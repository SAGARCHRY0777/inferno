"""Centralized enumerations.

Every categorical value in the system is defined here exactly once. No module
should ever compare against a bare string literal like ``"success"`` or
``"image"`` -- import the enum member instead. This eliminates magic strings and
gives us a single place to evolve the vocabulary of the platform.
"""

from __future__ import annotations

# Members serialize as plain strings on the wire (JSON, Redis) while staying
# type-safe in code. This was a hand-rolled `class StrEnum(str, Enum)` while the
# floor was 3.10; the stdlib has had it since 3.11.
from enum import StrEnum


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
