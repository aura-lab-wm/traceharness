"""`traceharness native-prompts ...`: the native prompt workbench without a browser.

Offline and read-only: it reads only the files named on the command line (size-limited, plain
JSON through json.loads), writes only an explicit -o file (created exclusively unless --force,
mode 0600), never reads a home directory, keeps no state and opens no network connection.
Checks PREDICT runner review; the runner stays authoritative.

Exit codes: 0 success; 1 findings (an invalid profile, audit errors, or warnings with
--strict); 2 usage error or unreadable input.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import stat
import sys
import unicodedata

from . import native_prompt_tools as T
from . import native_prompts as _claude
from . import native_prompts_codex as _codex

INVENTORY_LIMIT = 128 * 1024 * 1024
FILE_LIMIT = 2 * 1024 * 1024
RECEIPT_NOTE = ("Valid by the runner's own canonical_profile. The admission receipt is not checked here; "
                "runner review is authoritative.")
BUDGET_CAPTION = ("Sums over inventory fragments. A single request contains only some of them; "
                  "measured input tokens come from a run.")
DISABLE_MEANING = {"native-claude-code": "Claude Code: the literal evaluates to empty text.",
                   "native-codex": "Codex CLI: the span is overwritten with spaces and keeps its length."}


class Usage(Exception):
    """Exit 2: a usage error or an input that cannot be read."""


class Findings(Exception):
    """Exit 1: the input was read and is invalid or has blocking findings."""


# --- input -------------------------------------------------------------------------------------------

def _reject_constant(_):
    raise ValueError("NaN and Infinity are not JSON")


def read_text(path, limit):
    try:
        fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0))
    except OSError as error:
        raise Usage(f"Cannot open {path}: {error.strerror or error}.") from None
    info = os.fstat(fd)
    if not stat.S_ISREG(info.st_mode):
        os.close(fd)
        raise Usage(f"{path} is not a regular file.")
    with os.fdopen(fd, "rb") as stream:
        if info.st_size > limit:
            raise Usage(f"{path} is larger than {limit} bytes.")
        raw = stream.read(limit + 1)
    if len(raw) > limit:
        raise Usage(f"{path} is larger than {limit} bytes.")
    try:
        return raw.decode("utf-8")
    except UnicodeDecodeError:
        raise Usage(f"{path} is not UTF-8 text.") from None


def read_json(path, limit=None):
    text = read_text(path, FILE_LIMIT if limit is None else limit)
    try:
        return json.loads(text, parse_constant=_reject_constant)
    except RecursionError:
        raise Usage(f"{path} is nested too deeply.") from None
    except ValueError as error:
        raise Usage(f"{path} is not valid JSON: {error}.") from None


def load_inventory(path):
    """A public inventory, the API response wrapper, or an operator's private inventory, of
    which only the public view is used (the private anchors are dropped unread)."""
    data = read_json(path, INVENTORY_LIMIT)
    if isinstance(data, dict) and "inventory" in data and "available" in data and "schema_version" not in data:
        if data.get("available") is not True or not isinstance(data.get("inventory"), dict):
            reason = data.get("reason") if isinstance(data.get("reason"), str) else ""
            raise Usage(f"{path} reports no available inventory. {reason}".strip())
        data = data["inventory"]
    if not isinstance(data, dict):
        raise Usage(f"{path} is not a native prompt inventory.")
    public = {key: value for key, value in data.items() if key != "_private"}
    try:
        (_codex if public.get("runtime_id") == "native-codex" else _claude).validate_inventory(public)
    except (_claude.NativePromptError, KeyError, TypeError) as error:
        raise Usage(f"{path} is not a valid native prompt inventory: {error}.") from None
    return public


def load_profile(path):
    """The profile inside a profile file, a bundle (its digest verified) or a version-2
    configuration export. A profile object is returned as written, so that validation reports
    the runner's own sentence."""
    data = read_json(path)
    if isinstance(data, dict) and data.get("kind") == T.BUNDLE_KIND:
        try:
            return T.parse_profile_document(read_text(path, FILE_LIMIT))["profile"]
        except T.ToolError as error:
            raise Findings(str(error)) from None
    if isinstance(data, dict) and "version" in data and "runtime_id" in data and "schema_version" not in data:
        if "native_prompt_profile" not in data:
            raise Findings("This configuration has no native prompt profile. Export one from a run that uses a profile.")
        return data["native_prompt_profile"]
    return data


def canonical(profile, inventory):
    try:
        return T.canonical_profile(profile, inventory)
    except T.ToolError as error:
        raise Findings(str(error)) from None


# --- output ------------------------------------------------------------------------------------------

def _escape_character(character):
    code = ord(character)
    return "\\x%02x" % code if code < 0x100 else "\\u%04x" % code if code < 0x10000 else "\\U%08x" % code


