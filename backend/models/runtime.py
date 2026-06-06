"""Compute-device resolution shared by all model plugins.

One place decides whether work runs on CUDA or CPU, honoring
``INFERNO_INFERENCE__DEVICE`` and gracefully degrading when the requested
accelerator isn't actually available. Models call these helpers instead of
hardcoding ``"cpu"`` or a provider list.
"""

from __future__ import annotations

from backend.core.config import get_settings
from backend.core.logging import get_logger

_log = get_logger("model.runtime")


def resolve_torch_device() -> str:
    """Return the torch device string ("cuda" or "cpu") for the configured policy."""

    import torch

    pref = get_settings().inference.device
    cuda_ok = torch.cuda.is_available()
    if pref == "cuda" and not cuda_ok:
        _log.warning("cuda_requested_but_unavailable_falling_back_to_cpu")
        return "cpu"
    if pref == "cpu":
        return "cpu"
    # auto / cuda-with-cuda-available
    device = "cuda" if cuda_ok else "cpu"
    if pref == "auto":
        _log.info("device_auto_selected", device=device)
    return device


def optimize_torch_module(model, *, device: str):
    """Apply configured quantization + torch.compile to a torch model.

    Honors ``INFERNO_INFERENCE__QUANTIZE`` (int8 dynamic on CPU, fp16 on GPU) and
    ``INFERNO_INFERENCE__COMPILE``. Every step is guarded so an unsupported combo
    degrades gracefully to the unoptimized model rather than failing to load.
    """

    import torch

    s = get_settings().inference

    if s.quantize == "int8" and device == "cpu":
        try:
            model = torch.quantization.quantize_dynamic(model, {torch.nn.Linear}, dtype=torch.qint8)
            _log.info("quantized", mode="int8-dynamic")
        except Exception as exc:  # noqa: BLE001 - best-effort optimization
            _log.warning("quantize_failed", mode="int8", error=str(exc))
    elif s.quantize == "fp16" and device == "cuda":
        try:
            model = model.half()
            _log.info("quantized", mode="fp16")
        except Exception as exc:  # noqa: BLE001
            _log.warning("quantize_failed", mode="fp16", error=str(exc))
    elif s.quantize != "none":
        _log.info("quantize_skipped", reason=f"{s.quantize} not supported on {device}")

    if s.compile:
        try:
            model = torch.compile(model)
            _log.info("torch_compiled")
        except Exception as exc:  # noqa: BLE001
            _log.warning("compile_failed", error=str(exc))

    return model


def resolve_onnx_providers() -> list[str]:
    """Return the ONNX Runtime provider list for the configured policy.

    An explicit ``inference.onnx_providers`` wins. Otherwise we prefer CUDA when
    both the policy allows it and the CUDA provider is actually installed, always
    keeping CPU as the final fallback so inference never fails to find a provider.
    """

    import onnxruntime as ort

    settings = get_settings().inference
    if settings.onnx_providers:
        return settings.onnx_providers

    available = set(ort.get_available_providers())
    want_cuda = settings.device in ("auto", "cuda") and "CUDAExecutionProvider" in available
    if settings.device == "cuda" and "CUDAExecutionProvider" not in available:
        _log.warning("cuda_provider_unavailable_falling_back_to_cpu")
    providers = ["CPUExecutionProvider"]
    if want_cuda:
        providers.insert(0, "CUDAExecutionProvider")
    return providers
