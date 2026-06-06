"""Text sentiment: DistilBERT (SST-2) via Hugging Face Transformers.

Real tokenization and a single batched forward pass under ``torch.no_grad``. The
model id and label mapping come from the model config, so nothing about the
classes is hardcoded here.
"""

from __future__ import annotations

from backend.core.errors import InferenceError, ModelLoadError
from backend.core.logging import get_logger
from backend.core.schemas import Prediction
from backend.models.base import BaseModel
from backend.models.registry import register_kind

_log = get_logger("model.distilbert")

_DEFAULT_MODEL_ID = "distilbert-base-uncased-finetuned-sst-2-english"


@register_kind("hf-text")
class DistilBertSentiment(BaseModel):
    """Sentiment classifier returning calibrated per-label probabilities."""

    def load(self) -> None:
        try:
            import torch
            from transformers import AutoModelForSequenceClassification, AutoTokenizer
        except ImportError as exc:  # pragma: no cover - depends on extras
            raise ModelLoadError(f"transformers/torch required: {exc}") from exc

        self._torch = torch
        model_id = self.params.get("model_id", _DEFAULT_MODEL_ID)
        self._max_length = int(self.params.get("max_length", 256))
        self._top_k = int(self.params.get("top_k", 2))

        from backend.models.runtime import optimize_torch_module, resolve_torch_device

        self._device = resolve_torch_device()
        self._tokenizer = AutoTokenizer.from_pretrained(model_id)
        model = AutoModelForSequenceClassification.from_pretrained(model_id).eval().to(self._device)
        # Apply configured quantization / torch.compile (no-ops unless enabled).
        self._model = optimize_torch_module(model, device=self._device)
        self._id2label = self._model.config.id2label
        _log.info(
            "distilbert_loaded",
            model_id=model_id,
            device=self._device,
            labels=list(self._id2label.values()),
        )

    def preprocess(self, payloads: list[str]):
        return self._tokenizer(
            payloads,
            padding=True,
            truncation=True,
            max_length=self._max_length,
            return_tensors="pt",
        )

    def predict(self, batch):
        try:
            batch = batch.to(self._device)  # move tokenized tensors onto the device
            with self._torch.no_grad():
                logits = self._model(**batch).logits
            return self._torch.softmax(logits, dim=-1).cpu()  # back to CPU for postprocess
        except Exception as exc:  # torch raises its own error types
            raise InferenceError(f"transformer inference failed: {exc}") from exc

    def postprocess(self, output) -> list[list[Prediction]]:
        results: list[list[Prediction]] = []
        probs = output.tolist()
        for row in probs:
            ranked = sorted(enumerate(row), key=lambda kv: kv[1], reverse=True)[: self._top_k]
            results.append(
                [Prediction(label=self._id2label[i], score=float(score)) for i, score in ranked]
            )
        return results
