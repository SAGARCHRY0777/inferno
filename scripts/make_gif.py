"""Assemble docs/demo/frames/*.png into an optimized looping GIF.

A true 60s GIF at smooth framerate would be 100+ MB — useless for a README.
Instead we build a tasteful, downscaled, color-quantized highlight loop that
GitHub renders inline and autoplays. The full 60s lives in the .webm video.

Usage:  python scripts/make_gif.py            # default 960px wide, 100ms/frame
        python scripts/make_gif.py --width 800 --duration 90 --colors 96
"""
from __future__ import annotations

import argparse
import glob
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FRAMES = os.path.join(ROOT, "docs", "demo", "frames")
OUT = os.path.join(ROOT, "docs", "demo", "inferno-demo.gif")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--width", type=int, default=960, help="output width in px")
    ap.add_argument("--duration", type=int, default=100, help="ms per frame")
    ap.add_argument("--colors", type=int, default=128, help="palette size (<=256)")
    ap.add_argument("--step", type=int, default=1, help="keep every Nth frame (shrinks file)")
    ap.add_argument("--out", default=OUT)
    args = ap.parse_args()

    try:
        from PIL import Image
    except ImportError:
        print("Pillow is required:  pip install pillow", file=sys.stderr)
        return 2

    paths = sorted(glob.glob(os.path.join(FRAMES, "*.png")))
    if not paths:
        print(f"no frames in {FRAMES} — run frontend/demo-capture.mjs first", file=sys.stderr)
        return 1
    if args.step > 1:
        paths = paths[:: args.step]

    frames = []
    for p in paths:
        im = Image.open(p).convert("RGB")
        if im.width != args.width:
            h = round(im.height * args.width / im.width)
            im = im.resize((args.width, h), Image.LANCZOS)
        # Adaptive palette keeps the dark UI gradients clean at small file size.
        frames.append(im.convert("P", palette=Image.ADAPTIVE, colors=args.colors))

    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    frames[0].save(
        args.out,
        save_all=True,
        append_images=frames[1:],
        duration=args.duration,
        loop=0,
        optimize=True,
        disposal=2,
    )
    size_mb = os.path.getsize(args.out) / 1e6
    print(f"wrote {args.out}  ({len(frames)} frames, {size_mb:.1f} MB)")
    if size_mb > 12:
        print("  (>12MB — consider --width 800 or --colors 96 for GitHub)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
