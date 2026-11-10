"""Owner-bound jobs, replay-safe admission and transient provider capabilities."""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal, InvalidOperation
import hashlib
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
from .provider import ProviderError

TERMINAL = {"succeeded", "failed", "cancelled", "needs_attention"}


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
        with self.lock:
            row, cancel = self.rows[jid], self.events[jid]
            if cancel.is_set():
                row["job"].update(status="cancelled", updated_at=int(self.clock()))
                self._save(row)
                return
            if self.blocked_reason or any(item["job"]["status"] == "needs_attention" for item in self.rows.values()):
                row["job"].update(status="failed", issues=["Runner cleanup requires operator review; this queued run was not started."], updated_at=int(self.clock()))
                self._save(row)
                return
            row["job"].update(status="running", updated_at=int(self.clock()))
            self._save(row)
        owner, manifest = row["owner"], row["job"]["manifest"]
        broker_lock, reserved = threading.Lock(), Decimal("0")
        deadline = self.clock() + manifest["limits"]["wall_time_seconds"]

        def forward(protocol, body):
            nonlocal reserved
            with broker_lock:
                if cancel.is_set() or self.clock() >= deadline:
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
                           "response_format", "metadata", "service_tier", "context_management"}
                if set(body) - allowed:
                    raise ProviderError("Unsupported provider request options.")
                tools = body.get("tools", [])
                if not isinstance(tools, list) or len(tools) > 100 or any(not isinstance(tool, dict) or tool.get("type", "function") not in {"function", "custom"} for tool in tools):
                    raise ProviderError("Only client-executed function tools are supported.")
                # No file/image/audio fetch, stored response references, alternate
                # providers, model fallback, background work or web-search charges.
                def inspect(value):
                    if isinstance(value, dict):
                        if value.get("type") in {"image", "image_url", "input_image", "input_file", "input_audio", "file", "web_search", "web_search_preview"}:
                            raise ProviderError("Only text and local tool operations are supported.")
                        for child in value.values():
                            inspect(child)
                    elif isinstance(value, list):
                        for child in value:
                            inspect(child)
                inspect(body)
                if row["job"]["usage"]["requests"] >= manifest["limits"]["max_steps"]:
                    raise ProviderError("Model request limit reached.")
                body = dict(body)
                if manifest["runtime_id"] == "native-claude-code":
                    body["provider"] = {"only": ["anthropic"], "allow_fallbacks": False}
                output_field = "max_output_tokens" if protocol == "responses" else "max_tokens"
                requested = body.get(output_field, body.get("max_completion_tokens", 4096))
                if isinstance(requested, bool) or not isinstance(requested, int) or requested < 1:
                    raise ProviderError("Invalid output limit.")
                maximum_output = min(requested, 8192)
                for field in ("max_tokens", "max_output_tokens", "max_completion_tokens"):
                    body.pop(field, None)
                body[output_field] = maximum_output
                try:
                    pricing = model["pricing"]
                    prices = [Decimal(str(pricing[k])) for k in ("prompt", "completion")]
                    request_price = Decimal(str(pricing.get("request", "0")))
                    if any(not p.is_finite() or p < 0 for p in [*prices, request_price]):
                        raise ValueError()
                    # Reserve a conservative byte-based input bound plus framing;
                    # never refund uncertain charges or retry a billable request.
                    reserve = (len(canonical(body)) + 8192) * prices[0] + maximum_output * prices[1] + request_price
                except (KeyError, InvalidOperation, ValueError, TypeError):
                    raise ProviderError("Verified model pricing is unavailable.") from None
                if reserved + reserve > Decimal(str(manifest["limits"]["max_cost_usd"])):
                    raise ProviderError("The remaining cost reservation cannot cover this request.")
                reserved += reserve
                with self.lock:
                    row["job"]["usage"]["requests"] += 1
                    self._save(row)
                return self.provider.forward(protocol, key, body, timeout_seconds=max(0.1, deadline - self.clock()))

        try:
            self.vault.resolve(owner, credential_id)
            result = self.executor.execute(jid, manifest, self.root / jid, cancel, forward)
            with self.lock:
                if cancel.is_set():
                    row["job"].update(status="cancelled", artifacts=[], issues=[])
                else:
                    row["job"].update(status="succeeded", artifacts=result.get("artifacts", []), issues=result.get("issues", []),
                                      grade=result.get("grade") if result.get("grade") in {"passed", "failed", "error"} else "ungraded")
        except CredentialUnavailable:
            with self.lock:
                row["job"].update(status="failed", issues=["The credential expired or was revoked. Reconnect it before reviewing another run."])
        except ExecutionError as error:
            with self.lock:
                # ExecutionError contains only adapter-authored fixed messages.
                cleanup_failed = "cleanup" in str(error).lower()
                status = "needs_attention" if cleanup_failed else "cancelled" if cancel.is_set() else "failed"
                row["job"].update(status=status, issues=[str(error)])
        except Exception:
            with self.lock:
                row["job"].update(status="needs_attention", issues=["Execution did not finish safely. Operator review is required."])
        finally:
            with self.lock:
                row["job"]["updated_at"] = int(self.clock())
                self._save(row)

    def close(self):
        with self.lock:
            for event in self.events.values():
                event.set()
        self.pool.shutdown(wait=True, cancel_futures=False)
        self.vault.clear()