def safe(text, escape):
    """Escape control, format and separator characters (newline and tab kept) for a terminal."""
    if not escape:
        return text
    text = text.replace("\r\n", "\n")
    return "".join(character if character in "\n\t" or unicodedata.category(character) not in ("Cc", "Cf", "Cs", "Zl", "Zp")
                   else _escape_character(character) for character in text)


_JSON_UNSAFE = re.compile("[\u007f-\u009f\u00ad\u061c\u180e\u200b-\u200f\u2028\u2029\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff\ud800-\udfff]")


def safe_json(text, escape):
    """JSON text with the characters a terminal could act on written as \\u escapes (still valid JSON)."""
    return _JSON_UNSAFE.sub(lambda match: "\\u%04x" % ord(match.group(0)), text) if escape else text


class Output:
    def __init__(self, args):
        self.json = getattr(args, "json", False)
        self.escape = not getattr(args, "raw", False) and sys.stdout.isatty()
        self.escape_notes = not getattr(args, "raw", False) and sys.stderr.isatty()

    def text(self, value=""):
        sys.stdout.write(safe(value, self.escape) + "\n")

    def note(self, value):
        """A report line that must not mix with a file printed on stdout: stderr, escaped for a terminal."""
        sys.stderr.write(safe(value, self.escape_notes) + "\n")

    def data(self, value):
        sys.stdout.write(safe_json(json.dumps(value, ensure_ascii=False, indent=2), self.escape) + "\n")


def write_output(path, text, force):
    """Create `path` exclusively (or replace it with --force, never through a symlink)."""
    flags = os.O_WRONLY | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0) | (os.O_TRUNC if force else os.O_EXCL)
    try:
        fd = os.open(path, flags, 0o600)
    except FileExistsError:
        raise Usage(f"{path} already exists. Choose another file or pass --force to replace it.") from None
    except OSError as error:
        raise Usage(f"Cannot write {path}: {error.strerror or error}.") from None
    with os.fdopen(fd, "w", encoding="utf-8", newline="") as stream:
        stream.write(text)


def emit_file(args, out, text, summary):
    """Write `text` to -o, or print it when no -o was given."""
    if args.output:
        write_output(args.output, text, args.force)
        if out.json:
            out.data({**summary, "written": args.output})
        else:
            out.text(f"Wrote {args.output}.")
    else:
        sys.stdout.write(safe_json(text, out.escape))


def estimate_label(value):
    return f"≈ {value} tokens (estimate, {T.TOKEN_ESTIMATOR})"


# --- inventory commands ------------------------------------------------------------------------------

def cmd_inventory_summary(args, out):
    inventory = load_inventory(args.inventory)
    capabilities, classes, total_bytes, total_tokens = {}, {}, 0, 0
    for block in inventory["blocks"]:
        capabilities[block["capability"]] = capabilities.get(block["capability"], 0) + 1
        entry = classes.setdefault(block["class_name"], {"class_name": block["class_name"], "blocks": 0, "patchable": 0, "observed_only": 0,
                                                         "unavailable": 0, "bytes": 0, "est_tokens": 0})
        entry["blocks"] += 1
        entry[{"patchable": "patchable", "observed-only": "observed_only", "unavailable": "unavailable"}[block["capability"]]] += 1
        size, tokens = T.utf8_bytes(block["baseline_utf8"]), T.estimate_tokens(block["baseline_utf8"])
        entry["bytes"] += size
        entry["est_tokens"] += tokens
        total_bytes += size
        total_tokens += tokens
    result = {"pins": {key: inventory[key] for key in T.PROFILE_PINS}, "blocks": len(inventory["blocks"]), "capabilities": capabilities,
              "bytes": total_bytes, "est_tokens": total_tokens, "estimator": T.TOKEN_ESTIMATOR, "classes": list(classes.values())}
    if out.json:
        return out.data(result)
    for key in T.PROFILE_PINS:
        out.text(f"{key}: {inventory[key]}")
    out.text(f"blocks: {result['blocks']} ({', '.join(f'{count} {name}' for name, count in capabilities.items())})")
    out.text(f"baseline text: {total_bytes} bytes (exact), {estimate_label(total_tokens)}")
    out.text(BUDGET_CAPTION)
    out.text()
    out.text(f"{'class':<26} {'blocks':>6} {'patch':>6} {'obs':>5} {'unav':>5} {'bytes':>9} {'≈tokens':>8}")
    for entry in classes.values():
        out.text(f"{entry['class_name'][:26]:<26} {entry['blocks']:>6} {entry['patchable']:>6} {entry['observed_only']:>5} "
                 f"{entry['unavailable']:>5} {entry['bytes']:>9} {entry['est_tokens']:>8}")


def _search_options(args, inventory):
    if args.limit < 0:
        raise Usage("--limit must be 0 (no limit) or more.")
    options = {"classes": args.class_name or [], "capabilities": args.capability or [], "sort": args.sort}
    if getattr(args, "profile", None):
        options["profile"] = canonical(load_profile(args.profile), inventory)
    return options


