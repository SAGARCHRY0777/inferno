"""Centralized enumerations.

Every categorical value in the system is defined here exactly once. No module
should ever compare against a bare string literal like ``"success"`` or
``"image"`` -- import the enum member instead. This eliminates magic strings and
gives us a single place to evolve the vocabulary of the platform.
"""

from __future__ import annotations

from enum import Enum


class StrEnum(str, Enum):
    """A string-valued enum that serializes to its value.

    Python 3.10 lacks ``enum.StrEnum`` (added in 3.11), so we provide a minimal
    equivalent. Subclasses behave like plain strings on the wire (JSON, Redis)
    while remaining type-safe in code.
    """

    def __str__(self) -> str:  # pragma: no cover - trivial
        return str(self.value)


class InputType(StrEnum):
    """The kind of payload an inference request carries."""

    IMAGE = "image"
    TEXT = "text"
    AUDIO = "audio"


class TaskType(StrEnum):
    """What a model *does* -- drives how the UI renders its result.

    Adding a new task is how the platform generalizes: a model declares its task
    and the frontend picks the matching result renderer with no code changes.
    """

    CLASSIFICATION = "classification"  # label + score (sentiment, image class)
    DETECTION = "detection"            # labels + boxes (object detection)
    TRANSCRIPTION = "transcription"    # audio -> text transcript
    SEARCH = "search"                  # query -> ranked matching documents
    GENERATION = "generation"          # text -> text
    EMBEDDING = "embedding"            # -> vector


class JobStatus(StrEnum):
    """Lifecycle state of a job, surfaced to the UI as a state machine."""

    QUEUED = "queued"
    BATCHED = "batched"
    RUNNING = "running"
    DONE = "done"
    ERROR = "error"
    TIMEOUT = "timeout"


class ResultStatus(StrEnum):
    """Terminal outcome of an inference attempt."""

    SUCCESS = "success"
    ERROR = "error"


class WorkerState(StrEnum):
    """Operational state of a worker process, reported in heartbeats."""

    STARTING = "starting"
    IDLE = "idle"
    BATCHING = "batching"
    RUNNING = "running"
    DRAINING = "draining"
    STOPPED = "stopped"
