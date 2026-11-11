"""Pinned Codex Rust prompt assets, edited as fixed read-only UTF-8 slices.

Disable blanks literal content with spaces; it does not shorten the native slice,
remove task instructions, or disable the runner's isolation. Only source-owned
whole assets are admitted. Dynamic templates remain observed-only.
"""
from __future__ import annotations

import hashlib
from pathlib import Path, PurePosixPath
import re
import struct

from . import native_prompts as shared

BINARY_TARGET = "/usr/local/lib/node_modules/@openai/codex/node_modules/@openai/codex-linux-x64/vendor/x86_64-unknown-linux-musl/bin/codex"
SOURCE_COMMIT = "0a94398fa60c4fac0e7659e4213a0a36e613dd46"
POLICY = "codex-source-owned-rodata-space-padding-v1"
MAX_BINARY = 512 * 1024 * 1024
PRIVATE_FIELDS = {"schema_version", "source_kind", "binary_bytes", "source_commit", "source_tar_sha256", "policy", "anchors", "sources"}
TEMPLATE = re.compile(r"\{\{|\{%|\$\{")


def _require(value, message):
    if not value:
        raise shared.NativePromptError(message)


def materializer_sha256():
    paths = (Path(__file__), Path(shared.__file__))
    return shared.digest(shared.canonical_bytes({p.name: shared.digest(p.read_bytes()) for p in paths}))


def readonly_sections(binary):
    """Bounded ELF64 x86_64 parser; relocation/debug/code sections never qualify."""
    _require(isinstance(binary, bytes) and 64 <= len(binary) <= MAX_BINARY, "Codex binary size is unsupported")
    _require(binary[:7] == b"\x7fELF\x02\x01\x01", "Codex requires little-endian ELF64")
    _, machine, version = struct.unpack_from("<HHI", binary, 16)
    _require(machine == 62 and version == 1, "Codex ELF architecture is unsupported")
    shoff = struct.unpack_from("<Q", binary, 40)[0]
    phoff = struct.unpack_from("<Q", binary, 32)[0]
    ehsize, phentsize, phnum, shentsize, shnum, shstrndx = struct.unpack_from("<HHHHHH", binary, 52)
    _require(phentsize == 56 and 0 < phnum <= 1024 and 64 <= phoff <= len(binary) - phnum * 56,
             "Codex ELF program table is invalid")
    loads = []
    for i in range(phnum):
        kind, flags, offset, _, _, filesz, _, _ = struct.unpack_from("<IIQQQQQQ", binary, phoff + i * 56)
        if kind == 1:
            _require(offset <= len(binary) and filesz <= len(binary) - offset, "Codex ELF load bounds are invalid")
            loads.append((offset, offset + filesz, flags))
    _require(ehsize == 64 and shentsize == 64 and 0 < shnum <= 4096 and shstrndx < shnum
             and 64 <= shoff <= len(binary) - shnum * 64, "Codex ELF section table is invalid")
    rows = [struct.unpack_from("<IIQQQQIIQQ", binary, shoff + i * 64) for i in range(shnum)]
    names = rows[shstrndx]
    _require(names[1] == 3 and names[4] <= len(binary) and names[5] <= len(binary) - names[4], "Codex ELF section names are invalid")
    table = binary[names[4]:names[4] + names[5]]
    sections = []
    for row in rows:
        name_offset, kind, flags, _, offset, size, *_ = row
        _require(name_offset < len(table), "Codex ELF name offset is invalid")
        end = table.find(b"\0", name_offset)
        _require(end >= 0, "Codex ELF section name is unterminated")
        name = table[name_offset:end]
        if name != b".rodata":
            continue
        _require(kind == 1 and flags & 2 and not flags & (1 | 4) and size > 0
                 and offset >= 64 and offset <= len(binary) and size <= len(binary) - offset,
                 "Codex prompt section must be allocated, read-only and nonexecutable")
        _require(any(start <= offset and offset + size <= end and flags == 4 for start, end, flags in loads)
                 and not any(start < offset + size and offset < end and flags & 3 for start, end, flags in loads),
                 "Codex prompt section must belong only to read-only nonexecutable loads")
        sections.append((offset, offset + size))
    _require(len(sections) == 1, "Codex requires one exact read-only prompt section")
    return sections


