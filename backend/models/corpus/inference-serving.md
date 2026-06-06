# ML Inference Serving Concepts

Dynamic request batching groups several pending requests for the same model into a single batched forward pass. This maximizes hardware utilization and throughput. The batch window is the central latency-versus-throughput lever: a worker keeps collecting same-model requests until either a maximum batch size or a maximum wait time is reached, whichever comes first.

Backpressure protects the system from overload. When the queue depth crosses a high-water mark, the gateway sheds load by returning HTTP 429 with a Retry-After header instead of buffering unboundedly. It resumes accepting once depth falls below a low-water mark, and the hysteresis gap stops the system from flapping on and off around a single threshold.

Continuous batching, also called iteration-level scheduling, lets a server admit and evict requests between token-generation steps rather than only at request boundaries. It is the single biggest throughput win for large language model serving.

Quantization reduces a model's numerical precision, for example to INT8 or FP8, which shrinks the model and speeds up inference with minimal accuracy loss. Speculative decoding accelerates language model generation by drafting several tokens cheaply and verifying them in parallel, without changing the output distribution.

A result cache returns a stored answer when an identical request was already computed, skipping recomputation entirely. A semantic cache generalizes this by returning a previous answer when a new query is similar in meaning to an earlier one.

Graceful shutdown drains in-flight work when a worker receives a termination signal, finishing and acknowledging its current batch before exiting so that a deployment drops zero jobs.
