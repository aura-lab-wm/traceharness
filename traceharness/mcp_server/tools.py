"""One function per console operation (docs/superpowers/specs/2026-11-18-mcp-connector-design.md).

Each tool is a method of `Tools`, registered with `@tool(domain, level, ...)`. Its docstring is the
description the agent reads, and its parameters (with their Field descriptions) are the input schema.
The level says when it is listed (guard.py); a tool whose level depends on its arguments (a sweep or a
runner job with a live model) is listed at the lower level and checks the higher one when called.

Tools never accept or return an OpenRouter key: sweeps and runner jobs use the key saved in Settings.
"""
from __future__ import annotations

import functools
import json
import os
import re
import time
import uuid
from dataclasses import dataclass
from typing import Annotated, Any, Callable, Literal, Optional

from pydantic import Field

from .console import Console, ConsoleError
from .guard import Config, GuardError, SpendGuard
from .shape import SegmentError, cut, page, pick, recorded, seg

try:  # the SDK's error type keeps the message the agent reads; without the SDK (tests of this module) a stand-in
    from mcp.server.mcpserver.exceptions import ToolError
except ImportError:  # pragma: no cover - the `mcp` extra is not installed
    class ToolError(Exception):
        pass

#: Which argument names say what a call touched, for its record in the console (agent_api.TARGET_KEYS).
_TARGET_OF = {"dataset": "dataset", "run_id": "run_id", "run_a": "run_id", "job_id": "job_id", "sweep_id": "job_id",
              "experiment_id": "experiment_id", "harness": "harness", "harness_id": "harness", "base": "harness",
              "model": "model", "task": "task", "out": "dataset", "path": "path_name", "zip_path": "path_name",
              "out_path": "path_name"}
_PLAIN = re.compile(r"[^A-Za-z0-9 ._:/@+-]")


def _targets(kwargs: dict) -> dict:
    out = {}
    for arg, key in _TARGET_OF.items():
        value = kwargs.get(arg)
        if isinstance(value, str) and value and key not in out:
            if key == "path_name":
                value = os.path.basename(value.rstrip("/"))
            value = _PLAIN.sub("", value)[:200].strip()
            if value:
                out[key] = value
    return out

DatasetArg = Annotated[str, Field(description="Dataset (results directory) name, from datasets_list, e.g. llma4se_live.")]
RunArg = Annotated[str, Field(description="Run id from runs_list. A unique suffix or prefix (e.g. the 6 characters the console shows) also works.")]
LimitArg = Annotated[int, Field(ge=1, le=500, description="Rows per page.")]
OffsetArg = Annotated[int, Field(ge=0, description="Rows to skip; use next_offset from the previous page.")]

RUN_FIELDS = ("run_id", "task_id", "harness_id", "model", "repeat_index", "exit_reason", "steps", "tool_calls", "edits",
              "input_tokens", "output_tokens", "cost_usd", "wall_ms", "visible_pass", "hidden_pass", "strong_pass",
              "tests_modified", "error")


@dataclass(frozen=True)
class ToolDef:
    name: str
    domain: str
    level: str
    title: str
    method: Callable
    destructive: bool = False
    open_world: bool = False
    private: bool = False


_REGISTRY: list[tuple[str, dict]] = []


def tool(domain: str, level: str, title: str, *, destructive: bool = False, open_world: bool = False, private: bool = False):
    """Register a tool. The wrapper keeps the signature (the SDK follows __wrapped__), turns a refusal into an
    MCP tool error with its reason, and hands one record per call to the session's recorder."""
    def deco(fn):
        _REGISTRY.append((fn.__name__, dict(domain=domain, level=level, title=title, destructive=destructive,
                                            open_world=open_world, private=private)))

        @functools.wraps(fn)
        def call(self, *args, **kwargs):
            started = time.monotonic()
            error = None
            try:
                return fn(self, *args, **kwargs)
            except (GuardError, ConsoleError, SegmentError) as e:
                error = str(e)
                raise ToolError(error) from None
            except ToolError as e:
                error = str(e)
                raise
            except Exception as e:  # an unexpected failure still reaches the agent with its type and message
                error = f"{type(e).__name__}: {e}"
                raise ToolError(f"Unexpected error in {fn.__name__}: {error}") from None
            finally:
                reserved = self.guard.take_reserved()
                self._record(name=fn.__name__, level="spend" if reserved is not None else level, ok=error is None,
                             ms=int((time.monotonic() - started) * 1000), targets=_targets(kwargs),
                             error=error, reserved_usd=reserved)
        return call
    return deco


def _is_mock(model: str) -> bool:
    return isinstance(model, str) and model.startswith("mock")


