"""Bounded Bun ELF source materialization for a pinned native runtime.

Only an existing ELF64 little-endian .bun section is supported. Its virtual
address, ELF load segments and executable length stay fixed. All v2 profiles,
including Keep, clear the same derived bytecode caches and execute source.
The original v1 executable is never modified in place.
"""
from __future__ import annotations

import struct

from . import native_prompts as N


MAX_BINARY_BYTES = 512 * 1024 * 1024
TRAILER = b"\n---- Bun! ----\n"
MODULE_SIZE = 52
NATIVE_FORMAT = "bun-elf64-source-v1"


def _slice(data, offset, size, label):
    N._require(type(offset) is int and type(size) is int and 0 <= offset <= len(data)
               and 0 <= size <= len(data) - offset, f"Invalid {label} bounds")
    return data[offset:offset + size]


def _unpack(fmt, data, offset, label):
    return struct.unpack(fmt, _slice(data, offset, struct.calcsize(fmt), label))


def _parse(binary):
    N._require(isinstance(binary, bytes) and 64 <= len(binary) <= MAX_BINARY_BYTES, "Invalid native ELF size")
    N._require(binary[:7] == b"\x7fELF\x02\x01\x01", "Only ELF64 little-endian binaries are supported")
    N._require(_unpack("<H", binary, 18, "ELF machine")[0] == 62, "Only the pinned x86_64 ELF layout is supported")
    shoff = _unpack("<Q", binary, 40, "ELF section table")[0]
    shsize, shnum, names_index = _unpack("<HHH", binary, 58, "ELF section metadata")
    N._require(shsize == 64 and 0 < shnum <= 4096 and names_index < shnum, "Unsupported ELF section table")
    table = _slice(binary, shoff, shsize * shnum, "ELF section table")
    sections = [struct.unpack_from("<IIQQQQIIQQ", table, i * shsize) for i in range(shnum)]
    names = _slice(binary, sections[names_index][4], sections[names_index][5], "ELF section names")
    selected = []
    for index, section in enumerate(sections):
        N._require(section[0] < len(names), "Invalid ELF section name")
        name = names[section[0]:].split(b"\0", 1)[0]
        if name == b".bun":
            selected.append((index, section))
    N._require(len(selected) == 1, "Expected one native .bun section")
    section_index, section = selected[0]
    section_offset, section_size = section[4], section[5]
    N._require(section_offset >= 64 and (section_offset + section_size <= shoff
               or section_offset >= shoff + shsize * shnum), "Bun section overlaps ELF metadata")
    section_bytes = _slice(binary, section_offset, section_size, "Bun section")
    N._require(len(section_bytes) >= 56, "Bun section is too small")
    blob_size = _unpack("<Q", section_bytes, 0, "Bun blob size")[0]
    N._require(blob_size + 8 == section_size, "Unsupported Bun section size header")
    blob = _slice(section_bytes, 8, blob_size, "Bun blob")
    N._require(blob.endswith(TRAILER), "Native Bun trailer mismatch")
    offsets_at = len(blob) - len(TRAILER) - 32
    byte_count, modules_at, modules_size, entrypoint, argv_at, argv_size, flags = _unpack(
        "<QIIIIII", blob, offsets_at, "Bun offsets")
    N._require(byte_count == offsets_at and modules_size > 0 and modules_size % MODULE_SIZE == 0,
               "Unsupported Bun module graph layout")
    count = modules_size // MODULE_SIZE
    N._require(count <= 10_000 and entrypoint < count, "Invalid Bun module count or entrypoint")
    module_table = _slice(blob, modules_at, modules_size, "Bun module table")
    N._require(modules_at + modules_size <= offsets_at, "Bun module table crosses offsets")
    modules, graph = [], []
    virtual_offset = 0
    for index in range(count):
        raw = module_table[index * MODULE_SIZE:(index + 1) * MODULE_SIZE]
        pointers = [_unpack("<II", raw, i * 8, "Bun string pointer") for i in range(6)]
        for offset, length in pointers:
            N._require(offset + length <= offsets_at, "Bun string pointer crosses metadata")
        name_raw = _slice(blob, *pointers[0], "Bun module name")
        try:
            name = name_raw.decode("utf-8")
        except UnicodeError as exc:
            raise N.NativePromptError("Invalid Bun module name encoding") from exc
        N._require(name.startswith("/$bunfs/") and "\x00" not in name and len(name_raw) <= 4096,
                   "Unsupported Bun module name")
        module_flags = raw[48:52]
        module = {"index": index, "name": name, "pointers": pointers, "flags": module_flags}
        if module_flags[1] == 1:
            N._require(module_flags == b"\x01\x01\x01\x00", "Unsupported executable Bun module flags")
            source = _slice(blob, *pointers[1], "Bun JavaScript source")
            try:
                source.decode("utf-8")
            except UnicodeError as exc:
                raise N.NativePromptError("Unsupported Bun JavaScript encoding") from exc
            N._require(source, "Executable Bun module has no source fallback")
            graph.append({"index": index, "name": name, "start": virtual_offset,
                          "end": virtual_offset + len(source), "source_sha256": N.digest(source)})
            virtual_offset += len(source)
        modules.append(module)
    N._require(any(item["index"] == entrypoint for item in graph), "Bun entrypoint has no supported source")
    N._require(len({m["name"] for m in modules}) == len(modules), "Duplicate Bun module names")
    argv = _slice(blob, argv_at, argv_size, "Bun execution arguments")
    return {"blob": blob, "section_offset": section_offset, "section_size": section_size,
            "section_size_offset": shoff + section_index * shsize + 32, "modules": modules,
            "graph": graph, "entrypoint": entrypoint, "argv": argv, "flags": flags}


