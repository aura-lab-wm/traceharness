"""Offline tools over native prompt inventories and profiles: the Python mirror of the
browser workbench (traceharness/frontend/src/rig/native/*.js).

Everything here is pure and works on JSON-shaped values only. Nothing contacts a service,
reads a home directory or writes a file. The checks PREDICT what the deployed runner
refuses, to give earlier and clearer feedback; runner review stays authoritative and nothing
here marks a profile as verified.

Canonicalisation and validation are DELEGATED to the frozen adapters
(native_prompts.canonical_profile and native_prompts_codex.canonical_profile), which this
module imports read-only and never re-implements. The remaining functions follow the
JavaScript modules line for line, including the places where JavaScript semantics differ
from Python's (UTF-16 string lengths, JSON.stringify number formatting, ASCII-only regular
expression classes), so that both languages return the same value for the same input. The
shared golden fixtures in traceharness/frontend/test/native-golden/ hold both to one answer.

Not mirrored, because they are browser concerns: diffRows, history, library storage and
evidenceSummary.
"""
from __future__ import annotations

import copy
from datetime import datetime, timezone
import hashlib
import json
import math
import re
import unicodedata

from . import native_prompts as _claude
from . import native_prompts_codex as _codex

# --- shared constants ---------------------------------------------------------------------------------

TOKEN_ESTIMATOR = "chars-div-3.9-v1"
PROFILE_PINS = ("runtime_id", "runtime_version", "image_digest", "binary_sha256", "inventory_sha256",
                "taxonomy_sha256", "materializer_sha256")
PROFILE_KEYS = ("schema_version", *PROFILE_PINS, "default_action", "overrides")
LIMITS = {"overrides": 4096, "replacement_bytes": 250000, "profile_bytes": 786432, "manifest_bytes": 1048576,
          "plan_bytes": 786432, "arms": 8, "repeats": 10, "trials": 64, "observer_min_bytes": 16}
ACTIONS = ("keep", "disable", "replace")
RUNTIMES = ("native-claude-code", "native-codex")
PLACEHOLDER = re.compile(r"\$\{TH_PROMPT_EXPR_[0-9]+\}")
_ASCII_SPACE = " \t\n\x0b\x0c\r"
_HASH = re.compile(r"[a-f0-9]{64}")
_IMAGE = re.compile(r"(?:[a-zA-Z0-9][a-zA-Z0-9./:_-]*@)?sha256:[a-f0-9]{64}")
_SK_TOKEN_ASCII = re.compile(r"\bsk-(?:or-)?[A-Za-z0-9_-]{10,}\b", re.ASCII)
_PROVIDER_KEY_ASCII = re.compile(r"sk-or-v[0-9]+-[A-Za-z0-9_-]{16,}")
# JavaScript String.prototype.trim: WhiteSpace and LineTerminator code points.
_JS_TRIM = "\t\n\x0b\x0c\r \xa0            \u2028\u2029  　\ufeff"


class ToolError(ValueError):
    """A refusal whose message is the sentence to show, word for word as in the browser."""


def _fail(message):
    raise ToolError(message)


# --- JavaScript-compatible primitives -----------------------------------------------------------------

def _is_number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _js_is(value, number):
    """JavaScript `value === number` for a number literal: 1 and 1.0 are the same value."""
    return _is_number(value) and value == number


def _is_safe_integer(value):
    if isinstance(value, bool) or not _is_number(value):
        return False
    if isinstance(value, float) and (not math.isfinite(value) or not value.is_integer()):
        return False
    return abs(value) <= 2 ** 53 - 1


def _u16len(text):
    """String length as JavaScript counts it (UTF-16 code units)."""
    return len(text.encode("utf-16-le", "surrogatepass")) // 2


def _js_trim(text):
    return text.strip(_JS_TRIM)


def _has_category(text, categories):
    return any(unicodedata.category(character) in categories for character in text)


def _has_lone_surrogate(text):
    return any("\ud800" <= character <= "\udfff" for character in text)


def _js_number(value):
    """Number.prototype.toString for a finite number (shortest round trip, JavaScript layout)."""
    if isinstance(value, int) and abs(value) <= 2 ** 53:
        return str(value)
    value = float(value)
    if not math.isfinite(value):
        return "NaN" if value != value else ("Infinity" if value > 0 else "-Infinity")
    if value == 0:
        return "0"
    sign = "-" if value < 0 else ""
    text = repr(abs(value))
    mantissa, _, exponent = text.partition("e")
    whole, _, fraction = mantissa.partition(".")
    digits = whole + fraction
    point = len(whole) + (int(exponent) if exponent else 0)
    stripped = digits.lstrip("0")
    point -= len(digits) - len(stripped)
    digits = stripped.rstrip("0") or "0"
    k, n = len(digits), point
    if k <= n <= 21:
        out = digits + "0" * (n - k)
    elif 0 < n <= 21:
        out = digits[:n] + "." + digits[n:]
    elif -6 < n <= 0:
        out = "0." + "0" * (-n) + digits
    else:
        power = n - 1
        mark = "+" if power >= 0 else "-"
        out = (digits if k == 1 else digits[0] + "." + digits[1:]) + "e" + mark + str(abs(power))
    return sign + out


def _js_string_literal(text):
    """JSON.stringify of a string: escapes as JavaScript does, including lone surrogates."""
    out = ['"']
    for character in text:
        code = ord(character)
        if character == '"':
            out.append('\\"')
        elif character == "\\":
            out.append("\\\\")
        elif character == "\b":
            out.append("\\b")
        elif character == "\f":
            out.append("\\f")
        elif character == "\n":
            out.append("\\n")
        elif character == "\r":
            out.append("\\r")
        elif character == "\t":
            out.append("\\t")
        elif code < 0x20 or 0xD800 <= code <= 0xDFFF:
            out.append("\\u%04x" % code)
        else:
            out.append(character)
    out.append('"')
    return "".join(out)


def _js_keys(value):
    """Object.keys order: array-index keys ascending first, then the others in insertion order."""
    def index(key):
        return key.isdigit() and key.isascii() and (key == "0" or key[0] != "0") and int(key) < 2 ** 32 - 1
    numeric = sorted((key for key in value if index(key)), key=int)
    return numeric + [key for key in value if not index(key)]


def _js_stringify(value, indent=None, _level=0):
    """JSON.stringify(value) or JSON.stringify(value, null, indent) for JSON-shaped data."""
    if value is None:
        return "null"
    if value is True:
        return "true"
    if value is False:
        return "false"
    if _is_number(value):
        return _js_number(value) if math.isfinite(value) else "null"
    if isinstance(value, str):
        return _js_string_literal(value)
    if isinstance(value, (list, tuple)):
        if not value:
            return "[]"
        items = [_js_stringify(item, indent, _level + 1) for item in value]
        if indent is None:
            return "[" + ",".join(items) + "]"
        pad, inner = " " * (indent * _level), " " * (indent * (_level + 1))
        return "[\n" + ",\n".join(inner + item for item in items) + "\n" + pad + "]"
    if isinstance(value, dict):
        keys = _js_keys(value)
        if not keys:
            return "{}"
        separator = ":" if indent is None else ": "
        items = [_js_string_literal(key) + separator + _js_stringify(value[key], indent, _level + 1) for key in keys]
        if indent is None:
            return "{" + ",".join(items) + "}"
        pad, inner = " " * (indent * _level), " " * (indent * (_level + 1))
        return "{\n" + ",\n".join(inner + item for item in items) + "\n" + pad + "}"
    raise TypeError("Not JSON-shaped data")


def _js_str(value):
    """String(value) for the values the exports print."""
    if value is None:
        return "null"
    if value is True:
        return "true"
    if value is False:
        return "false"
    if _is_number(value):
        return _js_number(value)
    return str(value)


_JS_DECIMAL = re.compile(r"[+-]?(?:Infinity|(?:[0-9]+\.?[0-9]*|\.[0-9]+)(?:[eE][+-]?[0-9]+)?)")
_JS_RADIX = re.compile(r"0(?:[xX][0-9a-fA-F]+|[oO][0-7]+|[bB][01]+)")


def _js_truthy_number(value):
    """`Number(value) || 0` for JSON values."""
    if value is None or value is False:
        return 0
    if value is True:
        return 1
    if _is_number(value):
        return value if value == value else 0
    if isinstance(value, str):
        text = _js_trim(value)
        if not text:
            return 0
        if _JS_RADIX.fullmatch(text):
            return int(text, 0)
        if not _JS_DECIMAL.fullmatch(text):
            return 0
        number = float(text.replace("Infinity", "inf"))
        return int(number) if number.is_integer() and abs(number) <= 2 ** 53 else number
    return 0


def _js_utf8(text):
    """The bytes TextEncoder writes: a lone surrogate becomes U+FFFD."""
    if _has_lone_surrogate(text):
        text = text.encode("utf-16-le", "surrogatepass").decode("utf-16-le", "replace")
    return text.encode("utf-8")


# --- text metrics -------------------------------------------------------------------------------------

def utf8_bytes(text):
    """Exact UTF-8 size. A lone surrogate counts three bytes, as TextEncoder writes U+FFFD."""
    return len(text.encode("utf-8", "surrogatepass"))


def code_points(text):
    return len(text)


def line_count(text):
    return 0 if not text else text.count("\n") + 1


def strip_ascii_whitespace(text):
    return text.strip(_ASCII_SPACE)


