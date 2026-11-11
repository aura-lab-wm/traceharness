"""Owner-bound jobs, replay-safe admission and transient provider capabilities."""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal, InvalidOperation
import hashlib
import math
import json
from pathlib import Path
import re
import secrets
import shutil
import threading
import time

from .configuration import canonical, digest
from .credentials import CredentialUnavailable
from .execution import ExecutionError
from .provider import ProviderError, provider_status

TERMINAL = {"succeeded", "failed", "cancelled", "needs_attention"}

# Only these adapter-authored literals may become pretransport diagnostics.
BROKER_REFUSALS = {message: message for message in (
    'A previous model request had an uncertain outcome; this job cannot retry it.',
    'Invalid output limit.',
    'Invalid thinking budget.',
    'Invalid prompt cache identity.',
    'Job is no longer accepting model calls.',
    'Model does not match the reviewed run.',
    'Model request limit reached.',
    'Only bounded client-executed function tools are supported.',
    'Only standard-tier model requests are supported.',
    'Only stateless synchronous model requests are supported.',
    'Only text and local tool operations are supported.',
    'Protocol does not match the reviewed runtime.',
    'Provider-managed context operations are unsupported.',
    'Stored provider responses are unsupported.',
    'The remaining cost reservation cannot cover this request.',
    'The thinking budget must be smaller than the enforced output limit.',
    'Unsupported provider request options.',
    'Unsupported response inclusion options.',
    'Verified model pricing is unavailable.',
)}


def reported_usage(protocol, content_type, payload):
    """Read only terminal provider counters; never infer billing from token prices.

    Missing/invalid fields stay absent. Native Messages emits input usage in
    message_start and cumulative output usage in message_delta. Responses puts
    cumulative usage in its terminal response; Chat includes a final usage chunk.
    """
    if not isinstance(payload, bytes) or len(payload) > 4 * 1024 * 1024:
        return {}
    usages = []
    try:
        text = payload.decode("utf-8", errors="strict")
        if "text/event-stream" in content_type:
            events = []
            for record in text.replace("\r\n", "\n").split("\n\n"):
                data = "\n".join(line[5:].lstrip() for line in record.split("\n") if line.startswith("data:"))
                if data and data != "[DONE]":
                    events.append(json.loads(data))
        else:
            events = [json.loads(text)]
        for event in events:
            if not isinstance(event, dict):
                continue
            if protocol == "responses":
                candidate = event.get("response") if event.get("type") in {"response.completed", "response.incomplete"} else event if "type" not in event else None
            elif protocol == "messages":
                candidate = event.get("message") if event.get("type") == "message_start" else event if event.get("type") in {None, "message_delta"} else None
            else:
                candidate = event
            if isinstance(candidate, dict) and isinstance(candidate.get("usage"), dict):
                usages.append(candidate["usage"])
    except (ValueError, TypeError, UnicodeError, RecursionError):
        return {}
    combined = {}
    for usage in usages:
        combined.update(usage)
    out = {}
    for target, source in (("input_tokens", "prompt_tokens" if protocol == "chat/completions" else "input_tokens"),
                           ("output_tokens", "completion_tokens" if protocol == "chat/completions" else "output_tokens")):
        value = combined.get(source)
        if isinstance(value, int) and not isinstance(value, bool) and 0 <= value <= 2**53 - 1:
            out[target] = value
    cost = combined.get("cost")
    if isinstance(cost, (int, float)) and not isinstance(cost, bool) and math.isfinite(cost) and 0 <= cost <= 1000000:
        out["cost_usd"] = cost
    return out


