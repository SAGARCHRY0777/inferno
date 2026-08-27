"""The MCP server's contract: it imports, and it exposes the expected tools.

Nothing exercised this module before, so a rename, a bad import or a decorator
that silently stopped registering would ship unnoticed — the failure only shows
up as "no tools available" inside someone's MCP client, far from the change that
caused it.

These are contract tests: they never reach the gateway, so they run in CI with
no Redis, no workers and no models loaded.
"""

from __future__ import annotations

import asyncio

import pytest

from backend.mcp_server import server as mcp_server

# Every tool an MCP client is entitled to see. Removing or renaming one is a
# breaking change for anybody's saved client config, so make it fail loudly.
EXPECTED_TOOLS = {
    "list_models",
    "health",
    "classify_text",
    "detect_objects",
    "transcribe_audio",
    "semantic_search",
    "rag_search",
    "run_inference",
    "get_metrics",
}


def _tool_names() -> set[str]:
    tools = asyncio.run(mcp_server.mcp.list_tools())
    return {t.name for t in tools}


def test_expected_tools_are_registered() -> None:
    assert EXPECTED_TOOLS <= _tool_names()


def test_every_tool_is_documented() -> None:
    """An MCP client shows the docstring to the model; a blank one is useless."""

    tools = asyncio.run(mcp_server.mcp.list_tools())
    undocumented = [t.name for t in tools if not (t.description or "").strip()]
    assert not undocumented, f"tools missing a description: {undocumented}"


def test_gateway_url_is_configurable(monkeypatch: pytest.MonkeyPatch) -> None:
    """INFERNO_MCP_GATEWAY drives both the REST base and the WebSocket base."""

    monkeypatch.setenv("INFERNO_MCP_GATEWAY", "https://example.test:9000/")
    import importlib

    reloaded = importlib.reload(mcp_server)
    try:
        assert reloaded.API == "https://example.test:9000/api/v1"
        # https must map to wss, or the result socket fails on a TLS deployment.
        assert reloaded.WS == "wss://example.test:9000"
    finally:
        monkeypatch.delenv("INFERNO_MCP_GATEWAY", raising=False)
        importlib.reload(mcp_server)


@pytest.mark.parametrize("transport", ["stdio", "sse"])
def test_valid_transports_are_accepted(transport: str, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("INFERNO_MCP_TRANSPORT", transport)
    import importlib

    reloaded = importlib.reload(mcp_server)
    try:
        seen: list[str] = []
        monkeypatch.setattr(reloaded.mcp, "run", lambda transport: seen.append(transport))
        reloaded.main()
        assert seen == [transport]
    finally:
        monkeypatch.delenv("INFERNO_MCP_TRANSPORT", raising=False)
        importlib.reload(mcp_server)


def test_unknown_transport_fails_fast(monkeypatch: pytest.MonkeyPatch) -> None:
    """A typo must not silently fall back to stdio and look like a hung service."""

    monkeypatch.setenv("INFERNO_MCP_TRANSPORT", "websocket")
    import importlib

    reloaded = importlib.reload(mcp_server)
    try:
        with pytest.raises(SystemExit):
            reloaded.main()
    finally:
        monkeypatch.delenv("INFERNO_MCP_TRANSPORT", raising=False)
        importlib.reload(mcp_server)
