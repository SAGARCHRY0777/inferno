"""Phase-0 smoke test: import the spine and exercise the dummy model offline."""

from backend.broker.redis_broker import RedisAsyncBroker, RedisWorkerBroker  # noqa: F401
from backend.core import constants, metrics, redis_keys, schemas, sysinfo, timing  # noqa: F401
from backend.core.config import get_settings
from backend.gateway.backpressure import BackpressureController  # noqa: F401
from backend.models.registry import build_model, list_specs

s = get_settings()
print(
    "settings ok:", s.environment,
    "| max_batch", s.batching.max_batch_size,
    "| device", s.inference.device,
)
print("models:", [m.name for m in list_specs()])

m = build_model("dummy-echo")
m.ensure_loaded()
out = m.postprocess(m.predict(m.preprocess(["hello world", "another text"])))
print("dummy preds:", [[(p.label, p.score) for p in row] for row in out])
print("percentile p50 of 1..100:", metrics.percentile([float(i) for i in range(1, 101)], 50))
print("SMOKE OK")