def _print_rows(out, result, limit, snippets):
    rows = result["rows"][:limit] if limit else result["rows"]
    if out.json:
        return out.data({"total": result["total"], "matched": len(result["rows"]), "shown": len(rows), "estimator": T.TOKEN_ESTIMATOR,
                         "query_limited": result["query_limited"],
                         "rows": [{"id": row["block"]["id"], "index": row["index"], "capability": row["block"]["capability"],
                                   "class_name": row["block"]["class_name"], "title": row["block"]["title"], "action": row["action"],
                                   "bytes": row["bytes"], "est_tokens": row["est_tokens"], "match_count": row["match_count"],
                                   **({"snippet": row["snippet"]} if snippets else {})} for row in rows]})
    out.text(f"{len(result['rows'])} of {result['total']} blocks match; showing {len(rows)}. Bytes are exact; ≈ tokens are estimates "
             f"({T.TOKEN_ESTIMATOR}).")
    if result["query_limited"]:
        out.text(f"Only the first {T.QUERY_LIMITS['terms']} terms and {T.QUERY_LIMITS['chars']:,} characters of the query were used.")
    for row in rows:
        block = row["block"]
        state = f" [{row['action']}]" if row["action"] else ""
        out.text(f"{block['id']}\t{block['capability']}\t{row['bytes']} B\t≈{row['est_tokens']}\t{block['class_name']}\t{block['title']}{state}")
        if snippets and row["snippet"]:
            snippet = row["snippet"]
            line = (snippet["before"] + "[" + snippet["match"] + "]" + snippet["after"]).replace("\n", " ↵ ")
            out.text(f"    {snippet['field']}: …{line}…")


def cmd_inventory_list(args, out):
    inventory = load_inventory(args.inventory)
    try:
        result = T.search_inventory(inventory, _search_options(args, inventory))
    except T.ToolError as error:
        raise Usage(str(error)) from None
    _print_rows(out, result, args.limit, False)


def cmd_inventory_search(args, out):
    inventory = load_inventory(args.inventory)
    options = _search_options(args, inventory)
    try:
        result = (T.search_inventory_regex(inventory, args.query, options) if args.regex
                  else T.search_inventory(inventory, {**options, "query": args.query}))
    except T.ToolError as error:
        raise Usage(str(error)) from None
    _print_rows(out, result, args.limit, True)


def cmd_inventory_show(args, out):
    inventory = load_inventory(args.inventory)
    block = next((entry for entry in inventory["blocks"] if entry["id"] == args.block_id), None)
    if block is None:
        raise Usage(f"No block {args.block_id!r} exists in this inventory.")
    metrics = T.text_metrics(block["baseline_utf8"])
    if out.json:
        return out.data({"block": block, "metrics": metrics, "estimator": T.TOKEN_ESTIMATOR})
    for key in ("id", "title", "class_name", "class_source", "source_layer", "capability", "occurrence_count", "baseline_sha256"):
        out.text(f"{key}: {block[key]}")
    out.text(f"required_placeholders: {', '.join(block['required_placeholders']) or 'none'}")
    out.text(f"size: {metrics['bytes']} bytes, {metrics['code_points']} characters, {metrics['lines']} lines (exact); "
             f"{estimate_label(metrics['est_tokens'])}")
    out.text("--- baseline text ---")
    out.text(block["baseline_utf8"])


# --- profile commands --------------------------------------------------------------------------------

def _profile_file(profile):
    return T.serialize_profile_file(profile)


def cmd_profile_new(args, out):
    inventory = load_inventory(args.inventory)
    profile = canonical(T.baseline_profile(inventory, args.default), inventory)
    emit_file(args, out, _profile_file(profile), {"profile_sha256": T.profile_sha256(profile)})


def cmd_profile_validate(args, out):
    inventory = load_inventory(args.inventory)
    try:
        profile = T.canonical_profile(load_profile(args.profile), inventory)
    except (T.ToolError, Findings) as error:
        if out.json:
            out.data({"valid": False, "issue": str(error), "note": RECEIPT_NOTE})
        else:
            out.text(f"invalid: {error}")
        return 1
    digest = T.profile_sha256(profile)
    if out.json:
        return out.data({"valid": True, "profile_sha256": digest, "note": RECEIPT_NOTE})
    out.text(f"valid: native_prompt_profile_sha256 {digest}")
    out.text(RECEIPT_NOTE)


def _prompt(args):
    return read_text(args.prompt_file, FILE_LIMIT) if getattr(args, "prompt_file", None) else ""


