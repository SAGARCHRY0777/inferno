"""Standalone streaming chat service.

A separate process from the gateway (so the gateway stays thin and never loads a
model). It serves a single SSE endpoint that:
  1. optionally retrieves grounding passages from the platform via the gateway's
     RAG model (it's just an HTTP/WS client of the public API);
  2. streams a grounded, cited answer from the local LLM token-by-token.

Run it::

    python -m backend.chat.app          # serves on :8100

This is the production-shaped split: the LLM serving tier is its own service
that scales independently of the inference gateway.
"""

from __future__ import annotations

import asyncio
import json

import httpx
import websockets
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from backend.chat.engine import engine
from backend.core.config import get_settings
from backend.core.logging import configure_logging, get_logger

_log = get_logger("chat.app")


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    messages: list[ChatMessage] = Field(..., min_length=1)
    use_rag: bool = True


def _sse(data: dict) -> str:
    return f"data: {json.dumps(data)}\n\n"


async def _retrieve(query: str) -> list[dict]:
    """Fetch grounding passages from the gateway's RAG model (decoupled client)."""

    base = get_settings().chat.gateway_url.rstrip("/")
    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            resp = await client.post(
                f"{base}/api/v1/infer",
                json={"model_name": "rag-search", "input_type": "text", "payload": query},
            )
            resp.raise_for_status()
            accepted = resp.json()
        ws = base.replace("https://", "wss://").replace("http://", "ws://")
        async with websockets.connect(f"{ws}{accepted['result_ws']}") as sock:
            msg = json.loads(await asyncio.wait_for(sock.recv(), timeout=30.0))
        return msg.get("data", {}).get("predictions", []) if msg.get("type") == "result" else []
    except (httpx.HTTPError, OSError, asyncio.TimeoutError) as exc:
        _log.warning("rag_retrieval_failed", error=str(exc))
        return []  # degrade gracefully to an ungrounded answer


def create_app() -> FastAPI:
    configure_logging(service="chat")
    settings = get_settings()
    app = FastAPI(title="Inferno Chat", version="0.1.0")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.server.cors_origins,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/health")
    async def health() -> dict:
        return {"status": "ok", "model": settings.chat.model_id}

    @app.post("/chat")
    async def chat(req: ChatRequest) -> StreamingResponse:
        context, sources = "", []
        if req.use_rag:
            passages = await _retrieve(req.messages[-1].content)
            if passages:
                context = "\n".join(f"[{p.get('source')}] {p['label']}" for p in passages)
                sources = sorted({p.get("source") for p in passages if p.get("source")})

        async def stream():
            if sources:
                yield _sse({"type": "sources", "sources": sources})
            try:
                async for token in engine.stream(
                    [m.model_dump() for m in req.messages], context
                ):
                    yield _sse({"type": "token", "token": token})
            except Exception as exc:  # noqa: BLE001 - surface generation errors to the client
                _log.error("generation_failed", error=str(exc))
                yield _sse({"type": "error", "error": str(exc)})
            yield _sse({"type": "done"})

        return StreamingResponse(stream(), media_type="text/event-stream")

    return app


app = create_app()


def main() -> None:
    import uvicorn

    port = get_settings().chat.port
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="warning")


if __name__ == "__main__":
    main()