def validate_inventory(inventory, *, require_private=False):
    _require(isinstance(inventory, dict), "Codex inventory must be an object")
    public = {k: v for k, v in inventory.items() if k != "_private"}
    shared.validate_inventory(public)
    _require(inventory["runtime_id"] == "native-codex" and inventory["runtime_version"] == "0.167.1", "Unsupported native Codex inventory")
    _require(set(inventory) in (shared.INVENTORY_FIELDS, shared.INVENTORY_FIELDS | {"_private"}), "Invalid Codex inventory fields")
    private = inventory.get("_private")
    _require(not require_private or isinstance(private, dict), "Codex private anchors are required")
    if private is None:
        return inventory
    _require(isinstance(private, dict) and set(private) == PRIVATE_FIELDS and type(private["schema_version"]) is int and private["schema_version"] == 1
             and private["source_kind"] == "rust-readonly-assets" and private["policy"] == POLICY
             and private["source_commit"] == SOURCE_COMMIT and isinstance(private["source_tar_sha256"], str) and shared.HASH.fullmatch(private["source_tar_sha256"])
             and type(private["binary_bytes"]) is int and 64 <= private["binary_bytes"] <= MAX_BINARY,
             "Invalid Codex private provenance")
    blocks = {b["id"]: b for b in inventory["blocks"]}
    _require(isinstance(private["anchors"], dict) and isinstance(private["sources"], dict)
             and set(private["anchors"]) == set(blocks) == set(private["sources"]), "Codex asset membership differs")
    occupied = []
    for bid, block in blocks.items():
        body = block["baseline_utf8"].encode("utf-8")
        _require(body and not block["required_placeholders"], "Codex assets use no executable placeholders")
        dynamic = bool(TEMPLATE.search(block["baseline_utf8"]))
        _require(block["capability"] == ("observed-only" if dynamic else "patchable"), "Codex dynamic assets must remain observed-only")
        refs = private["sources"][bid]
        _require(isinstance(refs, list) and 1 <= len(refs) <= 32, "Invalid Codex source references")
        seen = set()
        for ref in refs:
            _require(isinstance(ref, dict) and set(ref) == {"path", "sha256"}, "Invalid Codex asset reference")
            path = ref["path"]
            _require(isinstance(path, str) and len(path) <= 400 and path.startswith("codex-rs/")
                     and not PurePosixPath(path).is_absolute() and ".." not in PurePosixPath(path).parts
                     and path.endswith((".md", ".xml")) and path not in seen and ref["sha256"] == block["baseline_sha256"], "Invalid Codex source path or digest")
            seen.add(path)
        anchors = private["anchors"][bid]
        _require(isinstance(anchors, list) and 0 < len(anchors) == block["occurrence_count"] <= 100,
                 "Invalid Codex occurrence count")
        for anchor in anchors:
            _require(isinstance(anchor, dict) and set(anchor) == {"start", "end", "section"}
                     and anchor["section"] == ".rodata" and type(anchor["start"]) is int and type(anchor["end"]) is int
                     and 64 <= anchor["start"] < anchor["end"] <= private["binary_bytes"]
                     and anchor["end"] - anchor["start"] == len(body), "Invalid Codex asset span")
            occupied.append((anchor["start"], anchor["end"]))
    occupied.sort()
    _require(all(a[1] <= b[0] for a, b in zip(occupied, occupied[1:])), "Codex asset spans overlap")
    _require(shared.inventory_sha256(inventory) == inventory["inventory_sha256"], "Codex inventory digest mismatch")
    return inventory


def public_inventory(inventory):
    validate_inventory(inventory, require_private=True)
    return {k: v for k, v in inventory.items() if k != "_private"}