def cmd_profile_audit(args, out):
    inventory = load_inventory(args.inventory)
    result = T.audit_profile(load_profile(args.profile), inventory, {"prompt": _prompt(args)})
    failing = result["counts"]["error"] > 0 or (args.strict and result["counts"]["warning"] > 0)
    if out.json:
        out.data({**result, "strict": args.strict, "note": "Predictions of runner review; the runner is authoritative."})
    else:
        counts = result["counts"]
        out.text(f"{counts['error']} errors, {counts['warning']} warnings, {counts['info']} notes. "
                 "Predictions of runner review; the runner is authoritative.")
        for finding in result["findings"]:
            where = finding["block_id"] or finding["scope"]
            mark = " (mirrors a deployed check)" if finding["contract"] else ""
            out.text(f"{finding['severity']:<7} {finding['rule']:<28} {where}: {finding['message']}{mark}")
    return 1 if failing else 0


def cmd_profile_stats(args, out):
    inventory = load_inventory(args.inventory)
    profile = canonical(load_profile(args.profile), inventory)
    budget = T.profile_budget(profile, inventory, {"prompt": _prompt(args)})
    if out.json:
        return out.data({**budget, "caption": BUDGET_CAPTION})
    exact, estimate = budget["exact"], budget["estimate"]
    out.text(f"overrides: {exact['overrides']} (keep {exact['keep']}, replace {exact['replace']}, disable {exact['disable']} patchable blocks)")
    out.text(f"patchable text: baseline {exact['baseline_bytes']} bytes, effective {exact['effective_bytes']} bytes, "
             f"delta {exact['delta_bytes']:+d} bytes (exact)")
    out.text(f"tokens: baseline ≈ {estimate['baseline_tokens']}, effective ≈ {estimate['effective_tokens']}, delta ≈ "
             f"{estimate['delta_tokens']:+d} (estimate, {budget['estimator']})")
    if estimate["not_estimated_blocks"]:
        out.text(f"not estimated (space padding): {estimate['not_estimated_blocks']} Codex blocks keep their span length")
    out.text(BUDGET_CAPTION)
    names = {"overrides": "overrides", "profile_bytes": "canonical profile bytes", "manifest_bytes": "run manifest bytes",
             "paired_plan_bytes": "two-arm frozen plan bytes"}
    for meter in budget["limits"]:
        percent = 100 * meter["used"] / meter["max"]
        out.text(f"{names[meter['id']]:<26} {meter['used']:>9} of {meter['max']:<9} {percent:5.1f} %  {meter['state']:<4} ({meter['kind']})")


def cmd_profile_digest(args, out):
    inventory = load_inventory(args.inventory)
    profile = canonical(load_profile(args.profile), inventory)
    digest = T.profile_sha256(profile)
    if out.json:
        return out.data({"profile_sha256": digest, "file_name": T.profile_file_name(profile, digest)})
    out.text(digest)


def cmd_profile_canonicalize(args, out):
    inventory = load_inventory(args.inventory)
    profile = canonical(load_profile(args.profile), inventory)
    emit_file(args, out, _profile_file(profile), {"profile_sha256": T.profile_sha256(profile)})


def inline_diff(diff):
    pieces = []
    for op in diff["ops"]:
        pieces.append(op["text"] if op["op"] == "equal" else ("[-" + op["text"] + "-]") if op["op"] == "delete" else ("{+" + op["text"] + "+}"))
    return "".join(pieces)


def cmd_profile_diff(args, out):
    inventory = load_inventory(args.inventory)
    left = canonical(load_profile(args.against), inventory) if args.against else T.baseline_profile(inventory)
    right = canonical(load_profile(args.profile), inventory)
    try:
        summary = T.diff_profiles(left, right, inventory)
    except T.ToolError as error:
        raise Findings(str(error)) from None
    blocks = {block["id"]: block for block in inventory["blocks"]}
    rows = [row for row in summary["rows"] if not args.block or row["block_id"] == args.block]
    if args.block and args.block not in blocks:
        raise Usage(f"No block {args.block!r} exists in this inventory.")
    diffs = {}
    for row in rows:
        before = T.effective_text(blocks[row["block_id"]], left)["text"]
        after = T.effective_text(blocks[row["block_id"]], right)["text"]
        diffs[row["block_id"]] = T.diff_text(before, after)
    if out.json:
        return out.data({**summary, "rows": rows, "diffs": diffs, "against": args.against or "baseline"})
    out.text(f"{summary['changed']} blocks differ from {args.against or 'the baseline'}. Patchable text: {summary['a_bytes']} -> "
             f"{summary['b_bytes']} bytes (exact), ≈ {summary['a_est_tokens']} -> ≈ {summary['b_est_tokens']} tokens (estimate).")
    for row in rows:
        out.text()
        out.text(f"=== {row['block_id']} ({row['title']}): {row['a']['action']} -> {row['b']['action']}")
        if row["b"]["action"] == "disable" or row["a"]["action"] == "disable":
            side = "after" if row["b"]["action"] == "disable" else "before"
            out.text(f"Disabled {side}: the baseline text is withheld. {DISABLE_MEANING[inventory['runtime_id']]}")
            if row["a"]["action"] == "disable" and row["b"]["action"] == "disable":
                continue
        diff = diffs[row["block_id"]]
        if diff["granularity"] != "word":
            out.text(f"(granularity: {diff['granularity']}; the input was too large for a word-level diff)")
        out.text(inline_diff(diff))


