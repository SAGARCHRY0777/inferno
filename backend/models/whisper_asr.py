"""Speech-to-text: Whisper via Hugging Face Transformers.

Accepts base64 **WAV** audio (the frontend records/encodes to 16 kHz mono WAV in
the browser, so no server-side ffmpeg is needed), runs the ASR pipeline over the
batch, and returns the transcript as a single prediction whose ``label`` is the
text (the UI renders it as a transcript because the model's task is
``transcription``).
"""

from __future__ import annotations

from backend.core.errors import InferenceError, ModelLoadError
from backend.core.logging import get_logger
from backend.core.schemas import Prediction
from backend.models.audio_decode import TARGET_SR, decode_mono16k
from backend.models.base import BaseModel
from backend.models.registry import register_kind

_log = get_logger("model.whisper")


@register_kind("whisper-asr")
class WhisperAsr(BaseModel):
    """Whisper speech recognition (transcription task)."""

    def load(self) -> None:
        try:
            from transformers import pipeline
        except ImportError as exc:  # pragma: no cover - optional extra
            raise ModelLoadError(f"transformers required for Whisper: {exc}") from exc

        from backend.models.runtime import resolve_torch_device

        model_id = self.params.get("model_id", "openai/whisper-tiny.en")
        device = resolve_torch_device()  # "cuda" or "cpu"
        self._pipe = pipeline(
            "automatic-speech-recognition",
            model=model_id,
            device=0 if device == "cuda" else -1,
        )
        _log.info("whisper_loaded", model_id=model_id, device=device)

    def preprocess(self, payloads: list[str]) -> list[dict]:
        return [
            {"array": decode_mono16k(p), "sampling_rate": TARGET_SR} for p in payloads
        ]

    def predict(self, batch: list[dict]):
        try:
            return self._pipe(batch)
        except Exception as exc:  # transformers raises various error types
            raise InferenceError(f"whisper inference failed: {exc}") from exc

    def postprocess(self, output) -> list[list[Prediction]]:
        # pipeline returns a list of {"text": ...} (one per input).
        if isinstance(output, dict):
            output = [output]
        results: list[list[Prediction]] = []
        for item in output:
            text = (item.get("text") or "").strip() or "(no speech detected)"
            results.append([Prediction(label=text, score=1.0)])
        return results
