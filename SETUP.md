# Running Inferno on another computer

Copying the project folder alone **will not run** — the code travels, but the
installed **Python packages** (in the conda env, *outside* the folder), the
frontend **`node_modules`**, and the downloaded **model weights** do not. Do a
one-time setup, then run normally.

## What you install manually first (prerequisites)
These need admin rights, so install them yourself on the new PC:

| Prerequisite | Why | Link |
| --- | --- | --- |
| **Miniconda** | creates the Python 3.10 env + ML deps | https://docs.conda.io/en/latest/miniconda.html |
| **Node.js 20+** | builds/serves the React frontend | https://nodejs.org |
| *(GPU only)* NVIDIA driver + CUDA-capable GPU | runs models on GPU; otherwise it auto-falls back to CPU | — |

> **No API keys or secrets are required** — auth is off by default, so the app
> runs with zero configuration. (Only set values in `.env` if you deliberately
> enable `INFERNO_AUTH__*`.)

## Option A — Recommended: copy the folder + run setup (needs internet)
1. Copy the whole project folder to the new PC (or `git clone` the repo).
2. Open an **Anaconda Prompt** in the project folder.
3. Run **one** command — it installs the Python env + ML deps, the frontend
   deps, and portable Redis:
   ```bat
   scripts\setup.bat          :: CPU stack (works everywhere)
   scripts\setup.bat gpu      :: CUDA 12.4 stack (NVIDIA GPU)
   ```
4. Start everything:
   ```bat
   scripts\run-all.bat
   ```
   Open **http://localhost:5173**. The first run also downloads the model
   weights (a few minutes); later runs are instant.

That's it — after `setup.bat`, the project folder runs directly via `run-all.bat`.

## Option B — Offline: ship the exact env as a binary copy (no internet)
If the new PC has **no internet** (or you want the byte-identical env), use the
`conda-pack` tarball instead of reinstalling:

1. On THIS PC, build the env tarball (one-time, ~3 GB):
   ```bat
   scripts\pack-env.bat        :: -> dist\inferno-test-env.tar.gz
   ```
2. Copy the project folder **including** `dist\inferno-test-env.tar.gz`,
   `tools\redis\`, and `frontend\node_modules\` to the new PC.
3. On the new PC, restore the env:
   ```bat
   scripts\restore-env.bat     :: unpacks + conda-unpack
   ```
4. Run the frontend with the copied `node_modules` and the bundled Redis (no
   npm/conda install needed). See [ENVIRONMENT.md](ENVIRONMENT.md) for details.

> Option B requires the **same OS/CPU architecture** (Windows x64 → Windows x64).
> Option A is more portable and is what most people should use.

## Quick troubleshooting
- **`'conda' is not recognized`** → run from an *Anaconda Prompt*, or
  `conda init cmd.exe` once and reopen the terminal.
- **`'npm' is not recognized`** → install Node.js 20+ and reopen the terminal.
- **A window closes instantly / a service didn't start** → run the piece on its
  own (`scripts\run-redis.bat`, `scripts\run-backend.bat`, …) to see its error.
- **Close everything** → `scripts\stop-all.bat`.