def _block_ids_of_class(inventory, name):
    ids = [block["id"] for block in inventory["blocks"] if block["capability"] == "patchable" and block["class_name"] == name]
    if not ids:
        raise Usage(f"No patchable block has the class {name!r}.")
    return ids


def cmd_profile_edit(args, out):
    inventory = load_inventory(args.inventory)
    profile = canonical(load_profile(args.profile), inventory)
    steps = []
    if args.restore_all:
        steps.append(("restore", [block["id"] for block in inventory["blocks"] if block["capability"] == "patchable"], None))
    if args.keep_only:
        steps.append(("keep-only", args.keep_only, None))
    for name in args.disable_class or []:
        steps.append(("disable", _block_ids_of_class(inventory, name), None))
    if args.disable:
        steps.append(("disable", args.disable, None))
    if args.keep:
        steps.append(("keep", args.keep, None))
    if args.replace or args.text_file:
        if not (args.replace and args.text_file):
            raise Usage("--replace needs --text-file, and --text-file needs --replace.")
        steps.append(("replace", [args.replace], read_text(args.text_file, FILE_LIMIT)))
    if not steps:
        raise Usage("Name at least one edit: --keep, --disable, --disable-class, --keep-only, --restore-all or --replace.")
    for action, ids, text in steps:
        try:
            profile = T.change_prompt_actions(profile, inventory, list(ids), action, text)
        except T.ToolError as error:
            raise Findings(f"{action}: {error}") from None
    emit_file(args, out, _profile_file(profile), {"profile_sha256": T.profile_sha256(profile), "counts": T.profile_counts(profile, inventory)})


def cmd_profile_macro(args, out):
    inventory = load_inventory(args.inventory)
    profile = canonical(load_profile(args.profile), inventory)
    if args.all:
        ids = [block["id"] for block in inventory["blocks"] if block["capability"] == "patchable"]
    elif args.class_name:
        ids = _block_ids_of_class(inventory, args.class_name)
    else:
        ids = args.block
    try:
        generated = T.generate_macro_edits(inventory, profile, ids, args.macro)
    except T.ToolError as error:
        raise Usage(str(error)) from None
    edits = T.fit_macro_edits(inventory, profile, generated["edits"]) if args.fit else generated["edits"]
    preview = {"macros": args.macro, "edits": [{key: value for key, value in edit.items() if key != "replacement_utf8"} for edit in edits],
               "skipped": generated["skipped"], "projected": generated["projected"], "fitted": bool(args.fit),
               "left_out_by_fit": len(generated["edits"]) - len(edits), "estimator": T.TOKEN_ESTIMATOR,
               "note": "Macro output is a candidate for a paired experiment, not evidence of better performance."}
    if not args.fit and not generated["projected"]["fits"]:
        if out.json:
            out.data({**preview, "applied": False})
        else:
            out.text(f"The projected profile ({generated['projected']['profile_bytes']} bytes, {generated['projected']['overrides']} overrides) "
                     "exceeds a contract limit. Nothing was written; pass --fit to keep the largest savings that fit.")
        return 1
    if args.dry_run or not edits:
        if out.json:
            return out.data({**preview, "applied": False})
        fitted = f", {preview['left_out_by_fit']} left out to fit" if args.fit else ""
        out.text(f"{len(edits)} edits, {len(generated['skipped'])} skipped{fitted}. Bytes exact; ≈ tokens estimated.")
        for edit in edits:
            out.text(f"  {edit['block_id']}: {edit['before_bytes']} -> {edit['after_bytes']} bytes, ≈ {edit['before_tokens']} -> "
                     f"≈ {edit['after_tokens']} tokens")
        for row in generated["skipped"]:
            out.text(f"  skipped {row['block_id']}: {row['reason']}")
        if not args.dry_run:
            out.text("No edit to apply; nothing was written.")
        return 0
    try:
        result = T.apply_replace_edits(profile, inventory, edits)
    except T.ToolError as error:
        raise Findings(str(error)) from None
    emit_file(args, out, _profile_file(result), {**preview, "applied": True, "profile_sha256": T.profile_sha256(result)})


