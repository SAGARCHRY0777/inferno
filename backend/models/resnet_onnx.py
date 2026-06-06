"""Image classifier: ResNet-18 served via ONNX Runtime.

On first load we export torchvision's pretrained ResNet-18 to ONNX (with a
dynamic batch axis) and cache it under the artifact dir, then serve all
subsequent requests through ONNX Runtime -- a realistic "train in PyTorch, serve
in ONNX" split. Preprocessing is the standard ImageNet pipeline; the model runs a
single batched forward pass over the whole window.
"""

from __future__ import annotations

import base64
import io
import json
from pathlib import Path

import numpy as np

from backend.core.config import get_settings
from backend.core.errors import InferenceError, ModelLoadError
from backend.core.logging import get_logger
from backend.core.schemas import Prediction
from backend.models.base import BaseModel
from backend.models.registry import register_kind

_log = get_logger("model.resnet")

_Batch = np.ndarray  # float32 [N, 3, 224, 224]
_Raw = np.ndarray    # logits [N, 1000]

# ImageNet normalization constants (the one place these live).
_MEAN = np.array([0.485, 0.456, 0.406], dtype=np.float32).reshape(3, 1, 1)
_STD = np.array([0.229, 0.224, 0.225], dtype=np.float32).reshape(3, 1, 1)
_SIDE = 224
_RESIZE = 256


@register_kind("onnx-image")
class ResNetOnnxModel(BaseModel[_Batch, _Raw]):
    """Pretrained ResNet-18 image classifier (ONNX Runtime backend)."""

    def load(self) -> None:
        import onnxruntime as ort  # local import: heavy, worker-only

        self._top_k = int(self.params.get("top_k", 5))
        artifact_dir: Path = get_settings().models.artifact_dir
        artifact_dir.mkdir(parents=True, exist_ok=True)
        onnx_path = artifact_dir / "resnet18.onnx"
        labels_path = artifact_dir / "resnet18_categories.json"

        if not onnx_path.exists() or not labels_path.exists():
            self._export(onnx_path, labels_path)

        from backend.models.runtime import resolve_onnx_providers

        self._categories: list[str] = json.loads(labels_path.read_text(encoding="utf-8"))
        providers = resolve_onnx_providers()
        self._session = ort.InferenceSession(str(onnx_path), providers=providers)
        self._input_name = self._session.get_inputs()[0].name
        _log.info(
            "resnet_loaded",
            onnx=str(onnx_path),
            classes=len(self._categories),
            providers=self._session.get_providers(),
        )

    def _export(self, onnx_path: Path, labels_path: Path) -> None:
        """Export torchvision ResNet-18 to ONNX with a dynamic batch dimension."""

        try:
            import torch
            from torchvision.models import ResNet18_Weights, resnet18
        except ImportError as exc:  # pragma: no cover - depends on extras
            raise ModelLoadError(f"torch/torchvision required to export ResNet: {exc}") from exc

        _log.info("resnet_exporting_onnx", target=str(onnx_path))
        weights = ResNet18_Weights.IMAGENET1K_V1
        net = resnet18(weights=weights).eval()
        labels_path.write_text(json.dumps(list(weights.meta["categories"])), encoding="utf-8")
        dummy = torch.randn(1, 3, _SIDE, _SIDE)
        torch.onnx.export(
            net,
            dummy,
            str(onnx_path),
            input_names=["input"],
            output_names=["logits"],
            dynamic_axes={"input": {0: "batch"}, "logits": {0: "batch"}},
            opset_version=17,
        )

    def preprocess(self, payloads: list[str]) -> _Batch:
        from PIL import Image  # local import: pillow

        tensors: list[np.ndarray] = []
        for payload in payloads:
            raw = base64.b64decode(payload, validate=True)
            img = Image.open(io.BytesIO(raw)).convert("RGB")
            img = _resize_center_crop(img, _RESIZE, _SIDE)
            arr = np.asarray(img, dtype=np.float32) / 255.0      # HWC in [0,1]
            arr = np.transpose(arr, (2, 0, 1))                   # CHW
            arr = (arr - _MEAN) / _STD                           # normalize
            tensors.append(arr)
        return np.stack(tensors).astype(np.float32)

    def predict(self, batch: _Batch) -> _Raw:
        try:
            (logits,) = self._session.run(None, {self._input_name: batch})
        except Exception as exc:  # onnxruntime raises its own error types
            raise InferenceError(f"onnx inference failed: {exc}") from exc
        return logits

    def postprocess(self, output: _Raw) -> list[list[Prediction]]:
        probs = _softmax(output, axis=1)
        results: list[list[Prediction]] = []
        for row in probs:
            top = np.argsort(row)[::-1][: self._top_k]
            results.append(
                [Prediction(label=self._categories[i], score=float(row[i])) for i in top]
            )
        return results


def _resize_center_crop(img, resize: int, side: int):
    from PIL import Image

    w, h = img.size
    scale = resize / min(w, h)
    img = img.resize((round(w * scale), round(h * scale)), Image.BILINEAR)
    w, h = img.size
    left, top = (w - side) // 2, (h - side) // 2
    return img.crop((left, top, left + side, top + side))


def _softmax(x: np.ndarray, axis: int) -> np.ndarray:
    shifted = x - np.max(x, axis=axis, keepdims=True)
    exp = np.exp(shifted)
    return exp / np.sum(exp, axis=axis, keepdims=True)
