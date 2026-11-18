"""Which tools an agent gets, and what it may spend.

Levels (docs/superpowers/specs/2026-11-18-mcp-connector-design.md, decisions 3 and 4):
  read    no change on disk, no cost. Always on.
  write   changes files in the lab for free (a mock sweep, an import, a paused-run decision). `--allow-writes`.
  spend   can cost money (a live-model sweep, a runner job, an experiment start). `--allow-spend`, which
          implies writes, and a session budget (`--budget`, default 1.00 USD).

A spend reserves its cap before the call and never gives it back, and a cap that does not fit in what
is left is refused before anything reaches the console: the budget bounds the sum of the caps. The
console enforces each cap. A container runtime (Claude Code, Codex) reserves before every model request
and refuses one that would pass it. The TraceHarness engine (sweeps, the `traceharness` runtime) ends a
run before its next model call once the cap is reached, so it can pass a cap by the cost of one model
call; the connector runs live sweeps one run at a time, so that is one call per sweep, not one per
parallel run.
"""
from __future__ import annotations

import math
import threading
from dataclasses import dataclass, field

DOMAINS = ("lab", "data", "analysis", "harness", "run", "runner", "import", "capture", "sentinel")
#: Listed only when named in --toolsets: they read the private captured sessions.
EXPLICIT_ONLY = frozenset({"capture"})
LEVELS = ("read", "write", "spend")
DEFAULT_BUDGET = 1.00


class GuardError(Exception):
    """A refusal by the connector itself, before anything reaches the console."""


@dataclass
class Config:
    domains: tuple = tuple(d for d in DOMAINS if d not in EXPLICIT_ONLY)
    allow_writes: bool = False
    allow_spend: bool = False
    budget_usd: float = DEFAULT_BUDGET

    @classmethod
    def from_flags(cls, toolsets: str | None, allow_writes: bool, allow_spend: bool, budget: float | None) -> "Config":
        if toolsets:
            picked = tuple(dict.fromkeys(x.strip() for x in toolsets.split(",") if x.strip()))
            unknown = [x for x in picked if x not in DOMAINS]
            if unknown:
                raise GuardError(f"unknown toolset(s) {', '.join(unknown)}; the toolsets are {', '.join(DOMAINS)}")
        else:
            picked = cls.domains
        b = DEFAULT_BUDGET if budget is None else float(budget)
        if not math.isfinite(b) or b < 0 or b > 1000:
            raise GuardError("--budget is a number of US dollars from 0 to 1000")
        return cls(domains=picked, allow_writes=allow_writes or allow_spend, allow_spend=allow_spend, budget_usd=b)

    def levels(self) -> tuple:
        return ("read",) + (("write",) if self.allow_writes else ()) + (("spend",) if self.allow_spend else ())

    def lists(self, domain: str, level: str) -> bool:
        return domain in self.domains and level in self.levels()


@dataclass
class SpendGuard:
    budget_usd: float
    allowed: bool
    reserved_usd: float = 0.0
    _lock: threading.Lock = field(default_factory=threading.Lock, repr=False)
    _local: threading.local = field(default_factory=threading.local, repr=False)

    def require_writes(self, config: Config, what: str) -> None:
        if not config.allow_writes:
            raise GuardError(f"{what} changes files in the lab. Restart the connector with --allow-writes.")

    def reserve(self, cap_usd, what: str) -> float:
        """Reserve `cap_usd` of the session budget for one paid call, or refuse."""
        if not self.allowed:
            raise GuardError(f"{what} can cost money. Restart the connector with --allow-spend (and --budget).")
        if isinstance(cap_usd, bool) or not isinstance(cap_usd, (int, float)) or not math.isfinite(cap_usd) or cap_usd <= 0:
            raise GuardError(f"{what} needs a positive max_cost_usd: the most this call may spend.")
        cap = float(cap_usd)
        with self._lock:
            left = self.budget_usd - self.reserved_usd
            if cap > left + 1e-9:
                raise GuardError(f"{what} asks for up to ${cap:.2f}, but ${left:.2f} of this session's "
                                 f"${self.budget_usd:.2f} budget is left. Lower the cap, or restart with a larger --budget.")
            self.reserved_usd += cap
        self._local.reserved = cap
        return cap

    def left(self) -> float:
        with self._lock:
            return round(self.budget_usd - self.reserved_usd, 6)

    def take_reserved(self):
        """The cap reserved by the call running on this thread (once), for its record."""
        value = getattr(self._local, "reserved", None)
        self._local.reserved = None
        return value

    def report(self) -> dict:
        return {"allowed": self.allowed, "budget_usd": self.budget_usd, "reserved_usd": round(self.reserved_usd, 6),
                "left_usd": self.left()}
