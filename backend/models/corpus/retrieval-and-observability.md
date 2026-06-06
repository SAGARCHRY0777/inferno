# Retrieval, Vectors, and Observability

Retrieval-augmented generation grounds a language model in external documents. The system retrieves relevant passages for a query and supplies them as context, which reduces hallucination and lets the model cite sources. A typical pipeline is retrieve, then rerank, then generate.

Embeddings map text into a vector space where semantically similar text lands nearby. A bi-encoder embeds the query and each document independently, so document vectors can be precomputed and searched quickly by cosine similarity. A cross-encoder reranker then scores the top candidates by reading the query and passage together, which is more accurate but slower, so it is applied only to a small shortlist.

Vector databases such as Qdrant, pgvector, and LanceDB store embeddings and perform fast approximate nearest-neighbor search at scale. Matryoshka embeddings allow truncating a vector to fewer dimensions while keeping most of its quality, trading accuracy for speed and storage.

Prometheus scrapes numeric metrics from services and Grafana visualizes them, including latency percentiles like p50, p90, and p99 and request throughput. OpenTelemetry propagates trace context across services so a single request can be followed end to end as one distributed trace.

A horizontal pod autoscaler in Kubernetes adds or removes worker replicas based on a signal such as queue depth, so capacity tracks demand automatically. Carbon-aware scheduling shifts flexible work toward times and regions where electricity is cleaner.
