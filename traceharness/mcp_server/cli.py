"""`traceharness mcp`: serve the MCP connector over stdio, list its tools, or test it against the console.

    traceharness mcp                                   read tools, every domain but capture
    traceharness mcp --allow-writes                    + free changes (mock sweeps, imports, decisions)
    traceharness mcp --allow-spend --budget 2          + paid runs, at most $2 reserved in this session
    traceharness mcp --toolsets data,analysis          only these domains
    traceharness mcp --list-tools [flags]              print what an agent would get, and exit (offline)
    traceharness mcp --selftest [--dataset NAME]       call every read tool through an MCP client and print a table

Add it to Claude Code:   claude mcp add traceharness -- traceharness mcp --lab /path/to/lab
Add it to Codex (~/.codex/config.toml):   [mcp_servers.traceharness]  command = "traceharness"  args = ["mcp"]
"""
from __future__ import annotations

import argparse
import sys

from .guard import DOMAINS, Config, GuardError

INSTALL_HINT = "python3 -m pip install -e '.[mcp]'   (from a checkout; or: pip install 'traceharness[mcp]')"


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="traceharness mcp", description=__doc__.split("\n\n")[0],
                                formatter_class=argparse.RawDescriptionHelpFormatter, epilog="\n".join(__doc__.split("\n")[2:]))
    p.add_argument("--lab", metavar="DIR", help="lab root (default: as `traceharness` resolves it)")
    p.add_argument("--console", metavar="URL", help="a running console to use, e.g. http://127.0.0.1:8765 (loopback only)")
    p.add_argument("--no-start", action="store_true", help="refuse instead of starting a console when none is running")
    p.add_argument("--toolsets", metavar="LIST", help=f"comma-separated domains: {', '.join(DOMAINS)} "
                                                      "(default: all but capture, which reads private sessions)")
    p.add_argument("--allow-writes", action="store_true", help="add tools that change files in the lab for free")
    p.add_argument("--allow-spend", action="store_true", help="add tools that can cost money (implies --allow-writes)")
    p.add_argument("--budget", type=float, metavar="USD", help="most this session may reserve for paid calls (default 1.00)")
    p.add_argument("--list-tools", action="store_true", help="print the tools these flags list, and exit")
    p.add_argument("--selftest", action="store_true", help="call every read tool against the console and print a table")
    p.add_argument("--dataset", metavar="NAME", help="dataset the self-test reads (default: llma4se_live, else the largest)")
    p.add_argument("--network", action="store_true", help="the self-test also calls the tools that ask the Hugging Face Hub")
    return p


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    import logging
    for noisy in ("httpx", "httpcore"):     # one INFO line per request; stdout carries the protocol, stderr stays readable
        logging.getLogger(noisy).setLevel(logging.WARNING)
    try:
        config = Config.from_flags(args.toolsets, args.allow_writes, args.allow_spend, args.budget)
    except GuardError as e:
        print(f"traceharness mcp: {e}", file=sys.stderr)
        return 2
    try:
        from .server import Runtime, build_server
    except ImportError as e:
        print(f"traceharness mcp needs the MCP SDK ({e.name or e}). Install it with:\n  {INSTALL_HINT}", file=sys.stderr)
        return 2

    rt = Runtime(config, lab=args.lab, console_url=args.console, may_start=not args.no_start, client="")
    if args.list_tools:
        width = max(len(d.name) for d in rt.listed)
        for d in rt.listed:
            print(f"{d.name:<{width}}  {d.domain:<8}  {d.level:<5}  {d.title}")
        print(f"\n{len(rt.listed)} tools · levels {', '.join(config.levels())} · domains {', '.join(config.domains)}")
        return 0
    if args.selftest:
        from .selftest import run_selftest
        try:
            return run_selftest(rt, dataset=args.dataset, network=args.network)
        finally:
            rt.close()
    server = build_server(rt)
    try:
        server.run("stdio")
    finally:
        rt.close()
    return 0
