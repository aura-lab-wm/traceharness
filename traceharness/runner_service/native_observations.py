"""Bounded observations of client-authored requests, never prompt rewriting.

Literal presence is narrower than execution coverage: conditional branches that
do not fire remain unobserved, and absence alone cannot prove an ablation. We
retain hashes and block IDs, never request bodies, credentials or task contents.
"""
from __future__ import annotations

import hashlib
import threading

from .native_prompts import canonical_bytes, profile_sha256, resolve_block_actions


def instruction_texts(body):
    """Keep location labels closed and omit provider metadata/tool arguments."""
    def content(value):
        if isinstance(value, str):
            return value
        if isinstance(value, list):
            return "\n".join(item["text"] for item in value
                             if isinstance(item, dict) and isinstance(item.get("text"), str)
                             and item.get("type") in {"text", "input_text", "output_text"})
        return ""

    out = []
    for field in ("system", "instructions"):
        text = content(body.get(field))
        if text:
            out.append((field, text))
    for item in body.get("tools", []) if isinstance(body.get("tools"), list) else []:
        if isinstance(item, dict):
            function = item.get("function", item)
            if isinstance(function, dict) and isinstance(function.get("description"), str):
                out.append(("tool_description", function["description"]))
    for field in ("messages", "input"):
        rows = body.get(field)
        if not isinstance(rows, list):
            continue
        for item in rows:
            if not isinstance(item, dict) or item.get("role") not in {"system", "developer", "user", "assistant"}:
                continue
            text = content(item.get("content"))
            if text:
                out.append((field + "." + item["role"], text))
    return out


class NativePromptObserver:
    """Hash instructions before the broker normalizes protocol/billing fields."""

    def __init__(self, inventory, profile):
        self.profile_hash = profile_sha256(profile)
        self.inventory_hash = inventory["inventory_sha256"]
        actions = resolve_block_actions(profile, inventory)
        overrides = {item["block_id"]: item for item in profile["overrides"]}
        self.candidates = []
        self.dynamic_count = self.short_count = 0
        for block in inventory["blocks"]:
            if block["capability"] != "patchable":
                continue
            action = actions[block["id"]]
            if block["required_placeholders"]:
                self.dynamic_count += 1
                continue
            values = [("baseline", block["baseline_utf8"])]
            if action == "replace":
                values.append(("replacement", overrides[block["id"]]["replacement_utf8"]))
            for kind, text in values:
                if len(text.encode("utf-8")) < 16:
                    self.short_count += 1
                    continue
                self.candidates.append((block["id"], action, kind, text,
                                        hashlib.sha256(text.encode("utf-8")).hexdigest()))
        self.requests = []
        self.truncated = False
        self.total = 0
        self.lock = threading.Lock()
        # Replacement markers are most informative; do not let an all-keep
        # inventory consume the bounded scan budget before an edited target.
        self.candidates.sort(key=lambda item: (item[2] != "replacement", item[1] == "keep", item[0]))

    def observe(self, protocol, body):
        with self.lock:
            self.total += 1
            number = self.total
            if len(self.requests) >= 64 or self.truncated:
                self.truncated = True
                return None
        texts = instruction_texts(body)
        record = {"protocol": protocol, "locations": [
            {"location": location, "bytes": len(text.encode("utf-8")),
             "sha256": hashlib.sha256(text.encode("utf-8")).hexdigest()}
            for location, text in texts[:256]], "literal_matches": [],
            "transport": "not_completed", "locations_truncated": len(texts) > 256,
            "matching_truncated": False}
        # The proxy already bounds requests to 1 MiB. No task data is retained.
        matches = set()
        work = 0
        for block_id, action, kind, literal, digest in self.candidates:
            for location, text in texts:
                if len(literal) > len(text):
                    continue
                work += len(text)
                if work > 32 * 1024 * 1024:
                    record["matching_truncated"] = True
                    break
                if literal in text:
                    matches.add((block_id, action, kind, digest, location))
            if record["matching_truncated"]:
                break
        record["literal_matches"] = [dict(zip(
            ("block_id", "configured_action", "literal", "sha256", "location"), item))
            for item in sorted(matches)[:512]]
        record["matches_truncated"] = len(matches) > 512
        with self.lock:
            record["request_number"] = number
            if len(self.requests) >= 64 or len(canonical_bytes(self.requests)) + len(canonical_bytes(record)) > 512 * 1024:
                self.truncated = True
                return None
            self.requests.append(record)
            return record

    def wrap(self, forward):
        def observed_forward(protocol, body):
            record = self.observe(protocol, body)
            try:
                response = forward(protocol, body)
            except Exception:
                if record is not None:
                    record["transport"] = "refused_or_failed"
                raise
            if record is not None:
                record["transport"] = "returned"
            return response
        return observed_forward

    def report(self):
        return {"schema_version": 1, "native_prompt_profile_sha256": self.profile_hash,
                "inventory_sha256": self.inventory_hash, "evidence_kind": "client_request_literal_observation",
                "scope": "system, instructions, tool descriptions and message text before broker normalization",
                "absence_proves_disable": False, "conditional_coverage_proved": False,
                "dynamic_blocks_unverified": self.dynamic_count, "short_literals_not_matched": self.short_count,
                "request_count": self.total, "requests_truncated": self.truncated, "requests": self.requests}
