"""An offline, scripted stand-in for the model broker's upstream: no network, no key, no cost.

It exists so the whole runner (containers, broker, grading, manifests, experiment matrices) can be
proved on a machine without a paid call. It is selected only by TRACEHARNESS_RUNNER_PROVIDER=scripted
and offers one model, "mock/scripted", over the chat-completions protocol the TraceHarness runtime
speaks. It is not trying to solve a task: it lists the files, runs the tests, and submits.
"""
from __future__ import annotations

import json

from traceharness.runner_service.provider import ProviderError

MODEL_ID = "mock/scripted"
SCRIPT = ("list_files", "run_tests", "submit")


class ScriptedProvider:
    def models(self, allowed):
        row = {"id": MODEL_ID, "name": "Scripted mock model (offline)", "context_length": 32768,
               "pricing": {"prompt": "0", "completion": "0"}, "supported_parameters": ["tools"]}
        return [row] if allowed is None or MODEL_ID in allowed else []

    def validate_key(self, key):
        return None

    def forward(self, protocol, key, body, *, timeout_seconds=30):
        if protocol != "chat/completions":
            raise ProviderError("The scripted model speaks only chat/completions.")
        messages = body.get("messages") or []
        done = sum(1 for m in messages if isinstance(m, dict) and m.get("role") == "assistant" and m.get("tool_calls"))
        offered = {t.get("function", {}).get("name") for t in body.get("tools") or [] if isinstance(t, dict)}
        name = SCRIPT[min(done, len(SCRIPT) - 1)]
        if name not in offered:
            name = "submit" if "submit" in offered else next(iter(sorted(offered)), None)
        message = {"role": "assistant", "content": f"scripted step {done + 1}"}
        finish = "stop"
        if name:
            args = {"summary": "Scripted run: inspected the repository and ran the visible tests; no change made."} if name == "submit" else {}
            message["tool_calls"] = [{"id": f"call_{done + 1}", "type": "function",
                                      "function": {"name": name, "arguments": json.dumps(args)}}]
            finish = "tool_calls"
        payload = {"id": f"scripted-{done + 1}", "object": "chat.completion", "model": MODEL_ID,
                   "choices": [{"index": 0, "finish_reason": finish, "message": message}],
                   "usage": {"prompt_tokens": 100 + 50 * done, "completion_tokens": 20, "cost": 0}}
        return "application/json", json.dumps(payload).encode()
