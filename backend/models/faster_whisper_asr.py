"""Fast speech-to-text: faster-whisper (CTranslate2) — 4–6× faster than HF Whisper.

Same transcription task and contract as the transformers Whisper plugin, but
backed by CTranslate2 with INT8 (CPU) / FP16 (GPU) compute for a big speedup.
"""

from __future__ import annotations

from backend.core.config import get_settings
from backend.core.errors import InferenceError, ModelLoadError
from backend.core.logging import get_logger
from backend.core.schemas import Prediction
from backend.models.audio_decode import decode_mono16k
from backend.models.base import BaseModel
from backend.models.registry import register_kind

_log = get_logger("model.faster_whisper")


@register_kind("faster-whisper-asr")
class FasterWhisperAsr(BaseModel):
    """faster-whisper (CTranslate2) speech recognition."""

    def load(self) -> None:
        try:
            from faster_whisper import WhisperModel
        except ImportError as exc:  # pragma: no cover - optional extra
            raise ModelLoadError(f"faster-whisper required: {exc}") from exc

        from backend.models.runtime import resolve_torch_device

        size = self.params.get("model_size", "tiny.en")
        device = resolve_torch_device()  # "cuda" or "cpu"
        compute = self.params.get("compute_type", "int8" if device == "cpu" else "float16")
        self._beam = int(self.params.get("beam_size", 1))
        artifact_dir = get_settings().models.artifact_dir
        artifact_dir.mkdir(parents=True, exist_ok=True)
        self._model = WhisperModel(
            size, device=device, compute_type=compute, download_root=str(artifact_dir)
        )
        _log.info("faster_whisper_loaded", size=size, device=device, compute_type=compute)

    def preprocess(self, payloads: list[str]):
        return [decode_mono16k(p) for p in payloads]

    def predict(self, batch):
        texts: list[str] = []
        try:
            for audio in batch:
                segments, _info = self._model.transcribe(audio, beam_size=self._beam)
                texts.append(" ".join(seg.text for seg in segments).strip())
        except Exception as exc:  # ctranslate2 raises its own error types
            raise InferenceError(f"faster-whisper inference failed: {exc}") from exc
        return texts

    def postprocess(self, output) -> list[list[Prediction]]:
        return [[Prediction(label=t or "(no speech detected)", score=1.0)] for t in output]
