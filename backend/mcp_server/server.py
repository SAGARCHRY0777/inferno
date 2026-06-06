"""Inferno MCP server — exposes the inference platform as agent-callable tools.

Run it and point any MCP client (Claude Desktop, an agent SDK, etc.) at it:
the LLM becomes an **agent** that can classify text, detect objects, transcribe
audio, and run semantic search by calling these tools — orchestrating Inferno's
models on its own.

    python -m backend.mcp_server.server          # stdio transport (Claude Desktop)

It is a thin, decoupled CLIENT of the gateway's public REST + WebSocket API (it
does not import the gateway), so it scales and deploys independently. Set the
gateway location with INFERNO_MCP_GATEWAY (default http://127.0.0.1:8000).

Each tool: POST /infer, then await the single result over the job's result
WebSocket — exactly the path a browser client uses.
"""

from __future__ import annotations

import asyncio
import base64
import json
import os

import httpx
import websockets
from mcp.server.fastmcp import FastMCP

GATEWAY = os.environ.get("INFERNO_MCP_GATEWAY", "http://127.0.0.1:8000").rstrip("/")
API = f"{GATEWAY}/api/v1"
WS = GATEWAY.replace("https://", "wss://").replace("http://", "ws://")

mcp = FastMCP("inferno")


# --------------------------------------------------------------------------- #
# Internals                                                                    #
# --------------------------------------------------------------------------- #
async def _infer(model: str, input_type: str, payload: str, timeout: float = 120.0) -> dict:
    """Submit a job and await its result over the result WebSocket."""

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                f"{API}/infer",
                json={"model_name": model, "input_type": input_type, "payload": payload},
            )
    except httpx.HTTPError as exc:
        return {"error": f"gateway unreachable at {GATEWAY}: {exc}"}

    if resp.status_code == 429:
        return {"error": "backpressure — the queue is saturated, retry shortly"}
    if resp.status_code == 401:
        return {"error": "unauthorized — the gateway requires an API key"}
    if resp.status_code >= 400:
        return {"error": f"request failed: HTTP {resp.status_code} {resp.text[:200]}"}

    accepted = resp.json()
    try:
        async with websockets.connect(f"{WS}{accepted['result_ws']}") as ws:
            message = json.loads(await asyncio.wait_for(ws.recv(), timeout=timeout))
    except (asyncio.TimeoutError, OSError) as exc:
        return {"error": f"no result within {timeout:.0f}s: {exc}"}

    if message.get("type") != "result":
        return {"error": f"job did not complete: {message.get('type')}"}
    return message["data"]


async def _fetch_base64(url: str) -> str:
    """Download a URL and base64-encode its bytes (for image/audio tools)."""

    async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
        resp = await client.get(url)
        resp.raise_for_status()
        return base64.b64encode(resp.content).decode()


def _preds(result: dict) -> list[dict]:
    return [
        {"label": p["label"], "score": round(p["score"], 4)}
        for p in result.get("predictions", [])
    ]


# --------------------------------------------------------------------------- #
# Tools (the agent reads these docstrings to decide what to call)             #
# --------------------------------------------------------------------------- #
@mcp.tool()
async def list_models() -> list[dict]:
    """List the inference models Inferno can serve, with their task and input type."""

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(f"{API}/models")
            resp.raise_for_status()
            return resp.json()
    except httpx.HTTPError as exc:
        return [{"error": f"gateway unreachable: {exc}"}]


@mcp.tool()
async def health() -> dict:
    """Check Inferno's health: Redis connectivity, available models, active workers."""

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(f"{API}/health")
            resp.raise_for_status()
            return resp.json()
    except httpx.HTTPError as exc:
        return {"error": f"gateway unreachable: {exc}"}


