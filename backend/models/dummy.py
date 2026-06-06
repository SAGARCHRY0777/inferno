"""A dependency-free dummy model.

Used for Phase-1 bring-up, fast integration tests, and as the default worker
model so the whole platform runs end to end with zero heavyweight downloads. It
exercises the exact batched pipeline a real model uses, so nothing about the
plumbing is special-cased for it.
"""

from __future__ import annotations

import hashlib

from backend.core.schemas import Prediction
from backend.models.base import BaseModel
from backend.models.registry import register_kind

# The preprocessed batch is just the list of strings; raw output is a list of
# (label, score) lists. Typed via the generic base for clarity.
_Batch = list[str]
_Raw = list[list[tuple[str, float]]]


@register_kind("dummy")
class DummyModel(BaseModel[_Batch, _Raw]):
    """Deterministic stand-in that echoes a stable, payload-derived prediction."""

    def load(self) -> None:
        # Nothing to load; documents the lifecycle hook explicitly.
        self._labels: list[str] = list(self.params.get("labels", ["alpha", "beta", "gamma"]))

    def preprocess(self, payloads: list[str]) -> _Batch:
        return payloads

    def predict(self, batch: _Batch) -> _Raw:
        out: _Raw = []
        for payload in batch:
            # Deterministic pseudo-confidence from a hash so results are stable
            # and the UI shows varied, non-trivial scores.
            digest = hashlib.sha256(payload.encode("utf-8")).digest()
            idx = digest[0] % len(self._labels)
            score = 0.5 + (digest[1] / 255.0) * 0.5  # in [0.5, 1.0]
            out.append([(self._labels[idx], round(score, 4))])
        return out

    def postprocess(self, output: _Raw) -> list[list[Prediction]]:
        return [[Prediction(label=lbl, score=sc) for lbl, sc in preds] for preds in output]
