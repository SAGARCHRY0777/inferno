"""The messaging-broker abstraction.

Gateway and worker depend on these interfaces, **not** on Redis directly. That
decoupling means the transport can be swapped (Redis Streams today; Kafka, NATS,
or an in-memory fake for tests tomorrow) without touching a single line of
business logic. The async interface serves the fully-async gateway; the sync
interface serves the worker's tight inner loop.
"""

from __future__ import annotations

from abc import ABC, abstractmethod

from backend.core.schemas import InferenceResult, Job, WorkerHeartbeat

# A consumed stream entry: (broker-native entry id, decoded Job).
ConsumedEntry = tuple[str, Job]


class AsyncBroker(ABC):
    """Gateway-side operations: enqueue, depth probing, result delivery."""

    @abstractmethod
    async def ensure_topology(self, model_names: list[str]) -> None:
        """Create streams/consumer groups for the given models (idempotent)."""

    @abstractmethod
    async def enqueue(self, job: Job) -> str:
        """Append a job to its model's queue; return the broker entry id."""

    @abstractmethod
    async def queue_depth(self, model_name: str) -> int:
        """Pending depth for one model lane."""

    @abstractmethod
    async def total_queue_depth(self, model_names: list[str]) -> int:
        """Summed pending depth across the given model lanes."""

    @abstractmethod
    async def list_heartbeats(self) -> list[WorkerHeartbeat]:
        """Snapshot of currently-live worker heartbeats."""

    @abstractmethod
    async def aclose(self) -> None:
        """Release resources."""


class WorkerBroker(ABC):
    """Worker-side operations: consume, ack, publish, reclaim, heartbeat (sync)."""

    @abstractmethod
    def ensure_topology(self, model_name: str) -> None:
        """Create the stream + consumer group for this worker's model lane."""

    @abstractmethod
    def read_first(
        self, model_name: str, consumer: str, *, block_ms: int
    ) -> ConsumedEntry | None:
        """Block up to ``block_ms`` for the first job of a new batch window.

        Returns ``None`` if the window timed out with no work -- the worker then
        loops (checking for shutdown/reclaim) rather than blocking forever.
        """

    @abstractmethod
    def read_more(
        self, model_name: str, consumer: str, *, count: int
    ) -> list[ConsumedEntry]:
        """Non-blocking read of up to ``count`` additional pending jobs.

        The batcher calls this repeatedly inside the wait window to grow the
        batch; it returns immediately with whatever is available (possibly none).
        """

    @abstractmethod
    def ack(self, model_name: str, entry_ids: list[str]) -> None:
        """Acknowledge successfully-processed entries (at-least-once -> once)."""

    @abstractmethod
    def publish_result(self, result: InferenceResult) -> None:
        """Publish a result to its job channel and store it TTL'd (late-join safe)."""

    @abstractmethod
    def reclaim_stale(
        self,
        model_name: str,
        consumer: str,
        *,
        min_idle_ms: int,
        count: int,
    ) -> list[ConsumedEntry]:
        """Claim entries abandoned by a dead worker so no job is stranded."""

    @abstractmethod
    def heartbeat(self, hb: WorkerHeartbeat, ttl_s: int) -> None:
        """Publish this worker's heartbeat with a TTL (auto-expires on death)."""

    @abstractmethod
    def close(self) -> None:
        """Release resources."""
