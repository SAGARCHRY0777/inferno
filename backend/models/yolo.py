"""Object detection: YOLOv8 via Ultralytics.

Returns one :class:`Prediction` per detected object, each carrying a normalized
``[x1, y1, x2, y2]`` bounding box so the UI can overlay it on the image at any
display size. Runs the whole batch in a single call; honors the configured
device (CUDA when available, else CPU).
"""

from __future__ import annotations

import base64
import io

from backend.core.config import get_settings
from backend.core.errors import InferenceError, ModelLoadError
from backend.core.logging import get_logger
from backend.core.schemas import Prediction
from backend.models.base import BaseModel
from backend.models.registry import register_kind

_log = get_logger("model.yolo")


@register_kind("yolo-detect")
class YoloDetector(BaseModel):
    """YOLOv8 object detector (Ultralytics backend)."""

    def load(self) -> None:
        try:
            from ultralytics import YOLO
        except ImportError as exc:  # pragma: no cover - optional extra
            raise ModelLoadError(f"ultralytics required for YOLO: {exc}") from exc

        from backend.models.runtime import resolve_torch_device

        weights = self.params.get("weights", "yolov8n.pt")
        self._conf = float(self.params.get("conf", 0.35))
        self._max_det = int(self.params.get("max_det", 20))
        artifact_dir = get_settings().models.artifact_dir
        artifact_dir.mkdir(parents=True, exist_ok=True)

        # Ultralytics downloads weights on first use; keep them under artifacts.
        weights_path = artifact_dir / weights
        self._model = YOLO(str(weights_path) if weights_path.exists() else weights)
        self._device = resolve_torch_device()
        self._names = self._model.names
        _log.info("yolo_loaded", weights=weights, device=self._device, classes=len(self._names))

    def preprocess(self, payloads: list[str]):
        from PIL import Image

        images = []
        for payload in payloads:
            raw = base64.b64decode(payload, validate=True)
            images.append(Image.open(io.BytesIO(raw)).convert("RGB"))
        return images

    def predict(self, batch):
        try:
            return self._model.predict(
                batch,
                conf=self._conf,
                max_det=self._max_det,
                device=self._device,
                verbose=False,
            )
        except Exception as exc:  # ultralytics raises various error types
            raise InferenceError(f"yolo inference failed: {exc}") from exc

    def postprocess(self, output) -> list[list[Prediction]]:
        results: list[list[Prediction]] = []
        for res in output:
            preds: list[Prediction] = []
            boxes = getattr(res, "boxes", None)
            if boxes is not None and len(boxes) > 0:
                xyxyn = boxes.xyxyn.tolist()  # normalized [x1,y1,x2,y2]
                confs = boxes.conf.tolist()
                clss = boxes.cls.tolist()
                for box, conf, cls in zip(xyxyn, confs, clss, strict=False):
                    preds.append(
                        Prediction(
                            label=self._names[int(cls)],
                            score=float(conf),
                            box=[round(float(v), 4) for v in box],
                        )
                    )
            results.append(preds)
        return results