def extract_native_source(binary):
    parsed = _parse(binary)
    return b"".join(_slice(parsed["blob"], *parsed["modules"][m["index"]]["pointers"][1], "source")
                    for m in parsed["graph"])


def native_source_layout(binary):
    parsed = _parse(binary)
    return {"format": NATIVE_FORMAT, "modules": parsed["graph"], "entrypoint": parsed["entrypoint"],
            "module_count": len(parsed["modules"]), "cache_policy": "clear-all-bytecode-for-every-v2-profile"}


def _modified_modules(source, inventory, profile, graph):
    actions = N.resolve_block_actions(profile, inventory)
    overrides = {o["block_id"]: o for o in profile["overrides"]}
    edits = []
    for block in inventory["blocks"]:
        action = actions[block["id"]]
        for anchor in inventory["_private"]["anchors"].get(block["id"], []):
            start, end = anchor["start"], anchor["end"]
            original = source[start:end]
            if action == "keep":
                replacement = original
            elif action == "disable":
                replacement = b'""' if anchor["kind"] == "string" else b"(" + original + b', "")'
            else:
                replacement = N._render_replacement(overrides[block["id"]]["replacement_utf8"], anchor, original)
            edits.append((start, end, replacement))
    edits.sort(key=lambda edit: edit[0])
    result, cursor = {}, 0
    for module in graph:
        start, end = module["start"], module["end"]
        chunks, position = [], start
        while cursor < len(edits) and edits[cursor][0] < end:
            left, right, replacement = edits[cursor]
            N._require(start <= left < right <= end, "A native prompt anchor crosses module boundaries")
            chunks.extend((source[position:left], replacement))
            position = right
            cursor += 1
        chunks.append(source[position:end])
        result[module["index"]] = b"".join(chunks)
    N._require(cursor == len(edits), "A native prompt anchor is outside the source graph")
    return result


def _rebuild_blob(parsed, modified):
    blob, chunks, size, pointers = parsed["blob"], [], 0, {}

    def put(data, key):
        nonlocal size
        if key not in pointers:
            N._require(size + len(data) + 1 < 2**32, "Bun graph exceeds pointer capacity")
            pointers[key] = (size, len(data))
            chunks.extend((data, b"\0"))
            size += len(data) + 1
        return pointers[key]

    rows = []
    for module in parsed["modules"]:
        row = []
        for index, pointer in enumerate(module["pointers"]):
            if index in (3, 5):
                # Bytecode and its origin path are derived caches, not native prompt source.
                row.append(put(b"", ("empty-cache",)))
            elif index == 1 and module["index"] in modified:
                row.append(put(modified[module["index"]], ("source", module["index"])))
            else:
                row.append(put(_slice(blob, *pointer, "Bun preserved component"), ("original", *pointer)))
        rows.append(b"".join(struct.pack("<II", *p) for p in row) + module["flags"])
    modules_at = size
    module_table = b"".join(rows)
    chunks.append(module_table)
    size += len(module_table)
    argv_at = size
    chunks.extend((parsed["argv"], b"\0"))
    size += len(parsed["argv"]) + 1
    chunks.append(struct.pack("<QIIIIII", size, modules_at, len(module_table), parsed["entrypoint"],
                              argv_at, len(parsed["argv"]), parsed["flags"]))
    chunks.append(TRAILER)
    return b"".join(chunks)


