"""Golden fixtures shared by the browser and the CLI (traceharness/frontend/test/native-golden).

Run normally, every case of every golden file is recomputed with the Python mirror
(runner_service/native_prompt_tools.py) and compared with its recorded `expected` value.
With TH_UPDATE_NATIVE_GOLDEN=1 the files are rewritten from the case definitions below;
the result is reviewed by eye and must then be reproduced, without edits, by the
JavaScript implementation (src/rig/native/golden.test.js).

All content is fabricated for these tests. None of it is native prompt text.
The school package does not ship traceharness/frontend/test, so the test skips when the
golden directory is absent.
"""
from __future__ import annotations

import copy
import hashlib
import json
import re
import math
import os
from pathlib import Path
import unittest

from traceharness.runner_service import experiments as E
from traceharness.runner_service import native_prompt_tools as T
from traceharness.runner_service import native_prompts as N
from traceharness.runner_service import native_prompts_codex as C

GOLDEN = Path(__file__).resolve().parents[1] / "traceharness" / "frontend" / "test" / "native-golden"
UPDATE = os.environ.get("TH_UPDATE_NATIVE_GOLDEN") == "1"

FUNCTIONS = {
    "utf8_bytes": T.utf8_bytes, "code_points": T.code_points, "line_count": T.line_count,
    "estimate_tokens": T.estimate_tokens, "text_metrics": T.text_metrics,
    "canonical_json": T.canonical_json, "canonical_profile": T.canonical_profile, "profile_sha256": T.profile_sha256,
    "profile_bytes": T.profile_bytes, "resolve_actions": T.resolve_actions, "effective_text": T.effective_text,
    "profile_counts": T.profile_counts, "rebase_profile": T.rebase_profile,
    "parse_query": T.parse_query, "search_inventory": T.search_inventory,
    "diff_text": T.diff_text, "diff_profiles": T.diff_profiles,
    "audit_replacement": T.audit_replacement, "audit_profile": T.audit_profile,
    "profile_budget": T.profile_budget, "plan_budget": T.plan_budget,
    "apply_macro": T.apply_macro, "generate_macro_edits": T.generate_macro_edits, "fit_macro_edits": T.fit_macro_edits,
    "make_bundle": T.make_bundle, "parse_profile_document": T.parse_profile_document,
    "profile_file_name": T.profile_file_name, "serialize_profile_file": T.serialize_profile_file,
    "profile_from_agent_patcher_blocks": T.profile_from_agent_patcher_blocks,
    "agent_patcher_blocks_from_profile": T.agent_patcher_blocks_from_profile,
    "wilson_interval": T.wilson_interval, "mcnemar_exact_p": T.mcnemar_exact_p, "smallest_reachable_p": T.smallest_reachable_p,
    "experiment_outcomes": T.experiment_outcomes, "experiment_csv": T.experiment_csv,
    "experiment_markdown": T.experiment_markdown,
}
FIXTURE_FILES = ("inventory-claude", "inventory-claude-next", "inventory-codex", "inventory-large", "profile-large-over")


# --- shared helpers (used by the generator and the checker) -------------------------------------------

def expand(value, fixtures):
    """Resolve "@<fixture>" strings and {"@repeat": text, "times": n} objects."""
    if isinstance(value, str) and value.startswith("@") and value[1:] in fixtures:
        return copy.deepcopy(fixtures[value[1:]])
    if isinstance(value, list):
        return [expand(item, fixtures) for item in value]
    if isinstance(value, dict):
        if set(value) == {"@repeat", "times"}:
            return value["@repeat"] * value["times"]
        return {key: expand(item, fixtures) for key, item in value.items()}
    return value


def run_case(function, args, fixtures):
    try:
        return FUNCTIONS[function](*expand(args, fixtures))
    except (T.ToolError, N.NativePromptError) as error:
        return {"error": str(error)}


def jsonable(value):
    return json.loads(json.dumps(value))


def same(left, right, path="$"):
    """Exact equality, except numbers that are not integers compare within 1e-9."""
    if isinstance(left, bool) or isinstance(right, bool):
        return (left is right) or (path + f": {left!r} != {right!r}")
    if isinstance(left, (int, float)) and isinstance(right, (int, float)):
        if float(left).is_integer() and float(right).is_integer():
            return left == right or path + f": {left!r} != {right!r}"
        return math.isclose(left, right, rel_tol=0, abs_tol=1e-9) or path + f": {left!r} != {right!r}"
    if isinstance(left, list) and isinstance(right, list):
        if len(left) != len(right):
            return path + f": length {len(left)} != {len(right)}"
        for index, (a, b) in enumerate(zip(left, right, strict=True)):
            result = same(a, b, f"{path}[{index}]")
            if result is not True:
                return result
        return True
    if isinstance(left, dict) and isinstance(right, dict):
        if set(left) != set(right):
            return path + f": keys {sorted(set(left) ^ set(right))} differ"
        for key in left:
            result = same(left[key], right[key], f"{path}.{key}")
            if result is not True:
                return result
        return True
    return left == right or path + f": {left!r} != {right!r}"


def load_fixtures():
    return {name: json.loads((GOLDEN / f"{name}.json").read_text(encoding="utf-8")) for name in FIXTURE_FILES}


# --- fabricated inventories -----------------------------------------------------------------------------

