"""Invoke the Inferno MCP tools against a live gateway to verify the agent path."""

import asyncio

from backend.mcp_server.server import mcp


async def call(name: str, **args):
    res = await mcp.call_tool(name, args)
    # FastMCP returns a list of content blocks; pull the text/JSON out.
    return res


async def main() -> None:
    tools = await mcp.list_tools()
    print("tools:", [t.name for t in tools])
    print("health:", await mcp.call_tool("health", {}))
    print("classify:", await mcp.call_tool("classify_text", {"text": "this platform is amazing"}))
    q = {"query": "how does batching help throughput"}
    print("search:", await mcp.call_tool("semantic_search", q))


if __name__ == "__main__":
    asyncio.run(main())
