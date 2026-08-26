# 🧩 Bring your own model

**Short answer:** there is no upload button. Models are registered **server-side**
in [`backend/models/models.yaml`](../backend/models/models.yaml), and each worker
process serves exactly one of them. For the most common formats you do not write
any code — you add a YAML entry pointing at your downloaded weights and start a
worker for it.

> **Why no upload UI?** Accepting an arbitrary model file over HTTP means
> executing untrusted code on the worker: a `.pt` checkpoint is a pickle, and
> loading one is equivalent to running whatever is inside it. Registering models
> in config keeps that decision with whoever operates the cluster.

---

## The three steps

```
1. put the weights where the worker can read them   (models.artifact_dir, default ./artifacts)
2. add an entry to backend/models/models.yaml       (name + kind + params)
3. start a worker for it                            INFERNO_WORKER__MODEL_NAME=<name>
```

The gateway picks the new model up automatically — `GET /models` advertises it
and the UI's model dropdown lists it. **A model with no running worker will
accept jobs and then time out after 30 s**, so step 3 is not optional.

---

## No code needed

### Hugging Face text classifier → `kind: hf-text`

`model_id` is passed straight to `from_pretrained`, which accepts a **local
directory** as readily as a Hub id.

```yaml
  - name: my-sentiment
    kind: hf-text
    input_type: text
    task: classification
    description: My fine-tuned sentiment model.
    params:
      model_id: /models/my-finetuned-distilbert   # or "org/model" to pull from the Hub
      max_length: 256
      top_k: 3
```

```bash
INFERNO_WORKER__MODEL_NAME=my-sentiment python -m backend.worker.main
```

### YOLO detector → `kind: yolo-detect`

`weights` resolves inside `models.artifact_dir` when it exists there, otherwise
it is handed to Ultralytics (which will download a known name).

```yaml
  - name: my-detector
    kind: yolo-detect
    input_type: image
    task: detection
    params:
      weights: my-yolov8-custom.pt   # drop this file into ./artifacts/
      conf: 0.35
      max_det: 20
```

### Any ONNX image classifier → `kind: onnx-image`

Point it at your exported graph plus a JSON array of class names **in the model's
output order**. Relative paths resolve inside `models.artifact_dir`; absolute
paths are used as-is.

```yaml
  - name: my-classifier
    kind: onnx-image
    input_type: image
    task: classification
    params:
      weights: my-model.onnx        # ./artifacts/my-model.onnx
      labels: my-labels.json        # ["cat", "dog", ...]
      top_k: 5
```

```json
["tench", "goldfish", "great white shark"]
```

If `weights` is set but the file is missing, the worker **fails loudly** rather
than silently falling back to the bundled ResNet-18 — otherwise you would get
confident predictions from an entirely different network.

Expected input: `1×3×224×224` NCHW float32, ImageNet-normalised. A model with a
different input shape or preprocessing needs its own `kind` (below).

### Whisper speech-to-text → `kind: faster-whisper-asr` / `whisper-asr`

```yaml
  - name: my-asr
    kind: faster-whisper-asr
    input_type: audio
    task: transcription
    params:
      model_size: /models/my-whisper-ct2   # a local CTranslate2 dir, or "small"/"medium"
```

---

## When you *do* need code

Write a new `kind` when your model's **preprocessing, output shape, or runtime**
differs from the bundled ones. It is one file implementing three methods:

```python
# backend/models/my_model.py
from backend.models.base import BaseModel
from backend.models.registry import register_kind


@register_kind("my-kind")                     # the string you put in models.yaml
class MyModel(BaseModel):
    def load(self) -> None:
        """Called once at worker start. Read self.params, load weights."""
        self._thing = load_my_weights(self.params["path"])

    def preprocess(self, payloads: list[str]) -> object:
        """Decode the raw request payloads into ONE batched tensor/array."""
        return batch_of(payloads)

    def predict(self, batch: object) -> object:
        """Run the forward pass on the whole batch at once."""
        return self._thing(batch)

    def postprocess(self, raw: object) -> list[list[Prediction]]:
        """Return ONE list of Predictions per input, in input order."""
        return [...]
```

Then register the module so `@register_kind` runs — add it to the import list in
[`backend/models/registry.py`](../backend/models/registry.py)
(`_ensure_kinds_imported`).

> ⚠️ **`postprocess` must return results in the same order as the inputs, one
> entry per input.** The runner validates the count and raises if it disagrees,
> but it cannot detect a re-ordering — that would silently return each caller
> someone else's answer.

Existing kinds worth copying from:

| Kind | File | Good template for |
|---|---|---|
| `dummy` | [`dummy.py`](../backend/models/dummy.py) | the minimal shape — start here |
| `hf-text` | [`distilbert.py`](../backend/models/distilbert.py) | Hugging Face text |
| `onnx-image` | [`resnet_onnx.py`](../backend/models/resnet_onnx.py) | ONNX Runtime + image preprocessing |
| `yolo-detect` | [`yolo.py`](../backend/models/yolo.py) | detection with bounding boxes |
| `faster-whisper-asr` | [`faster_whisper_asr.py`](../backend/models/faster_whisper_asr.py) | audio |
| `semantic-search` | [`semantic_search.py`](../backend/models/semantic_search.py) | embeddings |

---

## Running your model

| Where | How |
|---|---|
| Local (Windows) | `scripts\run-worker.bat my-model` |
| Local (any OS) | `INFERNO_WORKER__MODEL_NAME=my-model python -m backend.worker.main` |
| Docker Compose | copy a `worker-*` service in `docker-compose.yml`, change `INFERNO_WORKER__MODEL_NAME`, mount your weights into the `model-cache` volume |
| Kubernetes | copy a Deployment in `k8s/workers.yaml`, change the env var, and mount a PVC holding the weights (the bundled manifests use an `emptyDir`, which does **not** persist) |

Point `INFERNO_MODELS__CONFIG_PATH` at a different YAML file to keep your own
registry outside the repo, and `INFERNO_MODELS__ARTIFACT_DIR` at wherever the
weights live.

## Checklist

- [ ] Weights readable by the **worker** process (in the container/pod, not just the host)
- [ ] Entry added to `models.yaml` with a `kind` that exists
- [ ] `input_type` matches what clients send (`image` / `text` / `audio`)
- [ ] `task` set correctly — it drives how the UI renders results
- [ ] **A worker is actually running for it** (otherwise jobs hang for 30 s and fail)
- [ ] `GET /api/v1/health` lists it under `models`, and `workers_active` went up