def cmd_profile_rebase(args, out):
    inventory = load_inventory(args.inventory)
    try:
        result = T.rebase_profile(load_profile(args.profile), inventory)
        profile = T.canonical_profile(result["profile"], inventory)
    except T.ToolError as error:
        raise Findings(str(error)) from None
    summary = {"kept": result["kept"], "dropped": result["dropped"], "default_applies_to": result["default_applies_to"],
               "profile_sha256": T.profile_sha256(profile),
               "note": "A rebased profile is a new profile with a new digest; it needs runner review like any other."}
    if not args.output:
        if out.json:
            return out.data({**summary, "profile": profile})
        sys.stdout.write(_profile_file(profile))
        return 0
    write_output(args.output, _profile_file(profile), args.force)
    if out.json:
        return out.data({**summary, "written": args.output})
    out.text(f"Kept {len(result['kept'])} overrides, dropped {len(result['dropped'])}. Wrote {args.output}.")
    for row in result["dropped"]:
        out.text(f"  dropped {row['block_id']} ({row['action']}): {row['reason']}")
    if result["default_applies_to"]:
        out.text(f"The default action (disable) also disables {len(result['default_applies_to'])} patchable fragments that no override names, "
                 "including any fragment that is new in this inventory.")


def cmd_profile_convert(args, out):
    inventory = load_inventory(args.inventory)
    if args.source_format:
        try:
            parsed = T.parse_profile_document(read_text(args.source, FILE_LIMIT))
        except T.ToolError as error:
            raise Findings(str(error)) from None
        if parsed["kind"] != args.source_format:
            raise Usage(f"{args.source} is a {parsed['kind']} file, not {args.source_format}.")
        report = None
        if parsed["kind"] == "agent-patcher-blocks":
            converted = T.profile_from_agent_patcher_blocks(parsed["blocks"], inventory)
            profile, report = converted["profile"], converted["report"]
        else:
            profile = parsed["profile"]
        profile = canonical(profile, inventory)
        summary = {"from": parsed["kind"], "profile_sha256": T.profile_sha256(profile), **({"report": report} if report else {})}
        if report and not out.json:
            # stderr, like the skipped rows of `--to agent-patcher-blocks`: without -o the profile
            # file itself goes to stdout, and `convert ... > profile.json` must stay a readable file.
            out.note(f"{report['total']} blocks: keep {report['keep']}, disable {report['disable']}, replace {report['replace']}, "
                     f"skipped {len(report['skipped'])}.")
            for row in report["skipped"]:
                out.note(f"  skipped {row['id']}: {row['reason']}")
        return emit_file(args, out, _profile_file(profile), summary)
    profile = canonical(load_profile(args.source), inventory)
    if args.target_format == "bundle":
        if not args.name:
            raise Usage("A bundle needs --name.")
        try:
            bundle = T.make_bundle({"profile": profile, "name": args.name, "note": args.note or "", "tool": "traceharness-cli"})
        except T.ToolError as error:
            raise Findings(str(error)) from None
        return emit_file(args, out, T.serialize_profile_file(bundle), {"to": "bundle", "profile_sha256": bundle["profile_sha256"]})
    dump = T.agent_patcher_blocks_from_profile(profile, inventory)
    if dump["skipped"] and not out.json:
        for row in dump["skipped"]:
            out.note(f"skipped {row['id']}: {row['reason']}")
    return emit_file(args, out, json.dumps(dump["blocks"], ensure_ascii=False, indent=2) + "\n",
                     {"to": "agent-patcher-blocks", "blocks": len(dump["blocks"]), "skipped": dump["skipped"],
                      "note": "The dump contains baseline text from the inventory; keep it as private as the inventory."})


# --- experiment command ------------------------------------------------------------------------------

def _experiment(data):
    if isinstance(data, dict) and isinstance(data.get("experiment"), dict) and "plan" not in data:
        data = data["experiment"]
    if (not isinstance(data, dict) or not isinstance(data.get("plan"), dict) or not isinstance(data.get("trials"), list)
            or not isinstance(data["plan"].get("arms"), list) or not isinstance(data["plan"].get("repeats"), int)
            or not all(isinstance(arm, dict) and isinstance(arm.get("id"), str) for arm in data["plan"]["arms"])
            or not all(isinstance(trial, dict) for trial in data["trials"])):
        raise Usage("This file is not a paired experiment export (it needs plan.arms, plan.repeats and trials).")
    return data