def materialize_native_binary(pristine, inventory, profile):
    N.validate_inventory(inventory, require_private=True)
    N._require(isinstance(pristine, bytes) and 64 <= len(pristine) <= MAX_BINARY_BYTES, "Invalid native ELF size")
    N._require(N.digest(pristine) == inventory["binary_sha256"], "Native executable digest mismatch")
    parsed = _parse(pristine)
    expected_layout = inventory["_private"].get("native_layout")
    N._require(expected_layout == native_source_layout(pristine), "Native module layout does not match the inventory")
    source = b"".join(_slice(parsed["blob"], *parsed["modules"][m["index"]]["pointers"][1], "source")
                      for m in parsed["graph"])
    normalized = N.canonical_profile(profile, inventory)
    changed_source, evidence = N.materialize_source(source, inventory, normalized)
    modified = _modified_modules(source, inventory, normalized, parsed["graph"])
    N._require(b"".join(modified[m["index"]] for m in parsed["graph"]) == changed_source,
               "Native module reassembly differs from verified source materialization")
    blob = _rebuild_blob(parsed, modified)
    section = struct.pack("<Q", len(blob)) + blob
    N._require(len(section) <= parsed["section_size"], "Materialized native source exceeds pinned Bun section capacity")
    result = bytearray(pristine)
    start, capacity = parsed["section_offset"], parsed["section_size"]
    result[start:start + capacity] = section + b"\0" * (capacity - len(section))
    struct.pack_into("<Q", result, parsed["section_size_offset"], len(section))
    result = bytes(result)
    checked = _parse(result)
    N._require(len(result) == len(pristine) and extract_native_source(result) == changed_source,
               "Repacked native executable source read-back mismatch")
    N._require(checked["entrypoint"] == parsed["entrypoint"] and checked["argv"] == parsed["argv"]
               and checked["flags"] == parsed["flags"], "Repacked native launch metadata changed")
    for before, after in zip(parsed["modules"], checked["modules"]):
        N._require(before["name"] == after["name"] and before["flags"] == after["flags"], "Native module identity changed")
        for index in (0, 2, 4):
            N._require(_slice(parsed["blob"], *before["pointers"][index], "original component") ==
                       _slice(checked["blob"], *after["pointers"][index], "materialized component"),
                       "A noncache native module component changed")
        if before["index"] not in modified:
            N._require(_slice(parsed["blob"], *before["pointers"][1], "original asset") ==
                       _slice(checked["blob"], *after["pointers"][1], "materialized asset"), "Native asset changed")
        N._require(after["pointers"][3][1] == after["pointers"][5][1] == 0, "Native derived cache was not cleared")
    evidence.update(mechanism=NATIVE_FORMAT, materialized_binary_sha256=N.digest(result),
                    materialized_binary_bytes=len(result), native_modules=len(parsed["modules"]),
                    javascript_modules=len(parsed["graph"]), bun_capacity_bytes=capacity,
                    materialized_bun_bytes=len(section), cache_policy="clear-all-bytecode-for-every-v2-profile",
                    cache_policy_caveat="Ordinary v1 retains its cache; v1 and v2 cold-start latency is not directly comparable.")
    evidence.pop("only_inventory_targets_changed", None)
    evidence.update(
        only_inventory_source_targets_changed=True,
        all_native_instructions_covered=False,
        source_scope="Catalog-named instruction literals with complete parsed JavaScript source anchors",
        non_prompt_binary_changes=["Cleared all derived bytecode and bytecode-origin paths",
                                  "Rebuilt Bun source/data pointer offsets without moving ELF load segments",
                                  "Updated Bun blob and section sizes; zero-filled unused original section capacity"],
    )
    return result, evidence