def settled_response_cost(protocol, content_type, payload):
    """Settle only a complete successful response's explicit final cost.

    Protocol completion follows OpenRouter's streaming contract. Partial/error
    streams and unknown shapes retain their full conservative reservation.
    https://openrouter.ai/docs/api_reference/streaming
    """
    if not isinstance(payload, bytes) or len(payload) > 4 * 1024 * 1024 or not isinstance(content_type, str):
        return None
    stops = {"stop", "tool_calls", "function_call"}
    message_stops = {"end_turn", "tool_use", "stop_sequence"}
    def cost(record):
        usage = record.get("usage") if isinstance(record, dict) else None
        value = usage.get("cost") if isinstance(usage, dict) else None
        if type(value) in (int, float) and 0 <= value <= 1000000 and math.isfinite(value):
            return Decimal(str(value))
        return None
    def failed(event):
        response, message = event.get("response"), event.get("message")
        return (event.get("error") is not None or event.get("type") in ("error", "response.failed", "response.incomplete")
                or isinstance(response, dict) and response.get("error") is not None
                or isinstance(message, dict) and message.get("error") is not None)
    try:
        text = payload.decode("utf-8", errors="strict")
        if "text/event-stream" not in content_type:
            event = json.loads(text)
            if not isinstance(event, dict) or failed(event):
                return None
            if protocol == "responses":
                return cost(event) if event.get("object") == "response" and event.get("status") == "completed" and event.get("incomplete_details") is None else None
            if protocol == "messages":
                return cost(event) if event.get("type") == "message" and event.get("stop_reason") in message_stops else None
            choices = event.get("choices")
            if (protocol == "chat/completions" and event.get("object") == "chat.completion" and isinstance(choices, list)
                    and choices and all(isinstance(choice, dict) and choice.get("finish_reason") in stops for choice in choices)):
                return cost(event)
            return None
        text = text.replace("\r\n", "\n").replace("\r", "\n")
        if not text.endswith("\n\n"):
            return None
        events = []
        for record in text.split("\n\n"):
            fields = record.split("\n")
            labels = [line[6:].strip() for line in fields if line.startswith("event:")]
            if any(label in {"error", "response.failed", "response.incomplete"} for label in labels):
                return None
            data = "\n".join(line[5:].lstrip(" ") for line in fields if line.startswith("data:"))
            if not data:
                continue
            if data == "[DONE]":
                events.append(data)
                continue
            event = json.loads(data)
            if not isinstance(event, dict) or failed(event) or any(label != event.get("type") for label in labels):
                return None
            events.append(event)
        if not events:
            return None
        done = events[-1] == "[DONE]"
        if done:
            events.pop()
        if not events or any(not isinstance(event, dict) for event in events):
            return None
        if protocol == "messages":
            # Usage may be cumulative throughout the stream. Only the final
            # message_delta immediately before message_stop can settle a charge.
            events = [event for event in events if event.get("type") != "ping"]
            allowed = {"message_start", "content_block_start", "content_block_delta", "content_block_stop", "message_delta", "message_stop"}
            if (done or len(events) < 3 or any(event.get("type") not in allowed for event in events)
                    or events[0].get("type") != "message_start" or events[-1].get("type") != "message_stop"
                    or sum(event.get("type") == "message_start" for event in events) != 1
                    or sum(event.get("type") == "message_stop" for event in events) != 1):
                return None
            start = events[0].get("message")
            if not isinstance(start, dict) or start.get("type") != "message":
                return None
            final = events[-2]
            delta = final.get("delta")
            return cost(final) if final.get("type") == "message_delta" and isinstance(delta, dict) and delta.get("stop_reason") in message_stops else None
        if protocol == "responses":
            final = events[-1]
            response = final.get("response")
            if (final.get("type") == "response.completed" and isinstance(response, dict)
                    and response.get("status") == "completed" and response.get("incomplete_details") is None
                    and sum(event.get("type") == "response.completed" for event in events) == 1):
                return cost(response)
            return None
        if protocol == "chat/completions" and done:
            seen, finished = set(), set()
            for event in events:
                choices = event.get("choices")
                if not isinstance(choices, list):
                    return None
                for choice in choices:
                    if not isinstance(choice, dict) or type(choice.get("index")) is not int or not 0 <= choice["index"] < 128:
                        return None
                    seen.add(choice["index"])
                    reason = choice.get("finish_reason")
                    if reason is not None:
                        if reason not in stops:
                            return None
                        finished.add(choice["index"])
            return cost(events[-1]) if seen and seen == finished else None
    except (ValueError, TypeError, UnicodeError, RecursionError):
        return None
    return None