def sha(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def make_block(block_id, title, body, capability="patchable", occurrences=None):
    return {"id": block_id, "title": title, "class_name": N.classify(block_id, title), "class_source": N.CLASSIFICATION_SOURCE,
            "source_layer": "fabricated-golden-fragment", "capability": capability, "baseline_sha256": sha(body), "baseline_utf8": body,
            "occurrence_count": (1 if capability == "patchable" else 0) if occurrences is None else occurrences,
            "required_placeholders": N.PLACEHOLDER.findall(body)}


def make_inventory(runtime_id, runtime_version, blocks, label):
    inventory = {"schema_version": 1, "runtime_id": runtime_id, "runtime_version": runtime_version,
                 "image_digest": "sha256:" + sha(f"fabricated golden image {label}"), "binary_sha256": sha(f"fabricated golden binary {label}"),
                 "inventory_sha256": "0" * 64, "taxonomy_sha256": N.taxonomy_sha256(),
                 "materializer_sha256": C.materializer_sha256() if runtime_id == "native-codex" else N.materializer_sha256(),
                 "blocks": blocks}
    inventory["inventory_sha256"] = N.inventory_sha256(inventory)
    (C if runtime_id == "native-codex" else N).validate_inventory(inventory)
    return inventory


def claude_blocks():
    return [
        make_block("tool-bash-guide", "Shell tool guide", "Fabricated guidance: run one shell command at a time and report its exit status.\n"),
        make_block("system-reminder-plan", "Plan reminder",
                   "Fabricated reminder for ${TH_PROMPT_EXPR_0}: keep the plan short and confirm it with ${TH_PROMPT_EXPR_1}.\n"),
        make_block("security-sandbox-note", "Sandbox note",
                   "Fabricated safety note: stay inside the working directory and refuse destructive commands.\n"),
        make_block("response-style", "Response style",
                   "IMPORTANT: Fabricated style rules follow.\nYou MUST NOT invent results.\n\n```\nIMPORTANT: inside a fence\n```\n\n\n\n"
                   "Keep answers short.   \n"),
        make_block("general-hedge", "Assistant persona",
                   "As a helpful AI assistant, you greet the user.\nFabricated persona line two.\n------------\n"
                   "Please note that as an AI you have limits.\nFinal fabricated line.\n"),
        make_block("observed-dynamic", "Observed template", "Fabricated observed text with {{name}} inside.\n", "observed-only"),
        make_block("unavailable-fragment", "Unavailable fragment", "Fabricated text that cannot be located.\n", "unavailable"),
        make_block("short", "Short literal", "Be brief."),
        make_block("unicode-mix", "Unicode sample \u65e5\u672c",
                   "Fabricated text: \u65e5\u672c\u8a9e\u306e\u8aac\u660e, emoji \U0001f642, cafe\u0301 with a combining accent, "
                   "and a line separator\u2028here.\n"),
        make_block("credential-prose", "Auth prose",
                   "Fabricated note about Bearer authentication headers and requests.exceptions.JSONDecodeError handling; "
                   "contact docs@example.com for details.\n"),
        make_block("escapes-sample", "Escapes sample", "Fabricated escapes: \\n and \\u2014 appear written out.\n"),
        make_block("zebra-only", "Animal fact", "Fabricated fact: the zebra appears only in this body.\n"),
        make_block("git-commit-guide", "Commit guide",
                   "Fabricated: write one commit per change.\nSecond line of the guide.\nThird line of the guide.\n"
                   "Fourth line of the guide.\nFifth line of the guide.\n"),
        make_block("permission-deny-list", "Permission list", "Fabricated permission rule: deny writes outside the project.\n"),
    ]


def build_inventories():
    claude = make_inventory("native-claude-code", "0.0.0-golden", claude_blocks(), "claude")
    following = [copy.deepcopy(block) for block in claude["blocks"] if block["id"] != "short"]
    for block in following:
        if block["id"] == "tool-bash-guide":
            block.update(make_block(block["id"], block["title"], "Fabricated guidance, revised: run one shell command at a time.\n"))
        if block["id"] == "zebra-only":
            block.update(capability="observed-only", occurrence_count=0)
    following.append(make_block("new-fragment", "New fragment", "Fabricated fragment that exists only in the next revision.\n"))
    claude_next = make_inventory("native-claude-code", "0.0.1-golden", following, "claude-next")
    codex = make_inventory("native-codex", "0.167.1", [
        make_block("codex-base-instructions", "base.md \u00b7 core/prompts/base.md", "Fabricated Codex base instructions for golden tests.\n"),
        make_block("codex-review", "review.md \u00b7 core/prompts/review.md", "Fabricated review prompt with a few lines.\nLine two.\n"),
        make_block("codex-template", "template.md \u00b7 core/templates/template.md", "Fabricated template {{ user }} text.\n",
                   "observed-only", 1),
        make_block("codex-jinja", "conditional.md \u00b7 core/templates/conditional.md",
                   "Fabricated {% if flag %}conditional{% endif %} text.\n", "observed-only", 1),
        make_block("codex-short", "note.md \u00b7 core/prompts/note.md", "Tiny note."),
        make_block("codex-unicode", "accents.md \u00b7 core/prompts/accents.md", "Fabricated: na\u00efve r\u00e9sum\u00e9 \u2713 accents.\n"),
    ], "codex")
    large = make_inventory("native-claude-code", "0.0.0-golden-large",
                           [{**make_block(f"f{index:04d}", f"F{index:04d}", f"Fabricated filler {index:04d}.\n"), "class_source": "fabricated"}
                            for index in range(4100)], "large")
    over = {**T.baseline_profile(large), "overrides": [{"block_id": block["id"], "baseline_sha256": block["baseline_sha256"], "action": "keep"}
                                                       for block in large["blocks"][:4097]]}
    return {"inventory-claude": claude, "inventory-claude-next": claude_next, "inventory-codex": codex,
            "inventory-large": large, "profile-large-over": over}


# --- case builders --------------------------------------------------------------------------------------

class Cases:
    def __init__(self, fixtures):
        self.fx = fixtures
        self.claude, self.codex = fixtures["inventory-claude"], fixtures["inventory-codex"]
        self.blocks = {block["id"]: block for block in self.claude["blocks"]}
        self.codex_blocks = {block["id"]: block for block in self.codex["blocks"]}

    # profiles
    def profile(self, overrides=(), default="keep", inventory=None):
        return {**T.baseline_profile(inventory or self.claude), "default_action": default, "overrides": list(overrides)}

    def keep(self, block_id, inventory=None):
        block = (inventory or self.claude)["blocks"][[b["id"] for b in (inventory or self.claude)["blocks"]].index(block_id)]
        return {"block_id": block_id, "baseline_sha256": block["baseline_sha256"], "action": "keep"}

    def disable(self, block_id, inventory=None):
        return {**self.keep(block_id, inventory), "action": "disable"}

    def replace(self, block_id, text, inventory=None):
        actual = expand(text, {})
        return {**self.keep(block_id, inventory), "action": "replace", "replacement_utf8": text, "replacement_sha256": sha_any(actual)}


def sha_any(text):
    return hashlib.sha256(text.encode("utf-8", "surrogatepass")).hexdigest()


def case(name, args, function=None):
    entry = {"name": name, "args": args}
    if function:
        entry["function"] = function
    return entry


def big(text, times):
    return {"@repeat": text, "times": times}


SAMPLES = [
    ("empty", ""), ("ascii", "Fabricated words."), ("cjk", "\u65e5\u672c\u8a9e\u306e\u6587"), ("emoji", "ok \U0001f642\U0001f680"),
    ("combining marks", "cafe\u0301 nai\u0308ve"), ("whitespace only", " \t\n\x0b\x0c\r "), ("trailing line feed", "one\ntwo\n"),
    ("no final line feed", "one\ntwo"), ("line separator is not ASCII whitespace", "\u2028"), ("non-breaking space kept", "\u00a0x\u00a0"),
    ("lone surrogate", "a\ud800b"), ("39 code points", "x" * 39), ("40 code points", "y" * 40), ("NUL character", "a\x00b"),
]


def metrics_cases(c):
    out = []
    for function in ("text_metrics", "utf8_bytes", "code_points", "line_count", "estimate_tokens"):
        out += [case(f"{function}: {name}", [text], None if function == "text_metrics" else function) for name, text in SAMPLES]
    return {"function": "text_metrics", "cases": out}


def canonical_cases(c):
    claude_profile = c.profile([c.disable("short"), c.replace("tool-bash-guide", "Fabricated \u2028 replacement \U0001f642")])
    values = [
        ("key order", {"b": 1, "a": 2, "c": {"z": 0, "y": [3, 2, 1]}}),
        ("non-ASCII keys sort by code point", {"\u00e9": 1, "z": 2, "\U0001f642": 3, "\uff21": 4, "A": 5}),
        ("U+2028 and U+2029 kept as is", {"text": "a\u2028b\u2029c"}),
        ("control characters escaped", {"text": "\x00\x01\x08\t\n\x0b\x0c\r\x1f\x7f"}),
        ("quotes and backslashes", {"text": 'say "hi" \\ there'}),
        ("astral characters kept", ["\U0001f642", "\U00010348"]),
        ("nested arrays", [[], [[]], [1, [2, [3]]], {}]),
        ("scalars", [True, False, None, 0, -12, 4096]),
        ("empty object", {}),
        ("empty string", ""),
        ("a whole profile", claude_profile),
    ]
    return {"function": "canonical_json", "cases": [case(name, [value]) for name, value in values]}


def profiles_cases(c):
    inv = "@inventory-claude"
    good = c.profile([c.replace("tool-bash-guide", "Fabricated replacement text."), c.disable("short"),
                      c.keep("observed-dynamic")])
    unordered = c.profile([c.disable("zebra-only"), c.keep("observed-dynamic"), c.replace("tool-bash-guide", "Fabricated replacement text.")])
    p = lambda overrides, **kw: c.profile(overrides, **kw)
    templated = c.replace("system-reminder-plan", "Fabricated: ${TH_PROMPT_EXPR_0} then ${TH_PROMPT_EXPR_1}.")
    out = [
        case("valid profile", [good, inv]),
        case("overrides return in inventory order", [unordered, inv]),
        case("baseline profile", [p([]), inv]),
        case("none included", [p([], default="disable"), inv]),
        case("templated replacement keeps placeholders", [p([templated]), inv]),
        case("unknown top-level field", [{**p([]), "name": "x"}, inv]),
        case("missing field", [{key: value for key, value in p([]).items() if key != "overrides"}, inv]),
        case("unsupported schema", [{**p([]), "schema_version": 2}, inv]),
        case("runtime version pin differs", [{**p([]), "runtime_version": "9.9.9"}, inv]),
        case("inventory digest pin differs", [{**p([]), "inventory_sha256": "f" * 64}, inv]),
        case("materializer pin differs", [{**p([]), "materializer_sha256": "e" * 64}, inv]),
        case("invalid default action", [{**p([]), "default_action": "replace"}, inv]),
        case("overrides is not a list", [{**p([]), "overrides": {}}, inv]),
        case("too many overrides", ["@profile-large-over", "@inventory-large"]),
        case("override is not an object", [p(["tool-bash-guide"]), inv]),
        case("override with an extra field", [p([{**c.disable("short"), "note": "x"}]), inv]),
        case("override with an unknown action", [p([{**c.keep("short"), "action": "insert"}]), inv]),
        case("override for an unknown block", [p([{**c.keep("short"), "block_id": "missing-block"}]), inv]),
        case("duplicate override", [p([c.keep("short"), c.disable("short")]), inv]),
        case("baseline changed", [p([{**c.disable("short"), "baseline_sha256": "a" * 64}]), inv]),
        case("observed-only block disabled", [p([c.disable("observed-dynamic")]), inv]),
        case("unavailable block replaced", [p([c.replace("unavailable-fragment", "Fabricated.")]), inv]),
        case("replacement is not text", [p([{**c.replace("short", "x"), "replacement_utf8": 7}]), inv]),
        case("replacement with a lone surrogate", [p([c.replace("short", "bad \ud800 text")]), inv]),
        case("replacement with a NUL", [p([c.replace("short", "bad \x00 text")]), inv]),
        case("empty replacement", [p([{**c.replace("short", "x"), "replacement_utf8": "", "replacement_sha256": sha("")}]), inv]),
        case("replacement over 250,000 bytes", [p([c.replace("tool-bash-guide", big("z", 250001))]), inv]),
        case("replacement digest mismatch", [p([{**c.replace("short", "Fabricated."), "replacement_sha256": "b" * 64}]), inv]),
        case("placeholders reordered", [p([c.replace("system-reminder-plan", "A ${TH_PROMPT_EXPR_1} B ${TH_PROMPT_EXPR_0}")]), inv]),
        case("placeholder missing", [p([c.replace("system-reminder-plan", "A ${TH_PROMPT_EXPR_0} only")]), inv]),
        case("stray placeholder text", [p([c.replace("short", "Fabricated ${TH_PROMPT_EXPR text")]), inv]),
        case("canonical profile over 768 KiB", [p([c.replace(block, big("Fabricated filler. ", 9000)) for block in
                                                     ("tool-bash-guide", "security-sandbox-note", "response-style", "general-hedge", "short")]), inv]),
        case("Codex replacement within capacity",
             [c.profile([c.replace("codex-base-instructions", "Shorter Codex text.", c.codex)], inventory=c.codex), "@inventory-codex"]),
        case("Codex replacement over capacity",
             [c.profile([c.replace("codex-short", "This is longer than ten bytes.", c.codex)], inventory=c.codex), "@inventory-codex"]),
        case("Codex observed-only template disabled",
             [c.profile([c.disable("codex-template", c.codex)], inventory=c.codex), "@inventory-codex"]),
        case("Claude profile against the Codex inventory", [good, "@inventory-codex"]),
    ]
    canonical_good = T.canonical_profile(expand(good, c.fx), c.claude)
    templated_profile = T.canonical_profile(expand(p([templated]), c.fx), c.claude)
    for name, value in (("canonical valid profile", canonical_good), ("baseline", p([])), ("none included", p([], default="disable")),
                        ("templated", templated_profile),
                        ("non-ASCII replacement", T.canonical_profile(p([c.replace("unicode-mix", "\u65e5\u672c \U0001f642 \u2028 caf\u00e9")]), c.claude)),
                        ("control characters in a replacement", T.canonical_profile(p([c.replace("short", "tab\tand\x01")]), c.claude)),
                        ("Codex baseline", T.baseline_profile(c.codex)),
                        ("Codex replacement", T.canonical_profile(c.profile([c.replace("codex-review", "Fabricated review.\n", c.codex)],
                                                                            inventory=c.codex), c.codex))):
        out.append(case(f"digest: {name}", [value], "profile_sha256"))
        out.append(case(f"bytes: {name}", [value], "profile_bytes"))
    for name, value in (("baseline", p([])), ("none included", p([], default="disable")), ("mixed", canonical_good),
                        ("observed-only keep override", p([c.keep("observed-dynamic")])),
                        ("templated replaced", templated_profile),
                        ("default disable with a keep override", p([c.keep("short")], default="disable")),
                        ("default disable with a replacement", p([c.replace("zebra-only", "Fabricated other fact.")], default="disable")),
                        ("every patchable block disabled", p([c.disable(b["id"]) for b in c.claude["blocks"] if b["capability"] == "patchable"]))):
        out.append(case(f"actions: {name}", [value, inv], "resolve_actions"))
        out.append(case(f"counts: {name}", [value, inv], "profile_counts"))
    mixed = expand(canonical_good, c.fx)
    for block_id in ("tool-bash-guide", "short", "observed-dynamic", "unavailable-fragment", "zebra-only", "system-reminder-plan",
                     "unicode-mix", "general-hedge"):
        out.append(case(f"effective text: {block_id} in a mixed profile", [c.blocks[block_id], mixed], "effective_text"))
    out.append(case("effective text: patchable block under default disable", [c.blocks["zebra-only"], p([], default="disable")], "effective_text"))
    out.append(case("effective text: observed-only block under default disable", [c.blocks["observed-dynamic"], p([], default="disable")],
                    "effective_text"))
    return {"function": "canonical_profile", "cases": out}


def search_cases(c):
    inv = "@inventory-claude"
    mixed = T.canonical_profile(c.profile([c.replace("tool-bash-guide", "Fabricated replacement mentions a giraffe."), c.disable("short"),
                                           c.keep("zebra-only")]), c.claude)
    queries = ["zebra", "ZEBRA", "id:short", "title:\"plan reminder\"", "class:\"Tool Descriptions\" -bash", "body:sandbox",
               "new:giraffe", "giraffe", "-fabricated", "\"working directory\"", "\"unclosed phrase", "class:", "-", "TITLE:Shell",
               "\u65e5\u672c", "\U0001f642", "caf\u00e9", "cafe", "line", "one\ttwo  three", "docs@example.com", "id:tool title:shell",
               "-id:tool -id:short", "body:\"\"", "\u00c9"]
    out = [case(f"parse: {query!r}", [query], "parse_query") for query in queries]
    out.append(case("parse: not text", [None], "parse_query"))
    out.append(case("parse: 64 terms are all used", [" ".join(f"t{n}" for n in range(64))], "parse_query"))
    out.append(case("parse: the 65th term is left out", [" ".join(f"t{n}" for n in range(65))], "parse_query"))
    out.append(case("parse: 1,000 code points are all used", ["\U0001f642" * 999 + "z"], "parse_query"))
    out.append(case("parse: text past 1,000 code points is left out", ["\U0001f642" * 1000 + " tail"], "parse_query"))
    out.append(case("parse: a phrase cut at 1,000 code points", ['"' + "p" * 1200 + '"'], "parse_query"))
    out.append(case("query: 500 one-letter terms and a phrase", [inv, {"query": " ".join("abcdefghij"[n % 10] for n in range(500)) + ' "zebra"'}]))
    for query in queries:
        out.append(case(f"query {query!r}", [inv, {"query": query, "profile": mixed}]))
    filters = [
        ("no options", {}),
        ("classes", {"classes": ["Security & Safety", "Git & VCS"]}),
        ("named set", {"set_ids": ["short", "zebra-only", "missing"]}),
        ("empty named set", {"set_ids": []}),
        ("states replace", {"states": ["replace"], "profile": mixed}),
        ("states disable and keep", {"states": ["disable", "keep"], "profile": mixed}),
        ("states without a profile", {"states": ["keep"]}),
        ("capabilities", {"capabilities": ["observed-only", "unavailable"]}),
        ("with placeholders", {"placeholders": "with"}),
        ("without placeholders", {"placeholders": "without"}),
        ("changed only", {"changed_only": True, "profile": mixed}),
        ("only ids", {"only_ids": ["unicode-mix", "short"]}),
        ("profile default disable", {"profile": c.profile([], default="disable"), "states": ["disable"]}),
    ]
    for name, options in filters:
        out.append(case(f"filter: {name}", [inv, options]))
    for sort in ("inventory", "bytes-desc", "bytes-asc", "tokens-desc", "title", "state", "relevance"):
        out.append(case(f"sort: {sort}", [inv, {"sort": sort, "profile": mixed, "query": "fabricated"}]))
    out.append(case("sort: unknown", [inv, {"sort": "random"}]))
    out.append(case("snippet: match at the very start", [inv, {"query": "IMPORTANT"}]))
    out.append(case("snippet: match near the end of a long body", [inv, {"query": "fifth"}]))
    out.append(case("snippet: astral characters around the match", [inv, {"query": "emoji"}]))
    out.append(case("Codex inventory search", ["@inventory-codex", {"query": "fabricated", "sort": "bytes-asc"}]))
    return {"function": "search_inventory", "cases": out}


def diff_cases(c):
    five = "line one\nline two has a word\nline three\nline four\nline five\n"
    pairs = [
        ("identical", "same text\n", "same text\n"),
        ("both empty", "", ""),
        ("one word changed", "a b c", "a x c"),
        ("the D4 example: one word in line 2 of 5 and one added line", five,
         "line one\nline two has a better word\nline three\nline four\nline five\nline six\n"),
        ("inserted line", "first\nthird\n", "first\nsecond\nthird\n"),
        ("deleted block", "keep\ndrop one\ndrop two\nkeep too\n", "keep\nkeep too\n"),
        ("empty to text", "", "new text\n"),
        ("text to empty", "old text\n", ""),
        ("Windows line ends", "alpha\r\nbeta\r\ngamma\r\n", "alpha\r\nBETA\r\ngamma\r\n"),
        ("text without a final line feed", "one\ntwo", "one\ntwo\nthree"),
        ("final line feed added", "one\ntwo", "one\ntwo\n"),
        ("only whitespace in common stays whole", "abc def\n", "xyz uvw\n"),
        ("non-ASCII words", "\u65e5\u672c\u8a9e \U0001f642 caf\u00e9\n", "\u65e5\u672c\u8a9e \U0001f680 caf\u00e9\n"),
        ("punctuation tokens", "a, b; c.", "a: b; c!"),
        ("tabs and spaces", "x\ty z\n", "x  y\tz\n"),
        ("several hunks", "a\nb\nc\nd\ne\nf\ng\n", "a\nB\nc\nd\ne\nF\ng\n"),
        ("replace everything", "one two\n", "three four\n"),
    ]
    out = [case(name, [before, after]) for name, before, after in pairs]
    out.append(case("line cap: falls back to one delete and one insert", ["a\nb\nc\nd\n", "a\nx\ny\nd\n", {"line_cells": 3}]))
    out.append(case("line cap exactly reached is not a fallback", ["a\nb\nc\nd\n", "a\nx\ny\nd\n", {"line_cells": 4}]))
    out.append(case("word cap: the hunk stays at line level", ["one two three\n", "one two four\n", {"word_cells": 4}]))
    out.append(case("word cap with room", ["one two three\n", "one two four\n", {"word_cells": 100}]))
    inv = "@inventory-claude"
    a = c.profile([c.replace("tool-bash-guide", "Fabricated A."), c.disable("short")])
    b = c.profile([c.replace("tool-bash-guide", "Fabricated B."), c.keep("short"), c.disable("zebra-only")])
    profile_pairs = [
        ("same profile", a, a),
        ("baseline against itself", c.profile([]), c.profile([])),
        ("baseline against none included", c.profile([]), c.profile([], default="disable")),
        ("text and action changes", a, b),
        ("replacement equal to the baseline is not a text change",
         c.profile([]), c.profile([c.replace("short", c.blocks["short"]["baseline_utf8"])])),
        ("disable against a replacement", c.profile([c.disable("unicode-mix")]), c.profile([c.replace("unicode-mix", "\u65e5\u672c only")])),
        ("keep override equals default keep", c.profile([c.keep("short")]), c.profile([])),
        ("observed-only overrides are ignored", c.profile([c.keep("observed-dynamic")]), c.profile([])),
        ("pins differ", a, {**b, "runtime_version": "9.9.9"}),
    ]
    out += [case(f"profiles: {name}", [left, right, inv], "diff_profiles") for name, left, right in profile_pairs]
    return {"function": "diff_text", "cases": out}


def audit_cases(c):
    block = c.blocks
    rows = [
        ("valid replacement", "tool-bash-guide", "Fabricated guidance: run one command and report its status.", "native-claude-code"),
        ("not text", "tool-bash-guide", 42, "native-claude-code"),
        ("lone surrogate", "tool-bash-guide", "bad \udfff", "native-claude-code"),
        ("NUL", "tool-bash-guide", "bad \x00", "native-claude-code"),
        ("empty", "tool-bash-guide", "", "native-claude-code"),
        ("over 250,000 bytes", "tool-bash-guide", big("q", 250001), "native-claude-code"),
        ("exactly 250,000 bytes", "tool-bash-guide", big("q", 250000), "native-claude-code"),
        ("placeholders kept", "system-reminder-plan", "Plan for ${TH_PROMPT_EXPR_0} with ${TH_PROMPT_EXPR_1}.", "native-claude-code"),
        ("placeholder sequence differs", "system-reminder-plan", "Plan for ${TH_PROMPT_EXPR_1} with ${TH_PROMPT_EXPR_0}.", "native-claude-code"),
        ("placeholder added to a literal", "tool-bash-guide", "Fabricated ${TH_PROMPT_EXPR_0} guidance.", "native-claude-code"),
        ("stray placeholder", "tool-bash-guide", "Fabricated ${TH_PROMPT_EXPR guidance.", "native-claude-code"),
        ("Bearer prose the runner refuses", "tool-bash-guide", "Fabricated: use Bearer authentication for the API.", "native-claude-code"),
        ("Bearer prose with a long word", "tool-bash-guide", "Fabricated: send bearer abcdefghijklmnopqrstuvwxyz0123 next.", "native-claude-code"),
        ("Bearer and long s: Python's case folding", "tool-bash-guide", "Fabricated Bearer \u017f\u017f\u017f\u017f\u017f\u017f\u017f\u017f text.", "native-claude-code"),
        ("Bearer and dotted capital I", "tool-bash-guide", "Fabricated Bearer " + "\u0130" * 8, "native-claude-code"),
        ("Bearer and Kelvin sign", "tool-bash-guide", "Fabricated Bearer " + "\u212a" * 8 + " text.", "native-claude-code"),
        ("bearer and dotless i after a no-break space", "tool-bash-guide", "Fabricated bearer\u00a0" + "\u0131" * 8, "native-claude-code"),
        ("Bearer and a long folded token is masked", "tool-bash-guide", "Fabricated Bearer " + "\u017f" * 20 + " text.", "native-claude-code"),
        ("Bearer and seven folded letters is short", "tool-bash-guide", "Fabricated Bearer " + "\u0131" * 7 + " text.", "native-claude-code"),
        ("Python path is not a JWT", "tool-bash-guide", "Fabricated: catch requests.exceptions.JSONDecodeError here.", "native-claude-code"),
        ("JWT-shaped token", "tool-bash-guide",
         "Fabricated token eyJhbGciOiJub25lIn0.eyJzdWIiOiJmYWJyaWNhdGVkIn0.ZmFicmljYXRlZC1zaWduYXR1cmUtYnl0ZXM here.", "native-claude-code"),
        ("sk- token", "tool-bash-guide", "Fabricated key sk-fabricated0123456789 inside.", "native-claude-code"),
        ("sk- word too short", "tool-bash-guide", "Fabricated sk-short text.", "native-claude-code"),
        ("provider key shape", "tool-bash-guide", "Fabricated sk-or-v1-0123456789abcdef0123 key.", "native-claude-code"),
        ("sk- glued to a word is not a gateway match", "tool-bash-guide", "Fabricated xsk-fabricated0123456789 text.", "native-claude-code"),
        ("provider key glued to a word: only the runner's provider pattern", "tool-bash-guide",
         "Fabricated xsk-or-v1-0123456789abcdef0123 text.", "native-claude-code"),
        ("sk- after a non-ASCII letter: the gateway's ASCII boundary", "tool-bash-guide", "Fabricated \u00e9sk-fabricated0123456789 text.",
         "native-claude-code"),
        ("sk- after a line feed: escaped for the runner, raw for the gateway", "tool-bash-guide", "Fabricated\nsk-fabricated0123456789",
         "native-claude-code"),
        ("GitHub token shape", "tool-bash-guide", "Fabricated ghp_" + "A1" * 18 + " text.", "native-claude-code"),
        ("fine-grained GitHub token shape", "tool-bash-guide", "Fabricated github_pat_" + "a" * 22 + " text.", "native-claude-code"),
        ("AWS key id shape", "tool-bash-guide", "Fabricated AKIA" + "ABCDEFGHIJKLMNOP" + " text.", "native-claude-code"),
        ("Slack token shape", "tool-bash-guide", "Fabricated xoxb-0123456789-abc text.", "native-claude-code"),
        ("private key header", "tool-bash-guide", "-----BEGIN FABRICATED PRIVATE KEY-----", "native-claude-code"),
        ("macOS home path", "tool-bash-guide", "Fabricated: read /Users/someone/project/file.txt first.", "native-claude-code"),
        ("Linux home path", "tool-bash-guide", "Fabricated: read /home/someone/notes now.", "native-claude-code"),
        ("Windows home path", "tool-bash-guide", "Fabricated: read C:\\Users\\Some One\\file now.", "native-claude-code"),
        ("e-mail address not in the baseline", "tool-bash-guide", "Fabricated: write to person@example.org today.", "native-claude-code"),
        ("e-mail address already in the baseline", "credential-prose", "Fabricated: contact docs@example.com again.", "native-claude-code"),
        ("literal escapes", "tool-bash-guide", "Fabricated \\n escape \\u2014 here.", "native-claude-code"),
        ("excessive literal escapes", "tool-bash-guide", "Fabricated" + "\\n" * 11, "native-claude-code"),
        ("escapes no more than the baseline", "escapes-sample", "Fabricated: \\n and \\u2014 stay.", "native-claude-code"),
        ("invisible characters", "tool-bash-guide", "Fabricated\u200b zero\u202e width\ufeff text\x07.", "native-claude-code"),
        ("many invisible characters", "tool-bash-guide", "".join(chr(code) for code in (1, 2, 3, 4, 5, 6, 7, 8, 11, 12)) + "x", "native-claude-code"),
        ("whitespace only", "tool-bash-guide", " \n\t ", "native-claude-code"),
        ("non-ASCII whitespace is not whitespace-only", "tool-bash-guide", "\u00a0\u3000", "native-claude-code"),
        ("no-op replacement", "tool-bash-guide", block["tool-bash-guide"]["baseline_utf8"], "native-claude-code"),
        ("short replacement", "tool-bash-guide", "Be terse.", "native-claude-code"),
        ("short baseline", "short", "Be brief, and say so in a longer sentence.", "native-claude-code"),
        ("Codex replacement within capacity", "codex-base-instructions", "Fabricated shorter instructions.", "native-codex"),
        ("Codex replacement over capacity", "codex-short", "Longer than the ten byte span.", "native-codex"),
        ("non-ASCII replacement", "unicode-mix", "\u65e5\u672c\u8a9e \U0001f642 caf\u00e9 fabricated text.", "native-claude-code"),
    ]
    out = []
    for name, block_id, text, runtime in rows:
        source = c.codex_blocks[block_id] if runtime == "native-codex" else block[block_id]
        out.append(case(f"replacement: {name}", [source, text, runtime], "audit_replacement"))
    inv = "@inventory-claude"
    p = c.profile
    profile_rows = [
        ("baseline is clean", p([]), {}),
        ("not an object", "not a profile", {}),
        ("unknown field", {**p([]), "extra": 1}, {}),
        ("unsupported schema", {**p([]), "schema_version": 3}, {}),
        ("invalid default action", {**p([]), "default_action": "maybe"}, {}),
        ("overrides not a list", {**p([]), "overrides": None}, {}),
        ("override not an object", p([[]]), {}),
        ("override fields", p([{"block_id": "short", "action": "keep"}]), {}),
        ("override block id not text", p([{**c.keep("short"), "block_id": 5}]), {}),
        ("pins mismatch", {**p([]), "runtime_version": "1.2.3", "binary_sha256": "c" * 64}, {}),
        ("unknown block", p([{**c.keep("short"), "block_id": "ghost-block"}]), {}),
        ("duplicate override", p([c.disable("short"), c.disable("short")]), {}),
        ("baseline changed", p([{**c.disable("tool-bash-guide"), "baseline_sha256": "d" * 64}]), {}),
        ("not patchable", p([c.disable("observed-dynamic"), c.replace("unavailable-fragment", "Fabricated.")]), {}),
        ("keep on observed-only is fine", p([c.keep("observed-dynamic")]), {}),
        ("digest mismatch", p([{**c.replace("tool-bash-guide", "Fabricated text."), "replacement_sha256": "e" * 64}]), {}),
        ("replacement findings carried", p([c.replace("tool-bash-guide", "Use Bearer authentication now."),
                                            c.replace("system-reminder-plan", "No placeholders here.")]), {}),
        ("templated disable gives an observer note", p([c.disable("system-reminder-plan")]), {}),
        ("short disable gives an observer note", p([c.disable("short")]), {}),
        ("default disable gives observer notes and the security count", p([], default="disable"), {}),
        ("one security fragment replaced", p([c.replace("security-sandbox-note", "Fabricated safety note, shorter.")]), {}),
        ("two security fragments disabled", p([c.disable("security-sandbox-note"), c.disable("permission-deny-list")]), {}),
        ("too many overrides", "@profile-large-over", {}),
        ("profile near 768 KiB", p([c.replace(b, big("Fabricated filler. ", 8400)) for b in
                                   ("tool-bash-guide", "security-sandbox-note", "response-style", "general-hedge")]), {}),
        ("profile over 768 KiB", p([c.replace(b, big("Fabricated filler. ", 9000)) for b in
                                   ("tool-bash-guide", "security-sandbox-note", "response-style", "general-hedge", "short")]), {}),
        ("prompt with a runner-refused shape", p([]), {"prompt": "Fabricated: use Bearer authentication."}),
        ("prompt with an sk- key", p([]), {"prompt": "Fabricated sk-fabricated0123456789 text."}),
        ("prompt with a provider key shape", p([]), {"prompt": "Fabricated sk-or-v2-0123456789abcdef0123."}),
        ("clean prompt", p([]), {"prompt": "Fabricated additional instructions."}),
        ("prompt with a gateway-only key shape", p([]), {"prompt": "Fabricated\nsk-fabricated0123456789"}),
        ("manifest estimate over 1 MiB", p([c.replace(b, big("Fabricated filler. ", 8000)) for b in
                                           ("tool-bash-guide", "security-sandbox-note", "response-style")]),
         {"prompt": big("Fabricated prompt. ", 33000)}),
        ("two-arm plan estimate over 768 KiB", p([c.replace(b, big("Fabricated filler. ", 10000)) for b in
                                                 ("tool-bash-guide", "security-sandbox-note")]), {}),
        ("Codex over capacity and disable", c.profile([c.replace("codex-short", "Longer than ten bytes.", c.codex),
                                                       c.disable("codex-review", c.codex)], inventory=c.codex), "@inventory-codex"),
    ]
    for name, profile, context in profile_rows:
        if context == "@inventory-codex":
            out.append(case(f"profile: {name}", [profile, "@inventory-codex", {}], "audit_profile"))
        elif profile == "@profile-large-over":
            out.append(case(f"profile: {name}", [profile, "@inventory-large", context], "audit_profile"))
        else:
            out.append(case(f"profile: {name}", [profile, inv, context], "audit_profile"))
    return {"function": "audit_profile", "cases": out}


def plan_for(c, profiles, repeats=2, cost=0.12, prompt=""):
    arms = []
    for index, profile in enumerate(profiles):
        arms.append({"id": f"arm-{index}", "label": f"Arm {index}", "configuration": {
            "version": 2, "runtime_id": "native-claude-code", "model_id": "fixture/model-a", "task_id": "fixture-task", "prompt": prompt,
            "prompt_mode": "append", "harness": {}, "limits": {"max_steps": 5, "wall_time_seconds": 60, "max_cost_usd": cost},
            "native_prompt_profile": profile}})
    return {"version": 1, "name": "Fabricated plan", "seed": 7, "repeats": repeats, "arms": arms}


def budget_cases(c):
    inv = "@inventory-claude"
    p = c.profile
    mixed = p([c.replace("tool-bash-guide", "Fabricated, shorter."), c.disable("short"), c.replace("unicode-mix", "\u65e5\u672c \U0001f642")])
    rows = [
        ("baseline", p([]), inv, {}),
        ("mixed", mixed, inv, {}),
        ("none included", p([], default="disable"), inv, {}),
        ("none included with one kept", p([c.keep("short")], default="disable"), inv, {}),
        ("with a prompt", mixed, inv, {"prompt": "Fabricated additional instructions \U0001f642."}),
        ("prompt is not text", mixed, inv, {"prompt": 12}),
        ("Codex padding: shorter replacement and a disable",
         c.profile([c.replace("codex-review", "Short.", c.codex), c.disable("codex-short", c.codex)], inventory=c.codex), "@inventory-codex", {}),
        ("Codex replacement of equal length",
         c.profile([c.replace("codex-short", "Tiny text.", c.codex)], inventory=c.codex), "@inventory-codex", {}),
        ("Codex none included", c.profile([], default="disable", inventory=c.codex), "@inventory-codex", {}),
        ("profile bytes near the limit", p([c.replace(b, big("Fabricated filler. ", 8400)) for b in
                                           ("tool-bash-guide", "security-sandbox-note", "response-style", "general-hedge")]), inv, {}),
        ("profile bytes over the limit", p([c.replace(b, big("Fabricated filler. ", 9000)) for b in
                                           ("tool-bash-guide", "security-sandbox-note", "response-style", "general-hedge", "short")]), inv, {}),
        ("manifest estimate near", p([c.replace("tool-bash-guide", big("Fabricated filler. ", 9000))]), inv,
         {"prompt": big("Fabricated prompt. ", 35000)}),
        ("manifest estimate over", p([c.replace("tool-bash-guide", big("Fabricated filler. ", 9000))]), inv,
         {"prompt": big("Fabricated prompt. ", 47000)}),
        ("override count over the limit", "@profile-large-over", "@inventory-large", {}),
    ]
    out = [case(name, [profile, inventory, context]) for name, profile, inventory, context in rows]
    baseline, edited = T.baseline_profile(c.claude), expand(mixed, {})
    plans = [
        ("two arms", plan_for(c, [baseline, edited])),
        ("three arms, three repetitions", plan_for(c, [baseline, edited, {**baseline, "default_action": "disable"}], repeats=3)),
        ("whole-number cost", plan_for(c, [baseline, edited], cost=1)),
        ("cost given as text", plan_for(c, [baseline, edited], cost="0.25")),
        ("cost missing", {**plan_for(c, [baseline, edited]), "arms": [{**arm, "configuration": {**arm["configuration"], "limits": {}}}
                                                                    for arm in plan_for(c, [baseline, edited])["arms"]]}),
        ("non-ASCII prompt", plan_for(c, [baseline, edited], prompt="\u65e5\u672c\u8a9e \U0001f642")),
        ("frozen estimate near the limit", plan_for(c, [baseline, edited], prompt=big("Fabricated prompt. ", 13500))),
        ("frozen estimate over the limit", plan_for(c, [baseline, edited], prompt=big("Fabricated prompt. ", 17000))),
        ("ten repetitions", plan_for(c, [baseline, edited], repeats=10, cost=0.3)),
    ]
    out += [case(f"plan: {name}", [plan], "plan_budget") for name, plan in plans]
    return {"function": "profile_budget", "cases": out}


def macros_cases(c):
    texts = [
        ("caps labels and shouted phrases", "IMPORTANT: Read this.\nYou MUST NOT guess. CRITICAL : stop.\nNEVER EVER: do that.", "strip-caps"),
        ("caps labels are case-insensitive", "note: lower case label.\nWarning:mixed case.", "strip-caps"),
        ("shouted phrases are case-sensitive", "you must not lower case. ALWAYS REMEMBER TO check.", "strip-caps"),
        ("caps inside a fenced block untouched", "IMPORTANT: outside.\n```\nIMPORTANT: inside\n```\nend", "strip-caps"),
        ("caps next to a placeholder untouched", "Use ${TH_PROMPT_EXPR_0}IMPORTANT: here and IMPORTANT: there.", "strip-caps"),
        ("caps glued to a word stays", "XIMPORTANT: stays.", "strip-caps"),
        ("caps leading and trailing whitespace preserved", "\n\n  IMPORTANT: padded text.  \n\n", "strip-caps"),
        ("caps nothing to change", "Plain fabricated text.\n\n\n\nwith blank lines.", "strip-caps"),
        ("hedging lines removed", "As a helpful AI assistant, I help.\nKeep this.\n  please note that as an AI I am fabricated.\nEnd.", "strip-hedging"),
        ("hedging mid-line is kept", "Keep: As a helpful AI assistant mid-line.", "strip-hedging"),
        ("hedging every line removed", "As a helpful AI assistant only.\nMake sure to apologize always.", "strip-hedging"),
        ("hedging inside a fence untouched", "```\nAs a helpful AI assistant\n```", "strip-hedging"),
        ("dividers and trailing spaces", "Title   \n------\nBody\t\n=======   \n***\n\n\n\nEnd  ", "compact-whitespace"),
        ("divider that is not the whole line stays", "text ------ text\n------", "compact-whitespace"),
        ("compact whitespace in a fence untouched", "```\na   \n\n\n\nb\n```", "compact-whitespace"),
        ("compact whitespace nothing to change", "Already compact.\n\nYes.", "compact-whitespace"),
        ("whitespace-only text", "   \n\t", "compact-whitespace"),
        ("empty text", "", "strip-caps"),
        ("non-ASCII text", "IMPORTANT: \u65e5\u672c\u8a9e \U0001f642 caf\u00e9   \n\n\n\nend", "strip-caps"),
        ("unknown macro", "text", "make-better"),
        ("dotless i does not fold to I", "\u0131MPORTANT: stays.", "strip-caps"),
    ]
    out = [case(name, [text, macro], "apply_macro") for name, text, macro in texts]
    inv = "@inventory-claude"
    every = [block["id"] for block in c.claude["blocks"]]
    p = c.profile
    generate = [
        ("strip-caps over every block", p([]), every, ["strip-caps"]),
        ("all three macros over every block", p([]), every, ["strip-caps", "strip-hedging", "compact-whitespace"]),
        ("disabled and missing blocks are skipped", p([c.disable("response-style")]), ["response-style", "observed-dynamic", "ghost", "short"],
         ["strip-caps"]),
        ("replacement text is the input", p([c.replace("tool-bash-guide", "IMPORTANT: fabricated replaced text.")]), ["tool-bash-guide"],
         ["strip-caps"]),
        ("a macro that empties a block", p([c.replace("tool-bash-guide", "As a helpful AI assistant only.")]), ["tool-bash-guide"],
         ["strip-hedging"]),
        ("duplicate ids count once", p([]), ["response-style", "response-style"], ["compact-whitespace"]),
        ("default disable skips everything", p([], default="disable"), every, ["strip-caps"]),
        ("unknown macro", p([]), every, ["strip-caps", "nope"]),
        ("a result with a credential shape is invalid",
         p([c.replace("tool-bash-guide", "IMPORTANT: sk-or-v1-0123456789abcdef0123")]), ["tool-bash-guide"], ["strip-caps"]),
        ("projection that fits beside large overrides", p([c.replace(b, big("Fabricated filler. ", 10000)) for b in
                                                          ("security-sandbox-note", "general-hedge", "git-commit-guide")]),
         ["response-style"], ["strip-caps"]),
        ("projection that does not fit", p([c.replace(b, big("Fabricated filler. ", 12000)) for b in
                                            ("security-sandbox-note", "general-hedge", "git-commit-guide", "permission-deny-list")]),
         ["response-style", "tool-bash-guide"], ["compact-whitespace", "strip-caps"]),
    ]
    out += [case(f"generate: {name}", [inv, profile, ids, macros], "generate_macro_edits") for name, profile, ids, macros in generate]
    codex_profile = c.profile([c.replace("codex-review", "IMPORTANT: Fabricated   ", c.codex)], inventory=c.codex)
    out.append(case("generate: Codex", ["@inventory-codex", codex_profile, [b["id"] for b in c.codex["blocks"]], ["strip-caps", "compact-whitespace"]],
                    "generate_macro_edits"))

    def edit(block_id, text, before):
        return {"block_id": block_id, "replacement_utf8": text, "before_bytes": before, "after_bytes": T.utf8_bytes(expand(text, {})),
                "before_tokens": 0, "after_tokens": 0}
    heavy = tight_profile(c, room=600)
    fits = [
        ("everything fits", p([]), [edit("tool-bash-guide", "Short.", 80), edit("short", "Brief.", 9)]),
        ("nothing to fit", p([]), []),
        ("largest saving first under pressure", heavy,
         [edit("tool-bash-guide", "t" * 300, 600), edit("response-style", "r" * 250, 300), edit("short", "s" * 120, 130)]),
        ("ties keep inventory order", heavy, [edit("short", "x" * 280, 290), edit("tool-bash-guide", "y" * 280, 290)]),
        ("an edit that cannot fit is skipped", heavy, [edit("tool-bash-guide", "z" * 900, 901), edit("short", "ok", 9)]),
        ("replacing an existing override frees its bytes", heavy,
         [edit("security-sandbox-note", "Fabricated, much shorter.", 247000), edit("short", "w" * 5000, 9)]),
        ("non-ASCII edit", p([]), [edit("unicode-mix", "\u65e5\u672c \U0001f642", 120)]),
        ("result returned in inventory order", p([]), [edit("zebra-only", "Z.", 50), edit("tool-bash-guide", "T.", 80), edit("short", "S.", 9)]),
        ("a small edit fits the remaining room", heavy, [edit("short", "q" * 100, 9)]),
    ]
    out += [case(f"fit: {name}", [inv, profile, edits], "fit_macro_edits") for name, profile, edits in fits]
    return {"function": "apply_macro", "cases": out}


def tight_profile(c, room):
    """A profile whose canonical size is exactly `room` bytes under the 768 KiB limit."""
    blocks = ("security-sandbox-note", "general-hedge", "git-commit-guide")
    def build(extra):
        return c.profile([c.replace(b, big("Fabricated filler. ", 13000)) for b in blocks]
                         + [c.replace("permission-deny-list", big("f", extra))])
    size = T.profile_bytes(expand(build(1), {}))
    return build(1 + T.LIMITS["profile_bytes"] - room - size)


def rebase_cases(c):
    p = c.profile
    profile = p([c.replace("tool-bash-guide", "Fabricated replaced guidance."), c.disable("short"), c.disable("zebra-only"),
                 c.replace("unicode-mix", "\u65e5\u672c \U0001f642 replaced"), c.keep("observed-dynamic")], default="disable")
    rows = [
        ("onto the same inventory is the identity", profile, "@inventory-claude"),
        ("baseline onto the next revision", p([]), "@inventory-claude-next"),
        ("drops: baseline changed, unknown block, not patchable", profile, "@inventory-claude-next"),
        ("drop: placeholder mismatch", p([c.replace("system-reminder-plan", "No placeholders left.")]), "@inventory-claude-next"),
        ("keep override onto a now observed-only block is kept", p([c.keep("zebra-only")]), "@inventory-claude-next"),
        ("default disable names the blocks it alone governs, the new one included", p([], default="disable"), "@inventory-claude-next"),
        ("default disable with a kept override and a dropped one",
         p([c.keep("response-style"), c.keep("short"), c.disable("general-hedge")], default="disable"), "@inventory-claude-next"),
        ("different runtime is refused", profile, "@inventory-codex"),
        ("bad shape is refused", {**profile, "extra": True}, "@inventory-claude-next"),
        ("bad schema is refused", {**profile, "schema_version": 0}, "@inventory-claude-next"),
        ("bad default action is refused", {**profile, "default_action": "replace"}, "@inventory-claude-next"),
        ("duplicate override is refused", p([c.disable("short"), c.keep("short")]), "@inventory-claude-next"),
        ("replacement digest mismatch is refused", p([{**c.replace("short", "x y z"), "replacement_sha256": "1" * 64}]), "@inventory-claude-next"),
        ("empty replacement is refused", p([{**c.replace("short", "x"), "replacement_utf8": "", "replacement_sha256": sha("")}]),
         "@inventory-claude-next"),
    ]
    out = [case(name, [prof, inventory]) for name, prof, inventory in rows]
    codex_old = c.profile([c.replace("codex-short", "Tiny note.", c.codex), c.replace("codex-review", "Fabricated longer review prompt that overflows the span.\n", c.codex)],
                          inventory=c.codex)
    out.append(case("drop: over capacity on Codex", [codex_old, "@inventory-codex"]))
    return {"function": "rebase_profile", "cases": out}


def interchange_cases(c):
    p = c.profile
    profile = T.canonical_profile(p([c.replace("unicode-mix", "\u65e5\u672c \U0001f642 \u2028 text"), c.disable("short")]), c.claude)
    bundle = T.make_bundle({"profile": profile, "name": "Fabricated lean profile", "note": "Fabricated note.\nSecond line.",
                            "sets": [{"name": "Fabricated set", "block_ids": ["short", "zebra-only"]}], "tool": "traceharness-cli",
                            "now": "2026-11-12T10:00:00.000Z"})
    text = T.serialize_profile_file(bundle)
    config = {"version": 2, "runtime_id": "native-claude-code", "model_id": "fixture/model-a", "task_id": "fixture-task", "prompt": "",
              "prompt_mode": "append", "harness": {}, "limits": {"max_steps": 5}, "native_prompt_profile": profile}
    nested = "[" * 14 + "]" * 14
    make = [
        ("minimal", {"profile": profile, "name": "Fabricated", "now": "2026-11-12T10:00:00.000Z"}),
        ("all fields", {"profile": profile, "name": "  Fabricated padded  ", "note": "Fabricated.", "tool": "agent-patcher",
                        "sets": [{"name": "Set", "block_ids": ["short"]}], "now": "2026-01-02T03:04:05.678Z"}),
        ("non-ASCII name", {"profile": profile, "name": "\u65e5\u672c \U0001f642", "now": "2026-11-12T10:00:00.000Z"}),
        ("empty name", {"profile": profile, "name": "   ", "now": "2026-11-12T10:00:00.000Z"}),
        ("name with a credential", {"profile": profile, "name": "key sk-fabricated0123456789", "now": "2026-11-12T10:00:00.000Z"}),
        ("name too long", {"profile": profile, "name": "n" * 81, "now": "2026-11-12T10:00:00.000Z"}),
        ("note with a control character", {"profile": profile, "name": "Fabricated", "note": "bad\x07", "now": "2026-11-12T10:00:00.000Z"}),
        ("unknown tool", {"profile": profile, "name": "Fabricated", "tool": "editor", "now": "2026-11-12T10:00:00.000Z"}),
        ("invalid profile", {"profile": {**profile, "default_action": "x"}, "name": "Fabricated", "now": "2026-11-12T10:00:00.000Z"}),
        ("replacement digest mismatch", {"profile": {**profile, "overrides": [{**profile["overrides"][0], "replacement_sha256": "2" * 64}]},
                                         "name": "Fabricated", "now": "2026-11-12T10:00:00.000Z"}),
        ("duplicate set names", {"profile": profile, "name": "Fabricated", "sets": [{"name": "A", "block_ids": []}, {"name": "A", "block_ids": []}],
                                 "now": "2026-11-12T10:00:00.000Z"}),
    ]
    out = [case(f"bundle: {name}", [options], "make_bundle") for name, options in make]
    documents = [
        ("canonical profile", T.serialize_profile_file(profile)),
        ("profile with keys in another order", json.dumps({k: profile[k] for k in reversed(list(profile))}, ensure_ascii=False)),
        ("bundle", text),
        ("configuration export", json.dumps(config, indent=2)),
        ("agent-patcher block dump", json.dumps([{"id": "short", "body": "Be brief.", "source_path": "/fabricated/path.md"},
                                                 {"id": "zebra-only", "body": ""}])),
        ("not JSON", "{not json"),
        ("NaN is not JSON", '{"schema_version": NaN}'),
        ("not text", None),
        ("over 1.5 MiB", big(" ", 1572865)),
        ("nested too deeply", nested),
        ("prototype key", '{"schema_version": 1, "__proto__": {"x": 1}}'),
        ("constructor key in a dump", '[{"id": "a", "body": "b", "constructor": 1}]'),
        ("a number", "42"),
        ("an object of another kind", '{"hello": "world"}'),
        ("dump entry without a body", '[{"id": "short"}]'),
        ("dump entry with an extra key", '[{"id": "short", "body": "x", "path": "y"}]'),
        ("bundle with an unknown field", json.dumps({**bundle, "extra": 1})),
        ("bundle version 2", json.dumps({**bundle, "bundle_version": 2})),
        ("bundle with a bad name", json.dumps({**bundle, "name": " padded"})),
        ("bundle with a bad note", json.dumps({**bundle, "note": "x" * 501})),
        ("bundle with an impossible time", json.dumps({**bundle, "created_at": "2026-02-32T00:00:00Z"})),
        ("bundle with hour 24", json.dumps({**bundle, "created_at": "2026-02-28T24:00:00Z"})),
        ("bundle with an unknown tool", json.dumps({**bundle, "tool": "other"})),
        ("bundle with a malformed digest", json.dumps({**bundle, "profile_sha256": "ABC"})),
        ("bundle whose digest does not match", json.dumps({**bundle, "profile_sha256": "3" * 64})),
        ("bundle with invalid sets", json.dumps({**bundle, "sets": [{"name": "", "block_ids": []}]})),
        ("configuration without a profile", json.dumps({k: v for k, v in config.items() if k != "native_prompt_profile"})),
        ("configuration version 1", json.dumps({**config, "version": 1})),
        ("configuration naming another runtime", json.dumps({**config, "runtime_id": "native-codex"})),
        ("schema_version written as 1.0", re.sub(r'"schema_version":\s*1', '"schema_version": 1.0', T.serialize_profile_file(profile), count=1)),
        ("schema_version written as 1e0", json.dumps(profile).replace('"schema_version": 1', '"schema_version":1e0', 1)),
        ("schema_version written as 1.0 inside a configuration", json.dumps(config).replace('"schema_version": 1', '"schema_version": 1.0', 1)),
        ("bundle_version written as 1.0", re.sub(r'"bundle_version":\s*1', '"bundle_version": 1.0', text, count=1)),
        ("the key spelled inside a text value is not a key",
         json.dumps({**profile, "overrides": [{**c.replace("short", 'Fabricated "schema_version": 1.0 text.')}]})),
        ("an escaped key name is still the key", json.dumps(profile).replace('"schema_version": 1', '"schema\\u005fversion": 1.0', 1)),
        ("a fraction on another key is not checked", json.dumps({**config, "limits": {"max_cost_usd": 1.5}})),
        ("profile with an invalid override", json.dumps({**profile, "overrides": [{"block_id": "short", "action": "disable"}]})),
        ("profile whose replacement digest does not match",
         json.dumps({**profile, "overrides": [{**profile["overrides"][0], "replacement_sha256": "4" * 64}, profile["overrides"][1]]})),
    ]
    out += [case(f"parse: {name}", [document], "parse_profile_document") for name, document in documents]
    digest = T.profile_sha256(profile)
    out += [
        case("file name: profile", [profile, digest], "profile_file_name"),
        case("file name: bundle", [profile, digest, "bundle"], "profile_file_name"),
        case("file name: Codex", [T.baseline_profile(c.codex), T.profile_sha256(T.baseline_profile(c.codex))], "profile_file_name"),
        case("file name: bad digest", [profile, "xyz"], "profile_file_name"),
        case("file name: unknown runtime", [{**profile, "runtime_id": "traceharness"}, digest], "profile_file_name"),
        case("file name: Codex bundle", [T.baseline_profile(c.codex), "a" * 64, "bundle"], "profile_file_name"),
        case("file name: digest not text", [profile, 12], "profile_file_name"),
        case("file name: profile not an object", ["profile", digest], "profile_file_name"),
        case("serialize: profile", [profile], "serialize_profile_file"),
        case("serialize: bundle", [bundle], "serialize_profile_file"),
        case("serialize: baseline", [T.baseline_profile(c.claude)], "serialize_profile_file"),
        case("serialize: none included", [T.baseline_profile(c.claude, "disable")], "serialize_profile_file"),
        case("serialize: Codex baseline", [T.baseline_profile(c.codex)], "serialize_profile_file"),
        case("serialize: keep overrides", [T.canonical_profile(p([c.keep("short"), c.keep("observed-dynamic")]), c.claude)],
             "serialize_profile_file"),
        case("serialize: bundle without sets or note", [T.make_bundle({"profile": T.baseline_profile(c.claude), "name": "Fabricated baseline",
                                                                       "now": "2026-11-12T10:00:00.000Z"})], "serialize_profile_file"),
        case("serialize: bundle with a non-ASCII name", [T.make_bundle({"profile": profile, "name": "\u65e5\u672c \U0001f642 \u2028 profile",
                                                                        "now": "2026-11-12T10:00:00.000Z"})], "serialize_profile_file"),
    ]
    return {"function": "parse_profile_document", "cases": out}


def agent_patcher_cases(c):
    blocks = c.blocks
    dumps = [
        ("bodies equal to the baseline keep", [{"id": b["id"], "body": b["baseline_utf8"]} for b in c.claude["blocks"]]),
        ("empty and whitespace bodies disable", [{"id": "short", "body": ""}, {"id": "zebra-only", "body": " \n\t"}]),
        ("changed body replaces", [{"id": "tool-bash-guide", "body": "Fabricated new guidance."}]),
        ("unknown and duplicate ids", [{"id": "ghost", "body": "x"}, {"id": "short", "body": ""}, {"id": "short", "body": "Be brief."}]),
        ("observed-only change is not patchable", [{"id": "observed-dynamic", "body": "changed"},
                                                   {"id": "observed-dynamic-2", "body": "x"}]),
        ("templated block with named variables", [{"id": "system-reminder-plan", "body": "Fabricated reminder for ${NAME}."}]),
        ("templated block emptied disables", [{"id": "system-reminder-plan", "body": ""}]),
        ("templated block unchanged keeps", [{"id": "system-reminder-plan", "body": blocks["system-reminder-plan"]["baseline_utf8"]}]),
        ("invalid replacements", [{"id": "tool-bash-guide", "body": "nul \x00"}, {"id": "short", "body": "has ${TH_PROMPT_EXPR_0}"},
                                  {"id": "zebra-only", "body": "key sk-or-v1-0123456789abcdef0123"}]),
        ("non-ASCII replacement", [{"id": "unicode-mix", "body": "\u65e5\u672c\u8a9e \U0001f642"}]),
        ("empty dump", []),
    ]
    out = [case(f"to profile: {name}", [dump, "@inventory-claude"]) for name, dump in dumps]
    out.append(case("to profile: Codex over capacity", [[{"id": "codex-short", "body": "Longer than ten bytes."},
                                                         {"id": "codex-review", "body": "Short."}], "@inventory-codex"]))
    p = c.profile
    profiles = [
        ("baseline", p([])),
        ("none included", p([], default="disable")),
        ("mixed", p([c.replace("tool-bash-guide", "Fabricated."), c.disable("short")])),
        ("templated replacement is skipped", p([c.replace("system-reminder-plan", "New ${TH_PROMPT_EXPR_0} and ${TH_PROMPT_EXPR_1}.")])),
        ("templated replacement equal to the baseline is written",
         p([c.replace("system-reminder-plan", blocks["system-reminder-plan"]["baseline_utf8"])])),
        ("templated disable is written", p([c.disable("system-reminder-plan")])),
        ("non-ASCII", p([c.replace("unicode-mix", "\u65e5\u672c \U0001f642")])),
        ("default disable with a keep", p([c.keep("tool-bash-guide")], default="disable")),
    ]
    out += [case(f"to blocks: {name}", [profile, "@inventory-claude"], "agent_patcher_blocks_from_profile") for name, profile in profiles]
    out.append(case("to blocks: Codex", [c.profile([c.disable("codex-short", c.codex)], inventory=c.codex), "@inventory-codex"],
                    "agent_patcher_blocks_from_profile"))
    return {"function": "profile_from_agent_patcher_blocks", "cases": out}


# --- fabricated paired experiments ---------------------------------------------------------------------

def make_experiment(c, outcomes, repeats=2, arm_count=2, summary="runner", labels=None):
    inventory = c.claude
    edits = [[], [c.disable("short")], [c.replace("tool-bash-guide", "Fabricated shorter guidance.")]]
    ids = ["arm-baseline", "arm-profile", "arm-third"]
    names = labels or ["Baseline (no edits)", "Lean tools", "Third | arm <b>"]
    limits = {"max_steps": 5, "wall_time_seconds": 60, "max_cost_usd": 0.12}
    arms = []
    for index in range(arm_count):
        profile = c.profile(edits[min(index, len(edits) - 1)])
        configuration = {"version": 2, "runtime_id": inventory["runtime_id"], "model_id": "fixture/model-a", "task_id": "fixture-task",
                         "prompt": "", "prompt_mode": "append", "harness": {}, "limits": limits, "native_prompt_profile": profile}
        manifest = {"version": 2, "runtime_id": inventory["runtime_id"], "model_id": "fixture/model-a", "task_id": "fixture-task",
                    "native_prompt_profile": profile, "native_prompt_profile_sha256": N.profile_sha256(profile)}
        arms.append({"id": ids[index], "label": names[index], "configuration": configuration, "manifest": manifest,
                     "manifest_sha256": hashlib.sha256(N.canonical_bytes(manifest)).hexdigest()})
    base = {"version": 1, "name": "Fabricated paired experiment", "seed": 7, "repeats": repeats, "reference_arm_id": arms[0]["id"],
            "order_algorithm": E.ALGORITHM, "arms": arms, "maximum_cost_usd": round(0.12 * arm_count * repeats, 6), "trial_count": arm_count * repeats}
    plan = {**base, "schedule": E._schedule(base)}
    created = 1794268800
    trials = []
    for index, row in enumerate(plan["schedule"]):
        kind = outcomes[index % len(outcomes)]
        job_id = sha("job:" + row["id"])[:48]
        usage = {"requests": 6 + index, "input_tokens": 70000 + 1500 * index, "output_tokens": 1200 + 40 * index,
                 "cost_usd": round(0.009 + 0.0004 * index, 6)}

        def job(status, grade, issues=(), reported=None, job_id=job_id, index=index, row=row, usage=usage):
            return {"id": job_id, "status": status, "grade": grade, "created_at": created + index * 60, "updated_at": created + index * 60 + 45,
                    "manifest_sha256": row["manifest_sha256"], "usage": usage if reported is None else reported, "issues": list(issues),
                    "cancellation_requested": False, "artifacts": []}
        def done(value, issues=(), row=row, job_id=job_id):
            return {**row, "status": value["status"], "job_id": job_id, "job": value, "issues": list(issues)}
        if kind == "pass":
            trials.append(done(job("succeeded", "passed")))
        elif kind == "pass-no-cost":
            trials.append(done(job("succeeded", "passed", reported={k: v for k, v in usage.items() if k != "cost_usd"})))
        elif kind == "fail":
            trials.append(done(job("succeeded", "failed")))
        elif kind == "grading-error":
            trials.append(done(job("succeeded", "error", ["Fabricated grader error."])))
        elif kind == "ungraded":
            trials.append(done(job("failed", "ungraded", ["Model request limit reached."], {"requests": usage["requests"]})))
        elif kind == "refused":
            trials.append({**row, "status": "refused", "job_id": None, "job": None, "issues": ["Runner refused this scheduled trial before submission."]})
        elif kind == "cancelled":
            trials.append({**row, "status": "cancelled", "job_id": None, "job": None, "issues": ["Cancelled before submission."]})
        elif kind == "needs-attention":
            trials.append({**row, "status": "needs_attention", "job_id": job_id, "job": None, "issues": ["Fabricated: needs operator review."]})
        elif kind == "running":
            trials.append({**row, "status": "running", "job_id": job_id, "job": {"id": job_id, "status": "running", "grade": None}, "issues": []})
        elif kind == "pending":
            trials.append({**row, "status": "pending", "job_id": None, "job": None, "issues": []})
        else:
            raise ValueError(kind)
    experiment = {"id": sha("experiment:" + str(len(trials)) + ":" + ",".join(outcomes))[:48], "status": "completed",
                  "created_at": created, "updated_at": created + len(trials) * 60, "plan_sha256": E.digest(plan), "plan": plan,
                  "trial_count": plan["trial_count"], "maximum_cost_usd": plan["maximum_cost_usd"], "cancellation_requested": False,
                  "issues": [], "trials": trials}
    if summary == "runner":
        experiment["summary"] = E.summarize(experiment)
    elif summary == "disagree":
        experiment["summary"] = E.summarize(experiment)
        for row in experiment["summary"]["comparisons"]:
            row["both_pass"] += 1
            row["incomplete_pairs"] = max(0, row["incomplete_pairs"] - 1)
    elif summary == "none":
        experiment["summary"] = {"comparisons": []}
    elif summary == "malformed":
        experiment["summary"] = E.summarize(experiment)
        for row in experiment["summary"]["comparisons"]:
            row["graded_pairs"] = -1
    return experiment


def experiment_cases(c):
    experiments = [
        ("all pass", make_experiment(c, ["pass"], repeats=3)),
        ("mixed pass and fail", make_experiment(c, ["pass", "fail", "fail", "pass", "pass", "fail"], repeats=3)),
        ("every non-graded state", make_experiment(c, ["ungraded", "refused", "cancelled", "needs-attention", "running", "pending",
                                                       "grading-error", "pass"], repeats=4)),
        ("missing usage", make_experiment(c, ["pass-no-cost", "pass", "ungraded"], repeats=3)),
        ("runner summary disagrees", make_experiment(c, ["pass", "fail"], repeats=3, summary="disagree")),
        ("runner reported no pair counts", make_experiment(c, ["fail", "pass"], repeats=2, summary="none")),
        ("malformed runner counts are not used", make_experiment(c, ["pass", "fail"], repeats=2, summary="malformed")),
        ("three arms with labels that need escaping", make_experiment(c, ["pass", "fail", "ungraded"], repeats=2, arm_count=3,
                                                                       labels=["Baseline (no edits)", "=Formula, \"quoted\"", "Third | arm <b>"])),
        ("six discordant pairs", make_experiment(c, ["fail", "pass", "pass", "fail"] * 3, repeats=6)),
        ("one repetition", make_experiment(c, ["pass", "fail"], repeats=1)),
    ]
    out = []
    for name, experiment in experiments:
        out.append(case(f"outcomes: {name}", [experiment], "experiment_outcomes"))
        out.append(case(f"csv: {name}", [experiment], "experiment_csv"))
        out.append(case(f"markdown: {name}", [experiment], "experiment_markdown"))
    for successes, n in ((0, 0), (0, 1), (1, 1), (0, 10), (3, 10), (5, 10), (10, 10), (1, 3), (7, 64), (63, 64),
                         # Not counts, or more successes than trials (review m4): no interval.
                         (3, 2), (-1, 4), (1.5, 4), (1, -2), (None, 3), ("1", 3)):
        out.append(case(f"wilson {successes!r} of {n!r}", [successes, n], "wilson_interval"))
    for b, c_count in ((0, 0), (1, 0), (0, 1), (2, 3), (5, 0), (6, 0), (3, 3), (10, 2), (0, 64), (20, 25),
                       # Log-space tail above 1,000 pairs (0.5 ** n underflows past 1,074), and inputs that are not counts.
                       (1000, 1000), (500, 501), (300, 900), (600, 2000), (0, 1100), (-1, 3), (1.5, 2), (None, 2)):
        out.append(case(f"mcnemar b={b!r} c={c_count!r}", [b, c_count], "mcnemar_exact_p"))
    for discordant in (0, 1, 2, 5, 10, 64, -1, 2.5):
        out.append(case(f"smallest reachable p for {discordant!r}", [discordant], "smallest_reachable_p"))
    return {"function": "experiment_outcomes", "cases": out}


FAMILIES = {
    "metrics": metrics_cases, "canonical": canonical_cases, "profiles": profiles_cases, "search": search_cases, "diff": diff_cases,
    "audit": audit_cases, "budget": budget_cases, "macros": macros_cases, "rebase": rebase_cases, "interchange": interchange_cases,
    "agent-patcher": agent_patcher_cases, "experiment": experiment_cases,
}


def write_json(path, value, compact=False):
    text = json.dumps(value, ensure_ascii=True, separators=(",", ":")) if compact else json.dumps(value, ensure_ascii=True, indent=1)
    path.write_text(text + "\n", encoding="utf-8")


def regenerate():
    GOLDEN.mkdir(parents=True, exist_ok=True)
    fixtures = build_inventories()
    for name, value in fixtures.items():
        write_json(GOLDEN / f"{name}.json", value, compact=name in ("inventory-large", "profile-large-over"))
    cases = Cases(fixtures)
    for family, builder in FAMILIES.items():
        document = builder(cases)
        default = document["function"]
        for entry in document["cases"]:
            entry["expected"] = jsonable(run_case(entry.get("function", default), entry["args"], fixtures))
        write_json(GOLDEN / f"{family}.json", document)


@unittest.skipUnless(GOLDEN.is_dir() or UPDATE, "golden fixtures are not shipped in this package")
class GoldenFixtures(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if UPDATE:
            regenerate()
        cls.fixtures = load_fixtures()

    def test_fixture_inventories_pass_the_frozen_validators(self):
        for name in ("inventory-claude", "inventory-claude-next", "inventory-large"):
            N.validate_inventory(self.fixtures[name])
        C.validate_inventory(self.fixtures["inventory-codex"])
        large = self.fixtures["inventory-large"]
        self.assertEqual(len(self.fixtures["profile-large-over"]["overrides"]), 4097)
        self.assertEqual(N.inventory_sha256(large), large["inventory_sha256"])

    def test_every_family_has_at_least_eight_cases_per_function(self):
        for family in FAMILIES:
            document = json.loads((GOLDEN / f"{family}.json").read_text(encoding="utf-8"))
            counts = {}
            for entry in document["cases"]:
                name = entry.get("function", document["function"])
                counts[name] = counts.get(name, 0) + 1
            for name, count in counts.items():
                self.assertGreaterEqual(count, 8, f"{family}.json has {count} cases of {name}")

    def test_every_case_reproduces_its_expected_value(self):
        for family in FAMILIES:
            document = json.loads((GOLDEN / f"{family}.json").read_text(encoding="utf-8"))
            for entry in document["cases"]:
                function = entry.get("function", document["function"])
                with self.subTest(family=family, case=entry["name"]):
                    actual = jsonable(run_case(function, entry["args"], self.fixtures))
                    self.assertIs(same(actual, entry["expected"]), True, same(actual, entry["expected"]))

    def test_every_audit_rule_fires_and_does_not_fire(self):
        document = json.loads((GOLDEN / "audit.json").read_text(encoding="utf-8"))
        fired = {}
        for entry in document["cases"]:
            expected = entry["expected"]
            findings = expected if isinstance(expected, list) else expected.get("findings", [])
            rules = {finding["rule"] for finding in findings}
            for rule in T.AUDIT_RULES:
                fired.setdefault(rule["id"], set()).add(rule["id"] in rules)
        for rule, states in fired.items():
            self.assertEqual(states, {True, False}, f"{rule} needs a firing and a non-firing golden case")

    def test_content_is_fabricated(self):
        for path in GOLDEN.glob("inventory-*.json"):
            inventory = json.loads(path.read_text(encoding="utf-8"))
            for block in inventory["blocks"]:
                self.assertIn(block["source_layer"], {"fabricated-golden-fragment"})
                self.assertTrue(block["baseline_utf8"].startswith(("Fabricated", "IMPORTANT: Fabricated", "As a helpful AI assistant",
                                                                   "Be brief.", "Tiny note.")), block["id"])


if __name__ == "__main__":
    unittest.main()