def outcomes_text(experiment, outcomes):
    lines = [(f"Paired experiment {experiment.get('id', '')}: {experiment['plan'].get('name', '')} "
              f"({experiment.get('status', 'status not reported')})"),
             f"{experiment['plan']['repeats']} repetitions of {len(experiment['plan']['arms'])} arms, {len(experiment['trials'])} scheduled trials.", ""]
    for arm in outcomes["arms"]:
        role = "reference" if arm["reference"] else "variant"
        rate = "no graded trial" if arm["pass_rate_of_graded"] is None else f"{arm['passed']} of {arm['graded']} graded"
        interval = arm["pass_interval_95"]
        lines.append(f"{arm['label']} ({role}, {'baseline' if arm['profile']['is_baseline'] else 'edited'}): planned {arm['planned']}, "
                     f"passed {arm['passed']}, failed {arm['failed']}, ungraded {arm['ungraded']}, refused {arm['refused']}, "
                     f"cancelled {arm['cancelled']}, needs attention {arm['needs_attention']}, not finished {arm['unfinished']}; "
                     f"pass {rate}, {arm['passed']} of {arm['planned']} planned"
                     + ("" if interval is None else f"; Wilson 95 % {T.fixed_decimals(interval[0], 3)} to {T.fixed_decimals(interval[1], 3)}"))
    for row in outcomes["comparisons"]:
        probability = ("no discordant pair" if row["mcnemar_exact_p"] is None
                       else f"exact two-sided McNemar p {T.fixed_decimals(row['mcnemar_exact_p'], 4)}; smallest reachable "
                            f"{T.fixed_decimals(row['smallest_reachable_p'], 4)}")
        lines.append(f"{row['label']} against the reference: both pass {row['both_pass']}, both fail {row['both_fail']}, reference only "
                     f"{row['reference_only_pass']}, variant only {row['variant_only_pass']}, incomplete {row['incomplete_pairs']} "
                     f"({row['source']} counts{'' if row['agrees_with_runner'] or row['source'] == 'client' else ', a recount differs'}); "
                     f"{probability}")
    lines += ["", *("- " + caveat for caveat in outcomes["caveats"])]
    return "\n".join(lines) + "\n"


def cmd_experiment_summarize(args, out):
    experiment = _experiment(read_json(args.export))
    form = "json" if out.json else args.format
    try:
        if form == "json":
            text = json.dumps(T.experiment_outcomes(experiment), ensure_ascii=False, indent=2) + "\n"
        elif form == "csv":
            text = T.experiment_csv(experiment)
        elif form == "markdown":
            text = T.experiment_markdown(experiment)
        else:
            text = outcomes_text(experiment, T.experiment_outcomes(experiment))
    except (KeyError, TypeError, AttributeError, IndexError) as error:
        raise Usage(f"This experiment export is incomplete ({type(error).__name__}).") from None
    if args.output:
        write_output(args.output, text, args.force)
        return out.data({"written": args.output, "format": form}) if out.json else out.text(f"Wrote {args.output}.")
    sys.stdout.write(safe(text, out.escape))


# --- parser ------------------------------------------------------------------------------------------

class _Parser(argparse.ArgumentParser):
    def error(self, message):
        raise Usage(f"{self.prog}: {message}")


SORTS = ("inventory", "bytes-desc", "bytes-asc", "tokens-desc", "title", "state", "relevance")


