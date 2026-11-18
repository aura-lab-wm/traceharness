"""`traceharness mcp`: an MCP server that lets agents run and steer the local console.

It speaks MCP over stdin/stdout and calls the lab's running console over HTTP on 127.0.0.1, so the
console stays the single owner of the runner and every call passes the console's own guards. See
docs/MCP.md and docs/superpowers/specs/2026-11-18-mcp-connector-design.md.

Modules: console (find, start and call the console), guard (levels and the spending budget),
shape (what a tool returns: paged, cut, labelled), tools (one function per console operation),
server (the MCP server: tools, resources, the call record), cli (`traceharness mcp`).
The MCP SDK is the optional extra `mcp`; only server and cli import it.
"""