def standard_request(body, protocol):
    """Pin the price tier and refuse operations not represented by run limits."""
    if body.get("service_tier") not in (None, "auto", "default", "standard"):
        raise ProviderError("Only standard-tier model requests are supported.")
    if body.get("context_management") not in (None, {}, {"edits": []}):
        raise ProviderError("Provider-managed context operations are unsupported.")
    for key in ("store", "background"):
        if key in body and body[key] is not False:
            raise ProviderError("Only stateless synchronous model requests are supported.")
    if body.get("previous_response_id") is not None:
        raise ProviderError("Stored provider responses are unsupported.")
    if "include" in body and (protocol != "responses" or not isinstance(body["include"], list)
            or len(body["include"]) > 1 or any(item != "reasoning.encrypted_content" for item in body["include"])):
        raise ProviderError("Unsupported response inclusion options.")
    if "prompt_cache_key" in body and (not isinstance(body["prompt_cache_key"], str)
            or len(body["prompt_cache_key"]) > 200 or re.search(r"[\x00-\x1f\x7f]", body["prompt_cache_key"])):
        raise ProviderError("Invalid prompt cache identity.")
    # Explicit cache-write markers carry premiums that baseline token prices do
    # not cover. Remove markers from protocol content/tools, never tool schemas.
    def copy(value):
        if isinstance(value, list):
            return [copy(item) for item in value]
        if isinstance(value, dict):
            return {key: item if key in {"input_schema", "parameters", "schema"} else copy(item)
                    for key, item in value.items() if key != "cache_control"}
        return value
    result = copy(body)
    result.pop("context_management", None)
    result.pop("previous_response_id", None)
    result["service_tier"] = "default"  # overrides a member's premium workspace default
    return result


def validate_client_tools(tools, protocol):
    """Allow one Responses namespace layer without enabling hosted tool operations."""
    def refuse():
        raise ProviderError("Only bounded client-executed function tools are supported.")
    def named(tool):
        return isinstance(tool.get("name"), str) and re.fullmatch(r"[A-Za-z0-9_-]{1,64}", tool["name"])
    if not isinstance(tools, list) or len(tools) > 100:
        refuse()
    count = 0
    for tool in tools:
        if not isinstance(tool, dict):
            refuse()
        kind = tool.get("type", "function")
        if kind in ("function", "custom"):
            count += 1
        elif kind == "namespace" and protocol == "responses":
            nested = tool.get("tools")
            if (not named(tool) or set(tool) - {"type", "name", "description", "tools"}
                    or "description" in tool and not isinstance(tool["description"], str)
                    or not isinstance(nested, list) or not 1 <= len(nested) <= 100):
                refuse()
            for local in nested:
                if not isinstance(local, dict) or local.get("type") not in ("function", "custom") or not named(local):
                    refuse()
            count += len(nested)
        else:
            refuse()
        if count > 100:
            refuse()


class JobError(Exception):
    def __init__(self, message, status=400):
        self.status = status
        super().__init__(message)


