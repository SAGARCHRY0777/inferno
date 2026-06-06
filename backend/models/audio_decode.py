"""Shared audio decoding for ASR models: base64 -> 16 kHz mono float32.

Used by both the transformers Whisper and faster-whisper plugins so the decode
path lives in one place. WAV/FLAC/OGG decode via ``soundfile`` (no ffmpeg).
"""

from __future__ import annotations

import base64
import io

import numpy as np

TARGET_SR = 16_000


def decode_mono16k(payload: str) -> np.ndarray:
    """Decode a base64 audio payload to a 16 kHz mono float32 waveform."""

    import soundfile as sf

    raw = base64.b64decode(payload, validate=True)
    data, sr = sf.read(io.BytesIO(raw), dtype="float32", always_2d=False)
    if data.ndim == 2:  # stereo -> mono
        data = data.mean(axis=1)
    if sr != TARGET_SR:
        data = _resample(data, sr, TARGET_SR)
    return data.astype(np.float32)


def _resample(data: np.ndarray, src_sr: int, dst_sr: int) -> np.ndarray:
    """Lightweight linear resample (no scipy/librosa dependency)."""

    if src_sr == dst_sr or data.size == 0:
        return data
    n_dst = int(round(data.shape[0] * dst_sr / src_sr))
    x_old = np.linspace(0.0, 1.0, num=data.shape[0], endpoint=False)
    x_new = np.linspace(0.0, 1.0, num=n_dst, endpoint=False)
    return np.interp(x_new, x_old, data).astype(np.float32)