def estimate_tokens(text):
    """An ESTIMATE, never a measurement: agent-patcher's chars / 3.9 with ASCII trimming."""
    count = len(strip_ascii_whitespace(text))
    return 0 if count == 0 else max(1, (10 * count + 38) // 39)


def text_metrics(text):
    return {"bytes": utf8_bytes(text), "code_points": code_points(text), "lines": line_count(text),
            "est_tokens": estimate_tokens(text)}


# --- profile model ------------------------------------------------------------------------------------

def canonical_json(value):
    """Sorted keys, no whitespace, non-ASCII kept: the text of native_prompts.canonical_bytes
    for every profile (the test suite pins that equality). Numbers and lone surrogates are
    written as JavaScript writes them, so the browser computes the same text."""
    if isinstance(value, (list, tuple)):
        return "[" + ",".join(canonical_json(item) for item in value) + "]"
    if isinstance(value, dict):
        return "{" + ",".join(_js_string_literal(key) + ":" + canonical_json(value[key])
                              for key in sorted(value)) + "}"
    return _js_stringify(value)


def sha256_hex(text):
    return hashlib.sha256(text.encode("utf-8", "surrogatepass")).hexdigest()


def _sha256_js(text):
    """SHA-256 as the browser computes it: TextEncoder writes U+FFFD for a lone surrogate."""
    return hashlib.sha256(_js_utf8(text)).hexdigest()


def profile_sha256(profile):
    """The manifest's native_prompt_profile_sha256 for a CANONICAL profile."""
    return hashlib.sha256(_js_utf8(canonical_json(profile))).hexdigest()


def profile_bytes(profile):
    return utf8_bytes(canonical_json(profile))


def override_bytes(override):
    return utf8_bytes(canonical_json(override))


def placeholder_sequence(text):
    return PLACEHOLDER.findall(text)


def _ordered_override(row):
    out = {"block_id": row.get("block_id"), "baseline_sha256": row.get("baseline_sha256"), "action": row.get("action")}
    if row.get("action") == "replace":
        out["replacement_utf8"] = row.get("replacement_utf8")
        out["replacement_sha256"] = row.get("replacement_sha256")
    return out


def ordered_profile(profile):
    """The profile with its keys in the documented order; content unchanged."""
    out = {"schema_version": profile.get("schema_version")}
    out.update({key: profile.get(key) for key in PROFILE_PINS})
    out["default_action"] = profile.get("default_action")
    out["overrides"] = [_ordered_override(row) for row in profile.get("overrides", [])]
    return out


def _adapter(inventory):
    return _codex if isinstance(inventory, dict) and inventory.get("runtime_id") == "native-codex" else _claude


def canonical_profile(profile, inventory):
    """The frozen adapter's canonical profile for the inventory's runtime. Raises ToolError
    with the deployed service's sentence for everything the service refuses."""
    try:
        return _adapter(inventory).canonical_profile(copy.deepcopy(profile), inventory)
    except _claude.NativePromptError as error:
        raise ToolError(str(error)) from None
    except (KeyError, TypeError, AttributeError):
        raise ToolError("Invalid native prompt profile fields") from None


def resolve_actions(profile, inventory):
    """{block id: action}: its override, else the default for a patchable block, else keep."""
    overrides = {}
    for row in profile["overrides"]:
        overrides[row["block_id"]] = row.get("action")
    return {block["id"]: overrides.get(block["id"]) or (profile["default_action"] if block["capability"] == "patchable" else "keep")
            for block in inventory["blocks"]}


def effective_text(block, profile):
    override = next((row for row in profile["overrides"] if row.get("block_id") == block["id"]), None)
    action = (override or {}).get("action") or (profile["default_action"] if block["capability"] == "patchable" else "keep")
    if action == "replace":
        return {"action": action, "text": override["replacement_utf8"]}
    return {"action": action, "text": "" if action == "disable" else block["baseline_utf8"]}


def profile_counts(profile, inventory):
    actions = resolve_actions(profile, inventory)
    counts = {"patchable": 0, "keep": 0, "replace": 0, "disable": 0, "observed": 0, "unavailable": 0,
              "overrides": len(profile["overrides"]), "default_action": profile["default_action"]}
    for block in inventory["blocks"]:
        if block["capability"] == "observed-only":
            counts["observed"] += 1
        elif block["capability"] == "unavailable":
            counts["unavailable"] += 1
        else:
            counts["patchable"] += 1
            counts[actions[block["id"]]] += 1
    return counts


def _replacement_text_issue(value):
    if not isinstance(value, str):
        return "replacement_utf8 must be text"
    if _has_lone_surrogate(value):
        return "replacement_utf8 is not valid UTF-8"
    if "\x00" in value:
        return "replacement_utf8 contains a NUL"
    size = utf8_bytes(value)
    if size == 0 or size > LIMITS["replacement_bytes"]:
        return "Native replacement must be nonempty and within the byte limit"
    return ""


def _override_fields(row):
    base = ["block_id", "baseline_sha256", "action"]
    return base + ["replacement_utf8", "replacement_sha256"] if row.get("action") == "replace" else base


def _exact_keys(value, keys):
    return isinstance(value, dict) and set(value) == set(keys) and len(value) == len(keys)


def _placeholders_ok(text, required):
    return placeholder_sequence(text) == list(required) and "${TH_PROMPT_EXPR" not in PLACEHOLDER.sub("", text)


def rebase_profile(profile, inventory):
    """Carry a profile to another inventory of the same runtime, exact matches only.
    Returns {profile, kept, dropped, default_applies_to}; the result has the target's pins and needs
    review. default_applies_to: the patchable target blocks only the default "disable" governs."""
    if not _exact_keys(profile, PROFILE_KEYS):
        _fail("Invalid native prompt profile fields")
    if not _js_is(profile["schema_version"], 1):
        _fail("Unsupported native prompt profile schema")
    if profile["runtime_id"] != inventory["runtime_id"]:
        _fail("A profile can be rebased only onto an inventory of the same runtime.")
    if profile["default_action"] not in ("keep", "disable"):
        _fail("Invalid default native prompt action")
    if not isinstance(profile["overrides"], list) or len(profile["overrides"]) > LIMITS["overrides"]:
        _fail("Too many native prompt overrides")
    blocks = {block["id"]: block for block in inventory["blocks"]}
    seen, keep, dropped = set(), {}, []
    for override in profile["overrides"]:
        if not isinstance(override, dict):
            _fail("Invalid native prompt override")
        action = override.get("action")
        if not _exact_keys(override, _override_fields(override)) or action not in ACTIONS:
            _fail("Invalid native prompt override fields")
        block_id = override["block_id"]
        if not isinstance(block_id, str) or block_id in seen:
            _fail("Unknown or duplicate native prompt override")
        seen.add(block_id)
        if action == "replace":
            issue = _replacement_text_issue(override["replacement_utf8"])
            if issue:
                _fail(issue)
            if sha256_hex(override["replacement_utf8"]) != override["replacement_sha256"]:
                _fail("Native replacement digest mismatch")
        block = blocks.get(block_id)
        reason = None
        if block is None:
            reason = "unknown-block"
        elif block["baseline_sha256"] != override["baseline_sha256"]:
            reason = "baseline-changed"
        elif action != "keep" and block["capability"] != "patchable":
            reason = "not-patchable"
        elif action == "replace" and not _placeholders_ok(override["replacement_utf8"], block["required_placeholders"]):
            reason = "placeholder-mismatch"
        elif (action == "replace" and inventory["runtime_id"] == "native-codex"
              and utf8_bytes(override["replacement_utf8"]) > utf8_bytes(block["baseline_utf8"])):
            reason = "over-capacity"
        if reason:
            dropped.append({"block_id": block_id, "action": action, "reason": reason})
        else:
            keep[block_id] = _ordered_override(override)
    kept = [block["id"] for block in inventory["blocks"] if block["id"] in keep]
    result = {"schema_version": 1, **{key: inventory[key] for key in PROFILE_PINS},
              "default_action": profile["default_action"], "overrides": [keep[block_id] for block_id in kept]}
    # Under default "disable", the patchable target blocks no kept override names are disabled by the
    # default alone (new blocks and blocks whose override was dropped among them).
    default_applies_to = ([block["id"] for block in inventory["blocks"] if block["capability"] == "patchable" and block["id"] not in keep]
                          if profile["default_action"] == "disable" else [])
    return {"profile": result, "kept": kept, "dropped": dropped, "default_applies_to": default_applies_to}


def baseline_profile(inventory, default_action="keep"):
    """A profile with the inventory's pins and no overrides (default keep: the baseline)."""
    return {"schema_version": 1, **{key: inventory[key] for key in PROFILE_PINS},
            "default_action": default_action, "overrides": []}


# --- mirrors of the browser's contract checks (native-prompts-contract.js) ----------------------------

def _contract_text(value, maximum=1000):
    return (isinstance(value, str) and len(value) > 0 and _u16len(value) <= maximum
            and not _has_category(value, ("Cc", "Cs")))


def _contract_pins(value):
    return (isinstance(value, dict) and value.get("runtime_id") in RUNTIMES and _contract_text(value.get("runtime_version"), 120)
            and isinstance(value.get("image_digest"), str) and bool(_IMAGE.fullmatch(value["image_digest"]))
            and all(isinstance(value.get(key), str) and bool(_HASH.fullmatch(value[key])) for key in PROFILE_PINS[3:]))


def replacement_issue(value, placeholders=None):
    """The browser's sentence for a replacement text, or '' (native-prompts-contract.js)."""
    if not isinstance(value, str) or not value:
        return "An empty replacement is not Disable. Use Disable to exclude this prompt."
    if "\x00" in value or _has_lone_surrogate(value):
        return "The replacement contains invalid Unicode or a NUL character."
    if utf8_bytes(value) > 250000:
        return "Keep this replacement within 250,000 UTF-8 bytes."
    if _PROVIDER_KEY_ASCII.search(value):
        return "Remove provider credentials from the replacement."
    if placeholders is not None:
        if placeholder_sequence(value) != list(placeholders):
            return "Preserve every required native placeholder exactly once, in its original order."
        if "${TH_PROMPT_EXPR" in PLACEHOLDER.sub("", value):
            return "The replacement contains an invalid native placeholder."
    return ""


def checked_native_profile(value, runtime_id=None):
    """Shape checks only, as the browser's checkedNativeProfile; returns a deep copy."""
    if (not _exact_keys(value, PROFILE_KEYS) or not _js_is(value["schema_version"], 1) or not _contract_pins(value)
            or (runtime_id and value["runtime_id"] != runtime_id) or value["default_action"] not in ("keep", "disable")
            or not isinstance(value["overrides"], list) or len(value["overrides"]) > 4096):
        _fail("The native prompt profile is incomplete or names a different runtime.")
    ids = set()
    for row in value["overrides"]:
        fields = ["block_id", "baseline_sha256", "action"]
        if isinstance(row, dict) and row.get("action") == "replace":
            fields += ["replacement_utf8", "replacement_sha256"]
        if (not _exact_keys(row, fields) or not _contract_text(row["block_id"], 240)
                or row["block_id"] in ("__proto__", "constructor", "prototype") or row["block_id"] in ids
                or not isinstance(row["baseline_sha256"], str) or not _HASH.fullmatch(row["baseline_sha256"])
                or row["action"] not in ACTIONS
                or (row["action"] == "replace" and (replacement_issue(row["replacement_utf8"])
                                                    or not isinstance(row["replacement_sha256"], str)
                                                    or not _HASH.fullmatch(row["replacement_sha256"])))):
            _fail("The native prompt profile has an invalid or duplicate prompt intervention.")
        ids.add(row["block_id"])
    if utf8_bytes(_js_stringify(value)) > 768 * 1024:
        _fail("The native prompt profile exceeds its 768 KiB limit.")
    return copy.deepcopy(value)


def profile_name_issue(name):
    if (not isinstance(name, str) or not _js_trim(name) or _js_trim(name) != name or _u16len(name) > 80
            or _has_category(name, ("Cc", "Cf", "Cs"))):
        return "Use a profile name from 1 to 80 visible characters, without leading or trailing spaces."
    if _PROVIDER_KEY_ASCII.search(name) or _SK_TOKEN_ASCII.search(name):
        return "Remove provider credentials from the profile name."
    return ""


def library_note_issue(note):
    if not isinstance(note, str) or _u16len(note) > 500 or _has_category(note.replace("\n", ""), ("Cc", "Cf", "Cs")):
        return "Keep the note within 500 characters, without control characters."
    if _SK_TOKEN_ASCII.search(note):
        return "Remove provider credentials from the note."
    return ""


# --- search -------------------------------------------------------------------------------------------

_FIELDS = ("id", "title", "class", "body", "new")
_SNIPPET_ORDER = ("title", "id", "class", "new", "body")
_STATE_RANK = {"replace": 0, "disable": 1, "keep": 2}
_ASCII_UPPER = {code: code + 32 for code in range(65, 91)}
_SORTS = ("inventory", "bytes-desc", "bytes-asc", "tokens-desc", "title", "state", "relevance")


def ascii_lower(text):
    """Lower-case A to Z only; length and every index are preserved."""
    return text.translate(_ASCII_UPPER)


def _is_space(character):
    return character == " " or "\t" <= character <= "\r"


QUERY_LIMITS = {"terms": 64, "chars": 1000}


def parse_query(text):
    """Terms ANDed; "a phrase"; prefixes id: title: class: body: new:; a leading - negates.
    Only the first 1,000 code points and the first 64 terms are used ("limited" says so)."""
    text = text if isinstance(text, str) else ""
    limited = len(text) > QUERY_LIMITS["chars"]
    text = text[:QUERY_LIMITS["chars"]]
    terms, index, size = [], 0, len(text)
    while index < size:
        while index < size and _is_space(text[index]):
            index += 1
        if index >= size:
            break
        negate, field = False, "any"
        if text[index] == "-":
            index += 1
            if index >= size or _is_space(text[index]):
                continue
            negate = True
        for name in _FIELDS:
            if ascii_lower(text[index:index + len(name) + 1]) == name + ":":
                field = name
                index += len(name) + 1
                break
        if index < size and text[index] == '"':
            close = text.find('"', index + 1)
            value = text[index + 1:size if close == -1 else close]
            index = size if close == -1 else close + 1
        else:
            start = index
            while index < size and not _is_space(text[index]):
                index += 1
            value = text[start:index]
        if value:
            if len(terms) == QUERY_LIMITS["terms"]:
                limited = True
                break
            terms.append({"field": field, "text": value, "negate": negate})
    return {"terms": terms, "limited": limited}


def baseline_metrics(inventory):
    return [{"bytes": utf8_bytes(block["baseline_utf8"]), "est_tokens": estimate_tokens(block["baseline_utf8"])}
            for block in inventory["blocks"]]


def _clip(text, start, end, before, after):
    return {"before": text[max(0, start - before):start], "match": text[start:end], "after": text[end:end + after]}


def _filtered(inventory, options):
    """Rows that pass every filter except the text query, with the values the query needs."""
    classes = options.get("classes") or []
    set_ids = options.get("set_ids")
    states = options.get("states") or []
    capabilities = options.get("capabilities") or []
    placeholders = options.get("placeholders", "any")
    changed_only = bool(options.get("changed_only", False))
    only_ids = options.get("only_ids")
    profile = options.get("profile")
    class_set = set(classes) if classes else None
    members = set(set_ids) if set_ids is not None else None
    only = set(only_ids) if only_ids is not None else None
    state_set = set(states) if states else None
    capability_set = set(capabilities) if capabilities else None
    overrides = {}
    for row in (profile or {}).get("overrides") or []:
        overrides[row["block_id"]] = row
    for position, block in enumerate(inventory["blocks"]):
        if ((class_set is not None and block["class_name"] not in class_set) or (members is not None and block["id"] not in members)
                or (only is not None and block["id"] not in only)
                or (capability_set is not None and block["capability"] not in capability_set)):
            continue
        count = len(block["required_placeholders"])
        if (placeholders == "with" and not count) or (placeholders == "without" and count):
            continue
        override = overrides.get(block["id"])
        action = ((override or {}).get("action") or profile["default_action"]) if block["capability"] == "patchable" and profile else None
        if (state_set is not None and action not in state_set) or (changed_only and action in (None, "keep")):
            continue
        replacement = override["replacement_utf8"] if override and override.get("action") == "replace" else ""
        yield position, block, action, replacement


def _sorted_rows(rows, sort):
    if sort not in _SORTS:
        _fail("Choose a supported sort order.")
    keys = {
        "inventory": lambda row: row["index"],
        "bytes-desc": lambda row: (-row["bytes"], row["index"]),
        "bytes-asc": lambda row: (row["bytes"], row["index"]),
        "tokens-desc": lambda row: (-row["est_tokens"], row["index"]),
        "title": lambda row: (ascii_lower(row["block"]["title"]), row["index"]),
        "state": lambda row: (_STATE_RANK.get(row["action"], 3), row["index"]),
        "relevance": lambda row: (-int(row["_strong"]), -row["match_count"], row["index"]),
    }
    return rows if sort == "inventory" else sorted(rows, key=keys[sort])


def search_inventory(inventory, options=None):
    """The browser's searchInventory: {rows, total, patchable_ids}. Byte and token figures are
    the BASELINE's (exact and estimate)."""
    options = options or {}
    parsed = parse_query(options.get("query", ""))
    terms = [{**term, "needle": ascii_lower(term["text"])} for term in parsed["terms"]]
    positive = [term for term in terms if not term["negate"]]
    sort = options.get("sort", "inventory")
    rows = []
    for position, block, action, replacement in _filtered(inventory, options):
        lowered = {"id": ascii_lower(block["id"]), "title": ascii_lower(block["title"]), "class": ascii_lower(block["class_name"]),
                   "body": ascii_lower(block["baseline_utf8"]), "new": ascii_lower(replacement)}
        original = {"id": block["id"], "title": block["title"], "class": block["class_name"],
                    "body": block["baseline_utf8"], "new": replacement}

        def hit(term, lowered=lowered):
            fields = _SNIPPET_ORDER if term["field"] == "any" else (term["field"],)
            return any(term["needle"] in lowered[field] for field in fields)
        if any(hit(term) == term["negate"] for term in terms):
            continue
        match_count, strong, snippet = 0, False, None
        for term in positive:
            for field in _SNIPPET_ORDER if term["field"] == "any" else (term["field"],):
                found = lowered[field].count(term["needle"])
                match_count += found
                if found and field in ("title", "id"):
                    strong = True
        if positive:
            first = positive[0]
            for field in _SNIPPET_ORDER if first["field"] == "any" else (first["field"],):
                at = lowered[field].find(first["needle"])
                if at != -1:
                    snippet = {"field": field, **_clip(original[field], at, at + len(first["needle"]), 40, 80)}
                    break
        rows.append({"block": block, "index": position, "action": action, "bytes": utf8_bytes(block["baseline_utf8"]),
                     "est_tokens": estimate_tokens(block["baseline_utf8"]), "match_count": match_count, "snippet": snippet,
                     "_strong": strong})
    rows = _sorted_rows(rows, sort)
    for row in rows:
        row.pop("_strong")
    return {"rows": rows, "total": len(inventory["blocks"]),
            "patchable_ids": [row["block"]["id"] for row in rows if row["block"]["capability"] == "patchable"],
            "query_limited": parsed["limited"]}


def search_inventory_regex(inventory, pattern, options=None):
    """CLI only (offline): a Python regular expression over id, title, class, replacement and
    baseline text, with the same filters and result shape as search_inventory."""
    options = options or {}
    try:
        compiled = re.compile(pattern)
    except re.error as error:
        raise ToolError(f"The regular expression is not valid: {error}.") from None
    rows = []
    for position, block, action, replacement in _filtered(inventory, options):
        original = {"id": block["id"], "title": block["title"], "class": block["class_name"],
                    "body": block["baseline_utf8"], "new": replacement}
        count, snippet = 0, None
        for field in _SNIPPET_ORDER:
            for match in compiled.finditer(original[field]):
                if match.end() == match.start():
                    continue
                count += 1
                if snippet is None:
                    snippet = {"field": field, **_clip(original[field], match.start(), match.end(), 40, 80)}
        if not count:
            continue
        rows.append({"block": block, "index": position, "action": action, "bytes": utf8_bytes(block["baseline_utf8"]),
                     "est_tokens": estimate_tokens(block["baseline_utf8"]), "match_count": count, "snippet": snippet,
                     "_strong": snippet is not None and snippet["field"] in ("title", "id")})
    rows = _sorted_rows(rows, options.get("sort", "inventory"))
    for row in rows:
        row.pop("_strong")
    return {"rows": rows, "total": len(inventory["blocks"]),
            "patchable_ids": [row["block"]["id"] for row in rows if row["block"]["capability"] == "patchable"],
            "query_limited": False}


# --- diff ---------------------------------------------------------------------------------------------

DIFF_LIMITS = {"line_cells": 4000000, "word_cells": 1000000}
_WORD = re.compile(r"[A-Za-z0-9_]+|[ \t\r\n]+|.", re.S)
_BLANK = re.compile(r"[ \t\r\n]+")


def _split_lines(text):
    lines, start = [], 0
    while True:
        at = text.find("\n", start)
        if at == -1:
            break
        lines.append(text[start:at + 1])
        start = at + 1
    if start < len(text):
        lines.append(text[start:])
    return lines


def _sequence_ops(left, right, max_cells):
    shortest = min(len(left), len(right))
    head = 0
    while head < shortest and left[head] == right[head]:
        head += 1
    tail = 0
    while tail < shortest - head and left[len(left) - 1 - tail] == right[len(right) - 1 - tail]:
        tail += 1
    a, b = left[head:len(left) - tail], right[head:len(right) - tail]
    ops = []

    def put(op, items):
        if items:
            ops.append((op, items))
    put("equal", left[:head])
    capped = False
    if len(a) * len(b) > max_cells:
        capped = True
        put("delete", a)
        put("insert", b)
    elif not a or not b:
        put("delete", a)
        put("insert", b)
    else:
        codes = {}
        x = [codes.setdefault(item, len(codes)) for item in a]
        y = [codes.setdefault(item, len(codes)) for item in b]
        n, m = len(x), len(y)
        table = [None] * (n + 1)
        table[n] = [0] * (m + 1)
        for i in range(n - 1, -1, -1):
            below, row, xi = table[i + 1], [0] * (m + 1), x[i]
            for j in range(m - 1, -1, -1):
                if xi == y[j]:
                    row[j] = below[j + 1] + 1
                else:
                    down, right_value = below[j], row[j + 1]
                    row[j] = down if down >= right_value else right_value
            table[i] = row
        i = j = 0
        removed, added, same = [], [], []
        while i < n and j < m:
            if x[i] == y[j]:
                put("delete", removed)
                put("insert", added)
                removed, added = [], []
                same.append(a[i])
                i += 1
                j += 1
            elif table[i + 1][j] >= table[i][j + 1]:
                put("equal", same)
                same = []
                removed.append(a[i])
                i += 1
            else:
                put("equal", same)
                same = []
                added.append(b[j])
                j += 1
        put("equal", same)
        removed.extend(a[i:])
        added.extend(b[j:])
        put("delete", removed)
        put("insert", added)
    put("equal", left[len(left) - tail:])
    return ops, capped


def _merged(ops):
    out = []
    for op, text in ops:
        if not text:
            continue
        if out and out[-1]["op"] == op:
            out[-1]["text"] += text
        else:
            out.append({"op": op, "text": text})
    return out


def diff_text(before, after, limits=None):
    """Line diff refined to words; the fixed algorithm of the browser's diffText.
    Equal plus delete texts concatenate to `before`, equal plus insert texts to `after`."""
    limits = limits or {}
    line_cells = limits.get("line_cells", DIFF_LIMITS["line_cells"])
    word_cells = limits.get("word_cells", DIFF_LIMITS["word_cells"])
    line_ops, line_capped = _sequence_ops(_split_lines(before), _split_lines(after), line_cells)
    granularity = "none" if line_capped else "word"
    flat = []
    index = 0
    while index < len(line_ops):
        op, items = line_ops[index]
        following = line_ops[index + 1] if index + 1 < len(line_ops) else None
        text = "".join(items)
        if line_capped or op != "delete" or following is None or following[0] != "insert":
            flat.append((op, text))
            index += 1
            continue
        inserted = "".join(following[1])
        index += 2
        word_ops, word_capped = _sequence_ops(_WORD.findall(text), _WORD.findall(inserted), word_cells)
        if word_capped:
            granularity = "line"
            flat.extend((("delete", text), ("insert", inserted)))
            continue
        if not any(entry_op == "equal" and any(not _BLANK.fullmatch(item) for item in entry_items)
                   for entry_op, entry_items in word_ops):
            flat.extend((("delete", text), ("insert", inserted)))
            continue
        flat.extend((entry_op, "".join(entry_items)) for entry_op, entry_items in word_ops)
    ops = _merged(flat)
    stats = {"equal_bytes": 0, "delete_bytes": 0, "insert_bytes": 0}
    for entry in ops:
        stats[entry["op"] + "_bytes"] += utf8_bytes(entry["text"])
    return {"changed": before != after, "granularity": granularity,
            "before": {"bytes": utf8_bytes(before), "lines": line_count(before)},
            "after": {"bytes": utf8_bytes(after), "lines": line_count(after)}, "ops": ops, "stats": stats}


def diff_profiles(a, b, inventory):
    """Blocks whose action or authored text differs between two profiles of one inventory."""
    for profile in (a, b):
        if any(profile.get(key) != inventory[key] for key in PROFILE_PINS):
            _fail("Compare profiles of one inventory. One of these belongs to a different runtime or inventory revision; rebase it first.")
    left = {row["block_id"]: row for row in a["overrides"]}
    right = {row["block_id"]: row for row in b["overrides"]}

    def side(block, baseline, profile, overrides):
        row = overrides.get(block["id"])
        action = (row or {}).get("action") or profile["default_action"]
        if action == "disable":
            return {"action": action, "bytes": 0, "est_tokens": 0, "authored": block["baseline_utf8"]}
        if action == "replace":
            text = row["replacement_utf8"]
            return {"action": action, "bytes": utf8_bytes(text), "est_tokens": estimate_tokens(text), "authored": text}
        return {"action": action, "bytes": baseline["bytes"], "est_tokens": baseline["est_tokens"], "authored": block["baseline_utf8"]}
    rows = []
    totals = {"a_bytes": 0, "b_bytes": 0, "a_est_tokens": 0, "b_est_tokens": 0}
    metrics = baseline_metrics(inventory)
    for index, block in enumerate(inventory["blocks"]):
        if block["capability"] != "patchable":
            continue
        one, two = side(block, metrics[index], a, left), side(block, metrics[index], b, right)
        totals["a_bytes"] += one["bytes"]
        totals["b_bytes"] += two["bytes"]
        totals["a_est_tokens"] += one["est_tokens"]
        totals["b_est_tokens"] += two["est_tokens"]
        action_changed, text_changed = one["action"] != two["action"], one["authored"] != two["authored"]
        if not action_changed and not text_changed:
            continue
        rows.append({"block_id": block["id"], "title": block["title"], "class_name": block["class_name"],
                     "a": {"action": one["action"], "bytes": one["bytes"], "est_tokens": one["est_tokens"]},
                     "b": {"action": two["action"], "bytes": two["bytes"], "est_tokens": two["est_tokens"]},
                     "change": "action+text" if action_changed and text_changed else "action" if action_changed else "text"})
    return {"rows": rows, "changed": len(rows), **totals}


# --- budget -------------------------------------------------------------------------------------------

def limit_state(used, maximum):
    return "over" if used > maximum else "near" if used * 5 >= maximum * 4 else "ok"


def _prompt_json_bytes(prompt):
    return utf8_bytes(_js_stringify(prompt if isinstance(prompt, str) else ""))


def manifest_bytes_estimate(profile_size, prompt=""):
    """ESTIMATE of the run manifest for a canonical profile of `profile_size` bytes."""
    return profile_size + _prompt_json_bytes(prompt) + 2048


def paired_plan_bytes_estimate(profile_size, prompt=""):
    """ESTIMATE of a frozen two-arm plan: this profile against the baseline."""
    return 2 * manifest_bytes_estimate(profile_size, prompt) + 2 * (_prompt_json_bytes(prompt) + 2748) + 4096


def profile_budget(profile, inventory, context=None):
    """Sizes against the contract limits. `exact` is exact; `estimate` and the manifest and
    plan meters are estimates. Sums cover patchable fragments; no request contains them all."""
    context = context or {}
    codex = inventory["runtime_id"] == "native-codex"
    overrides = {row["block_id"]: row for row in profile["overrides"]}
    exact = {"baseline_bytes": 0, "effective_bytes": 0, "delta_bytes": 0, "profile_bytes": profile_bytes(profile),
             "overrides": len(profile["overrides"]), "keep": 0, "replace": 0, "disable": 0}
    estimate = {"baseline_tokens": 0, "effective_tokens": 0, "delta_tokens": 0, "not_estimated_blocks": 0}
    classes = {}
    for block in inventory["blocks"]:
        entry = classes.get(block["class_name"])
        if entry is None:
            entry = classes[block["class_name"]] = {"class_name": block["class_name"], "blocks": 0, "patchable": 0, "keep": 0,
                                                    "replace": 0, "disable": 0, "baseline_bytes": 0, "effective_bytes": 0,
                                                    "baseline_tokens": 0, "effective_tokens": 0}
        entry["blocks"] += 1
        if block["capability"] != "patchable":
            continue
        base_bytes, base_tokens = utf8_bytes(block["baseline_utf8"]), estimate_tokens(block["baseline_utf8"])
        override = overrides.get(block["id"])
        action = (override or {}).get("action") or profile["default_action"]
        size, tokens = base_bytes, base_tokens
        if action == "replace":
            replaced = utf8_bytes(override["replacement_utf8"])
            if codex and replaced < base_bytes:
                estimate["not_estimated_blocks"] += 1
            else:
                tokens = estimate_tokens(override["replacement_utf8"])
                if not codex:
                    size = replaced
        elif action == "disable":
            if codex:
                estimate["not_estimated_blocks"] += 1
            else:
                size, tokens = 0, 0
        entry["patchable"] += 1
        entry[action] += 1
        exact[action] += 1
        entry["baseline_bytes"] += base_bytes
        entry["effective_bytes"] += size
        entry["baseline_tokens"] += base_tokens
        entry["effective_tokens"] += tokens
        exact["baseline_bytes"] += base_bytes
        exact["effective_bytes"] += size
        estimate["baseline_tokens"] += base_tokens
        estimate["effective_tokens"] += tokens
    exact["delta_bytes"] = exact["effective_bytes"] - exact["baseline_bytes"]
    estimate["delta_tokens"] = estimate["effective_tokens"] - estimate["baseline_tokens"]
    prompt = context.get("prompt", "")
    manifest = manifest_bytes_estimate(exact["profile_bytes"], prompt)
    plan = paired_plan_bytes_estimate(exact["profile_bytes"], prompt)

    def meter(identifier, used, maximum, kind):
        return {"id": identifier, "used": used, "max": maximum, "kind": kind, "state": limit_state(used, maximum)}
    return {"estimator": TOKEN_ESTIMATOR, "exact": exact, "estimate": estimate,
            "limits": [meter("overrides", exact["overrides"], LIMITS["overrides"], "exact"),
                       meter("profile_bytes", exact["profile_bytes"], LIMITS["profile_bytes"], "exact"),
                       meter("manifest_bytes", manifest, LIMITS["manifest_bytes"], "estimate"),
                       meter("paired_plan_bytes", plan, LIMITS["plan_bytes"], "estimate")],
            "by_class": list(classes.values())}


def plan_budget(plan):
    """Sizes of a draft paired plan: draft_bytes exact, frozen_bytes_estimate an ESTIMATE,
    maximum_cost_usd the sum of per-trial caps (a worst case, not a forecast)."""
    draft = utf8_bytes(_js_stringify(plan))
    trials = len(plan["arms"]) * plan["repeats"]
    frozen, cost = draft + 200 * trials + 512, 0
    for arm in plan["arms"]:
        frozen += utf8_bytes(_js_stringify(arm["configuration"])) + 2048
        limits = (arm.get("configuration") or {}).get("limits") if isinstance(arm.get("configuration"), dict) else None
        cost += _js_truthy_number(limits.get("max_cost_usd") if isinstance(limits, dict) else None)
    return {"draft_bytes": draft, "frozen_bytes_estimate": frozen, "max": LIMITS["plan_bytes"],
            "state": limit_state(frozen, LIMITS["plan_bytes"]), "maximum_cost_usd": cost * plan["repeats"], "trials": trials}


# --- audit --------------------------------------------------------------------------------------------

def _rule(identifier, severity, contract, scope, title):
    return {"id": identifier, "severity": severity, "contract": contract, "scope": scope, "title": title}


AUDIT_RULES = (
    _rule("profile.invalid-shape", "error", True, "profile", "The profile is not a schema-1 native prompt profile"),
    _rule("pins.mismatch", "error", True, "profile", "Profile pins differ from the inventory"),
    _rule("override.unknown-block", "error", True, "block", "Override targets a block that is not in the inventory"),
    _rule("override.duplicate", "error", True, "block", "Two overrides target one block"),
    _rule("override.baseline-changed", "error", True, "block", "Override was written for a different baseline text"),
    _rule("override.not-patchable", "error", True, "block", "Override changes a block that cannot be edited"),
    _rule("override.digest-mismatch", "error", True, "block", "Replacement text does not match its SHA-256 digest"),
    _rule("replacement.empty", "error", True, "block", "Replacement is empty"),
    _rule("replacement.invalid-unicode", "error", True, "block", "Replacement has a NUL or an unpaired surrogate"),
    _rule("replacement.too-large", "error", True, "block", "Replacement exceeds 250,000 UTF-8 bytes"),
    _rule("placeholder.sequence", "error", True, "block", "Placeholders differ in order or number"),
    _rule("placeholder.stray", "error", True, "block", "Malformed native placeholder"),
    _rule("codex.over-capacity", "error", True, "block", "Codex replacement is longer than the native span"),
    _rule("profile.too-many-overrides", "error", True, "profile", "More than 4,096 overrides"),
    _rule("profile.too-large", "error", True, "profile", "Canonical profile exceeds 768 KiB"),
    _rule("leak.runner-redaction", "error", True, "block", "Text the runner treats as a credential"),
    _rule("leak.gateway-credential", "error", True, "block", "Text the gateway treats as a provider key"),
    _rule("leak.credential-shape", "warning", False, "block", "Text shaped like a credential"),
    _rule("leak.local-path", "warning", False, "block", "Home-directory path"),
    _rule("leak.email", "warning", False, "block", "E-mail address"),
    _rule("escape.poisoning", "warning", False, "block", "Literal escape sequences"),
    _rule("unicode.invisible", "warning", False, "block", "Invisible or control characters"),
    _rule("replacement.whitespace-only", "warning", False, "block", "Replacement is only whitespace"),
    _rule("manifest.size-estimate", "warning", False, "profile", "Estimated manifest exceeds 1 MiB"),
    _rule("plan.size-estimate", "warning", False, "plan", "Estimated two-arm plan exceeds 768 KiB"),
    _rule("replacement.noop", "info", False, "block", "Replacement equals the baseline"),
    _rule("observer.templated", "info", False, "block", "Templated fragment: no literal-match evidence"),
    _rule("observer.short-literal", "info", False, "block", "Short literal: no literal-match evidence"),
    _rule("class.security-disabled", "info", False, "profile", "Fragments labelled Security & Safety are changed"),
)
_RULES = {entry["id"]: entry for entry in AUDIT_RULES}
_SEVERITY_RANK = {"error": 0, "warning": 1, "info": 2}

# The runner's own patterns (execution.py _redacted), on the JSON text of the manifest.
# They are Unicode-aware there (Python \b, \s, (?i)); they are copied here unchanged so the
# prediction matches the deployed check exactly.
_RUNNER_SK = re.compile(r"\bsk-(?:or-)?[A-Za-z0-9_-]{10,}\b")
_RUNNER_JWT = re.compile(r"(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{8,2048}\.[A-Za-z0-9_-]{3,8192}\.[A-Za-z0-9_-]{22,1366}(?![A-Za-z0-9_-])")
_RUNNER_BEARER = re.compile(r"(?i)(\bBearer\s+)[A-Za-z0-9._~+/=-]{8,}")
# The gateway's noSecrets (JavaScript \b, ASCII) and the runner's has_secret (Python \d).
_GATEWAY_SK = _SK_TOKEN_ASCII
_RUNNER_PROVIDER_KEY = re.compile(r"sk-or-v\d+-[A-Za-z0-9_-]{16,}")
# "Bearer" and the run of spaces the runner matched; the token keeps every character the runner took.
_BEARER_PREFIX = re.compile(r"[A-Za-z]{6}\s+")

_CREDENTIAL_SHAPES = (
    ("github-token", re.compile(r"(?<![A-Za-z0-9_])gh[pousr]_[A-Za-z0-9]{36,255}")),
    ("github-fine-grained-token", re.compile(r"(?<![A-Za-z0-9_])github_pat_[A-Za-z0-9_]{22,255}")),
    ("aws-access-key-id", re.compile(r"(?<![A-Z0-9])AKIA[0-9A-Z]{16}(?![A-Z0-9])")),
    ("slack-token", re.compile(r"(?<![A-Za-z0-9_])xox[abprs]-[A-Za-z0-9-]{10,255}")),
    ("private-key", re.compile(r"-----BEGIN [A-Z ]{0,40}PRIVATE KEY-----")),
)
_LOCAL_PATH = re.compile(r"/(?:Users|home)/[A-Za-z0-9._-]{1,64}/|[A-Za-z]:\\Users\\[A-Za-z0-9._ -]{1,64}\\")
_EMAIL = re.compile(r"(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]{1,64}@(?:[A-Za-z0-9-]{1,63}\.){1,8}[A-Za-z]{2,24}(?![A-Za-z0-9-])")
_ESCAPES = re.compile(r"\\u[0-9a-fA-F]{4}|\\\\|\\n")
_INVISIBLE = re.compile("[\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u00ad\u061c\u180e\u200b-\u200f"
                        "\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]")
_ONLY_ASCII_SPACE = re.compile(r"[ \t\n\r\f\v]+")
_REDACTION_KIND = {"sk-token": 'an "sk-" key', "jwt": "a JSON Web Token", "bearer": "a Bearer credential"}


def _masked(span, keep=6):
    return span if len(span) <= keep + 2 else span[:keep] + "…"


def _looks_like_jwt(candidate):
    """execution.py jwt_candidate: structure only, never authenticity."""
    import base64

    def invalid_constant(_):
        raise ValueError("Non-JSON constant")
    try:
        parts = candidate.split(".")
        decoded = [base64.b64decode(part + "=" * (-len(part) % 4), altchars=b"-_", validate=True) for part in parts]
        if any(base64.urlsafe_b64encode(value).rstrip(b"=").decode() != part for part, value in zip(parts, decoded, strict=True)):
            return False
        header, payload = [json.loads(value.decode("utf-8"), parse_constant=invalid_constant) for value in decoded[:2]]
        return (isinstance(header, dict) and isinstance(payload, dict) and isinstance(header.get("alg"), str)
                and 1 <= len(header["alg"]) <= 128 and 16 <= len(decoded[2]) <= 1024)
    except (ValueError, UnicodeError, RecursionError):
        return False


def runner_redaction_matches(text):
    """Spans of `text` that make the runner refuse a manifest, checked as the manifest writes
    the text (a JSON string, ensure_ascii=False)."""
    escaped = _js_stringify(text)
    out = []

    def record(pattern, spans, shown):
        if spans:
            out.append({"pattern": pattern, "match": shown(spans[0]), "count": len(spans)})
    record("sk-token", [match.group(0) for match in _RUNNER_SK.finditer(escaped)], _masked)
    record("jwt", [match.group(0) for match in _RUNNER_JWT.finditer(escaped) if _looks_like_jwt(match.group(0))], _masked)

    def bearer(span):
        token = _BEARER_PREFIX.sub("", span, count=1) if _BEARER_PREFIX.match(span) else span
        return span[:len(span) - len(token)] + _masked(token) if _u16len(token) > 16 else span
    record("bearer", [match.group(0) for match in _RUNNER_BEARER.finditer(escaped)], bearer)
    return out


def gateway_credential_matches(text):
    out = []
    gateway = [match.group(0) for match in _GATEWAY_SK.finditer(text)]
    provider = [match.group(0) for match in _RUNNER_PROVIDER_KEY.finditer(text)]
    if gateway:
        out.append({"pattern": "gateway-sk-token", "match": _masked(gateway[0]), "count": len(gateway)})
    if provider:
        out.append({"pattern": "runner-provider-key", "match": _masked(provider[0]), "count": len(provider)})
    return out


def _finding(identifier, block_id, message, data=None, severity=None):
    entry = _RULES[identifier]
    return {"rule": identifier, "severity": severity or entry["severity"], "contract": False if severity else entry["contract"],
            "scope": entry["scope"], "block_id": block_id, "message": message, "data": data or {}}


def _first_new(text, baseline, pattern):
    seen = []
    for match in pattern.finditer(text):
        span = match.group(0)
        if span not in seen:
            seen.append(span)
    return [span for span in seen if span not in baseline]


def _sorted_findings(findings, order):
    ranked = sorted(enumerate(findings), key=lambda item: (_SEVERITY_RANK[item[1]["severity"]],
                                                           order.get(item[1]["block_id"], -1), item[1]["rule"], item[0]))
    return [entry for _, entry in ranked]


def audit_replacement(block, text, runtime_id):
    """Findings for one replacement text (block rules only), for live typing."""
    out = []

    def add(identifier, message, data=None, severity=None):
        out.append(_finding(identifier, block["id"], message, data, severity))
    baseline = block["baseline_utf8"]
    if not isinstance(text, str) or _has_lone_surrogate(text) or "\x00" in text:
        add("replacement.invalid-unicode", "The replacement contains a NUL character or an unpaired surrogate. The runner accepts valid Unicode text only.")
        return out
    if not text:
        add("replacement.empty", "An empty replacement is refused. Use Disable to withhold this fragment.")
        return out
    size = utf8_bytes(text)
    if size > LIMITS["replacement_bytes"]:
        add("replacement.too-large", f"The replacement is {size} UTF-8 bytes; the limit is {LIMITS['replacement_bytes']}.",
            {"bytes": size, "max": LIMITS["replacement_bytes"]})
    expected, actual = list(block["required_placeholders"]), placeholder_sequence(text)
    if actual != expected:
        plural = "" if len(expected) == 1 else "s"
        add("placeholder.sequence", f"Keep the {len(expected)} native placeholder{plural} of this fragment exactly once each, "
            f"in the original order. Found {len(actual)}.", {"expected": len(expected), "found": len(actual)})
    if "${TH_PROMPT_EXPR" in PLACEHOLDER.sub("", text):
        add("placeholder.stray", 'The text "${TH_PROMPT_EXPR" appears outside a complete native placeholder.')
    if runtime_id == "native-codex":
        capacity = utf8_bytes(baseline)
        if size > capacity:
            add("codex.over-capacity", f"The replacement is {size} UTF-8 bytes; this Codex fragment holds {capacity}.",
                {"bytes": size, "capacity": capacity})
    redactions = runner_redaction_matches(text)
    for hit in redactions:
        add("leak.runner-redaction", f'The runner treats "{hit["match"]}" as {_REDACTION_KIND[hit["pattern"]]} and refuses the run. '
            "Reword it; the check reads the shape, not the meaning.", dict(hit))
    if not any(hit["pattern"] == "sk-token" for hit in redactions):
        for hit in gateway_credential_matches(text):
            add("leak.gateway-credential", f'"{hit["match"]}" has the shape of a provider key. The hosted service refuses the request.', dict(hit))
    for name, pattern in _CREDENTIAL_SHAPES:
        spans = _first_new(text, baseline, pattern)
        if spans:
            add("leak.credential-shape", f'"{_masked(spans[0])}" has the shape of a credential ({name}) and is not in the baseline text.',
                {"pattern": name, "match": _masked(spans[0]), "count": len(spans)})
    paths = _first_new(text, baseline, _LOCAL_PATH)
    if paths:
        add("leak.local-path", f'"{paths[0]}" is a home-directory path that is not in the baseline text. It will be stored with the run.',
            {"match": paths[0], "count": len(paths)})
    emails = _first_new(text, baseline, _EMAIL)
    if emails:
        add("leak.email", f'"{emails[0]}" is an e-mail address that is not in the baseline text. It will be stored with the run.',
            {"match": emails[0], "count": len(emails)})
    escapes, baseline_escapes = len(_ESCAPES.findall(text)), len(_ESCAPES.findall(baseline))
    if escapes > baseline_escapes:
        lead = "Excessive literal escaping" if escapes > 10 else "Literal escape sequences"
        add("escape.poisoning", f"{lead}: {escapes} written out (such as \\n or \\u2014 typed as characters); the baseline has "
            f"{baseline_escapes}. The runtime would show them as typed.",
            {"count": escapes, "baseline_count": baseline_escapes, "excessive": escapes > 10})
    invisible = _first_new(text, baseline, _INVISIBLE)
    if invisible:
        names = sorted("U+%04X" % ord(character) for character in invisible)
        more = ", …" if len(names) > 8 else ""
        add("unicode.invisible", f"Invisible or control characters that are not in the baseline text: {', '.join(names[:8])}{more}.",
            {"count": len(names), "code_points": ", ".join(names[:8])})
    if _ONLY_ASCII_SPACE.fullmatch(text):
        add("replacement.whitespace-only", "The replacement is only whitespace. Use Disable so that the record says the fragment was withheld.")
    if text == baseline:
        add("replacement.noop", "The replacement equals the baseline. As a deliberate no-op control it still counts as a rewrite target.")
    minimum = LIMITS["observer_min_bytes"]
    if expected:
        add("observer.templated", "This fragment has native placeholders. The run observer skips templated fragments, so this change "
            "will have no literal-match evidence.")
    elif size < minimum or utf8_bytes(baseline) < minimum:
        add("observer.short-literal", f"The run observer does not match literals under {minimum} bytes, so this change will have "
            "incomplete literal-match evidence.", {"bytes": size, "baseline_bytes": utf8_bytes(baseline)})
    return _sorted_findings(out, {})


def _shape_issue(profile):
    if not _exact_keys(profile, PROFILE_KEYS):
        return "Invalid native prompt profile fields"
    if not _js_is(profile["schema_version"], 1):
        return "Unsupported native prompt profile schema"
    if profile["default_action"] not in ("keep", "disable"):
        return "Invalid default native prompt action"
    if not isinstance(profile["overrides"], list):
        return "Too many native prompt overrides"
    for row in profile["overrides"]:
        if not isinstance(row, dict):
            return "Invalid native prompt override"
        if not _exact_keys(row, _override_fields(row)) or row.get("action") not in ACTIONS:
            return "Invalid native prompt override fields"
        if not isinstance(row["block_id"], str):
            return "Unknown or duplicate native prompt override"
    return ""


def _observer_disable(block):
    minimum = LIMITS["observer_min_bytes"]
    if block["required_placeholders"]:
        return _finding("observer.templated", block["id"], "This fragment has native placeholders. The run observer skips templated "
                        "fragments, so disabling it will have no literal-match evidence.")
    if utf8_bytes(block["baseline_utf8"]) < minimum:
        return _finding("observer.short-literal", block["id"], f"The run observer does not match literals under {minimum} bytes, so "
                        "disabling this fragment will have no literal-match evidence.",
                        {"bytes": 0, "baseline_bytes": utf8_bytes(block["baseline_utf8"])})
    return None


def audit_profile(profile, inventory, context=None):
    """Audit a whole profile against its inventory: {ok, counts, findings}. Contract rules
    predict the runner's refusals; every other rule is advice and never blocks."""
    context = context or {}
    out = []
    order = {block["id"]: index for index, block in enumerate(inventory["blocks"])}

    def done():
        findings = _sorted_findings(out, order)
        counts = {"error": 0, "warning": 0, "info": 0}
        for entry in findings:
            counts[entry["severity"]] += 1
        return {"ok": counts["error"] == 0, "counts": counts, "findings": findings}
    shape = _shape_issue(profile)
    if shape:
        out.append(_finding("profile.invalid-shape", None, f"{shape}. The runner refuses a profile that is not an exact schema-1 object.",
                            {"reason": shape}))
        return done()
    mismatched = [key for key in PROFILE_PINS if profile[key] != inventory[key]]
    if mismatched:
        out.append(_finding("pins.mismatch", None, f"This profile belongs to a different runtime or inventory revision ({mismatched[0]} "
                            "differs). The runner refuses it; rebase it onto this inventory or start a new profile.",
                            {"pin": mismatched[0], "mismatched": len(mismatched)}))
        return done()
    blocks = {block["id"]: block for block in inventory["blocks"]}
    overrides = {}
    for row in profile["overrides"]:
        block = blocks.get(row["block_id"])
        if block is None:
            out.append(_finding("override.unknown-block", row["block_id"], f'No block "{_masked(row["block_id"], 60)}" exists in this inventory.'))
            continue
        if row["block_id"] in overrides:
            out.append(_finding("override.duplicate", row["block_id"], "This block has more than one override. The runner accepts one per block."))
            continue
        overrides[row["block_id"]] = row
        if row["baseline_sha256"] != block["baseline_sha256"]:
            out.append(_finding("override.baseline-changed", row["block_id"], "This override was written for a different baseline text of the block."))
            continue
        if row["action"] != "keep" and block["capability"] != "patchable":
            out.append(_finding("override.not-patchable", row["block_id"], f"This block is {block['capability']}: it can be kept, not disabled or replaced.",
                                {"capability": block["capability"]}))
            continue
        if row["action"] == "replace":
            found = audit_replacement(block, row["replacement_utf8"], inventory["runtime_id"])
            out.extend(found)
            if (isinstance(row["replacement_utf8"], str) and not any(entry["rule"] == "replacement.invalid-unicode" for entry in found)
                    and sha256_hex(row["replacement_utf8"]) != row["replacement_sha256"]):
                out.append(_finding("override.digest-mismatch", row["block_id"], "The replacement text does not match its recorded SHA-256 "
                                    "digest. The text or the digest was changed after the edit."))
        elif row["action"] == "disable":
            note = _observer_disable(block)
            if note:
                out.append(note)
    security = 0
    for block in inventory["blocks"]:
        if block["capability"] != "patchable":
            continue
        row = overrides.get(block["id"])
        action = (row or {}).get("action") or profile["default_action"]
        if action != "keep" and block["class_name"] == "Security & Safety":
            security += 1
        if row is None and action == "disable":
            note = _observer_disable(block)
            if note:
                out.append(note)
    count = len(profile["overrides"])
    if count > LIMITS["overrides"]:
        out.append(_finding("profile.too-many-overrides", None, f"The profile has {count} overrides; the runner accepts at most {LIMITS['overrides']}.",
                            {"used": count, "max": LIMITS["overrides"], "state": "over"}))
    elif count * 5 >= LIMITS["overrides"] * 4:
        out.append(_finding("profile.too-many-overrides", None, f"The profile has {count} of {LIMITS['overrides']} overrides.",
                            {"used": count, "max": LIMITS["overrides"], "state": "near"}, "warning"))
    size = profile_bytes(profile)
    if size > LIMITS["profile_bytes"]:
        out.append(_finding("profile.too-large", None, f"The canonical profile is {size} bytes; the runner accepts at most "
                            f"{LIMITS['profile_bytes']} (768 KiB).", {"used": size, "max": LIMITS["profile_bytes"], "state": "over"}))
    elif size * 5 >= LIMITS["profile_bytes"] * 4:
        out.append(_finding("profile.too-large", None, f"The canonical profile is {size} of {LIMITS['profile_bytes']} bytes (768 KiB).",
                            {"used": size, "max": LIMITS["profile_bytes"], "state": "near"}, "warning"))
    prompt = context.get("prompt") if isinstance(context.get("prompt"), str) else ""
    if prompt:
        redactions = runner_redaction_matches(prompt)
        for hit in redactions:
            out.append({**_finding("leak.runner-redaction", None, f'The additional instructions contain "{hit["match"]}", which the runner '
                                   "treats as a credential. It refuses the run.", {**hit, "field": "prompt"}), "scope": "profile"})
        if not any(hit["pattern"] == "sk-token" for hit in redactions):
            for hit in gateway_credential_matches(prompt):
                out.append({**_finding("leak.gateway-credential", None, f'The additional instructions contain "{hit["match"]}", which has '
                                       "the shape of a provider key. The hosted service refuses the request.", {**hit, "field": "prompt"}),
                            "scope": "profile"})
    manifest, plan = manifest_bytes_estimate(size, prompt), paired_plan_bytes_estimate(size, prompt)
    if manifest > LIMITS["manifest_bytes"]:
        out.append(_finding("manifest.size-estimate", None, f"Estimate: the run manifest would be about {manifest} bytes; the runner retains "
                            f"at most {LIMITS['manifest_bytes']} (1 MiB).", {"used": manifest, "max": LIMITS["manifest_bytes"], "estimate": True}))
    if plan > LIMITS["plan_bytes"]:
        out.append(_finding("plan.size-estimate", None, f"Estimate: a two-arm plan with this profile would freeze at about {plan} bytes; the "
                            f"runner retains at most {LIMITS['plan_bytes']} (768 KiB).", {"used": plan, "max": LIMITS["plan_bytes"], "estimate": True}))
    if security:
        many = security != 1
        out.append(_finding("class.security-disabled", None, f"{security} fragment{'s' if many else ''} labelled Security & Safety "
                            f"{'are' if many else 'is'} disabled or replaced. The label is a keyword heuristic over block names; runner "
                            "isolation is unchanged.", {"count": security}))
    return done()


# --- macros -------------------------------------------------------------------------------------------

MACROS = (
    {"id": "strip-caps", "title": "Strip emphasis words",
     "description": 'Removes shouted labels such as "IMPORTANT:" and rewrites "MUST NOT", "MUST NEVER", "DO NOT EVER", "YOU MUST" as plain sentences.'},
    {"id": "strip-hedging", "title": "Strip hedging lines",
     "description": 'Removes whole lines that begin with stock assistant phrases such as "As a helpful AI assistant".'},
    {"id": "compact-whitespace", "title": "Compact whitespace",
     "description": "Removes divider lines and trailing spaces, and folds three or more line feeds into two."},
)
_MACRO_IDS = tuple(macro["id"] for macro in MACROS)
# re.ASCII keeps case-insensitive matching to A-Z, as a JavaScript /i pattern without /u does.
_PROTECTED = re.compile(r"```[\s\S]*?```|\$\{TH_PROMPT_EXPR_[0-9]+\}")
_CAPS = re.compile(r"(?<![A-Za-z0-9_])(?:CRITICAL|IMPORTANT|WARNING|MANDATORY|NOTE|STRICTLY|ABSOLUTELY|NEVER EVER)[ \t\n\r\f\v]*:[ \t\n\r\f\v]*",
                   re.IGNORECASE | re.ASCII)
_SHOUT = re.compile(r"(?<![A-Za-z0-9_])(?:MUST NOT|MUST NEVER|DO NOT EVER|YOU MUST|ALWAYS REMEMBER TO)(?![A-Za-z0-9_])")
_SHOUT_WORDS = {"MUST NOT": "Do not", "MUST NEVER": "Never", "DO NOT EVER": "Never", "YOU MUST": "Always", "ALWAYS REMEMBER TO": ""}
_HEDGING = re.compile(r"(?<![^\n])[ \t]*(?:Please note that as an AI|Remember to always be polite|Make sure to apologize|"
                      r"If you are unsure, politely explain|As a helpful AI assistant)[^\n]*\n?", re.IGNORECASE | re.ASCII)
_DIVIDER = re.compile(r"(?<![^\n])[ \t]*[-=_*]{6,}[ \t]*(?![^\n])\n?")
_TRAILING = re.compile(r"(?<![ \t])[ \t]+(?![^\n])")
_BLANK_RUN = re.compile(r"\n{3,}")
_ZERO_DIGEST = "0" * 64


def _rewrite(text, pattern, replacement):
    ranges = [(match.start(), match.end()) for match in _PROTECTED.finditer(text)]
    state = {"at": 0}

    def substitute(match):
        offset, span = match.start(), match.group(0)
        while state["at"] < len(ranges) and ranges[state["at"]][1] <= offset:
            state["at"] += 1
        if state["at"] < len(ranges) and ranges[state["at"]][0] < offset + len(span):
            return span
        return replacement(span) if callable(replacement) else replacement
    return pattern.sub(substitute, text)


def apply_macro(text, macro_id):
    """One macro over one text; the fragment's own outer whitespace is preserved. Raises on an
    unknown id. A macro output is a candidate edit, never a claim that it performs better."""
    if macro_id not in _MACRO_IDS:
        _fail(f"Unknown macro: {macro_id}")
    core = strip_ascii_whitespace(text)
    if not core:
        return text
    start = len(text) - len(text.lstrip(_ASCII_SPACE))
    end = start + len(core)
    if macro_id == "strip-caps":
        body = _rewrite(_rewrite(core, _CAPS, ""), _SHOUT, lambda match: _SHOUT_WORDS[match])
    elif macro_id == "strip-hedging":
        body = _rewrite(core, _HEDGING, "")
    else:
        body = _rewrite(_rewrite(core, _DIVIDER, ""), _TRAILING, "")
    if body == core and macro_id != "compact-whitespace":
        return text
    body = strip_ascii_whitespace(_rewrite(body, _BLANK_RUN, "\n\n"))
    return text[:start] + body + text[end:] if body else ""


class _Projector:
    def __init__(self, inventory, profile):
        self.baselines = {block["id"]: block["baseline_sha256"] for block in inventory["blocks"]}
        self.base = profile_bytes({**profile, "overrides": []})
        self.sizes = {}
        for row in profile["overrides"]:
            self.sizes[row["block_id"]] = override_bytes(row)
        self.total = sum(self.sizes.values())

    def measure(self, total, count):
        size = self.base + total + max(0, count - 1)
        return {"profile_bytes": size, "overrides": count,
                "fits": size <= LIMITS["profile_bytes"] and count <= LIMITS["overrides"]}

    def state(self):
        return self.measure(self.total, len(self.sizes))

    def add(self, edit, commit):
        entry = override_bytes({"block_id": edit["block_id"], "baseline_sha256": self.baselines.get(edit["block_id"]), "action": "replace",
                                "replacement_utf8": edit["replacement_utf8"], "replacement_sha256": _ZERO_DIGEST})
        previous = self.sizes.get(edit["block_id"])
        total = self.total - (previous or 0) + entry
        count = len(self.sizes) + (1 if previous is None else 0)
        if commit:
            self.total = total
            self.sizes[edit["block_id"]] = entry
        return self.measure(total, count)


def generate_macro_edits(inventory, profile, block_ids, macro_ids):
    """Run the macros in order over each block's effective text: {edits, skipped, projected}.
    Byte figures are exact; token figures are estimates."""
    for identifier in macro_ids:
        if identifier not in _MACRO_IDS:
            _fail(f"Unknown macro: {identifier}")
    positions = {block["id"]: index for index, block in enumerate(inventory["blocks"])}
    overrides = {row["block_id"]: row for row in profile["overrides"]}
    codex = inventory["runtime_id"] == "native-codex"
    edits, skipped, seen = [], [], set()
    for block_id in block_ids:
        if block_id in seen:
            continue
        seen.add(block_id)
        block = inventory["blocks"][positions[block_id]] if block_id in positions else None
        if block is None or block["capability"] != "patchable":
            skipped.append({"block_id": block_id, "reason": "not-patchable"})
            continue
        row = overrides.get(block_id)
        action = (row or {}).get("action") or profile["default_action"]
        if action == "disable":
            skipped.append({"block_id": block_id, "reason": "disabled"})
            continue
        source = row["replacement_utf8"] if action == "replace" else block["baseline_utf8"]
        output = source
        for macro in macro_ids:
            output = apply_macro(output, macro)
        reason = None
        if output == source:
            reason = "unchanged"
        elif not output.strip(_ASCII_SPACE):
            reason = "empty-result"
        elif placeholder_sequence(output) != list(block["required_placeholders"]):
            reason = "placeholder-changed"
        elif replacement_issue(output, block["required_placeholders"]):
            reason = "invalid-result"
        elif codex and utf8_bytes(output) > utf8_bytes(block["baseline_utf8"]):
            reason = "over-capacity"
        if reason:
            skipped.append({"block_id": block_id, "reason": reason})
            continue
        edits.append({"block_id": block_id, "replacement_utf8": output, "before_bytes": utf8_bytes(source), "after_bytes": utf8_bytes(output),
                      "before_tokens": estimate_tokens(source), "after_tokens": estimate_tokens(output)})
    edits.sort(key=lambda edit: positions[edit["block_id"]])
    projection = _Projector(inventory, profile)
    for edit in edits:
        projection.add(edit, True)
    return {"edits": edits, "skipped": skipped, "projected": projection.state()}


def fit_macro_edits(inventory, profile, edits):
    """The subset of `edits` that keeps the projected profile within its limits: largest byte
    saving first, inventory order breaking ties; returned in inventory order."""
    positions = {block["id"]: index for index, block in enumerate(inventory["blocks"])}
    ranked = sorted(edits, key=lambda edit: (-(edit["before_bytes"] - edit["after_bytes"]), positions[edit["block_id"]]))
    projection = _Projector(inventory, profile)
    chosen = [edit for edit in ranked if projection.add(edit, False)["fits"] and projection.add(edit, True)]
    return sorted(chosen, key=lambda edit: positions[edit["block_id"]])


PROMPT_ACTIONS = ("keep", "disable", "replace", "restore", "keep-only")


def change_prompt_actions(profile, inventory, ids, action, replacement=None):
    """The browser's bulk action (changePromptActions) on a profile, for the CLI's `profile
    edit`: keep, disable, restore or replace the given patchable blocks, or keep only them.
    Overrides equal to the resulting default are dropped, as in the browser. The result is
    canonicalised by the frozen adapter, so it is exactly what the runner would accept."""
    if action not in PROMPT_ACTIONS:
        _fail("Choose a supported prompt action.")
    targets = {block["id"]: block for block in inventory["blocks"] if block["capability"] == "patchable"}
    if not isinstance(ids, list) or any(block_id not in targets for block_id in ids):
        _fail("Only patchable prompts in this inventory can be changed.")
    if action == "replace":
        if len(ids) != 1 or not isinstance(replacement, str):
            _fail("Replace one prompt with explicit text.")
        issue = replacement_issue(replacement, targets[ids[0]]["required_placeholders"])
        if issue:
            _fail(issue)
    current = canonical_profile(profile, inventory)
    default = current["default_action"]
    changed = {row["block_id"]: row for row in current["overrides"]}
    selected = set(ids)
    every = selected == set(targets)
    if action == "keep-only" or (every and action == "disable"):
        next_default = "disable"
    elif every and action in ("keep", "restore"):
        next_default = "keep"
    else:
        next_default = default
    for block in inventory["blocks"]:
        if block["capability"] != "patchable" or (action != "keep-only" and block["id"] not in selected):
            continue
        step = ("keep" if block["id"] in selected else "disable") if action == "keep-only" else action
        entry = {"block_id": block["id"], "baseline_sha256": block["baseline_sha256"]}
        if step == "disable":
            changed[block["id"]] = {**entry, "action": "disable"}
        elif step == "replace":
            changed[block["id"]] = {**entry, "action": "replace", "replacement_utf8": replacement,
                                    "replacement_sha256": sha256_hex(replacement)}
        elif action == "keep-only" and changed.get(block["id"], {}).get("action") == "replace":
            continue
        else:
            changed[block["id"]] = {**entry, "action": "keep"}
    overrides = []
    for block in inventory["blocks"]:
        if block["capability"] != "patchable":
            continue
        row = changed.get(block["id"]) or {"block_id": block["id"], "baseline_sha256": block["baseline_sha256"], "action": default}
        if row["action"] != next_default:
            overrides.append(row)
    return canonical_profile({**current, "default_action": next_default, "overrides": overrides}, inventory)


def apply_replace_edits(profile, inventory, edits):
    """Commit replacement texts (macro edits or a CLI --replace) to a profile, atomically:
    every edit is checked as the browser's applyReplaceEdits checks it, then the result is
    canonicalised by the frozen adapter. Raises and returns nothing partial on any issue."""
    blocks = {block["id"]: block for block in inventory["blocks"]}
    overrides = {row["block_id"]: row for row in profile["overrides"]}
    for edit in edits:
        block = blocks.get(edit["block_id"])
        if block is None or block["capability"] != "patchable":
            _fail("Only patchable prompts can be replaced.")
        issue = replacement_issue(edit["replacement_utf8"], block["required_placeholders"])
        if issue:
            _fail(issue)
        if inventory["runtime_id"] == "native-codex" and utf8_bytes(edit["replacement_utf8"]) > utf8_bytes(block["baseline_utf8"]):
            _fail("The replacement exceeds this native fragment’s UTF-8 byte capacity.")
        overrides[edit["block_id"]] = {"block_id": block["id"], "baseline_sha256": block["baseline_sha256"], "action": "replace",
                                       "replacement_utf8": edit["replacement_utf8"],
                                       "replacement_sha256": sha256_hex(edit["replacement_utf8"])}
    candidate = {**profile, "overrides": [overrides[block["id"]] for block in inventory["blocks"] if block["id"] in overrides]}
    return canonical_profile(candidate, inventory)


# --- interchange --------------------------------------------------------------------------------------

BUNDLE_KIND = "traceharness.native-prompt-profile-bundle"
PROFILE_FILE_LIMIT = 1572864
BUNDLE_KEYS = ("kind", "bundle_version", "name", "note", "created_at", "tool", "profile_sha256", "profile", "sets")
TOOLS = ("traceharness-ui", "traceharness-cli", "agent-patcher")
_TIME = re.compile(r"([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2}):([0-9]{2})(?:\.([0-9]{1,6}))?Z")
_FORBIDDEN_KEYS = ("__proto__", "constructor", "prototype")
_UNDEFINED = object()


def _iso_time_valid(text):
    """The bundle's created_at check: the browser's pattern plus Date.parse (V8 ranges)."""
    match = _TIME.fullmatch(text)
    if not match:
        return False
    _, month, day, hour, minute, second = (int(part) for part in match.groups()[:6])
    fraction = int(match.group(7) or "0")
    if not (1 <= month <= 12 and 1 <= day <= 31 and minute <= 59 and second <= 59):
        return False
    return hour <= 23 or (hour == 24 and minute == 0 and second == 0 and fraction == 0)


def _iso_now(now):
    if isinstance(now, str):
        if not _iso_time_valid(now):
            _fail("Give the bundle time as an ISO 8601 UTC time such as 2026-11-12T10:00:00.000Z.")
        match = _TIME.fullmatch(now)
        fraction = (match.group(7) or "").ljust(3, "0")[:3]
        return now[:19] + "." + fraction + "Z"
    moment = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    return moment.strftime("%Y-%m-%dT%H:%M:%S.") + "%03dZ" % (moment.microsecond // 1000)


def _set_key(value):
    if not isinstance(value, dict) or "name" not in value:
        return _UNDEFINED
    name = value["name"]
    try:
        hash(name)
    except TypeError:
        return ("unhashable", id(name))
    return ("value", type(name).__name__ if isinstance(name, bool) else "", name)


def _checked_sets(sets):
    message = "The named prompt sets in this file are not valid."
    if not isinstance(sets, list) or len(sets) > 50 or len({_set_key(entry) for entry in sets}) != len(sets):
        _fail(message)
    out = []
    for entry in sets:
        if (not _exact_keys(entry, ("name", "block_ids")) or not isinstance(entry["name"], str) or not _js_trim(entry["name"])
                or _u16len(entry["name"]) > 160 or _has_category(entry["name"], ("Cc", "Cf", "Cs"))
                or _SK_TOKEN_ASCII.search(entry["name"]) or not isinstance(entry["block_ids"], list) or len(entry["block_ids"]) > 20000
                or any(not isinstance(item, str) or not item or _u16len(item) > 240 for item in entry["block_ids"])
                or len(set(entry["block_ids"])) != len(entry["block_ids"])):
            _fail(message)
        out.append({"name": entry["name"], "block_ids": list(entry["block_ids"])})
    return out


def _checked_profile(value):
    profile = checked_native_profile(value)
    for row in profile["overrides"]:
        if row["action"] == "replace" and _sha256_js(row["replacement_utf8"]) != row["replacement_sha256"]:
            _fail("A replacement in this file does not match its SHA-256 digest. The file was changed after it was written.")
    return ordered_profile(profile)


def make_bundle(options):
    """A bundle around a profile: {kind, bundle_version, name, note, created_at, tool,
    profile_sha256, profile, sets}. `now` may be a datetime or an ISO 8601 UTC string."""
    options = options if isinstance(options, dict) else {}
    name = _js_trim(options["name"]) if isinstance(options.get("name"), str) else ""
    note = options.get("note", "")
    if profile_name_issue(name):
        _fail(profile_name_issue(name))
    if library_note_issue(note):
        _fail(library_note_issue(note))
    tool = options.get("tool", "traceharness-ui")
    if tool not in TOOLS:
        _fail("Name the tool that writes this bundle.")
    profile = _checked_profile(options.get("profile"))
    created = _iso_now(options.get("now"))
    return {"kind": BUNDLE_KIND, "bundle_version": 1, "name": name, "note": note, "created_at": created, "tool": tool,
            "profile_sha256": profile_sha256(profile), "profile": profile, "sets": _checked_sets(options.get("sets", []))}


def profile_file_name(profile, profile_sha, kind="profile"):
    if (not isinstance(profile, dict) or profile.get("runtime_id") not in RUNTIMES or not isinstance(profile_sha, str)
            or not _HASH.fullmatch(profile_sha)):
        _fail("A profile file name needs a native runtime and a SHA-256 digest.")
    return f"native-prompt-profile-{'bundle-' if kind == 'bundle' else ''}{profile['runtime_id']}-{profile_sha[:12]}.json"


def serialize_profile_file(value):
    """File text. Profile: canonical JSON and a line feed. Bundle: two-space JSON in the
    documented key order and a line feed. Identical bytes to the browser's export."""
    if isinstance(value, dict) and value.get("kind") == BUNDLE_KIND:
        bundle = {key: ordered_profile(value["profile"]) if key == "profile" else value.get(key) for key in BUNDLE_KEYS}
        return _js_stringify(bundle, indent=2) + "\n"
    return canonical_json(value) + "\n"


def _assert_plain_tree(value):
    stack, nodes = [(value, 0)], 0
    while stack:
        item, depth = stack.pop()
        if not isinstance(item, (dict, list)):
            continue
        if depth > 12:
            _fail("This file is nested too deeply to be a profile file.")
        nodes += 1
        if nodes > 200000:
            _fail("This file has too many values to be a profile file.")
        if isinstance(item, list):
            stack.extend((child, depth + 1) for child in item)
            continue
        for key in _js_keys(item):
            if key in _FORBIDDEN_KEYS:
                _fail("This file contains a key that a profile file cannot have.")
            stack.append((item[key], depth + 1))


def _reject_constant(_):
    raise ValueError("Non-JSON constant")


# json.loads and JSON.parse disagree on 1.0 (float against the number 1); the runner refuses a float
# schema_version. The raw text decides, exactly as interchange.js fractionalVersionKey does.
_KEY_THEN_NUMBER = re.compile(r'("[^"\\]*(?:\\.[^"\\]*)*")(?:[ \t\n\r]*:[ \t\n\r]*(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?))?')
_WHOLE_NUMBER_KEYS = ("schema_version", "bundle_version")


def fractional_version_key(text):
    """The first of schema_version / bundle_version written with a fraction or an exponent, or ''."""
    for match in _KEY_THEN_NUMBER.finditer(text):
        number = match.group(2)
        if number is None or not any(mark in number for mark in ".eE"):
            continue
        key = json.loads(match.group(1))
        if key in _WHOLE_NUMBER_KEYS:
            return key
    return ""


def parse_profile_document(text):
    """Read a profile file: {kind, profile, blocks, name, note, sets} where kind is
    'profile', 'bundle', 'configuration' or 'agent-patcher-blocks'. Raises ToolError with
    the browser's sentence. Size limit 1.5 MiB; plain JSON only; nothing is executed."""
    if not isinstance(text, str):
        _fail("Choose a JSON file.")
    if _u16len(text) > PROFILE_FILE_LIMIT or utf8_bytes(text) > PROFILE_FILE_LIMIT:
        _fail("This file is larger than 1.5 MiB. A profile file cannot be that large.")
    try:
        data = json.loads(text, parse_constant=_reject_constant)
    except RecursionError:
        _fail("This file is nested too deeply to be a profile file.")
    except ValueError:
        _fail("This file is not valid JSON.")
    _assert_plain_tree(data)
    fractional = fractional_version_key(text)
    if fractional:
        _fail(f"This file writes {fractional} with a fraction or an exponent. Write it as a whole number, for example 1.")
    if isinstance(data, list):
        if len(data) > 20000:
            _fail("This block dump has more than 20,000 blocks.")
        blocks = []
        for row in data:
            if (not isinstance(row, dict) or not isinstance(row.get("id"), str) or not row["id"] or _u16len(row["id"]) > 256
                    or not isinstance(row.get("body"), str) or any(key not in ("id", "body", "source_path") for key in row)
                    or ("source_path" in row and not isinstance(row["source_path"], str))):
                _fail("This list is not an agent-patcher block dump: every entry needs a text id and a text body.")
            blocks.append({"id": row["id"], "body": row["body"]})
        return {"kind": "agent-patcher-blocks", "profile": None, "blocks": blocks, "name": "", "note": "", "sets": []}
    if not isinstance(data, dict):
        _fail("This file is not a native prompt profile, bundle, configuration export or agent-patcher block dump.")
    if data.get("kind") == BUNDLE_KIND:
        if not _exact_keys(data, BUNDLE_KEYS):
            _fail("This bundle has missing or unknown fields. A bundle has exactly: " + ", ".join(BUNDLE_KEYS) + ".")
        if not _js_is(data["bundle_version"], 1):
            _fail("This bundle version is not supported. This workbench reads bundle version 1.")
        if profile_name_issue(data["name"]):
            _fail(profile_name_issue(data["name"]))
        if library_note_issue(data["note"]):
            _fail(library_note_issue(data["note"]))
        if not isinstance(data["created_at"], str) or not _iso_time_valid(data["created_at"]):
            _fail("This bundle has no valid creation time.")
        if data["tool"] not in TOOLS:
            _fail("This bundle does not name a known writing tool.")
        if not isinstance(data["profile_sha256"], str) or not _HASH.fullmatch(data["profile_sha256"]):
            _fail("This bundle has no valid profile digest.")
        profile = _checked_profile(data["profile"])
        if profile_sha256(profile) != data["profile_sha256"]:
            _fail("This bundle’s profile does not match its recorded digest. The file was changed after it was written.")
        return {"kind": "bundle", "profile": profile, "blocks": None, "name": data["name"], "note": data["note"],
                "sets": _checked_sets(data["sets"])}
    if "version" in data and "runtime_id" in data and "schema_version" not in data:
        if not _js_is(data["version"], 2) or "native_prompt_profile" not in data:
            _fail("This configuration has no native prompt profile. Export one from a run that uses a profile.")
        profile = _checked_profile(data["native_prompt_profile"])
        if profile["runtime_id"] != data["runtime_id"]:
            _fail("This configuration names a different runtime than its native prompt profile.")
        return {"kind": "configuration", "profile": profile, "blocks": None, "name": "", "note": "", "sets": []}
    if "schema_version" in data:
        return {"kind": "profile", "profile": _checked_profile(data), "blocks": None, "name": "", "note": "", "sets": []}
    _fail("This file is not a native prompt profile, bundle, configuration export or agent-patcher block dump.")


def profile_from_agent_patcher_blocks(blocks, inventory):
    """Map an agent-patcher block dump onto an inventory: equal body keeps, empty body
    disables, other text replaces; every skipped entry is reported, nothing is guessed."""
    known = {block["id"]: block for block in inventory["blocks"]}
    codex = inventory["runtime_id"] == "native-codex"
    report = {"total": len(blocks), "keep": 0, "disable": 0, "replace": 0, "skipped": []}
    overrides, seen = {}, set()
    for row in blocks:
        block = known.get(row["id"])

        def skip(reason, row=row):
            report["skipped"].append({"id": row["id"], "reason": reason})
        if block is None:
            skip("unknown-block")
            continue
        if row["id"] in seen:
            skip("duplicate-id")
            continue
        seen.add(row["id"])
        body = row["body"]
        if body == block["baseline_utf8"]:
            report["keep"] += 1
            continue
        if block["capability"] != "patchable":
            skip("not-patchable")
            continue
        if not body.strip(_ASCII_SPACE):
            report["disable"] += 1
            overrides[block["id"]] = {"block_id": block["id"], "baseline_sha256": block["baseline_sha256"], "action": "disable"}
            continue
        if block["required_placeholders"]:
            skip("placeholder-names-differ")
            continue
        if placeholder_sequence(body) or replacement_issue(body, []):
            skip("invalid-replacement")
            continue
        if codex and utf8_bytes(body) > utf8_bytes(block["baseline_utf8"]):
            skip("over-capacity")
            continue
        report["replace"] += 1
        overrides[block["id"]] = {"block_id": block["id"], "baseline_sha256": block["baseline_sha256"], "action": "replace",
                                  "replacement_utf8": body, "replacement_sha256": sha256_hex(body)}
    profile = {**baseline_profile(inventory),
               "overrides": [overrides[block["id"]] for block in inventory["blocks"] if block["id"] in overrides]}
    return {"profile": profile, "report": report}


def agent_patcher_blocks_from_profile(profile, inventory):
    """The reverse: one entry per inventory block with the text the profile gives it ('' when
    disabled). A replaced block with native placeholders is not written and is listed."""
    overrides = {row["block_id"]: row for row in profile["overrides"]}
    blocks, skipped = [], []
    for block in inventory["blocks"]:
        row = overrides.get(block["id"])
        action = (row or {}).get("action") or (profile["default_action"] if block["capability"] == "patchable" else "keep")
        if action == "replace" and block["required_placeholders"] and row["replacement_utf8"] != block["baseline_utf8"]:
            skipped.append({"id": block["id"], "reason": "placeholder-names-differ"})
            continue
        body = "" if action == "disable" else row["replacement_utf8"] if action == "replace" else block["baseline_utf8"]
        blocks.append({"id": block["id"], "body": body, "source_path": ""})
    return {"blocks": blocks, "skipped": skipped}


# --- paired experiment statistics ---------------------------------------------------------------------

_Z_95 = 1.959963984540054
_USAGE_KEYS = ("cost_usd", "input_tokens", "output_tokens", "requests")
_OUTCOME_KEYS = ("passed", "failed", "ungraded", "refused", "cancelled", "needs_attention", "unfinished")
_PAIR_KEYS = ("planned_pairs", "graded_pairs", "both_pass", "both_fail", "reference_only_pass", "variant_only_pass", "incomplete_pairs")
_GRADES = ("passed", "failed", "ungraded", "error")
EXPERIMENT_CAVEATS = (
    "One task: these trials say nothing about other tasks.",
    "Repetitions are repeated runs of the same task, not independent tasks.",
    "Model sampling is not controlled: the schedule seed fixes the order of trials, not the model’s output.",
    "A completed schedule is not a passed task: read the outcome counts.",
    "This comparison does not show that an intervention improves task performance.",
)


def _is_count(value):
    """JavaScript Number.isSafeInteger(value) && value >= 0 (2.0 counts, as it does in JavaScript)."""
    return (_is_number(value) and math.isfinite(value) and float(value).is_integer() and 0 <= value <= 9007199254740991)


def wilson_interval(successes, n):
    """Wilson score interval at 95 %; None when n is 0 or the inputs are not counts with successes <= n."""
    if not (_is_count(successes) and _is_count(n)) or n == 0 or successes > n:
        return None
    p, z2 = successes / n, _Z_95 * _Z_95
    denominator = 1 + z2 / n
    centre = (p + z2 / (2 * n)) / denominator
    half = _Z_95 * math.sqrt(p * (1 - p) / n + z2 / (4 * n * n)) / denominator
    return [0 if successes == 0 else max(0, centre - half), 1 if successes == n else min(1, centre + half)]


def mcnemar_exact_p(b, c):
    """Exact two-sided McNemar probability on b and c discordant pairs; None when b + c is 0 or an
    input is not a count. Above 1,000 pairs the tail is summed in log space (0.5 ** n underflows)."""
    if not (_is_count(b) and _is_count(c)):
        return None
    b, c = int(b), int(c)
    n = b + c
    if n == 0:
        return None
    k = min(b, c)
    if n <= 1000:
        term = math.pow(0.5, n)
        total = term
        for index in range(1, k + 1):
            term = term * (n - index + 1) / index
            total += term
        return min(1, 2 * total)
    logs = [-n * math.log(2)]
    for index in range(1, k + 1):
        logs.append(logs[index - 1] + math.log(n - index + 1) - math.log(index))
    top = logs[k]
    scaled = 0.0
    for value in logs:
        scaled += math.exp(value - top)
    return min(1, 2 * math.exp(top + math.log(scaled)))


def smallest_reachable_p(discordant):
    return min(1, 2 * math.pow(0.5, discordant)) if _is_count(discordant) and discordant > 0 else None


def _job(trial):
    job = trial.get("job") if isinstance(trial, dict) else None
    return job if isinstance(job, dict) else {}


def _grade_of(trial):
    if not isinstance(trial, dict):
        return None
    job = _job(trial)
    if trial.get("status") in ("succeeded", "failed") and job.get("status") in ("succeeded", "failed") and job.get("grade") in ("passed", "failed"):
        return job["grade"]
    return None


def trial_outcome(trial):
    grade = _grade_of(trial)
    if grade:
        return grade
    status = trial.get("status") if isinstance(trial, dict) else None
    if status in ("refused", "cancelled", "needs_attention"):
        return status
    return "ungraded" if status in ("succeeded", "failed") else "unfinished"


def _reported(trial, key):
    usage = _job(trial).get("usage")
    value = usage.get(key) if isinstance(usage, dict) else None
    return value if _is_number(value) and math.isfinite(value) and value >= 0 else None


def _spread(values):
    if not values:
        return {"min": None, "median": None, "max": None}
    ordered = sorted(values)
    middle = len(ordered) >> 1
    median = ordered[middle] if len(ordered) % 2 else (ordered[middle - 1] + ordered[middle]) / 2
    return {"min": ordered[0], "median": median, "max": ordered[-1]}


def _profile_summary(arm):
    configuration = arm.get("configuration") if isinstance(arm, dict) else None
    profile = configuration.get("native_prompt_profile") if isinstance(configuration, dict) else None
    profile = profile if isinstance(profile, dict) else {}
    overrides = profile.get("overrides") if isinstance(profile.get("overrides"), list) else []

    def count(action):
        return sum(1 for row in overrides if isinstance(row, dict) and row.get("action") == action)
    summary = {"default_action": "disable" if profile.get("default_action") == "disable" else "keep", "overrides": len(overrides),
               "replace": count("replace"), "disable": count("disable"), "keep": count("keep")}
    summary["is_baseline"] = summary["default_action"] == "keep" and summary["replace"] == 0 and summary["disable"] == 0
    return summary


def _issues(trial):
    def listed(value):
        if isinstance(value, list):
            return value
        if isinstance(value, str):
            return list(value)
        return []
    own = listed(trial.get("issues")) if isinstance(trial, dict) else []
    job = trial.get("job") if isinstance(trial, dict) else None
    from_job = listed(job.get("issues")) if isinstance(job, dict) else []
    return [issue for issue in own + from_job if isinstance(issue, str)]


def _trial_key(arm_id, repeat):
    return _js_str(arm_id) + "\n" + _js_str(repeat)


def experiment_outcomes(experiment):
    """Every outcome of a paired experiment: arms, matrix, comparisons, caveats. For every
    arm the seven outcome counts add up to the planned trials; nothing is filtered."""
    plan = experiment["plan"]
    repeats = plan["repeats"]
    reference_id = plan.get("reference_arm_id")
    if reference_id is None:
        reference_id = plan["arms"][0]["id"] if plan["arms"] else None
    trials = {}
    for trial in experiment["trials"]:
        trials[_trial_key(trial.get("arm_id"), trial.get("repeat"))] = trial

    def trial_of(arm_id, repeat):
        return trials.get(_trial_key(arm_id, repeat))
    rounds = list(range(1, repeats + 1))
    arms = []
    for arm in plan["arms"]:
        row = {"arm_id": arm["id"], "label": arm["label"], "reference": arm["id"] == reference_id, "planned": repeats}
        for key in _OUTCOME_KEYS:
            row[key] = 0
        for repeat in rounds:
            row[trial_outcome(trial_of(arm["id"], repeat))] += 1
        row["graded"] = row["passed"] + row["failed"]
        row["pass_rate_of_graded"] = row["passed"] / row["graded"] if row["graded"] else None
        row["pass_rate_of_planned"] = row["passed"] / repeats if repeats else 0
        row["pass_interval_95"] = wilson_interval(row["passed"], row["graded"])
        row["profile"] = _profile_summary(arm)
        usage = {}
        for key in _USAGE_KEYS:
            values = [value for value in (_reported(trial_of(arm["id"], repeat), key) for repeat in rounds) if value is not None]
            usage[key] = {"reported": len(values), "of": repeats, **_spread(values)}
        row["usage"] = usage
        arms.append(row)
    matrix = []
    for repeat in rounds:
        cells = {}
        for arm in plan["arms"]:
            trial = trial_of(arm["id"], repeat)
            job = trial.get("job") if isinstance(trial, dict) and isinstance(trial.get("job"), dict) else None
            trial = trial if isinstance(trial, dict) else None
            index = trial.get("index") if trial else None
            trial_id = trial.get("id") if trial else None
            status = trial.get("status") if trial else None
            cells[arm["id"]] = {"trial_id": "" if trial_id is None else trial_id,
                                "order": int(index) + 1 if _is_safe_integer(index) else 0,
                                "status": "missing" if status is None else status,
                                "grade": job["grade"] if job and job.get("grade") in _GRADES else None,
                                "job_id": trial.get("job_id") if trial and trial.get("job_id") is not None else None,
                                "cost_usd": _reported(trial, "cost_usd"), "input_tokens": _reported(trial, "input_tokens"),
                                "output_tokens": _reported(trial, "output_tokens"), "requests": _reported(trial, "requests"),
                                "issues": _issues(trial)}
        matrix.append({"repeat": repeat, "cells": cells})
    summary = experiment.get("summary")
    runner_rows = summary.get("comparisons") if isinstance(summary, dict) and isinstance(summary.get("comparisons"), list) else []
    comparisons = []
    for arm in plan["arms"]:
        if arm["id"] == reference_id:
            continue
        client = {key: 0 for key in _PAIR_KEYS}
        client["planned_pairs"] = repeats
        for repeat in rounds:
            reference, variant = _grade_of(trial_of(reference_id, repeat)), _grade_of(trial_of(arm["id"], repeat))
            if reference is None or variant is None:
                client["incomplete_pairs"] += 1
                continue
            client["graded_pairs"] += 1
            if reference == variant:
                client["both_pass" if reference == "passed" else "both_fail"] += 1
            else:
                client["reference_only_pass" if reference == "passed" else "variant_only_pass"] += 1
        found = next((entry for entry in runner_rows if isinstance(entry, dict) and entry.get("arm_id") == arm["id"]), None)
        runner = None
        if found is not None:
            runner = {"planned_pairs": found.get("planned_pairs"), "graded_pairs": found.get("graded_pairs"), "both_pass": found.get("both_pass"),
                      "both_fail": found.get("both_fail"), "reference_only_pass": found.get("control_only_pass"),
                      "variant_only_pass": found.get("variant_only_pass"), "incomplete_pairs": found.get("incomplete_pairs")}
        usable = runner is not None and all(_is_safe_integer(runner[key]) and runner[key] >= 0 for key in _PAIR_KEYS)
        shown = runner if usable else client
        discordant = shown["reference_only_pass"] + shown["variant_only_pass"]
        delta = {}
        for key in _USAGE_KEYS:
            values = []
            for repeat in rounds:
                reference, variant = _reported(trial_of(reference_id, repeat), key), _reported(trial_of(arm["id"], repeat), key)
                if reference is not None and variant is not None:
                    values.append(variant - reference)
            delta[key] = {"pairs": len(values), "of": repeats, **_spread(values)}
        comparisons.append({"arm_id": arm["id"], "label": arm["label"], **shown, "discordant": discordant,
                            "mcnemar_exact_p": mcnemar_exact_p(shown["reference_only_pass"], shown["variant_only_pass"]),
                            "smallest_reachable_p": smallest_reachable_p(discordant),
                            "agrees_with_runner": usable and all(runner[key] == client[key] for key in _PAIR_KEYS),
                            "source": "runner" if usable else "client", "client_counts": client, "paired_delta": delta})
    return {"arms": arms, "matrix": matrix, "comparisons": comparisons, "caveats": list(EXPERIMENT_CAVEATS)}


def fixed_decimals(value, digits):
    """Half-up fixed decimals, identical to the browser's (toFixed and format disagree on ties)."""
    scale = 10 ** digits
    scaled = math.floor(abs(value) * scale + 0.5)
    whole = math.floor(scaled / scale)
    text = f"{whole}.{str(scaled - whole * scale).rjust(digits, '0')}" if digits else str(whole)
    return "-" + text if value < 0 and scaled != 0 else text


_CSV_COLUMNS = ("execution_order", "repeat", "arm_id", "arm_label", "role", "outcome", "trial_status", "job_status", "grade", "cost_usd",
                "input_tokens", "output_tokens", "requests", "trial_id", "job_id", "manifest_sha256", "issues")
_FORMULA = re.compile(r"[=+\-@\t\r]")
_CSV_QUOTE = re.compile(r'[",\r\n]')


def _csv_cell(value):
    if value is None or value is _UNDEFINED:
        return ""
    if _is_number(value):
        return _js_number(value)
    text = _js_str(value)
    if _FORMULA.match(text):
        text = "'" + text
    return '"' + text.replace('"', '""') + '"' if _CSV_QUOTE.search(text) else text


def experiment_csv(experiment):
    """One row per scheduled trial, RFC 4180 quoting, CRLF line ends; missing measurements
    are empty cells, never 0; formula-like text is prefixed with an apostrophe."""
    plan = experiment["plan"]
    labels = {arm["id"]: arm["label"] for arm in plan["arms"]}
    reference_id = plan.get("reference_arm_id")
    if reference_id is None:
        reference_id = plan["arms"][0]["id"] if plan["arms"] else None
    lines = [",".join(_CSV_COLUMNS)]
    for trial in experiment["trials"]:
        job = trial.get("job") if isinstance(trial.get("job"), dict) else None
        index = trial.get("index")
        row = {"execution_order": index + 1 if _is_number(index) else None, "repeat": trial.get("repeat"), "arm_id": trial.get("arm_id"),
               "arm_label": labels.get(trial.get("arm_id"), ""), "role": "reference" if trial.get("arm_id") == reference_id else "variant",
               "outcome": trial_outcome(trial), "trial_status": trial.get("status"),
               "job_status": job.get("status", "") if job and job.get("status") is not None else "",
               "grade": job["grade"] if job and job.get("grade") in _GRADES else "", "cost_usd": _reported(trial, "cost_usd"),
               "input_tokens": _reported(trial, "input_tokens"), "output_tokens": _reported(trial, "output_tokens"),
               "requests": _reported(trial, "requests"), "trial_id": trial.get("id"),
               "job_id": trial.get("job_id") if trial.get("job_id") is not None else "", "manifest_sha256": trial.get("manifest_sha256"),
               "issues": " | ".join(_issues(trial))}
        lines.append(",".join(_csv_cell(row[column]) for column in _CSV_COLUMNS))
    return "\r\n".join(lines) + "\r\n"


_MD_ESCAPE = re.compile(r"[\\|<>`*_\[\]]")
_MD_BREAK = re.compile(r"[\r\n]+")
_OUTCOME_WORDS = {"passed": "passed", "failed": "failed", "ungraded": "ungraded", "refused": "refused", "cancelled": "cancelled",
                  "needs_attention": "needs attention", "unfinished": "not finished"}
_USAGE_WORDS = {"cost_usd": "Reported cost (USD)", "input_tokens": "Input tokens (measured)", "output_tokens": "Output tokens (measured)",
                "requests": "Model requests (measured)"}


def _md_text(value):
    return _MD_BREAK.sub(" ", _MD_ESCAPE.sub(lambda match: "\\" + match.group(0), _js_str(value)))


def _md_row(cells):
    return "| " + " | ".join(_js_str(cell) for cell in cells) + " |"


def _md_count(value):
    if value is None:
        return "not reported"
    if isinstance(value, int) or (isinstance(value, float) and value.is_integer()):
        return _js_number(value)
    return fixed_decimals(value, 1)


def _md_money(value):
    return "not reported" if value is None else "$" + fixed_decimals(value, 4)


def _ordinal(value):
    suffix = "th" if 11 <= value % 100 <= 13 else ("th", "st", "nd", "rd")[value % 10] if value % 10 < 4 else "th"
    return f"{value}{suffix}"


def experiment_markdown(experiment):
    """The whole summary as Markdown: outcomes over all planned trials, every trial, each
    variant against the reference with exact probabilities, measured usage, the caveats."""
    plan = experiment["plan"]
    outcomes = experiment_outcomes(experiment)

    def amount(key, value):
        return _md_money(value) if key == "cost_usd" else _md_count(value)
    repeats = plan["repeats"]
    lines = [f"# Paired experiment: {_md_text(plan.get('name', 'undefined'))}", "",
             f"- Experiment {_js_str(experiment.get('id', 'undefined'))}, status {_js_str(experiment.get('status', 'undefined')).replace('_', ' ')}",
             f"- Frozen plan SHA-256 {_js_str(experiment.get('plan_sha256', 'undefined'))}",
             (f"- {_js_str(repeats)} repetition{'' if repeats == 1 else 's'} of {len(plan['arms'])} arms: {len(experiment['trials'])} scheduled trials, "
              f"schedule seed {_js_str(plan.get('seed', 'undefined'))}"),
             f"- Worst-case cost {_md_money(experiment.get('maximum_cost_usd'))} (sum of per-trial caps, not a forecast)", "",
             "## Outcomes per arm, over all planned trials", "",
             _md_row(["Arm", "Role", "Planned", "Passed", "Failed", "Ungraded or grading error", "Refused", "Cancelled", "Needs attention",
                      "Not finished", "Pass rate of graded", "Pass rate of planned", "95% interval (Wilson, graded trials)"]),
             _md_row(["---"] * 13)]
    for arm in outcomes["arms"]:
        kind = "baseline" if arm["profile"]["is_baseline"] else "edited"
        interval = arm["pass_interval_95"]
        lines.append(_md_row([_md_text(arm["label"]), f"reference, {kind}" if arm["reference"] else f"variant, {kind}",
                              arm["planned"], arm["passed"], arm["failed"], arm["ungraded"], arm["refused"], arm["cancelled"],
                              arm["needs_attention"], arm["unfinished"],
                              "no graded trial" if arm["pass_rate_of_graded"] is None
                              else f"{arm['passed']} of {arm['graded']} ({fixed_decimals(arm['pass_rate_of_graded'], 3)})",
                              f"{arm['passed']} of {arm['planned']} ({fixed_decimals(arm['pass_rate_of_planned'], 3)})",
                              "no graded trial" if interval is None else f"{fixed_decimals(interval[0], 3)} to {fixed_decimals(interval[1], 3)}"]))
    lines += ["", "## Every trial, by repetition", "",
              _md_row(["Repetition", "Arm", "Outcome", "Reported cost (USD)", "Input tokens", "Output tokens", "Requests", "Ran", "Notes"]),
              _md_row(["---"] * 9)]
    for round_row in outcomes["matrix"]:
        for arm in plan["arms"]:
            cell = round_row["cells"][arm["id"]]
            trial = next((entry for entry in experiment["trials"] if entry.get("id") == cell["trial_id"]), None) or {"status": cell["status"]}
            lines.append(_md_row([round_row["repeat"], _md_text(arm["label"]), _OUTCOME_WORDS[trial_outcome(trial)], _md_money(cell["cost_usd"]),
                                  _md_count(cell["input_tokens"]), _md_count(cell["output_tokens"]), _md_count(cell["requests"]),
                                  _ordinal(cell["order"]) if cell["order"] else "not scheduled",
                                  _md_text(" / ".join(cell["issues"])) if cell["issues"] else ""]))
    lines += ["", "## Each variant against the reference", ""]
    if not outcomes["comparisons"]:
        lines += ["No variant arm.", ""]
    for row in outcomes["comparisons"]:
        discordant = row["discordant"]
        if row["source"] == "runner":
            source = ("- Pair counts are the runner’s and match a recount of the trials above" if row["agrees_with_runner"]
                      else "- Pair counts are the runner’s. A recount of the trials above differs: "
                      + ", ".join(f"{key.replace('_', ' ')} {row['client_counts'][key]}" for key in _PAIR_KEYS))
        else:
            source = "- The runner reported no pair counts for this arm; these are a recount of the trials above"
        lines += [f"### {_md_text(row['label'])}", "",
                  f"- Planned pairs {_js_str(row['planned_pairs'])}, graded pairs {_js_str(row['graded_pairs'])}, incomplete pairs {_js_str(row['incomplete_pairs'])}",
                  (f"- Both pass {_js_str(row['both_pass'])}, both fail {_js_str(row['both_fail'])}, reference only {_js_str(row['reference_only_pass'])}, "
                   f"variant only {_js_str(row['variant_only_pass'])}"),
                  f"- Discordant pairs {_js_str(discordant)}; exact two-sided McNemar probability {fixed_decimals(row['mcnemar_exact_p'], 4)}" if discordant
                  else "- Discordant pairs 0; no exact probability can be computed",
                  (f"- With {_js_str(discordant)} discordant pair{'' if discordant == 1 else 's'} the smallest reachable probability is "
                   f"{fixed_decimals(row['smallest_reachable_p'], 4)}"
                   + (" (fewer than six discordant pairs cannot go below 0.05)" if discordant < 6 else "")) if discordant
                  else "- With no discordant pair the trials do not separate the arms",
                  source, ""]
    lines += ["## Measured usage per arm", "", _md_row(["Arm", "Measure", "Trials that reported", "Minimum", "Median", "Maximum"]),
              _md_row(["---"] * 6)]
    for arm in outcomes["arms"]:
        for key in _USAGE_KEYS:
            stat = arm["usage"][key]
            lines.append(_md_row([_md_text(arm["label"]), _USAGE_WORDS[key], f"{stat['reported']} of {stat['of']}",
                                  amount(key, stat["min"]), amount(key, stat["median"]), amount(key, stat["max"])]))
    lines += ["", "## Paired differences, variant minus reference", "",
              _md_row(["Variant", "Measure", "Repetitions where both reported", "Minimum", "Median", "Maximum"]), _md_row(["---"] * 6)]
    for row in outcomes["comparisons"]:
        for key in _USAGE_KEYS:
            stat = row["paired_delta"][key]

            def difference(value, key=key):
                if value is None:
                    return "not reported"
                text = fixed_decimals(value, 4) if key == "cost_usd" else _md_count(value)
                return "+" + text if value > 0 else text
            lines.append(_md_row([_md_text(row["label"]), _USAGE_WORDS[key], f"{stat['pairs']} of {stat['of']}",
                                  difference(stat["min"]), difference(stat["median"]), difference(stat["max"])]))
    lines += ["", "## Caveats", "", *("- " + caveat for caveat in outcomes["caveats"]), ""]
    return "\n".join(lines)
