"""Host resource telemetry: CPU/RAM via psutil, GPU via guarded pynvml.

Every GPU call is wrapped so the platform behaves **identically** on a CPU-only
machine -- the import is optional, initialization failures are swallowed, and the
GPU list simply comes back empty. Workers call :func:`collect` each heartbeat.
"""

from __future__ import annotations

import psutil

from backend.core.config import get_settings
from backend.core.logging import get_logger
from backend.core.schemas import GpuStats

_log = get_logger("sysinfo")

# --- Optional GPU support (guarded import) --------------------------------- #
try:  # pragma: no cover - presence depends on host
    import pynvml  # type: ignore

    _PYNVML_AVAILABLE = True
except ImportError:  # CPU-only host, or driver/lib absent
    pynvml = None  # type: ignore
    _PYNVML_AVAILABLE = False

_gpu_initialized = False
_gpu_usable = False


def _ensure_gpu() -> bool:
    """Initialize NVML once. Returns True only if a GPU is actually usable."""

    global _gpu_initialized, _gpu_usable
    if _gpu_initialized:
        return _gpu_usable
    _gpu_initialized = True
    if not (_PYNVML_AVAILABLE and get_settings().metrics.enable_gpu):
        return False
    try:
        pynvml.nvmlInit()
        _gpu_usable = pynvml.nvmlDeviceGetCount() > 0
    except Exception as exc:  # pynvml raises its own error types; stay defensive
        _log.info("gpu_unavailable", reason=str(exc))
        _gpu_usable = False
    return _gpu_usable


def collect_gpus() -> list[GpuStats]:
    """Return per-device GPU stats, or an empty list when no GPU is present."""

    if not _ensure_gpu():
        return []
    out: list[GpuStats] = []
    try:
        count = pynvml.nvmlDeviceGetCount()
        for i in range(count):
            h = pynvml.nvmlDeviceGetHandleByIndex(i)
            util = pynvml.nvmlDeviceGetUtilizationRates(h)
            mem = pynvml.nvmlDeviceGetMemoryInfo(h)
            name = pynvml.nvmlDeviceGetName(h)
            out.append(
                GpuStats(
                    index=i,
                    name=name.decode() if isinstance(name, bytes) else name,
                    utilization_pct=float(util.gpu),
                    vram_used_mb=mem.used / (1024 * 1024),
                    vram_total_mb=mem.total / (1024 * 1024),
                )
            )
    except Exception as exc:  # never let telemetry crash the worker
        _log.warning("gpu_collect_failed", error=str(exc))
        return []
    return out


def collect_cpu_ram() -> tuple[float, float]:
    """Return (cpu_pct, ram_pct). Non-blocking CPU read (interval=None)."""

    return float(psutil.cpu_percent(interval=None)), float(psutil.virtual_memory().percent)