def _free_runner_job(cfg: dict) -> bool:
    """Only the TraceHarness engine runs a mock model offline; a container runtime always reaches OpenRouter,
    whatever its model id says, so it is always a spend."""
    return isinstance(cfg, dict) and cfg.get("runtime_id") == "traceharness" and _is_mock(cfg.get("model_id"))


class Tools:
    """The tools of one connector session. `console_of()` connects on first use."""

    def __init__(self, config: Config, guard: SpendGuard, console_of: Callable[[], Console],
                 recorder: Optional[Callable[..., None]] = None):
        self.config = config
        self.guard = guard
        self._console_of = console_of
        self._recorder = recorder

    def _record(self, **record) -> None:
        if self._recorder is not None:
            try:
                self._recorder(**record)
            except Exception:  # the record is a courtesy to the console; it never fails the call
                pass

    @property
    def c(self) -> Console:
        return self._console_of()

    def definitions(self) -> list[ToolDef]:
        return [ToolDef(name=name, method=getattr(self, name), **meta) for name, meta in _REGISTRY]

    # ------------------------------------------------------------------ helpers
    def _runs(self, dataset: str, **filters) -> list[dict]:
        rows = self.c.get(f"/api/results/{seg(dataset)}/runs", **filters)
        return rows if isinstance(rows, list) else []

    def _run_id(self, dataset: str, run_id: str) -> str:
        """A full run id; a unique suffix or prefix of one is resolved against the dataset."""
        if not isinstance(run_id, str) or not run_id.strip():
            raise GuardError("run_id is empty")
        run_id = run_id.strip()
        if len(run_id) >= 20:
            return run_id
        ids = [r.get("run_id") for r in self._runs(dataset)]
        hits = sorted({i for i in ids if isinstance(i, str) and (i.endswith(run_id) or i.startswith(run_id))})
        if len(hits) == 1:
            return hits[0]
        if not hits:
            raise GuardError(f"no run in {dataset} ends or starts with {run_id!r}")
        raise GuardError(f"{run_id!r} matches {len(hits)} runs in {dataset}; use more characters: {', '.join(hits[:5])}")

    # ================================================================== lab
    @tool("lab", "read", "Lab and connector status")
    def lab_status(self) -> dict:
        """Where the console runs, its version, which datasets and harnesses the lab holds, whether a key is
        saved in Settings (never the key), the local runner's readiness, and this connector's levels and budget.
        Call this first."""
        version = self.c.get("/api/version")
        settings = self.c.get("/api/settings")
        env = self.c.get("/api/environment")
        pause = self.c.get("/api/pause/config")
        caps = env.get("capabilities") if isinstance(env, dict) else None
        return {
            "console": {"url": self.c.url, "started_by_connector": self.c.started is not None,
                        "package_version": version.get("package_version"), "mode": version.get("mode")},
            "lab": pick(settings, ("lab_root", "results_root", "harness_dir", "task_dir", "results", "harnesses", "base_url")),
            "key_present": bool(settings.get("key_present")),
            "capabilities": caps,
            "pause_token_required": bool(pause.get("token_required")),
            "connector": {"domains": list(self.config.domains), "levels": list(self.config.levels()),
                          "spend": self.guard.report()},
        }

    @tool("lab", "read", "Doctor (offline checks)")
    def lab_doctor(self) -> dict:
        """`traceharness doctor`: do the package, the UI build and the shared sources agree, is the local runner
        set up, is the MCP SDK installed. Offline."""
        from traceharness.shared import doctor
        rows = doctor.run()
        return {"result": {0: "ok", 1: "drift", 2: "failed"}[doctor.exit_code(rows)], "rows": rows}

    # ================================================================== data
    @tool("data", "read", "List datasets")
    def datasets_list(self) -> dict:
        """Every dataset (results directory) the console can open: runs, harnesses, models, tasks, pass rate, date."""
        rows = self.c.get("/api/results")
        return {"datasets": cut(rows)}

    @tool("data", "read", "Dataset overview")
    def dataset_overview(self, dataset: DatasetArg) -> dict:
        """One dataset: its size and pass rate, and how its runs ended (counts by outcome and by failure mode)."""
        entry = next((d for d in self.c.get("/api/results") if d.get("name") == dataset), None)
        if entry is None:
            raise GuardError(f"no dataset named {dataset!r}; see datasets_list")
        out = {"dataset": entry}
        try:
            oc = self.c.get(f"/api/outcomes/{seg(dataset)}")
            out["outcomes"] = pick(oc, ("counts", "modes"))
        except ConsoleError as e:
            out["outcomes_unavailable"] = str(e)
        return cut(out)

    @tool("data", "read", "List runs")
    def runs_list(self, dataset: DatasetArg, harness: Optional[str] = None, task: Optional[str] = None,
                  model: Optional[str] = None,
                  outcome: Annotated[Literal["any", "passed", "failed", "ungraded"], Field(
                      description="By the hidden tests: passed, failed, ungraded (grader error or no grade), or any.")] = "any",
                  limit: LimitArg = 50, offset: OffsetArg = 0) -> dict:
        """Runs of a dataset, one compact row each (outcome, steps, tokens, cost, time), filtered and paged."""
        rows = self._runs(dataset, harness=harness, task=task, model=model)
        want = {"passed": True, "failed": False, "ungraded": None}.get(outcome, "any")
        if want != "any":
            rows = [r for r in rows if r.get("hidden_pass") is want]
        slim = [{k: (cut(r[k], 200) if k == "error" else r[k]) for k in RUN_FIELDS if k in r} for r in rows]
        return page(slim, limit, offset)

    @tool("data", "read", "Run detail")
    def run_get(self, dataset: DatasetArg, run_id: RunArg) -> dict:
        """One run: its summary, the issue it worked on, and its patch. Steps are in run_trajectory.
        The patch and texts are recorded agent output."""
        rid = self._run_id(dataset, run_id)
        d = self.c.get(f"/api/results/{seg(dataset)}/runs/{seg(rid)}")
        return recorded(cut({"run_id": rid, "summary": d.get("summary"), "issue": d.get("issue"), "patch": d.get("patch"),
                             "n_spans": len(d.get("spans") or []), "n_messages": len(d.get("messages") or [])}))

    @tool("data", "read", "Run trajectory (paged)")
    def run_trajectory(self, dataset: DatasetArg, run_id: RunArg, offset: OffsetArg = 0, limit: LimitArg = 40) -> dict:
        """The run's messages in order (system, user, assistant with tool calls, tool results), one per row, paged.
        Recorded agent output."""
        rid = self._run_id(dataset, run_id)
        text = self.c.request("GET", f"/api/export/{seg(dataset)}/runs/{seg(rid)}.trajectory.jsonl", text=True)
        rows = []
        for line in text.splitlines():
            if line.strip():
                try:
                    rows.append(json.loads(line))
                except ValueError:
                    rows.append({"unreadable_line": line[:200]})
        return recorded({"run_id": rid, **cut(page(rows, limit, offset))})

    @tool("data", "read", "Compare two runs")
    def runs_compare(self, dataset: DatasetArg, run_a: RunArg, run_b: RunArg) -> dict:
        """Two runs of the same dataset step by step: where they first diverge, the verdict and both outcomes."""
        a, b = self._run_id(dataset, run_a), self._run_id(dataset, run_b)
        d = self.c.get(f"/api/fork/{seg(dataset)}/compare", a=a, b=b)
        d.pop("state", None)
        return recorded(cut(d))

    @tool("data", "read", "Live runs")
    def live_runs(self, recent_seconds: Annotated[float, Field(gt=0, le=604800, description="How far back, in seconds.")] = 600,
                  limit: LimitArg = 50, offset: OffsetArg = 0) -> dict:
        """Runs that wrote to their ledger recently, newest first: what is running now, or just finished."""
        rows = self.c.get("/api/live", recent=recent_seconds)
        rows = sorted(rows if isinstance(rows, list) else [], key=lambda r: r.get("last_ts") or 0, reverse=True)
        return page(rows, limit, offset)

    # ================================================================== analysis
    @tool("analysis", "read", "Pass rates by cell")
    def pass_rates(self, dataset: DatasetArg, model: Optional[str] = None,
                   baseline: Annotated[str, Field(description="Harness every other harness is compared with.")] = "baseline",
                   per_task: Annotated[bool, Field(description="Also give each cell's pass@1 per task.")] = False) -> dict:
        """pass@1 per model x harness cell (per task on request), with the paired comparison against the baseline harness."""
        d = self.c.get(f"/api/results/{seg(dataset)}/metrics", model=model, baseline=baseline)
        for c in d.get("cells") or []:
            if not per_task:
                c.pop("tasks", None)
                continue
            for t in (c.get("tasks") or {}).values():
                if isinstance(t, dict):
                    t.pop("outcomes", None)
        return cut(d)

    @tool("analysis", "read", "Outcomes and failure modes")
    def outcomes(self, dataset: DatasetArg) -> dict:
        """How the dataset's runs ended: counts by outcome and by failure mode (use runs_list for the runs)."""
        d = self.c.get(f"/api/outcomes/{seg(dataset)}")
        return cut(pick(d, ("counts", "modes")))

    @tool("analysis", "read", "Harness comparisons")
    def comparisons(self, dataset: DatasetArg, baseline: Optional[str] = None) -> dict:
        """Each harness against a baseline harness, per model: difference in pass rate with a 95% interval."""
        return cut(self.c.get(f"/api/results/{seg(dataset)}/comparisons", baseline=baseline))

    @tool("analysis", "read", "Oracle agreement")
    def oracle(self, dataset: DatasetArg) -> dict:
        """Agreement between the hidden and the strengthened test suites (Cohen's kappa and the 2x2 table)."""
        return cut(self.c.get(f"/api/results/{seg(dataset)}/oracle"))

    @tool("analysis", "read", "Integrity checks")
    def integrity(self, dataset: DatasetArg, harness: str = "baseline") -> dict:
        """Leakage, weak tests, self-reported success against the grade, and fault localisation for one harness."""
        return cut(self.c.get(f"/api/results/{seg(dataset)}/integrity", harness=harness))

    @tool("analysis", "read", "Two-factor fit")
    def fit(self, dataset: DatasetArg, a: str = "model", b: str = "harness_id", outcome: str = "hidden_pass",
            hold: Annotated[Optional[list[str]], Field(description="column=value filters, e.g. ['task_id=t02_intervals'].")] = None) -> dict:
        """A two-factor decomposition (ANOVA) of the outcome over factors a and b, optionally holding columns fixed."""
        params = {"a": a, "b": b, "outcome": outcome}
        if hold:
            params["hold"] = hold
        return cut(self.c.request("GET", f"/api/results/{seg(dataset)}/experiment", params=params))

    @tool("analysis", "read", "Trajectory patterns")
    def patterns(self, dataset: DatasetArg, harness: Optional[str] = None, task: Optional[str] = None,
                 model: Optional[str] = None) -> dict:
        """Action sequences across runs: alphabet, common sequences, transitions, where runs diverge, clusters."""
        return cut(self.c.get(f"/api/results/{seg(dataset)}/patterns", harness=harness, task=task, model=model))

    @tool("analysis", "read", "Query action strings")
    def query_actions(self, dataset: DatasetArg,
                      pattern: Annotated[str, Field(description="Regex over each run's action string (one letter per action, see patterns).")],
                      harness: Optional[str] = None, model: Optional[str] = None,
                      steps_min: Optional[int] = None, steps_max: Optional[int] = None) -> dict:
        """Runs whose action string matches a regex against the rest: pass rates, association, the matching runs."""
        return cut(self.c.get(f"/api/results/{seg(dataset)}/query", pattern=pattern, harness=harness, model=model,
                              steps_min=steps_min, steps_max=steps_max))

    @tool("analysis", "read", "Report card (Markdown)")
    def report(self, dataset: DatasetArg, harness: str = "baseline", model: Optional[str] = None) -> dict:
        """The dataset's report card as Markdown, as the console exports it."""
        md = self.c.request("GET", f"/api/results/{seg(dataset)}/report.md", params={"harness": harness, "model": model}, text=True)
        return {"markdown": cut(md, 20000)}

    @tool("analysis", "read", "Rank harnesses")
    def ranking(self, dataset: DatasetArg, outcome: str = "hidden_pass") -> dict:
        """Harnesses ranked on one dataset, with bootstrap intervals."""
        return cut(self.c.get("/api/harness/ranking", dir=dataset, outcome=outcome))

    @tool("analysis", "read", "Which benchmark?")
    def recommend_benchmark(self, goal: Literal["run", "analyse"] = "run", model: str = "",
                            model_cutoff: Annotated[Optional[str], Field(description="The model's training cutoff, YYYY-MM.")] = None,
                            budget_usd: Optional[float] = None, hours: Optional[float] = None,
                            languages: Optional[list[str]] = None, where: Literal["laptop", "runner"] = "laptop",
                            compare_public: bool = False) -> dict:
        """A recommended benchmark, a runner-up and one to avoid, each with reasons and the sizing arithmetic."""
        params = {"goal": goal, "model": model, "model_cutoff": model_cutoff, "budget_usd": budget_usd, "hours": hours,
                  "where": where, "compare_public": compare_public}
        if languages:
            params["languages"] = languages
        d = self.c.request("GET", "/api/recommend", params=params)
        d.pop("considered", None)
        return cut(d)

    # ================================================================== harness
    @tool("harness", "read", "List harnesses")
    def harnesses_list(self) -> dict:
        """The lab's harnesses: id, content hash, source file and notes."""
        return {"harnesses": cut(self.c.get("/api/harness/list"))}

    @tool("harness", "read", "Harness configuration")
    def harness_get(self, harness_id: str) -> dict:
        """One harness's full configuration: system prompt, tools, policy, limits, sentinel."""
        h = next((x for x in self.c.get("/api/harnesses") if x.get("id") == harness_id), None)
        if h is None:
            raise GuardError(f"no harness named {harness_id!r}; see harnesses_list")
        return cut(h)

    @tool("harness", "read", "Diff two harnesses")
    def harness_diff(self, a: str, b: str, dataset: Optional[str] = None, model: Optional[str] = None) -> dict:
        """What differs between two harness configurations and, with a dataset, how their outcomes differ."""
        return cut(self.c.get("/api/harness/diff", a=a, b=b, dir=dataset, model=model))

    @tool("harness", "read", "Plan an ablation")
    def ablation_plan(self, base: str,
                      factors: Annotated[Optional[str], Field(description="Comma-separated knobs to vary (see the knobs list in the plan).")] = None,
                      models: str = "mock", tasks: Optional[str] = None) -> dict:
        """The cells an ablation of a base harness would run, and how many runs that is. Plans only; runs nothing."""
        return cut(self.c.get("/api/harness/ablate/plan", base=base, factors=factors, models=models, tasks=tasks))

    @tool("harness", "read", "List tasks")
    def tasks_list(self, suite: str = "full") -> dict:
        """The lab's tasks: id, title, the issue text and the files it touches."""
        return {"tasks": cut(self.c.get("/api/tasks", suite=suite), 600)}

    # ================================================================== run
    @tool("run", "read", "List sweeps")
    def sweeps_list(self) -> dict:
        """Sweeps started in this console session: status, progress, results directory."""
        return {"sweeps": cut(self.c.get("/api/jobs"))}

    @tool("run", "write", "Start a sweep")
    def sweep_start(self, out: Annotated[str, Field(description="Results directory to write into (a new or existing dataset name).")],
                    harnesses: list[str], tasks: list[str],
                    models: Annotated[list[str], Field(description="'mock' (free, offline) or OpenRouter model ids (paid).")] = ["mock"],
                    repeats: Annotated[int, Field(ge=1, le=20)] = 1, seed: int = 0,
                    max_cost_usd: Annotated[Optional[float], Field(description="Required for live models: the most this sweep may spend.")] = None) -> dict:
        """Run harnesses x tasks x models in the local console, writing runs into a dataset. Mock models are free;
        live models use the key in Settings, need --allow-spend and a max_cost_usd within the session budget."""
        body = {"out": out, "models": models, "harnesses": harnesses, "tasks": tasks, "repeats": repeats,
                "parallel": 3, "seed": seed}
        if any(not _is_mock(m) for m in models):
            body["max_cost_usd"] = self.guard.reserve(max_cost_usd, "A sweep with a live model")
        return {"sweep": self.c.post("/api/jobs", body), "spend": self.guard.report()}

    @tool("run", "write", "Cancel a sweep", destructive=True)
    def sweep_cancel(self, sweep_id: str) -> dict:
        """Stop a running sweep. Runs already finished stay in the dataset."""
        return {"sweep": self.c.post(f"/api/jobs/{seg(sweep_id)}/cancel")}

    @tool("run", "read", "Runs waiting for a decision")
    def paused_list(self) -> dict:
        """Runs paused by their harness for a human decision, with the call each one is waiting on."""
        return recorded({"paused": cut(self.c.get("/api/paused"))})

    @tool("run", "write", "Decide on a paused run", destructive=True)
    def paused_decide(self, dataset: DatasetArg, run_id: str,
                      decision: Literal["approve", "deny", "edit", "inject", "abort"],
                      note: str = "", call: Optional[int] = None,
                      args: Annotated[Optional[dict], Field(description="For edit: the tool call's new arguments.")] = None,
                      message: Annotated[Optional[str], Field(description="For inject: the message to add.")] = None) -> dict:
        """Answer a paused run: approve or deny its pending call, edit its arguments, inject a message, or abort.
        Approving lets the agent's tool call run on this machine."""
        body = {"decision": decision, "note": note, "call": call, "args": args, "message": message}
        return self.c.post(f"/api/runs/{seg(dataset)}/{seg(run_id)}/decision", {k: v for k, v in body.items() if v is not None})

    # ================================================================== runner
    @tool("runner", "read", "Local runner status")
    def runner_status(self) -> dict:
        """Whether container runs are available (Docker, images, registry), which runtimes are ready, and why not."""
        env = self.c.get("/api/environment")
        cat = self.c.get("/api/runner/catalog")
        return cut({"capabilities": env.get("capabilities"), "execution_available": cat.get("execution_available"),
                    "runner": cat.get("runner"),
                    "runtimes": [pick(r, ("id", "name", "kind", "available", "reason", "version")) for r in cat.get("runtimes") or []],
                    "setup_command": "traceharness runner setup"})

    @tool("runner", "read", "Runner catalog")
    def runner_catalog(self) -> dict:
        """Runtimes, models and tasks the runner can run here, and the limits it accepts."""
        return cut(self.c.get("/api/runner/catalog"))

    @tool("runner", "read", "Runner configuration template")
    def runner_configuration_template(self, runtime_id: str = "traceharness", model_id: str = "mock",
                                      task_id: str = "t01_slugify", prompt: Optional[str] = None,
                                      max_steps: Annotated[int, Field(ge=1, le=200)] = 6,
                                      wall_time_seconds: Annotated[int, Field(ge=30, le=3600)] = 900,
                                      max_cost_usd: Annotated[float, Field(ge=0.01, le=100)] = 0.05) -> dict:
        """A configuration for runner_preflight / runner_job_start: the recommended minimal harness for the
        TraceHarness engine, or an appended instruction for a native runtime (Claude Code, Codex). Edit it, then preflight."""
        limits = {"max_steps": max_steps, "wall_time_seconds": wall_time_seconds, "max_cost_usd": max_cost_usd,
                  "max_output_tokens": 8192}
        if runtime_id == "traceharness":
            from traceharness.shallow.wizard import blocks_from_answers, recommended_answers
            blocks = blocks_from_answers(recommended_answers())
            if prompt:
                blocks[0] = {**blocks[0], "text": prompt}
            cfg = {"version": 1, "runtime_id": runtime_id, "model_id": model_id, "task_id": task_id,
                   "prompt": blocks[0]["text"], "prompt_mode": "replace", "harness": {"lane": "minimal", "blocks": blocks},
                   "limits": limits}
        else:
            cfg = {"version": 1, "runtime_id": runtime_id, "model_id": model_id, "task_id": task_id,
                   "prompt": prompt or "", "prompt_mode": "append", "harness": {}, "limits": limits}
        return {"configuration": cfg}

    @tool("runner", "read", "Review a run configuration")
    def runner_preflight(self, configuration: Annotated[dict, Field(description="A run configuration (see runner_configuration_template).")]) -> dict:
        """The runner's review of a configuration, spending nothing: ok or the issues, whether only a missing
        compatibility receipt stands in the way (consent_required), and the manifest it would run."""
        return cut(self.c.post("/api/runner/preflight", {"configuration": configuration}))

    @tool("runner", "write", "Start a runner job")
    def runner_job_start(self, configuration: Annotated[dict, Field(description="A configuration that passed runner_preflight.")],
                         accept_unverified: Annotated[bool, Field(description=(
                             "Run a combination without a compatibility receipt on this machine; the job records verified: false. "
                             "Only when the person you work for agreed to unverified runs."))] = False,
                         idempotency_key: Optional[str] = None) -> dict:
        """Review, then start one run in the local runner (the engine, or Claude Code / Codex in a container).
        A mock model is free; any other model needs --allow-spend, and the configuration's limits.max_cost_usd
        must fit in the session budget."""
        cfg = dict(configuration)
        if accept_unverified:
            cfg["unverified_ok"] = True
        review = self.c.post("/api/runner/preflight", {"configuration": cfg})
        if not review.get("ok"):
            hint = " It needs a receipt: pass accept_unverified=true if unverified runs were agreed." if review.get("consent_required") else ""
            raise GuardError("The runner refused this configuration: " + "; ".join(map(str, review.get("issues") or [])) + hint)
        if not _free_runner_job(cfg):
            limits = cfg.get("limits") if isinstance(cfg.get("limits"), dict) else {}
            self.guard.reserve(limits.get("max_cost_usd"), "A runner job with a live model or a container runtime")
        body = {"configuration": cfg, "credential_id": None, "manifest_sha256": review["manifest_sha256"],
                "idempotency_key": idempotency_key or uuid.uuid4().hex}
        created = self.c.post("/api/runner/jobs", body)
        job = created.get("job", created) if isinstance(created, dict) else created
        return {"job": cut(job), "spend": self.guard.report()}

    @tool("runner", "read", "List runner jobs")
    def runner_jobs(self, limit: LimitArg = 50, offset: OffsetArg = 0) -> dict:
        """Runner jobs, newest first: status, runtime, model, task, grade, cost."""
        d = self.c.get("/api/runner/jobs")
        return cut(page(d.get("jobs") or [], limit, offset))

    @tool("runner", "read", "Runner job")
    def runner_job(self, job_id: str) -> dict:
        """One runner job: status, manifest, grade, reported cost, isolation, artifacts."""
        return cut(self.c.get(f"/api/runner/jobs/{seg(job_id)}"))

    @tool("runner", "write", "Cancel a runner job", destructive=True)
    def runner_job_cancel(self, job_id: str) -> dict:
        """Stop a runner job."""
        return cut(self.c.post(f"/api/runner/jobs/{seg(job_id)}/cancel"))

    @tool("runner", "read", "Runner job artifact")
    def runner_artifact(self, job_id: str, name: Annotated[str, Field(description="An artifact name listed by runner_job.")]) -> dict:
        """One artifact of a runner job (trace, grade, manifest, native prompt files), as text. Recorded agent output."""
        text = self.c.request("GET", f"/api/runner/jobs/{seg(job_id)}/artifacts/{seg(name)}", text=True)
        return recorded({"job_id": job_id, "name": name, "text": cut(text, 20000)})

    @tool("runner", "read", "Review an experiment plan")
    def experiment_preflight(self, plan: dict) -> dict:
        """The runner's review of an experiment plan (arms x repeats), spending nothing: issues, trial count,
        the worst-case cost, and the arms that need a receipt."""
        return cut(self.c.post("/api/runner/experiments/preflight", {"plan": plan}))

    @tool("runner", "spend", "Start an experiment")
    def experiment_start(self, plan: dict, idempotency_key: Optional[str] = None) -> dict:
        """Review, create and start an experiment. Its reviewed worst-case cost (maximum_cost_usd) must fit in
        the session budget."""
        review = self.c.post("/api/runner/experiments/preflight", {"plan": plan})
        if not review.get("ok"):
            raise GuardError("The runner refused this plan: " + "; ".join(map(str, review.get("issues") or [])))
        self.guard.reserve(review.get("maximum_cost_usd"), "This experiment")
        created = self.c.post("/api/runner/experiments", {"plan": review["plan"], "plan_sha256": review["plan_sha256"],
                                                          "idempotency_key": idempotency_key or uuid.uuid4().hex})
        exp = created.get("experiment") or {}
        started = self.c.post(f"/api/runner/experiments/{seg(exp.get('id'))}/start", {"plan_sha256": review["plan_sha256"]})
        return {"experiment": cut(started.get("experiment", started)), "spend": self.guard.report()}

    @tool("runner", "read", "List experiments")
    def experiments_list(self) -> dict:
        """Experiments the runner recorded: status, trials, cost."""
        try:
            return cut(self.c.get("/api/runner/experiments"))
        except ConsoleError as e:
            if e.status == 404:
                raise GuardError("No experiments: they are recorded by the local runner, which is not set up here "
                                 "(traceharness runner setup). (HTTP 404)") from None
            raise

    @tool("runner", "read", "Experiment")
    def experiment_get(self, experiment_id: str) -> dict:
        """One experiment: plan, trials and their outcomes."""
        return cut(self.c.get(f"/api/runner/experiments/{seg(experiment_id)}"))

    @tool("runner", "write", "Cancel an experiment", destructive=True)
    def experiment_cancel(self, experiment_id: str) -> dict:
        """Stop an experiment's remaining trials."""
        return cut(self.c.post(f"/api/runner/experiments/{seg(experiment_id)}/cancel"))

    # ================================================================== import
    @tool("import", "read", "Import adapters")
    def import_sources(self) -> dict:
        """The import adapters (Claude Code, Codex, SWE-agent, OpenHands, Inspect, ...) and the files each reads."""
        return cut(self.c.get("/api/import/sources"))

    @tool("import", "read", "Detect a trace format")
    def import_detect(self, path: Annotated[str, Field(description="A file or folder on this machine.")]) -> dict:
        """Which adapter would read a file or folder, with its confidence. Imports nothing."""
        return cut(self.c.request("GET", "/api/import/detect", params={"path": path}))

    @tool("import", "read", "Import status")
    def import_status(self) -> dict:
        """The running or last import: progress and result."""
        return cut(self.c.get("/api/import/status"))

    @tool("import", "write", "Import traces")
    def import_run(self, path: str, dataset: Annotated[str, Field(description="Results directory to import into.")],
                   source: Optional[str] = None, model: Optional[str] = None) -> dict:
        """Import another harness's traces (a file or folder) into a dataset. Re-importing skips runs already there."""
        body = {"path": path, "results_dir": dataset, "source": source, "model": model}
        return cut(self.c.post("/api/import", {k: v for k, v in body.items() if v is not None}))

    @tool("import", "read", "Hugging Face catalog", open_world=False)
    def hf_catalog(self) -> dict:
        """The curated Hugging Face benchmarks and trajectory sets (offline list), with which ones import."""
        return cut(self.c.get("/api/hf/catalog"))

    @tool("import", "read", "Hugging Face dataset", open_world=True)
    def hf_dataset(self, dataset: Annotated[str, Field(description="owner/name, e.g. nebius/SWE-agent-trajectories.")]) -> dict:
        """One Hugging Face dataset: rows, license, languages, dates and whether it imports. Asks the Hub."""
        owner, _, name = dataset.partition("/")
        if not owner or not name or "/" in name:
            raise GuardError("dataset is owner/name")
        return cut(self.c.get(f"/api/hf/datasets/{seg(owner)}/{seg(name)}"))

    @tool("import", "read", "Preview a Hugging Face dataset", open_world=True)
    def hf_preview(self, dataset: str, config: Optional[str] = None, split: Optional[str] = None) -> dict:
        """Columns and first rows of a Hugging Face dataset. Asks the Hub. Recorded agent output."""
        return recorded(cut(self.c.get("/api/hf/preview", dataset=dataset, config=config, split=split), 1500))

    @tool("import", "write", "Import from Hugging Face", open_world=True)
    def hf_import(self, dataset: str, n: Annotated[int, Field(ge=1, le=5000)] = 20, seed: int = 0,
                  name: Optional[str] = None, config: Optional[str] = None, split: Optional[str] = None) -> dict:
        """Import n rows of an importable Hugging Face trajectory set into a dataset, with its provenance."""
        body = {"dataset": dataset, "n": n, "seed": seed, "name": name, "config": config, "split": split}
        return cut(self.c.post("/api/hf/import", {k: v for k, v in body.items() if v is not None}))

    # ================================================================== capture (private; explicit only)
    @tool("capture", "read", "Capture status", private=True)
    def capture_status(self) -> dict:
        """The capture watcher and the captured sessions on this machine (private): state, counts, tokens, cost."""
        return cut(self.c.request("GET", "/api/capture/status", private=True))

    @tool("capture", "write", "Export captured sessions", private=True)
    def capture_export(self, out_path: Annotated[str, Field(description="Where to write the zip; must not exist yet.")],
                       since: Annotated[Optional[str], Field(description="Only sessions that ended on or after YYYY-MM-DD.")] = None) -> dict:
        """Write the captured sessions to one redacted zip (keys are redacted; check it before you share it)."""
        from traceharness.capture.exchange import export_archive
        out = os.path.abspath(os.path.expanduser(out_path))
        if os.path.exists(out):
            raise GuardError(f"{out} already exists; choose another out_path")
        runs_root = self.c.get("/api/settings").get("results_root")
        info = export_archive(runs_root, out, since=since or "")
        return {"path": info.get("path"), "runs": info.get("runs"), "bytes": info.get("bytes"),
                "skipped": (info.get("skipped") or [])[:20]}

    @tool("capture", "write", "Import captured sessions", private=True)
    def capture_import(self, zip_path: str) -> dict:
        """Read a zip made by capture_export (or `traceharness capture export`) into this lab's captured dataset."""
        from traceharness.capture.exchange import import_archive
        runs_root = self.c.get("/api/settings").get("results_root")
        info = import_archive(runs_root, os.path.abspath(os.path.expanduser(zip_path)))
        return {"imported": len(info.get("imported") or []), "skipped": len(info.get("skipped") or []),
                "sources": info.get("sources")}

    # ================================================================== sentinel
    @tool("sentinel", "read", "Sentinel status")
    def sentinel_status(self) -> dict:
        """The trained early-warning models: which is active, their accuracy and operating points."""
        d = self.c.get("/api/sentinel")
        return cut({"active": d.get("active"), "model": (d.get("model") or {}).get("meta"),
                    "models": [{"name": m.get("name"), "meta": m.get("meta")} for m in d.get("models") or []]})

    @tool("sentinel", "read", "Replay the sentinel over a dataset")
    def sentinel_replay(self, dataset: DatasetArg, harness: Optional[str] = None,
                        threshold: Annotated[float, Field(ge=0, le=1, description="Risk at which a run counts as flagged.")] = 0.6,
                        limit: LimitArg = 25, offset: OffsetArg = 0) -> dict:
        """The active sentinel replayed over every run of a dataset: how many failing and passing runs it would
        flag at a threshold, and the runs by highest risk (risk per step, the patterns it saw)."""
        rows = self.c.get(f"/api/sentinel/replay_all/{seg(dataset)}", harness=harness)
        rows = rows if isinstance(rows, list) else []
        flagged = [r for r in rows if (r.get("max_risk") or 0) >= threshold]
        summary = {"runs": len(rows), "threshold": threshold, "flagged": len(flagged),
                   "flagged_failing": sum(1 for r in flagged if r.get("hidden_pass") is False),
                   "failing": sum(1 for r in rows if r.get("hidden_pass") is False),
                   "flagged_passing": sum(1 for r in flagged if r.get("hidden_pass") is True),
                   "passing": sum(1 for r in rows if r.get("hidden_pass") is True)}
        ranked = sorted(rows, key=lambda r: r.get("max_risk") or 0, reverse=True)
        return {"summary": summary, **cut(page(ranked, limit, offset))}

    @tool("sentinel", "read", "Sentinel detectors")
    def sentinel_plugins(self) -> dict:
        """The detectors and rules the sentinel runs (built-in and plugins), and which are on."""
        return cut(self.c.get("/api/sentinel/plugins"))