class Jobs:
    def __init__(self, settings, vault, provider, executor, clock=time.time):
        self.settings, self.vault, self.provider, self.executor, self.clock = settings, vault, provider, executor, clock
        self.root = Path(settings.state_dir)
        if self.root.is_symlink():
            raise ValueError("Runner state cannot be a symlink")
        self.root.mkdir(mode=0o700, parents=True, exist_ok=True)
        self.root.chmod(0o700)
        self.lock = threading.RLock()
        self.rows, self.idempotency, self.events = {}, {}, {}
        self.blocked_reason = None
        self.pool = ThreadPoolExecutor(max_workers=settings.max_workers, thread_name_prefix="private-runner")
        for directory in self.root.iterdir():
            path = directory / "job.json"
            if (directory.is_symlink() or not directory.is_dir() or not re.fullmatch(r"[a-f0-9]{48}", directory.name)
                    or path.is_symlink() or not path.is_file() or path.stat().st_size > 2 * 1024 * 1024):
                self.blocked_reason = "Unknown runner state requires operator reconciliation."
                continue
            try:
                row = json.loads(path.read_text())
                if row["job"]["id"] != path.parent.name:
                    self.blocked_reason = "Invalid runner state requires operator reconciliation."
                    continue
                if row["job"]["status"] not in TERMINAL:
                    row["job"].update(status="needs_attention", issues=["Runner restarted. Inspect prior execution before starting another run."], updated_at=int(clock()))
                self.rows[path.parent.name] = row
                self.idempotency[(row["owner"], row["idempotency_key"])] = path.parent.name
                self._save(row)
            except (ValueError, KeyError, TypeError, OSError):
                self.blocked_reason = "Unreadable runner state requires operator reconciliation."
        if sum(len(canonical(row)) for row in self.rows.values()) > 64 * 1024 * 1024:
            self.blocked_reason = "Runner state exceeds its retention limit."
        self._purge()

    def _save(self, row):
        directory = self.root / row["job"]["id"]
        directory.mkdir(mode=0o700, exist_ok=True)
        temp = directory / "job.tmp"
        temp.write_bytes(canonical(row))
        temp.chmod(0o600)
        temp.replace(directory / "job.json")

    def _purge(self):
        now = self.clock()
        for jid, row in list(self.rows.items()):
            if row["job"]["status"] in TERMINAL - {"needs_attention"} and now - row["job"]["updated_at"] > self.settings.job_ttl:
                shutil.rmtree(self.root / jid)
                del self.rows[jid]
                self.idempotency.pop((row["owner"], row["idempotency_key"]), None)
                self.events.pop(jid, None)

    def public(self, row):
        return json.loads(json.dumps(row["job"]))

    def list(self, owner):
        with self.lock:
            self._purge()
            return [{k: v for k, v in self.public(row).items() if k != "manifest"}
                    for row in sorted(self.rows.values(), key=lambda r: r["job"]["created_at"], reverse=True) if row["owner"] == owner]

    def get(self, owner, jid):
        with self.lock:
            row = self.rows.get(jid)
            if row is None or row["owner"] != owner:
                raise JobError("Job not found.", 404)
            return self.public(row)

    def reconcile(self, owner, idempotency_key, manifest_sha256):
        """Adopt an existing reviewed job without creating or changing a run.

        A scheduler can recover a committed submission after a lost response or
        credential rotation. Do not purge before this lookup: retention cleanup
        must not turn a known execution into permission to issue it again.
        Ordinary submit still binds its original credential fingerprint.
        """
        if (not isinstance(idempotency_key, str) or not re.fullmatch(r"[A-Za-z0-9_-]{16,128}", idempotency_key)
                or not isinstance(manifest_sha256, str) or not re.fullmatch(r"[a-f0-9]{64}", manifest_sha256)):
            raise JobError("Supply a reviewed job identity.")
        with self.lock:
            existing = self.idempotency.get((owner, idempotency_key))
            if existing is None:
                return None
            row = self.rows.get(existing)
            if row is None or row.get("owner") != owner:
                raise JobError("Job identity requires operator reconciliation.", 409)
            if row["job"].get("manifest_sha256") != manifest_sha256:
                raise JobError("Idempotency key belongs to a different run.", 409)
            return self.public(row)

    def submit(self, owner, manifest, credential_id, idempotency_key, model):
        if not isinstance(idempotency_key, str) or not re.fullmatch(r"[A-Za-z0-9_-]{16,128}", idempotency_key):
            raise JobError("Supply a fresh idempotency key.")
        fingerprint = digest({"manifest": manifest, "credential_id": credential_id})
        with self.lock:
            self._purge()
            existing = self.idempotency.get((owner, idempotency_key))
            if existing:
                row = self.rows[existing]
                if row["fingerprint"] != fingerprint:
                    raise JobError("Idempotency key belongs to a different run.", 409)
                return self.public(row)
            self.vault.resolve(owner, credential_id)
            if self.blocked_reason or any(row["job"]["status"] == "needs_attention" for row in self.rows.values()):
                raise JobError("Runner cleanup requires operator review before another run.", 503)
            owned = [row for row in self.rows.values() if row["owner"] == owner]
            active = sum(row["job"]["status"] not in TERMINAL for row in owned)
            total_active = sum(row["job"]["status"] not in TERMINAL for row in self.rows.values())
            if len(owned) >= self.settings.max_jobs_per_owner or active >= self.settings.max_active_per_owner or total_active >= self.settings.max_workers * 4 or len(self.rows) >= 2000:
                raise JobError("Runner capacity is full. Try again later.", 429)
            jid, now = secrets.token_hex(24), int(self.clock())
            row = {"owner": owner, "idempotency_key": idempotency_key, "fingerprint": fingerprint,
                   "job": {"id": jid, "status": "queued", "created_at": now, "updated_at": now,
                           "manifest": manifest, "manifest_sha256": digest(manifest), "issues": [], "artifacts": [],
                           "usage": {"requests": 0}, "cancellation_requested": False, "grade": "ungraded"}}
            if sum(len(canonical(existing)) for existing in self.rows.values()) + len(canonical(row)) > 64 * 1024 * 1024:
                raise JobError("Runner retention capacity is full. Try again later.", 429)
            self.rows[jid] = row
            self.idempotency[(owner, idempotency_key)] = jid
            self.events[jid] = threading.Event()
            self._save(row)
            self.pool.submit(self._execute, jid, credential_id, model)
            return self.public(row)

    def cancel(self, owner, jid):
        with self.lock:
            self.get(owner, jid)
            row = self.rows[jid]
            if row["job"]["status"] not in TERMINAL:
                row["job"].update(status="cancel_requested", cancellation_requested=True, updated_at=int(self.clock()))
                self.events[jid].set()
                self._save(row)
            return self.public(row)

    def revoke(self, owner, credential_id):
        self.vault.revoke(owner, credential_id)
        # Each subsequent model request resolves the handle anew. Never retain a
        # resolved provider key in queued jobs, manifests, exceptions or disk.

    def _execute(self, jid, credential_id, model):
        zero_usage = {"requests": 0, "input_tokens": 0, "output_tokens": 0, "cost_usd": 0}
        with self.lock:
            row, cancel = self.rows[jid], self.events[jid]
            if cancel.is_set():
                if row["job"]["usage"].get("requests") == 0:
                    row["job"]["usage"] = dict(zero_usage)
                row["job"].update(status="cancelled", updated_at=int(self.clock()))
                self._save(row)
                return
            if self.blocked_reason or any(item["job"]["status"] == "needs_attention" for item in self.rows.values()):
                if row["job"]["usage"].get("requests") == 0:
                    row["job"]["usage"] = dict(zero_usage)
                row["job"].update(status="failed", issues=["Runner cleanup requires operator review; this queued run was not started."],
                                  updated_at=int(self.clock()))
                self._save(row)
                return
            row["job"].update(status="running", updated_at=int(self.clock()))
            self._save(row)
        owner, manifest = row["owner"], row["job"]["manifest"]
        broker_lock, reserved = threading.Lock(), Decimal("0")
        observed = {key: Decimal("0") for key in ("input_tokens", "output_tokens", "cost_usd")}
        complete_usage = {key: True for key in observed}
        accepting_calls = True
        provider_attempted = False
        transport_failed = False
        transport_issue = None
        broker_issue = None
        budget_issue = None
        deadline = self.clock() + manifest["limits"]["wall_time_seconds"]

        def with_diagnostics(issues):
            # Keep the first bounded diagnostic even when the adapter returns or
            # replaces terminal issues. Never copy provider exception text.
            return [*issues, *(issue for issue in (transport_issue, broker_issue, budget_issue) if issue and issue not in issues)]

        def forward(protocol, body):
            nonlocal reserved, provider_attempted, transport_failed, transport_issue, broker_issue, budget_issue
            budget_refusal = None
            with broker_lock:
                try:
                    if transport_failed:
                        raise ProviderError("A previous model request had an uncertain outcome; this job cannot retry it.")
                    if not accepting_calls or cancel.is_set() or self.clock() >= deadline:
                        raise ProviderError("Job is no longer accepting model calls.")
                    expected_protocol = {"traceharness": "chat/completions", "native-codex": "responses", "native-claude-code": "messages"}[manifest["runtime_id"]]
                    if protocol != expected_protocol:
                        raise ProviderError("Protocol does not match the reviewed runtime.")
                    key = self.vault.resolve(owner, credential_id)
                    if body.get("model") != manifest["model_id"]:
                        raise ProviderError("Model does not match the reviewed run.")
                    allowed = {"model", "messages", "input", "instructions", "tools", "tool_choice", "parallel_tool_calls",
                               "temperature", "top_p", "top_k", "max_tokens", "max_output_tokens", "max_completion_tokens",
                               "stream", "stream_options", "stop", "seed", "system", "thinking", "reasoning", "text",
                               "response_format", "metadata", "service_tier", "context_management",
                               "store", "background", "previous_response_id", "include", "prompt_cache_key"}
                    if protocol == "responses":
                        allowed.add("client_metadata")
                    if set(body) - allowed:
                        raise ProviderError("Unsupported provider request options.")
                    # Codex client telemetry is not a model input or an execution capability.
                    # Drop it before inspection, reservation and transport; never retain it.
                    body = {key: value for key, value in body.items() if key != "client_metadata"}
                    validate_client_tools(body.get("tools", []), protocol)
                    # No file/image/audio fetch, stored response references, alternate
                    # providers, model fallback, background work or web-search charges.
                    def inspect(value):
                        if isinstance(value, dict):
                            if isinstance(value.get("type"), str) and value["type"] in {"image", "image_url", "input_image", "input_file", "input_audio", "file", "document", "url", "web_search", "web_search_preview"}:
                                raise ProviderError("Only text and local tool operations are supported.")
                            for child in value.values():
                                inspect(child)
                        elif isinstance(value, list):
                            for child in value:
                                inspect(child)
                    inspect(body)
                    if row["job"]["usage"]["requests"] >= manifest["limits"]["max_steps"]:
                        raise ProviderError("Model request limit reached.")
                    body = standard_request(body, protocol)
                    output_field = "max_output_tokens" if protocol == "responses" else "max_tokens"
                    requested = body.get(output_field, body.get("max_completion_tokens", 4096))
                    reviewed_output_cap = manifest["limits"].get("max_output_tokens", 8192)
                    minimum_output_cap = 2049 if manifest["runtime_id"] == "native-claude-code" else 1
                    if (isinstance(requested, bool) or not isinstance(requested, int) or requested < 1
                            or type(reviewed_output_cap) is not int or not minimum_output_cap <= reviewed_output_cap <= 8192):
                        raise ProviderError("Invalid output limit.")
                    maximum_output = min(requested, reviewed_output_cap)
                    thinking = body.get("thinking")
                    if protocol == "messages" and isinstance(thinking, dict) and thinking.get("type") == "enabled":
                        thinking_budget = thinking.get("budget_tokens")
                        if type(thinking_budget) is not int or thinking_budget < 1:
                            raise ProviderError("Invalid thinking budget.")
                        if thinking_budget >= maximum_output:
                            raise ProviderError("The thinking budget must be smaller than the enforced output limit.")
                    for field in ("max_tokens", "max_output_tokens", "max_completion_tokens"):
                        body.pop(field, None)
                    body[output_field] = maximum_output
                    try:
                        pricing = model["pricing"]
                        prices = [Decimal(str(pricing[k])) for k in ("prompt", "completion")]
                        request_price = Decimal(str(pricing.get("request", "0")))
                        if any(not p.is_finite() or not 0 <= p <= 100 for p in [*prices, request_price]):
                            raise ValueError()
                        # Catalog token prices are per token; provider.max_price uses
                        # USD per million tokens. Prevent routing above the reserved rate.
                        body["provider"] = {"allow_fallbacks": False, "max_price": {
                            "prompt": float(prices[0] * 1000000), "completion": float(prices[1] * 1000000),
                            "request": float(request_price)}}
                        if manifest["runtime_id"] == "native-claude-code":
                            body["provider"]["only"] = ["anthropic"]
                        # Reserve a conservative byte-based input bound plus framing;
                        # never refund uncertain charges or retry a billable request.
                        reserve = (len(canonical(body)) + 8192) * prices[0] + maximum_output * prices[1] + request_price
                    except (KeyError, InvalidOperation, ValueError, TypeError):
                        raise ProviderError("Verified model pricing is unavailable.") from None
                    cap = Decimal(str(manifest["limits"]["max_cost_usd"]))
                    if reserved + reserve > cap:
                        # These values are trusted arithmetic, never provider/error
                        # text or model input. Committed reservations can exceed
                        # reported usage when a prior charge cannot be settled.
                        remaining = max(Decimal("0"), cap - reserved)
                        budget_refusal = (f"Next request reservation: ${reserve:.6f}. "
                                          f"Remaining reservation allowance: ${remaining:.6f} of the ${cap:.6f} run cap. "
                                          "Reported usage may be lower than reserved charges.")
                        raise ProviderError("The remaining cost reservation cannot cover this request.")
                    reserved += reserve
                    with self.lock:
                        row["job"]["usage"]["requests"] += 1
                        self._save(row)
                    provider_attempted = True
                    try:
                        response = self.provider.forward(protocol, key, body, timeout_seconds=max(0.1, deadline - self.clock()))
                        usage = reported_usage(protocol, *response)
                    except Exception as error:
                        transport_failed = True
                        status = provider_status(error)
                        transport_issue = (f"OpenRouter refused the model request (HTTP {status})." if status is not None
                                           else "Model transport outcome is uncertain.")
                        # A transport failure may still be billed. Do not publish an
                        # earlier subtotal as if it represented every issued request.
                        with self.lock:
                            row["job"]["issues"] = with_diagnostics(row["job"]["issues"])
                            for field in observed:
                                complete_usage[field] = False
                                row["job"]["usage"].pop(field, None)
                            self._save(row)
                        raise
                    actual_cost = settled_response_cost(protocol, *response)
                    if actual_cost is not None:
                        # Replace only this completed request's reservation. Earlier
                        # unknown charges stay reserved; actual spend is never refunded.
                        reserved = reserved - reserve + actual_cost
                    with self.lock:
                        for field in observed:
                            complete_usage[field] = complete_usage[field] and field in usage
                            if field in usage:
                                observed[field] += Decimal(str(usage[field]))
                            if complete_usage[field]:
                                row["job"]["usage"][field] = float(observed[field]) if field == "cost_usd" else int(observed[field])
                            else:
                                row["job"]["usage"].pop(field, None)
                        self._save(row)
                    return response
                except ProviderError as error:
                    if accepting_calls and not transport_failed:
                        # Never serialize arbitrary exception text. A closed map
                        # selects an authored literal, or a fixed generic refusal.
                        argument = error.args[0] if len(error.args) == 1 and type(error.args[0]) is str else None
                        previous, previous_budget = broker_issue, budget_issue
                        broker_issue = BROKER_REFUSALS.get(argument, "Model request was refused before transport.")
                        budget_issue = budget_refusal
                        with self.lock:
                            row["job"]["issues"] = with_diagnostics([issue for issue in row["job"]["issues"] if issue not in (previous, previous_budget)])
                            self._save(row)
                    raise

        artifacts, issues, result_grade = [], [], None
        failure = None
        try:
            self.vault.resolve(owner, credential_id)
            result = self.executor.execute(jid, manifest, self.root / jid, cancel, forward)
            if not isinstance(result, dict):
                raise ValueError("Invalid executor result.")
            artifacts = result.get("artifacts", [])
            issues = result.get("issues", [])
            result_grade = result.get("grade")
            if (not isinstance(artifacts, list) or not isinstance(issues, list)
                    or not all(type(item) is str for item in issues)
                    or (result_grade is not None and type(result_grade) is not str)):
                raise ValueError("Invalid executor result.")
            canonical(artifacts)
        except BaseException as error:
            failure = error
            if not isinstance(error, Exception):
                with broker_lock:
                    accepting_calls = False
                raise
        with broker_lock:
            accepting_calls = False
        with self.lock:
            if failure is None:
                if cancel.is_set():
                    row["job"].update(status="cancelled", artifacts=[], issues=with_diagnostics([]), grade="ungraded")
                else:
                    row["job"].update(status="succeeded", artifacts=list(artifacts), issues=with_diagnostics(issues),
                                      grade=result_grade if result_grade in {"passed", "failed", "error"} else "ungraded")
            elif isinstance(failure, CredentialUnavailable):
                row["job"].update(status="failed", issues=with_diagnostics(["The credential expired or was revoked. Reconnect it before reviewing another run."]),
                                  grade="ungraded")
            elif isinstance(failure, ExecutionError):
                # ExecutionError contains only adapter-authored fixed messages.
                cleanup_failed = "cleanup" in str(failure).lower()
                status = "needs_attention" if cleanup_failed else "cancelled" if cancel.is_set() else "failed"
                trusted_grade = getattr(failure, "grade", None)
                raw_artifacts = getattr(failure, "artifacts", None)
                grade = trusted_grade if status == "failed" and type(trusted_grade) is str and trusted_grade in {"passed", "failed", "error"} else "ungraded"
                row["job"].update(status=status, issues=with_diagnostics([str(failure)]),
                                  artifacts=list(raw_artifacts) if isinstance(raw_artifacts, list) else [], grade=grade)
            else:
                row["job"].update(status="needs_attention", issues=with_diagnostics(["Execution did not finish safely. Operator review is required."]),
                                  grade="ungraded")
            if not provider_attempted and not transport_failed and row["job"]["usage"].get("requests") == 0:
                row["job"]["usage"] = dict(zero_usage)
            row["job"]["updated_at"] = int(self.clock())
            self._save(row)

    def close(self):
        with self.lock:
            for event in self.events.values():
                event.set()
        self.pool.shutdown(wait=True, cancel_futures=False)
        self.vault.clear()
