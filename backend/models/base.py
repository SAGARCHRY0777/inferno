"""The model plugin contract.

A new model drops into the platform by subclassing :class:`BaseModel`,
implementing four methods, and registering its *kind* with the registry. The
worker and runner depend only on this interface -- they never import a concrete
model -- so the inference engine is genuinely model-agnostic.

The pipeline is deliberately split into three batched stages so the expensive
middle stage (``predict``) operates on a whole batch at once:

    preprocess(list[str])  ->  Batch
    predict(Batch)         ->  RawOutput
    postprocess(RawOutput) ->  list[list[Prediction]]   # aligned to input order
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any, Generic, TypeVar

from backend.core.enums import InputType
from backend.core.schemas import Prediction

# A model defines what its preprocessed batch and raw output look like; the
# generics keep concrete models type-checked end to end.
Batch = TypeVar("Batch")
RawOutput = TypeVar("RawOutput")


class BaseModel(ABC, Generic[Batch, RawOutput]):
    """Abstract base every model plugin implements.

    Args:
        name: the registered model name clients request.
        input_type: which payload kind this model accepts.
        params: free-form model-specific configuration from ``models.yaml``.
    """

    def __init__(self, name: str, input_type: InputType, params: dict[str, Any] | None = None):
        self.name = name
        self.input_type = input_type
        self.params = params or {}
        self._loaded = False

    # -- lifecycle ---------------------------------------------------------- #
    @abstractmethod
    def load(self) -> None:
        """Load weights/tokenizers into memory. Called once at worker startup."""

    @property
    def loaded(self) -> bool:
        return self._loaded

    def ensure_loaded(self) -> None:
        """Idempotently load the model, marking it ready."""

        if not self._loaded:
            self.load()
            self._loaded = True

    # -- batched inference pipeline ---------------------------------------- #
    @abstractmethod
    def preprocess(self, payloads: list[str]) -> Batch:
        """Turn a batch of raw payload strings into a model-ready batch."""

    @abstractmethod
    def predict(self, batch: Batch) -> RawOutput:
        """Run a single batched forward pass over the whole batch."""

    @abstractmethod
    def postprocess(self, output: RawOutput) -> list[list[Prediction]]:
        """Split raw output into per-input predictions, preserving input order."""

    def warmup(self) -> None:
        """Optional: run a tiny batch so the first real request isn't cold.

        Default is a no-op; models with JIT/graph compilation may override.
        """
