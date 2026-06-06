"""Centralized structured logging (structlog).

Configured exactly once per process via :func:`configure_logging`. Every module
obtains a logger with :func:`get_logger` and binds the standard dimensions from
``core.constants`` (job_id, worker_id, model_name, batch_size). We emit JSON in
production for machine ingestion and a colorized console renderer in dev. There
is no ``print()`` anywhere in the codebase.
"""

from __future__ import annotations

import logging
import sys
from typing import Any

import structlog

from backend.core import constants as C
from backend.core.config import get_settings

_configured = False


def configure_logging(*, service: str | None = None) -> None:
    """Initialize logging for the current process. Idempotent.

    Args:
        service: logical service name bound onto every log line
            (e.g. ``"gateway"`` or ``"worker"``). Defaults to the configured
            ``service_name``.
    """

    global _configured
    if _configured:
        return

    settings = get_settings()
    level = getattr(logging, settings.logging.level)

    # Route stdlib logging (uvicorn, redis) through structlog's pipeline so we
    # get one consistent, structured stream rather than two log formats.
    logging.basicConfig(format="%(message)s", stream=sys.stdout, level=level)

    shared_processors: list[structlog.types.Processor] = [
        structlog.contextvars.merge_contextvars,
        structlog.processors.add_log_level,
        structlog.processors.TimeStamper(fmt="iso", utc=True),
        structlog.processors.StackInfoRenderer(),
        structlog.processors.format_exc_info,
    ]

    renderer: structlog.types.Processor = (
        structlog.processors.JSONRenderer()
        if settings.logging.render_json
        else structlog.dev.ConsoleRenderer(colors=True)
    )

    structlog.configure(
        processors=[*shared_processors, renderer],
        wrapper_class=structlog.make_filtering_bound_logger(level),
        logger_factory=structlog.PrintLoggerFactory(),
        cache_logger_on_first_use=True,
    )

    # Bind process-wide context every line inherits.
    structlog.contextvars.bind_contextvars(
        **{
            C.LOG_SERVICE: service or settings.service_name,
        }
    )
    _configured = True


def get_logger(component: str, **bind: Any) -> structlog.stdlib.BoundLogger:
    """Return a logger tagged with a component name and optional bound fields.

    Args:
        component: the subsystem emitting logs (e.g. ``"batcher"``).
        **bind: additional static fields to bind (e.g. ``worker_id=...``).
    """

    return structlog.get_logger().bind(**{C.LOG_COMPONENT: component, **bind})