def build_parser():
    parser = _Parser(prog="traceharness native-prompts",
                     description="Inspect native prompt inventories and author profiles offline. Reads only the files you name; "
                                 "writes only an explicit -o file. Checks predict runner review; the runner is authoritative.",
                     epilog="Exit codes: 0 success, 1 findings (invalid profile, audit errors, or warnings with --strict), "
                            "2 usage error or unreadable input.")
    groups = parser.add_subparsers(dest="group", metavar="{inventory,profile,experiment}", parser_class=_Parser)
    groups.required = True

    def leaf(subparsers, name, handler, help_text, inventory=True, profile=False, output=False):
        command = subparsers.add_parser(name, help=help_text, description=help_text)
        if inventory:
            command.add_argument("inventory", metavar="INVENTORY", help="inventory JSON: public view, API response or private inventory")
        if profile:
            command.add_argument("profile", metavar="PROFILE", help="profile, bundle or version-2 configuration JSON")
        command.add_argument("--json", action="store_true", help="print JSON")
        command.add_argument("--raw", action="store_true", help="do not escape control characters on a terminal")
        if output:
            command.add_argument("-o", "--output", metavar="FILE", help="write the result to FILE (created exclusively)")
            command.add_argument("--force", action="store_true", help="replace FILE if it exists")
        command.set_defaults(handler=handler)
        return command

    inventory = groups.add_parser("inventory", help="read an inventory").add_subparsers(dest="command", metavar="COMMAND", parser_class=_Parser)
    inventory.required = True
    leaf(inventory, "summary", cmd_inventory_summary, "pins, block counts by capability and class, bytes and ≈ tokens")
    for name, handler, text in (("list", cmd_inventory_list, "one line per block"),
                                ("search", cmd_inventory_search, "full-text search with snippets")):
        command = leaf(inventory, name, handler, text)
        if name == "search":
            command.add_argument("query", metavar="QUERY", help='terms ANDed; "phrase"; id: title: class: body: new:; -term negates')
            command.add_argument("--regex", action="store_true", help="treat QUERY as a Python regular expression (offline only)")
        command.add_argument("--class", dest="class_name", action="append", metavar="CLASS", help="only this class (repeatable)")
        command.add_argument("--capability", action="append", choices=("patchable", "observed-only", "unavailable"), help="repeatable")
        command.add_argument("--sort", choices=SORTS, default="relevance" if name == "search" else "inventory")
        command.add_argument("--limit", type=int, default=0, metavar="N", help="show at most N rows")
        command.add_argument("--profile", metavar="PROFILE", help="show each block's action under this profile and search its replacements")
    show = leaf(inventory, "show", cmd_inventory_show, "metadata and baseline text of one block")
    show.add_argument("block_id", metavar="BLOCK_ID")

    profile = groups.add_parser("profile", help="author and check a profile").add_subparsers(dest="command", metavar="COMMAND", parser_class=_Parser)
    profile.required = True
    new = leaf(profile, "new", cmd_profile_new, "a baseline (keep) or none-included (disable) profile", output=True)
    new.add_argument("--default", choices=("keep", "disable"), default="keep")
    leaf(profile, "validate", cmd_profile_validate, "the runner's canonical_profile verdict", profile=True)
    audit = leaf(profile, "audit", cmd_profile_audit, "audit findings (predictions of runner review)", profile=True)
    audit.add_argument("--strict", action="store_true", help="exit 1 on warnings too")
    audit.add_argument("--prompt-file", metavar="FILE", help="the run's additional instructions, checked and counted in the estimates")
    stats = leaf(profile, "stats", cmd_profile_stats, "budget: exact bytes, estimated tokens, contract limits", profile=True)
    stats.add_argument("--prompt-file", metavar="FILE")
    leaf(profile, "digest", cmd_profile_digest, "canonical SHA-256 (native_prompt_profile_sha256)", profile=True)
    leaf(profile, "canonicalize", cmd_profile_canonicalize, "the canonical profile file", profile=True, output=True)
    diff = leaf(profile, "diff", cmd_profile_diff, "word-level diff against the baseline or another profile", profile=True)
    diff.add_argument("--against", metavar="OTHER", help="compare with this profile instead of the baseline")
    diff.add_argument("--block", metavar="ID", help="only this block")
    edit = leaf(profile, "edit", cmd_profile_edit, "apply keep, disable, keep-only, restore or replace", profile=True, output=True)
    edit.add_argument("--keep", nargs="+", metavar="ID")
    edit.add_argument("--disable", nargs="+", metavar="ID")
    edit.add_argument("--disable-class", action="append", metavar="CLASS")
    edit.add_argument("--keep-only", nargs="+", metavar="ID")
    edit.add_argument("--restore-all", action="store_true")
    edit.add_argument("--replace", metavar="ID")
    edit.add_argument("--text-file", metavar="FILE", help="UTF-8 replacement text for --replace")
    macro = leaf(profile, "macro", cmd_profile_macro, "generate replacements with macros", profile=True, output=True)
    macro.add_argument("--macro", nargs="+", required=True, choices=[entry["id"] for entry in T.MACROS])
    scope = macro.add_mutually_exclusive_group(required=True)
    scope.add_argument("--block", nargs="+", metavar="ID")
    scope.add_argument("--class", dest="class_name", metavar="CLASS")
    scope.add_argument("--all", action="store_true")
    macro.add_argument("--fit", action="store_true", help="keep the largest savings that fit the limits")
    macro.add_argument("--dry-run", action="store_true", help="show the preview and write nothing")
    leaf(profile, "rebase", cmd_profile_rebase, "carry a profile to NEW_INVENTORY, exact matches only", profile=True, output=True)
    convert = leaf(profile, "convert", cmd_profile_convert, "bundle, configuration and agent-patcher block dump conversion", output=True)
    convert.add_argument("source", metavar="SOURCE")
    direction = convert.add_mutually_exclusive_group(required=True)
    direction.add_argument("--from", dest="source_format", choices=("bundle", "configuration", "agent-patcher-blocks"))
    direction.add_argument("--to", dest="target_format", choices=("bundle", "agent-patcher-blocks"))
    convert.add_argument("--name", help="bundle name (with --to bundle)")
    convert.add_argument("--note", help="bundle note (with --to bundle)")

    experiment = groups.add_parser("experiment", help="paired experiment exports").add_subparsers(dest="command", metavar="COMMAND",
                                                                                                    parser_class=_Parser)
    experiment.required = True
    summarize = leaf(experiment, "summarize", cmd_experiment_summarize, "every outcome, pair counts, exact probabilities, caveats",
                     inventory=False, output=True)
    summarize.add_argument("export", metavar="EXPORT", help="the experiment JSON exported from the Pair view")
    summarize.add_argument("--format", choices=("text", "json", "markdown", "csv"), default="text")
    return parser


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    parser = build_parser()
    try:
        args = parser.parse_args(argv)
        out = Output(args)
        code = args.handler(args, out)
        return code or 0
    except Usage as error:
        sys.stderr.write(safe(str(error), sys.stderr.isatty()) + "\n")
        return 2
    except Findings as error:
        sys.stderr.write(safe(str(error), sys.stderr.isatty()) + "\n")
        return 1
    except SystemExit as exit_:
        return exit_.code if isinstance(exit_.code, int) else 2
    except BrokenPipeError:
        return 0


if __name__ == "__main__":
    sys.exit(main())
