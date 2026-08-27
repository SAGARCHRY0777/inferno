"""Config-driven model registry.

Models are declared in ``models.yaml`` (one entry per servable model). Each
entry names a *kind* -- a registered ``BaseModel`` subclass -- plus its
``input_type`` and free-form ``params``. Concrete model classes register their
kind with :func:`register_kind`; the registry instantiates them on demand.

This indirection means adding a model is purely additive: write the class,
decorate it, add a YAML entry. No core code changes, nothing hardcoded.
"""

from __future__ import annotations

from collections.abc import Callable
from functools import lru_cache

import yaml
from pydantic import BaseModel as PydanticModel
from pydantic import Field

from backend.core.config import get_settings
from backend.core.enums import InputType, TaskType
from backend.core.errors import ModelLoadError, UnknownModelError
from backend.core.logging import get_logger
from backend.models.base import BaseModel

_log = get_logger("registry")

# kind -> concrete model class. Populated by @register_kind at import time.
_KINDS: dict[str, type[BaseModel]] = {}


def register_kind(kind: str) -> Callable[[type[BaseModel]], type[BaseModel]]:
    """Class decorator registering a model implementation under ``kind``."""

    def _decorator(cls: type[BaseModel]) -> type[BaseModel]:
        if kind in _KINDS and _KINDS[kind] is not cls:
            raise ModelLoadError(f"duplicate model kind registered: {kind!r}")
        _KINDS[kind] = cls
        return cls

    return _decorator


class ModelSpec(PydanticModel):
    """A single servable-model declaration from ``models.yaml``."""

    name: str = Field(..., min_length=1)
    kind: str = Field(..., min_length=1)
    input_type: InputType
    task: TaskType = TaskType.CLASSIFICATION
    description: str = ""
    params: dict = Field(default_factory=dict)
    version: str = Field(
        default="",
        description=(
            "Optional operator-set version tag (e.g. '2024-11-a', a git sha, a weights "
            "digest). Bump it whenever the weights or params change: it is part of the "
            "result-cache key and is recorded on every history row, so a stale cached "
            "answer can never outlive the model that produced it."
        ),
    )

    def fingerprint(self) -> str:
        """Identity of the *artifact*, not just the name.

        Two models can share a `name` across a weights swap — that is exactly the
        dangerous case. Derived from `kind`, `params` and `version`, so changing
        `model_id`, a weights path or the version tag all produce a new
        fingerprint without the operator having to remember to bump anything.
        """

        import hashlib
        import json

        material = json.dumps(
            {"kind": self.kind, "params": self.params, "version": self.version},
            sort_keys=True,
            default=str,
        )
        return hashlib.sha256(material.encode()).hexdigest()[:12]


@lru_cache(maxsize=1)
def load_specs() -> dict[str, ModelSpec]:
    """Parse and cache all model specs, keyed by model name."""

    path = get_settings().models.config_path
    if not path.exists():
        raise ModelLoadError(f"models config not found: {path}")
    raw = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    specs: dict[str, ModelSpec] = {}
    for entry in raw.get("models", []):
        spec = ModelSpec.model_validate(entry)
        if spec.name in specs:
            raise ModelLoadError(f"duplicate model name in config: {spec.name!r}")
        specs[spec.name] = spec
    if not specs:
        raise ModelLoadError("no models defined in config")
    _log.info("model_specs_loaded", count=len(specs), names=list(specs))
    return specs


def list_specs() -> list[ModelSpec]:
    """All declared model specs (backs ``GET /models``)."""

    return list(load_specs().values())


def build_model(name: str) -> BaseModel:
    """Instantiate (but do not yet ``load``) the model named ``name``.

    Importing this module's sibling model modules must have populated ``_KINDS``;
    we import them lazily here to avoid a heavy import at module load time.
    """

    _ensure_kinds_imported()
    specs = load_specs()
    spec = specs.get(name)
    if spec is None:
        raise UnknownModelError(f"model not registered: {name!r}")
    kind_cls = _KINDS.get(spec.kind)
    if kind_cls is None:
        raise ModelLoadError(
            f"model {name!r} requires kind {spec.kind!r}, which is not registered"
        )
    return kind_cls(name=spec.name, input_type=spec.input_type, params=spec.params)


def _ensure_kinds_imported() -> None:
    """Import the bundled model modules so their @register_kind runs.

    Kept local (not top-level) so heavy deps (torch/onnx) load only in worker
    processes that actually build a model, not in the gateway.
    """

    from backend.models import dummy  # noqa: F401  (registers "dummy")

    # Heavy/optional kinds -- each imported independently so one missing extra
    # (e.g. ultralytics) never disables the others.
    for module in (
        "distilbert", "resnet_onnx", "yolo", "whisper_asr",
        "faster_whisper_asr", "semantic_search", "rag",
    ):
        try:
            __import__(f"backend.models.{module}")
        except ImportError as exc:  # pragma: no cover - depends on installed extras
            _log.warning("optional_model_kind_unavailable", module=module, error=str(exc))
