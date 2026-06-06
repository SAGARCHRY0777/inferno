# Inferno Architecture

Inferno is a horizontally scalable machine learning inference platform. A client submits an inference job over a REST API. The job is validated and enqueued in Redis. A pool of independent worker processes pulls jobs, performs dynamic request batching, runs the model, and publishes the result. The client receives its result in real time over a WebSocket, correlated by job id, with no polling.

The gateway never runs models. It validates input, applies backpressure, enqueues jobs, and relays results. Keeping the gateway lean and fully asynchronous means scaling it is just running more copies behind a load balancer.

Workers are independent processes that share nothing but Redis. Scaling the throughput of a model is simply launching more workers for that model. Each worker has a stable worker id and loads exactly one configured model at startup.

The job queue uses Redis Streams with consumer groups. This gives at-least-once delivery, prevents double processing across workers, and supports explicit acknowledgements. If a worker dies mid-batch, its unacknowledged entries remain claimable and another worker reclaims them, so no job is ever lost.

Results flow back through Redis Pub/Sub, one channel per job id. The gateway holds a single pattern subscription and dispatches each result to the in-process waiter for that job, keeping Redis connection usage constant regardless of how many clients are connected.