def canonical_profile(profile, inventory):
    public = public_inventory(inventory) if "_private" in inventory else inventory
    validate_inventory(public)
    profile = shared.canonical_profile(profile, public)
    blocks = {b["id"]: b for b in public["blocks"]}
    for row in profile["overrides"]:
        if row["action"] == "replace":
            _require(len(row["replacement_utf8"].encode("utf-8")) <= len(blocks[row["block_id"]]["baseline_utf8"].encode("utf-8")),
                     "Codex replacement exceeds the native fragment UTF-8 byte capacity")
    return profile


def materialize_native_binary(pristine, inventory, profile):
    validate_inventory(inventory, require_private=True)
    profile = canonical_profile(profile, inventory)
    _require(inventory["materializer_sha256"] == materializer_sha256() and inventory["taxonomy_sha256"] == shared.taxonomy_sha256(), "Codex materializer or taxonomy changed")
    private = inventory["_private"]
    _require(isinstance(pristine, bytes) and len(pristine) == private["binary_bytes"]
             and shared.digest(pristine) == inventory["binary_sha256"], "Codex pristine binary differs")
    sections = readonly_sections(pristine)
    by_id = {b["id"]: b for b in inventory["blocks"]}
    overrides = {o["block_id"]: o for o in profile["overrides"]}
    actions = shared.resolve_block_actions(profile, public_inventory(inventory))
    patches, verified, changed = [], 0, []
    for bid, block in by_id.items():
        body = block["baseline_utf8"].encode("utf-8")
        anchors = private["anchors"][bid]
        expected = [(a["start"], a["end"]) for a in anchors]
        # Re-establish ALL complete asset matches in the admitted section.
        actual = []
        for start, end in sections:
            cursor = start
            while True:
                offset = pristine.find(body, cursor, end)
                if offset < 0:
                    break
                actual.append((offset, offset + len(body))); cursor = offset + 1
        _require(actual == expected, "Codex asset occurrences differ from pinned source ownership")
        for anchor in anchors:
            _require(any(start <= anchor["start"] < anchor["end"] <= end for start, end in sections)
                     and pristine[anchor["start"]:anchor["end"]] == body, "Codex anchor does not match read-only baseline")
            verified += 1
        action = actions[bid]
        if action == "keep":
            continue
        desired = b"" if action == "disable" else overrides[bid]["replacement_utf8"].encode("utf-8")
        replacement = desired + b" " * (len(body) - len(desired))
        for anchor in anchors:
            patches.append((anchor["start"], anchor["end"], replacement))
        changed.append({"block_id": bid, "action": action, "occurrences": len(anchors),
                        "baseline_sha256": block["baseline_sha256"], "replacement_sha256": shared.digest(desired),
                        "materialized_span_sha256": shared.digest(replacement), "content_bytes": len(desired),
                        "padding_bytes": len(body) - len(desired), "span_bytes": len(body)})
    result = bytearray(pristine)
    for start, end, replacement in patches:
        result[start:end] = replacement
    patched = bytes(result)
    _require(len(patched) == len(pristine) and readonly_sections(patched) == sections, "Codex ELF layout changed")
    for start, end, replacement in patches:
        _require(patched[start:end] == replacement, "Codex materialized readback differs")
    evidence = {"schema_version": 1, "runtime_id": inventory["runtime_id"], "runtime_version": inventory["runtime_version"],
                "inventory_sha256": inventory["inventory_sha256"], "native_prompt_profile_sha256": shared.profile_sha256(profile),
                "materializer_sha256": inventory["materializer_sha256"], "baseline_binary_sha256": inventory["binary_sha256"],
                "materialized_binary_sha256": shared.digest(patched), "materialized_binary_bytes": len(patched),
                "readback_verified": True, "verified_source_occurrences": verified, "changed_source_occurrences": len(patches),
                "changes": changed, "application_mechanism": POLICY, "non_prompt_binary_changes": [],
                "disable_semantics": "Literal content blanked with spaces; original UTF-8 slice capacity retained.",
                "all_native_instructions_covered": False, "conditional_coverage_proved": False}
    return patched, evidence
