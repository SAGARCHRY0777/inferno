"""OpenTelemetry tracing -- optional and fully guarded.

When ``INFERNO_OTEL__ENABLED`` is false (default) or the OTel packages aren't
installed, everything here is a no-op: :func:`get_tracer` returns a tracer whose
spans do nothing, and inject/extract pass through. So instrumentation can be
sprinkled through the code unconditionally with zero overhead when off.

When enabled, the gateway and workers export spans to an OTLP/HTTP collector
(or the console), and trace context is propagated from gateway to worker via the
``Job.trace`` carrier so one request shows up as a single distributed trace.
"""

from __future__ import annotations

from typing import Any

from backend.core.config import get_settings
from backend.core.logging import get_logger

_log = get_logger("tracing")
_configured = False
_OTEL: Any = None  # the opentelemetry.trace module, or None


def configure_tracing(service: str) -> None:
    """Initialize the tracer provider for this process (idempotent, guarded)."""

    global _configured, _OTEL
    if _configured:
        return
    _configured = True

    settings = get_settings().otel
    if not settings.enabled:
        return
    try:
        from opentelemetry import trace
        from opentelemetry.sdk.resources import SERVICE_NAME, Resource
        from opentelemetry.sdk.trace import TracerProvider
        from opentelemetry.sdk.trace.export import BatchSpanProcessor, ConsoleSpanExporter

        provider = TracerProvider(resource=Resource.create({SERVICE_NAME: f"inferno-{service}"}))
        if settings.endpoint:
            from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter

            exporter: Any = OTLPSpanExporter(endpoint=settings.endpoint)
        else:
            exporter = ConsoleSpanExporter()
        provider.add_span_processor(BatchSpanProcessor(exporter))
        trace.set_tracer_provider(provider)
        _OTEL = trace
        _log.info("tracing_enabled", service=service, endpoint=settings.endpoint or "console")
    except Exception as exc:  # noqa: BLE001 - tracing must never break the app
        _log.warning("tracing_setup_failed", error=str(exc))
        _OTEL = None


def get_tracer(name: str):
    """Return a tracer (real if enabled, otherwise a no-op)."""

    if _OTEL is not None:
        return _OTEL.get_tracer(name)
    return _NoopTracer()


def inject(carrier: dict[str, str]) -> dict[str, str]:
    """Inject the current span context into a carrier dict (W3C traceparent)."""

    if _OTEL is None:
        return carrier
    try:
        from opentelemetry.propagate import inject as _inject

        _inject(carrier)
    except Exception as exc:  # noqa: BLE001
        _log.debug("trace_inject_failed", error=str(exc))
    return carrier


def extract(carrier: dict[str, str]):
    """Extract a parent context from a carrier (returns None when disabled)."""

    if _OTEL is None or not carrier:
        return None
    try:
        from opentelemetry.propagate import extract as _extract

        return _extract(carrier)
    except Exception:  # noqa: BLE001
        return None


def instrument_fastapi(app) -> None:
    """Auto-instrument a FastAPI app if tracing is enabled (guarded)."""

    if _OTEL is None:
        return
    try:
        from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor

        FastAPIInstrumentor.instrument_app(app)
    except Exception as exc:  # noqa: BLE001
        _log.warning("fastapi_instrument_failed", error=str(exc))


class _NoopSpan:
    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def set_attribute(self, *_a, **_k):
        pass


class _NoopTracer:
    def start_as_current_span(self, *_a, **_k):
        return _NoopSpan()
