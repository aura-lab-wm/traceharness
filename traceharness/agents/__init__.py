"""Third-party coding agents run by TraceHarness, each in its own container.

`traceharness agents run` launches mini-SWE-agent, Codex CLI or Claude Code on the lab's tasks with
a pinned model and pinned hosts, and writes the same results directory as `traceharness run`: an
index row per run, and per run a ledger (built from the agent's own log by the import adapters),
the patch, the messages and the summary. The three grades come from the same grader as the lab's
own runs, applied to the workspace the agent left. See run.py for the containers.
"""
