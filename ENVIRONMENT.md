# Reproducing the Python environment

The backend runs in a conda env named **`test`** (Python 3.10, the CUDA 12.4 ML
stack). There are **three** ways to reproduce it — pick by your need.

| Need | Use | Cross-machine? | Internet? | Size |
| --- | --- | --- | --- | --- |
| Rebuild the env from scratch | `environment.yml` | ✅ any OS/arch | required | tiny recipe |
| Pin-exact pip reinstall | `requirements.lock.txt` | ✅ | required | tiny recipe |
| **Direct binary copy** of the env | `conda-pack` tarball | ⚠️ same OS/arch only | **offline** | ~3 GB |
| Install just the app package | `dist/inferno-*.whl` | ✅ | for deps | 91 KB |

Regenerate the recipe + wheel any time with **`scripts\export-env.bat`**.

---

## 1. Recipe — `environment.yml` (recommended for a fresh machine)

```bat
conda env create -f environment.yml
conda activate test
```

> The `test` env uses `torch==2.5.1+cu124` / `torchvision==0.20.1+cu124`, which
> plain PyPI does **not** host. `environment.yml`'s pip section therefore carries
> `--extra-index-url https://download.pytorch.org/whl/cu124` (injected
> automatically by `scripts\export-env.bat`). Without it the recreate fails to
> resolve torch. On a **CPU-only** box, ignore `environment.yml` and build the
> CPU stack instead:
> ```bat
> conda create -n test python=3.10 -y && conda activate test
> pip install -r requirements.txt -r requirements-ml-cpu.txt
> ```

## 2. Recipe — `requirements.lock.txt` (exact pip freeze)

For an existing Python 3.10 (conda or venv):

```bat
pip install -r requirements.lock.txt --extra-index-url https://download.pytorch.org/whl/cu124
```

`requirements.lock.txt` is the full `pip freeze` of the verified env (every
transitive pin). `requirements*.txt` remain the human-edited source of truth;
the lock is the machine-exact snapshot.

## 3. Direct copy — `conda-pack` (move the exact env, offline)

Produces a relocatable tarball of the *whole env directory* — no re-resolve, no
re-download, byte-for-byte the same packages. **Same OS/arch only** (the one in
`dist\` was packed on Windows x64).

```bat
:: On the source machine — create dist\inferno-test-env.tar.gz (~3 GB):
scripts\pack-env.bat

:: Copy that tarball to the target machine, then:
scripts\restore-env.bat            :: unpacks + runs conda-unpack to fix paths
```

Manual restore (equivalent to the script):
```bat
mkdir test-env && tar -xzf inferno-test-env.tar.gz -C test-env
call test-env\Scripts\activate.bat
test-env\Scripts\conda-unpack.exe
```

> `conda-unpack` is required: it rewrites the absolute paths baked into the env.
> The tarball is gitignored (too large for the repo) — share it out-of-band
> (network drive / release asset / object storage).

## 4. The project wheel — `dist\inferno-0.1.0-py3-none-any.whl`

Installs the **app package** (`backend.*` modules + `models.yaml` + the RAG
corpus) with its core runtime deps (read from `requirements.txt`):

```bat
pip install dist\inferno-0.1.0-py3-none-any.whl          :: gateway + dummy model + tests
pip install -r requirements-ml-cpu.txt                   :: add the model stack (or -gpu)
```

The wheel deliberately does **not** bundle the heavy ML stack: those wheels need
PyTorch's `--extra-index-url`, which wheel metadata can't encode. Install them
from the requirements files as shown.

---

### Known wart (faithfully captured)

The source env has **both** `onnxruntime==1.23.2` (CPU) and
`onnxruntime-gpu==1.20.1` installed — a leftover from layering the CPU and GPU
stacks. Inference works (ONNX Runtime picks an available provider), and the
exports reflect reality. For a clean single-distribution env, keep only
`onnxruntime-gpu` (GPU) **or** `onnxruntime` (CPU), then re-run
`scripts\export-env.bat`.
