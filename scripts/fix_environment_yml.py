"""Turn a raw `conda env export` into a portable environment.yml.

Reads env-raw-tmp.yml (produced by `conda env export -n test --no-builds`) and:
  * drops the machine-specific `prefix:` line,
  * injects PyTorch's --extra-index-url as the first pip entry, so the +cu124
    torch/torchvision wheels resolve on recreate (plain PyPI does not host them),
  * prepends a short usage header.
Writes environment.yml in the repo root.
"""
from __future__ import annotations

import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "env-raw-tmp.yml")
OUT = os.path.join(ROOT, "environment.yml")

PYTORCH_INDEX = "https://download.pytorch.org/whl/cu124"

HEADER = [
    "# Inferno - exact conda env 'test' (Python 3.10, CUDA 12.4 ML stack).",
    "# Recreate:  conda env create -f environment.yml   then  conda activate test",
    "#",
    "# torch/torchvision are the +cu124 builds, which plain PyPI does NOT host - the",
    "# pip --extra-index-url line below is REQUIRED for recreation to resolve them.",
    "# On a CPU-only machine, skip this file and build the CPU stack instead:",
    "#   conda create -n test python=3.10 -y && conda activate test",
    "#   pip install -r requirements.txt -r requirements-ml-cpu.txt",
    "",
]


def main() -> int:
    if not os.path.exists(RAW):
        raise SystemExit(
            f"missing {RAW} - run: conda env export -n test --no-builds > env-raw-tmp.yml"
        )
    out: list[str] = []
    for ln in open(RAW, encoding="utf-8").read().splitlines():
        if ln.startswith("prefix:"):
            continue
        out.append(ln)
        if ln.strip() == "- pip:":
            out.append(f"      - --extra-index-url {PYTORCH_INDEX}")
    open(OUT, "w", encoding="utf-8").write("\n".join(HEADER) + "\n".join(out) + "\n")
    print(f"wrote {OUT} ({sum(1 for _ in open(OUT, encoding='utf-8'))} lines)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