@mcp.tool()
async def classify_text(text: str, model: str = "distilbert-sentiment") -> dict:
    """Classify a piece of text (default: sentiment, POSITIVE/NEGATIVE with scores).

    Args:
        text: the text to classify.
        model: a text-classification model name from list_models().
    """

    result = await _infer(model, "text", text)
    return {"model": model, "predictions": _preds(result), "error": result.get("error")}


@mcp.tool()
async def detect_objects(image_url: str = "", image_base64: str = "") -> dict:
    """Detect objects in an image (YOLO). Returns labels, confidences, and boxes.

    Provide EITHER image_url (fetched server-side) OR image_base64.
    """

    payload = image_base64
    if image_url:
        try:
            payload = await _fetch_base64(image_url)
        except httpx.HTTPError as exc:
            return {"error": f"could not fetch image: {exc}"}
    if not payload:
        return {"error": "provide image_url or image_base64"}

    result = await _infer("yolo-detect", "image", payload)
    if result.get("error"):
        return result
    objects = [
        {"label": p["label"], "confidence": round(p["score"], 3), "box": p.get("box")}
        for p in result.get("predictions", [])
    ]
    return {"count": len(objects), "objects": objects}


@mcp.tool()
async def transcribe_audio(audio_url: str = "", audio_base64: str = "") -> dict:
    """Transcribe speech to text (Whisper). Provide audio_url OR audio_base64 (WAV/FLAC)."""

    payload = audio_base64
    if audio_url:
        try:
            payload = await _fetch_base64(audio_url)
        except httpx.HTTPError as exc:
            return {"error": f"could not fetch audio: {exc}"}
    if not payload:
        return {"error": "provide audio_url or audio_base64"}

    result = await _infer("whisper-transcribe", "audio", payload)
    if result.get("error"):
        return result
    preds = result.get("predictions", [])
    return {"transcript": preds[0]["label"] if preds else ""}


@mcp.tool()
async def semantic_search(query: str, top_k: int = 5) -> dict:
    """Search Inferno's knowledge corpus by meaning (embeddings). Returns ranked matches."""

    result = await _infer("semantic-search", "text", query)
    if result.get("error"):
        return result
    matches = [
        {"document": p["label"], "similarity": round(p["score"], 3)}
        for p in result.get("predictions", [])
    ]
    return {"query": query, "matches": matches[:top_k]}


@mcp.tool()
async def rag_search(query: str, top_k: int = 4) -> dict:
    """Retrieval-augmented search over Inferno's document corpus.

    Runs the full retrieve-then-rerank pipeline and returns the most relevant
    passages **with their source documents** (citations) — ideal grounding for
    an agent to answer a question from.
    """

    result = await _infer("rag-search", "text", query)
    if result.get("error"):
        return result
    passages = [
        {"passage": p["label"], "source": p.get("source"), "relevance": round(p["score"], 3)}
        for p in result.get("predictions", [])
    ]
    return {"query": query, "passages": passages[:top_k]}


@mcp.tool()
async def run_inference(model: str, input_type: str, payload: str) -> dict:
    """Run any registered model directly. input_type is one of image|text|audio.

    For image/audio, payload must be base64. Use the specific tools above when
    possible — they accept URLs and format the output for you.
    """

    return await _infer(model, input_type, payload)


@mcp.tool()
async def get_metrics() -> dict:
    """Live cluster metrics: throughput, latency percentiles, workers, per-model stats."""

    try:
        async with websockets.connect(f"{WS}/api/v1/ws/metrics") as ws:
            snap = json.loads(await asyncio.wait_for(ws.recv(), timeout=10.0))["data"]
    except (asyncio.TimeoutError, OSError) as exc:
        return {"error": f"metrics unavailable: {exc}"}
    return {
        "requests_per_sec": snap["requests_per_sec"],
        "latency_ms": snap["latency_ms"],
        "queue_depth": snap["queue_depth"],
        "workers_active": snap["workers_active"],
        "per_model": snap.get("per_model", []),
    }


def main() -> None:
    mcp.run()  # stdio transport


if __name__ == "__main__":
    main()
