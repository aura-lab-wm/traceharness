#!/usr/bin/env python3
"""Finalize an operator-prepared inventory; never discover or patch a home install.

Run the sibling static parser against a source graph from native_prompts_elf
first. All outputs contain private native source text and belong outside Git.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import re
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from traceharness.runner_service import native_prompts as N
from traceharness.runner_service import native_prompts_elf as ELF


def build_inventory(binary, candidates, *, image_digest, version):
    source = ELF.extract_native_source(binary)
    if candidates.get("source_sha256") != N.digest(source):
        raise N.NativePromptError("Parsed candidates do not describe this native executable")
    layout = ELF.native_source_layout(binary)
    provenance = candidates.get("provenance", {})
    policy = "complete-block-ambiguity-v1; minimum-64-bytes; reject control/schema/structural/nested-template contexts"
    if provenance.get("ownership_policy") != policy:
        raise N.NativePromptError("Native candidate ownership policy is missing or unsupported")
    extractor = Path(__file__).with_name("prepare_native_prompt_inventory.mjs")
    if provenance.get("extractor_sha256") != N.digest(extractor.read_bytes()):
        raise N.NativePromptError("Candidate extractor source digest does not match this preparation tool")
    if provenance.get("parsed_modules") != len(layout["modules"]) or provenance.get("parse_failures"):
        raise N.NativePromptError("Every executable source module must parse before publishing this inventory")
    reasons_by_body = {}
    for item in candidates["blocks"]:
        reasons = item.get("excluded_reasons")
        if not isinstance(reasons, list) or any(not isinstance(reason, str) or not reason for reason in reasons):
            raise N.NativePromptError("Native candidate exclusion evidence is missing")
        reasons_by_body.setdefault(item["baseline_sha256"], set()).update(reasons)
    blocks, anchors, labels = [], {}, {}
    for item in sorted(candidates["blocks"], key=lambda item: min(a["start"] for a in item["occurrences"])):
        reasons, contexts = item.get("excluded_reasons"), item.get("contexts")
        if (not isinstance(reasons, list) or any(not isinstance(reason, str) or not reason for reason in reasons)
                or not isinstance(contexts, list) or len(contexts) != len(item["occurrences"])
                or item.get("capability") != ("observed-only" if reasons else "patchable")
                or not reasons_by_body[item["baseline_sha256"]].issubset(set(reasons))
                or (len(item["baseline_utf8"].encode("utf-8")) < 64 and not reasons)):
            raise N.NativePromptError("Native candidate capability evidence is missing or inconsistent")
        for occurrence, context in zip(item["occurrences"], contexts):
            if (not isinstance(context, dict) or set(context) != {"start", "end", "source_sha256", "reasons"}
                    or any(context.get(key) != occurrence.get(key) for key in ("start", "end", "source_sha256"))
                    or not isinstance(context["reasons"], list)
                    or any(not isinstance(reason, str) or reason not in reasons for reason in context["reasons"])):
                raise N.NativePromptError("Native source context is inconsistent with its exclusion decision")
        catalog_id = item["catalog_id"]
        stem = re.sub(r"[^A-Za-z0-9_.:-]", "-", catalog_id)[:230].strip("-.")
        block_id = stem + ":" + item["baseline_sha256"][:16]
        if block_id in anchors:
            raise N.NativePromptError("Prepared native block identity collided")
        block = {
            "id": block_id, "title": item["title"], "class_name": N.classify(catalog_id, item["title"]),
            "class_source": N.CLASSIFICATION_SOURCE,
            "source_layer": "native-reminder" if catalog_id.startswith("system-reminder-") else "embedded-native-fragment",
            "capability": item["capability"], "baseline_sha256": item["baseline_sha256"],
            "baseline_utf8": item["baseline_utf8"], "occurrence_count": len(item["occurrences"]),
            "required_placeholders": item["required_placeholders"],
        }
        blocks.append(block)
        if item["capability"] == "patchable":
            anchors[block_id] = item["occurrences"]
        labels[block_id] = {key: item[key] for key in ("catalog_id", "catalog_version", "aliases", "excluded_reasons", "contexts")}
    if not blocks:
        raise N.NativePromptError("No candidate prompt was verified in the native source")
    inventory = {
        "schema_version": 1, "runtime_id": "native-claude-code", "runtime_version": version,
        "image_digest": image_digest, "binary_sha256": N.digest(binary),
        "taxonomy_sha256": N.taxonomy_sha256(), "materializer_sha256": N.materializer_sha256(),
        "blocks": blocks,
        "_private": {"source_kind": "javascript", "source_sha256": N.digest(source), "source_bytes": len(source),
            "source_path": "/usr/local/lib/node_modules/@anthropic-ai/claude-code/bin/claude.exe",
            "anchors": anchors, "native_layout": layout,
            "provenance": {**provenance, "catalog_labels": labels,
                "preparer_sha256": N.digest(Path(__file__).read_bytes()),
                "agent_patcher_revision": N.AGENT_PATCHER_REVISION,
                "inventory_scope": "Catalog-named literals with complete parsed source anchors and finite ambiguity exclusions; semantic prompt ownership remains unverified outside observed runtime requests"}},
    }
    inventory["inventory_sha256"] = N.inventory_sha256(inventory)
    N.validate_inventory(inventory, require_private=True)
    if len(N.canonical_bytes(N.public_inventory(inventory))) > 4 * 1024 * 1024:
        raise N.NativePromptError("Public native inventory exceeds the service's 4 MiB limit")
    if len(N.canonical_bytes(inventory)) > 16 * 1024 * 1024:
        raise N.NativePromptError("Private native inventory exceeds the service's 16 MiB limit")
    return inventory


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--binary", type=Path, required=True)
    parser.add_argument("--binary-sha256", required=True)
    parser.add_argument("--candidates", type=Path, required=True)
    parser.add_argument("--image-digest", required=True)
    parser.add_argument("--version", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    binary = args.binary.read_bytes()
    if N.digest(binary) != args.binary_sha256:
        raise N.NativePromptError("Operator-pinned native executable digest mismatch")
    inventory = build_inventory(binary, json.loads(args.candidates.read_text()),
                                image_digest=args.image_digest, version=args.version)
    payload = (json.dumps(inventory, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
    with args.output.open("xb") as handle:
        handle.write(payload)
    args.output.chmod(0o600)
    print(json.dumps({"inventory_sha256": inventory["inventory_sha256"], "blocks": len(inventory["blocks"]),
                      "occurrences": sum(b["occurrence_count"] for b in inventory["blocks"]),
                      "public_bytes": len(N.canonical_bytes(N.public_inventory(inventory))),
                      "runtime_consumption": "UNVERIFIED"}))


if __name__ == "__main__":
    main()
