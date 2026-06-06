"""Centralized exception hierarchy.

Every error the platform raises descends from :class:`InfernoError`, so callers
can catch the whole family in one place and each error carries a machine-readable
``code`` plus an HTTP status hint. We never raise bare ``Exception`` and never
use bare ``except`` -- catch a specific subclass and log with context.
"""

from __future__ import annotations

from http import HTTPStatus


class InfernoError(Exception):
    """Base class for all platform errors.

    Attributes:
        code: stable, machine-readable identifier (used by clients/UIs).
        http_status: the HTTP status the gateway should surface, if applicable.
    """

    code: str = "internal_error"
    http_status: int = HTTPStatus.INTERNAL_SERVER_ERROR

    def __init__(self, message: str | None = None) -> None:
        super().__init__(message or self.__class__.__doc__ or self.code)
        self.message = message or self.code


# --------------------------------------------------------------------------- #
# Validation / client errors                                                   #
# --------------------------------------------------------------------------- #
class ValidationError(InfernoError):
    """The request payload failed validation."""

    code = "validation_error"
    http_status = HTTPStatus.UNPROCESSABLE_ENTITY


class UnknownModelError(InfernoError):
    """The requested model is not registered."""

    code = "unknown_model"
    http_status = HTTPStatus.NOT_FOUND


# --------------------------------------------------------------------------- #
# Capacity / reliability                                                        #
# --------------------------------------------------------------------------- #
class UnauthorizedError(InfernoError):
    """Missing or invalid API key."""

    code = "unauthorized"
    http_status = HTTPStatus.UNAUTHORIZED


class RateLimitError(InfernoError):
    """The client exceeded its request quota; retry after the window resets."""

    code = "rate_limited"
    http_status = HTTPStatus.TOO_MANY_REQUESTS


class BackpressureError(InfernoError):
    """The queue is saturated; the client should retry later."""

    code = "backpressure"
    http_status = HTTPStatus.TOO_MANY_REQUESTS


class JobTimeoutError(InfernoError):
    """No result was produced within the configured deadline."""

    code = "job_timeout"
    http_status = HTTPStatus.GATEWAY_TIMEOUT


# --------------------------------------------------------------------------- #
# Model / worker execution                                                      #
# --------------------------------------------------------------------------- #
class ModelLoadError(InfernoError):
    """A model failed to load at worker startup."""

    code = "model_load_error"


class InferenceError(InfernoError):
    """A model failed while processing a specific job (fault-isolated)."""

    code = "inference_error"


class BrokerError(InfernoError):
    """The messaging broker (Redis) returned an unexpected failure."""

    code = "broker_error"
    http_status = HTTPStatus.SERVICE_UNAVAILABLE
