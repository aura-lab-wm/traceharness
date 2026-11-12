# Native prompt golden fixtures

These files hold the browser workbench (`src/rig/native/*.js`) and the CLI mirror
(`traceharness/runner_service/native_prompt_tools.py`) to one answer. Every case is an input
and the complete expected return value. All content is fabricated for these tests; none of it
is native prompt text from Claude Code or Codex CLI.

- Python: `tests_agentlab/test_native_prompt_golden.py` recomputes every case and compares.
- JavaScript: `src/rig/native/golden.test.js` must reproduce every case without edits.
- The school package does not ship `traceharness/frontend/test`, so the Python test skips when
  this directory is absent.

## Regenerating

The case inputs are defined in `tests_agentlab/test_native_prompt_golden.py`. The expected values
are produced by the Python implementation:

```sh
TH_UPDATE_NATIVE_GOLDEN=1 .venv/bin/python -m unittest tests_agentlab.test_native_prompt_golden
```

Review the diff by eye, then run the JavaScript golden test. A case that the two languages answer
differently is a defect in one of them, never a reason to edit the expected value by hand.

## Files

| File | Contents |
| --- | --- |
| `inventory-claude.json` | 14 fabricated Claude Code blocks: patchable, templated (two placeholders), observed-only, unavailable, a 9-byte literal, two Security & Safety blocks, CJK, emoji, combining marks, U+2028, prose with "Bearer authentication", an e-mail address, literal escapes, the word `zebra` once |
| `inventory-claude-next.json` | the next fabricated revision: one body changed, one block removed, one block now observed-only, one block added |
| `inventory-codex.json` | 6 fabricated Codex CLI blocks at runtime version 0.167.1, two observed-only templates (`{{`, `{%`), titles `name.md · dir/name.md` |
| `inventory-large.json`, `profile-large-over.json` | 4,100 short blocks and a profile with 4,097 keep overrides, for the override limit (`profile.too-many-overrides`, "Too many native prompt overrides") |
| `metrics.json` | `text_metrics`, `utf8_bytes`, `code_points`, `line_count`, `estimate_tokens` |
| `canonical.json` | `canonical_json` |
| `profiles.json` | `canonical_profile` (each refusal, Claude and Codex), `profile_sha256`, `profile_bytes`, `resolve_actions`, `profile_counts`, `effective_text` |
| `search.json` | `parse_query`, `search_inventory` (each prefix, negation, phrase, filter, sort, snippet edges) |
| `diff.json` | `diff_text` (including both caps through the `limits` argument), `diff_profiles` |
| `audit.json` | `audit_replacement`, `audit_profile`: every rule in a firing and a non-firing case |
| `budget.json` | `profile_budget` (baseline, mixed, none included, Codex padding, near and over each limit), `plan_budget` |
| `macros.json` | `apply_macro`, `generate_macro_edits`, `fit_macro_edits` |
| `rebase.json` | `rebase_profile` (identity, each drop reason, each refusal) |
| `interchange.json` | `make_bundle`, `parse_profile_document`, `profile_file_name`, `serialize_profile_file` |
| `agent-patcher.json` | `profile_from_agent_patcher_blocks`, `agent_patcher_blocks_from_profile` |
| `experiment.json` | `experiment_outcomes`, `experiment_csv`, `experiment_markdown`, `wilson_interval`, `mcnemar_exact_p` |

The two large files exist only because the override limit (4,096) cannot be reached with a smaller
inventory without also triggering other findings.

## Case format

```json
{ "function": "diff_text",
  "cases": [ { "name": "one word changed", "args": ["a b c", "a x c"], "expected": { "changed": true, "...": "..." } } ] }
```

- `function` at the top is the default; a case may name another function of the same family with
  its own `"function"` key.
- `args` is the argument list. Two substitutions are applied before the call, recursively:
  - a string `"@<fixture>"` (for example `"@inventory-claude"`) is replaced by a fresh copy of the
    fixture file `<fixture>.json` in this directory; only the five fixture names above are
    substituted;
  - an object with exactly the keys `"@repeat"` and `"times"` is replaced by the string repeated
    that many times (used for the 250,000-byte and 768 KiB limits).
- `expected` is the complete return value, after a JSON round trip (a JavaScript `undefined`
  property is absent), or `{ "error": "<exact sentence>" }` when the function throws.
- Numbers that are not integers compare within 1e-9; everything else compares exactly. Object key
  order does not matter.

## Names and calling conventions in JavaScript

| Golden name | JavaScript export | Note |
| --- | --- | --- |
| `utf8_bytes`, `code_points`, `line_count`, `estimate_tokens`, `text_metrics` | `text-metrics.js` `utf8Bytes`, `codePoints`, `lineCount`, `estimateTokens`, `textMetrics` | |
| `canonical_json`, `canonical_profile`, `profile_sha256`, `profile_bytes`, `effective_text`, `profile_counts`, `rebase_profile` | `profile-model.js` `canonicalJSON`, `canonicalProfile`, `profileSha256` (async), `profileBytes`, `effectiveText`, `profileCounts`, `rebaseProfile` | |
| `resolve_actions` | `profile-model.js` `resolveActions` | returns a `Map`; compare `Object.fromEntries(result)` |
| `parse_query`, `search_inventory` | `search.js` `parseQuery`, `searchInventory` | |
| `diff_text`, `diff_profiles` | `diff.js` `diffText`, `diffProfiles` | `diffText` takes the optional third `limits` argument |
| `audit_replacement`, `audit_profile` | `audit.js` `auditReplacement`, `auditProfile` | |
| `profile_budget`, `plan_budget` | `budget.js` `profileBudget`, `planBudget` | |
| `apply_macro`, `generate_macro_edits`, `fit_macro_edits` | `macros.js` `applyMacro`, `generateMacroEdits`, `fitMacroEdits` | |
| `make_bundle` | `interchange.js` `makeBundle` (async) | `now` is an ISO 8601 string in the file; pass `new Date(now)` |
| `parse_profile_document` | `interchange.js` `parseProfileFile` (async) | the argument is the file text |
| `profile_file_name`, `serialize_profile_file` | `interchange.js` `profileFileName`, `serializeProfileFile` | |
| `profile_from_agent_patcher_blocks`, `agent_patcher_blocks_from_profile` | `interchange.js` `profileFromAgentPatcherBlocks` (async), `agentPatcherBlocksFromProfile` | |
| `wilson_interval`, `mcnemar_exact_p`, `experiment_outcomes`, `experiment_csv`, `experiment_markdown` | `experiment-stats.js` `wilsonInterval`, `mcnemarExactP`, `experimentOutcomes`, `experimentCsv`, `experimentMarkdown` | |

Await every result; awaiting a plain value is harmless.
