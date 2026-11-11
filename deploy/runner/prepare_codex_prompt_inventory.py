#!/usr/bin/env python3
"""Prepare a private Codex inventory from pinned source assets and pristine ELF.

Nothing is installed or deployed. Baseline bodies and binaries belong in private
operator storage, outside Git. The candidate document selects source asset names;
all bodies, occurrences, capability and identities are independently recomputed.
"""
from __future__ import annotations
import argparse
import json
import os
from pathlib import Path
import sys
import tarfile

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from harnesslab.runner_service import native_prompts as shared
from harnesslab.runner_service import native_prompts_codex as codex

ARCHIVE_SHA256 = "214e5017a3c519557da811fe1df8e6fa51d408df0463c08f38a572b7e30b80fe"
BINARY_SHA256 = "dd5bfdf19d794dcc6fb482d2d5a2d9fb31d11f6caa44b303bb72890d461e8a02"
IMAGE_DIGEST = "sha256:e1e4ef84997e7c17acdb210ef55679b3d637fb590cdf469614fc6ab60459f2b0"


def prepare(binary, archive_path, candidate):
    if shared.digest(binary) != BINARY_SHA256:
        raise ValueError("Pristine Codex executable differs from the inspected build")
    if archive_path.is_symlink() or archive_path.stat().st_size > 100 * 1024 * 1024 or shared.digest(archive_path.read_bytes()) != ARCHIVE_SHA256:
        raise ValueError("Official Codex source archive differs")
    if candidate.get("source_commit") != codex.SOURCE_COMMIT or candidate.get("runtime_version") != "0.167.1":
        raise ValueError("Unsupported Codex preparation source")
    sections = codex.readonly_sections(binary)
    blocks, anchors, sources = [], {}, {}
    with tarfile.open(archive_path, "r:gz") as archive:
        members = {m.name.partition("/")[2]: m for m in archive.getmembers()}
        groups = candidate.get("groups")
        if not isinstance(groups, list) or not 1 <= len(groups) <= 128:
            raise ValueError("Invalid source asset candidate list")
        for group in groups:
            bid, paths = group["id"], group["sources"]
            if not isinstance(paths, list) or not 1 <= len(paths) <= 32:
                raise ValueError("Invalid source asset aliases")
            bodies, refs = [], []
            for path in paths:
                if not (path.startswith("codex-rs/prompts/templates/") and path.endswith((".md", ".xml"))
                        or path in {"codex-rs/protocol/src/prompts/base_instructions/default.md", "codex-rs/models-manager/prompt.md"}):
                    raise ValueError("Source file is outside the admitted instruction asset scope")
                member = members.get(path)
                if not member or not member.isfile() or not 1 <= member.size <= 250000:
                    raise ValueError("Pinned source asset is absent or unsupported")
                body = archive.extractfile(member).read(); body.decode("utf-8", errors="strict")
                bodies.append(body); refs.append({"path": path, "sha256": shared.digest(body)})
            if len(set(bodies)) != 1 or shared.digest(bodies[0]) != group["baseline_sha256"]:
                raise ValueError("Source asset aliases or candidate digest differ")
            body = bodies[0]; text = body.decode("utf-8"); matches = []
            for start, end in sections:
                cursor = start
                while True:
                    offset = binary.find(body, cursor, end)
                    if offset < 0: break
                    matches.append({"start": offset, "end": offset + len(body), "section": ".rodata"}); cursor = offset + 1
            if not matches or "matches" in group and matches != group["matches"]:
                raise ValueError("Source asset complete occurrence set differs")
            capability = "observed-only" if codex.TEMPLATE.search(text) else "patchable"
            blocks.append({"id": bid, "title": Path(paths[0]).name + " · " + paths[0].removeprefix("codex-rs/"),
                           "class_name": shared.classify(bid), "class_source": "Source filename heuristic using " + shared.CLASSIFICATION_SOURCE,
                           "source_layer": "embedded-rust-source-asset", "capability": capability,
                           "baseline_sha256": shared.digest(body), "baseline_utf8": text, "occurrence_count": len(matches), "required_placeholders": []})
            anchors[bid], sources[bid] = matches, refs
    inventory = {"schema_version": 1, "runtime_id": "native-codex", "runtime_version": "0.167.1", "image_digest": IMAGE_DIGEST,
                 "binary_sha256": BINARY_SHA256, "inventory_sha256": "0" * 64, "taxonomy_sha256": shared.taxonomy_sha256(),
                 "materializer_sha256": codex.materializer_sha256(), "blocks": blocks,
                 "_private": {"schema_version": 1, "source_kind": "rust-readonly-assets", "binary_bytes": len(binary),
                              "source_commit": codex.SOURCE_COMMIT, "source_tar_sha256": ARCHIVE_SHA256, "policy": codex.POLICY,
                              "anchors": anchors, "sources": sources}}
    inventory["inventory_sha256"] = shared.inventory_sha256(inventory)
    codex.validate_inventory(inventory, require_private=True)
    profile = {"schema_version": 1, **{k: inventory[k] for k in shared.PINS}, "default_action": "keep", "overrides": []}
    output, evidence = codex.materialize_native_binary(binary, inventory, profile)
    if output != binary or not evidence["readback_verified"]:
        raise ValueError("Pristine source readback failed")
    return inventory


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("binary", "source-archive", "output"): parser.add_argument("--" + name, type=Path, required=True)
    parser.add_argument("--candidate", type=Path, default=Path(__file__).with_name("codex-source-assets-0.167.1.json"))
    parser.add_argument("--candidate-sha256", default="c6865c05c50ec8fa366a3d0a43bf985afae89bceadd7314dabb31634ecc7dead")
    args = parser.parse_args()
    for path in (args.binary, args.source_archive, args.candidate):
        if path.is_symlink() or not path.is_file(): raise ValueError("Input must be a regular nonsymlink file")
    if args.binary.stat().st_size > codex.MAX_BINARY or args.candidate.stat().st_size > 4 * 1024 * 1024:
        raise ValueError("Preparation input exceeds its bound")
    raw = args.candidate.read_bytes()
    if shared.digest(raw) != args.candidate_sha256: raise ValueError("Candidate provenance changed")
    inventory = prepare(args.binary.read_bytes(), args.source_archive, json.loads(raw))
    fd = os.open(args.output, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, "wb") as stream: stream.write(shared.canonical_bytes(inventory))
    print(json.dumps({"inventory_sha256": inventory["inventory_sha256"], "materializer_sha256": inventory["materializer_sha256"],
                      "groups": len(inventory["blocks"]), "patchable": sum(b["capability"] == "patchable" for b in inventory["blocks"])}))

if __name__ == "__main__": main()
