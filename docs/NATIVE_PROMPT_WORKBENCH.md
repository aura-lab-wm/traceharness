# Native prompt workbench

The native prompt workbench inspects and edits the system-prompt fragments of a native
runtime (Claude Code or Codex CLI) as a **profile**: a small, version-bound list of `keep`,
`disable` and `replace` decisions over the runtime's inventory. A profile can be run, saved,
compared, carried to a new runtime version, exchanged with the stand-alone agent-patcher
tool, and paired against the unedited baseline in a paired experiment.

Two surfaces share one logic layer:

- the **browser workbench** in the hosted member app (the Native Prompts panel of the harness
  composer and the Paired Experiments panel), and
- the **CLI** `python -m traceharness native-prompts …`, which works offline on files.

Both are held to one answer by shared golden fixtures (see [Verification](#verification)).

Three rules frame everything below.

1. **The runner is authoritative.** Every check here *predicts* what the deployed runner will
   accept. Nothing marks a profile as verified, and nothing replaces runner review or the
   admission receipt it issues.
2. **Every number says what it is.** *Exact* numbers are byte counts, counts and digests.
   *Estimates* are labelled "≈" or "estimate" and name their estimator. *Measured* numbers
   come only from a finished run's reported usage; a missing measurement reads "not reported",
   never 0.
3. **An edit is not an improvement.** A shorter or reworded prompt is a candidate for a paired
   experiment. A paired experiment over one task says nothing about other tasks, and nothing in
   the workbench says that an intervention improves task performance.

The design history and the evidence model of native profiles are in
[Native prompt interventions](NATIVE_PROMPT_INTERVENTIONS.md).

## Contents

- [What a profile can do](#what-a-profile-can-do)
- [The browser workbench](#the-browser-workbench)
- [Search syntax](#search-syntax)
- [Audit rule reference](#audit-rule-reference)
- [Budgets and their labels](#budgets-and-their-labels)
- [Macros](#macros)
- [Snapshots and the browser library](#snapshots-and-the-browser-library)
- [File formats](#file-formats)
- [Paired experiments](#paired-experiments)
- [CLI reference](#cli-reference)
- [Interchange with agent-patcher](#interchange-with-agent-patcher)
- [Limits](#limits)
- [Verification](#verification)
- [What needs a runner release](#what-needs-a-runner-release)

## What a profile can do

An inventory lists every native fragment the runtime's pinned binary carries. Each block has
an id, a title, a class (a keyword label, see below), a capability, its exact baseline text and
SHA-256, an occurrence count, and its required placeholders `${TH_PROMPT_EXPR_<n>}` (Claude Code
template literals; the expressions themselves never leave the runner).

| Operation | Allowed on | Rule the runner enforces |
| --- | --- | --- |
| `keep` | any block | the baseline bytes are used |
| `disable` | patchable blocks | Claude Code: the literal evaluates to empty text. Codex CLI: the span is overwritten with spaces and keeps its length |
| `replace` | patchable blocks | non-empty valid Unicode without NUL, at most 250,000 UTF-8 bytes, the block's placeholders in the same order and number and no other `${TH_PROMPT_EXPR` text, `replacement_sha256` equal to the text's digest; Codex also requires bytes(replacement) ≤ bytes(baseline) |
| `default_action` | the profile | `keep` or `disable`, applied to patchable blocks without an override |

Observed-only and unavailable blocks always keep. There is no insert, append, reorder,
per-occurrence or partial patch; `replace` covers those cases.

A profile is pinned to its inventory by seven values (`runtime_id`, `runtime_version`,
`image_digest`, `binary_sha256`, `inventory_sha256`, `taxonomy_sha256`, `materializer_sha256`).
A profile whose pins differ from the selected inventory cannot run; it can be inspected,
exported or rebased.

The **profile digest** is SHA-256 of the canonical JSON (sorted keys, no whitespace, non-ASCII
kept, overrides in inventory order). It equals `native_prompt_profile_sha256` in the manifest of
a run that used the profile, so a file can be matched to a run.

**Classes are labels, not measured effects.** The class of a block (for example "Security &
Safety") is a keyword heuristic over its id and title, taken from agent-patcher's taxonomy.
Disabling a block labelled Security & Safety does not change runner isolation.

## The browser workbench

The workbench has five views, a header and a focus mode. The panel's own width decides the
layout (container queries), so it behaves the same in the composer column and in focus mode.
Up to 640 px of workbench width (a phone, and the composer column at 768 and 1024 px windows)
the list and the inspector take turns in one pane and the five views are chosen from one
"Workbench view" select beside Undo and Redo; wider, they are tabs.

| View | What it shows |
| --- | --- |
| **Inventory** | the search field, filters (class or named set; state: baseline, replacement, disabled, changed from baseline, observed or unavailable; capability; with or without placeholders) and sort (inventory order, best match, largest or smallest first, most ≈ tokens, title, state); the prompt list (a listbox that renders 100 rows and then "Show 100 more") with exact bytes and ≈ tokens per row; the bulk bar (`Include`, `Disable`, `Restore`, `Keep only` over the selected rows, the filtered prompts or all patchable prompts); named prompt sets; the inspector |
| **Changes** | every block whose action or text differs, with a word-level diff and totals, between any two of: the draft, the baseline, a library entry or an imported file (all of one inventory); comparing the baseline with the draft offers "Revert to baseline" per block |
| **Audit** | the findings of the [audit](#audit-rule-reference) with counts, each linked to its block |
| **Snapshots** | this session's labelled undo history, the profiles saved in this browser, import and export |
| **Pair** | `Pair this profile against baseline`: builds a paired experiment in one step |

The **inspector** shows class and class source, source layer, capability, occurrences,
placeholders, the baseline SHA-256 (copyable), exact bytes, characters and lines, and
"≈ tokens (estimate)". Codex blocks add a capacity meter (content, padding and span bytes).
The baseline and the editor are visible together when the inspector is at least 640 px wide;
narrower, they are sub-tabs. Unapplied editor text is kept per block while you move between
rows, and the header offers "Apply n edits" and "Discard n edits".

The **header** carries the profile name and digest, the inclusion counts
(`<included> / <patchable>`), exact text bytes and the token estimate (with a "sums over
fragments, not per request" button that reveals the [fixed caption](#budgets-and-their-labels)),
the profile-size and override meters, the audit counts in words, Undo and Redo (50 labelled steps, in memory only)
and the views. The full set of limit meters (manifest, two-arm plan, per class) is in Changes
under "Size and contract limits"; the Pair view shows the two-arm plan estimate. **Focus mode** opens the same workbench in a full-viewport dialog; view,
filters, selection, inspected block, scroll position and unapplied text are kept.

States each have their own copy: loading, inventory unavailable, overlay-only runtime, request
failed (with Retry), execution unverified, stale profile (different runtime or inventory
revision), no matches, storage unavailable, and locked while a run is active.

### Keyboard

| Key | Where | Action |
| --- | --- | --- |
| `/` | anywhere outside a text field | focus the search field |
| ↑ ↓ Home End | prompt list | move the active row; more rows load when needed |
| Page Up, Page Down | prompt list | move ten rows |
| Enter | prompt list | open the inspector for the active row |
| Space | prompt list | select or clear the active row |
| Ctrl/⌘ + A | prompt list | select every patchable row that matches the filters |
| Ctrl/⌘ + Enter | replacement text | apply the replacement |
| Escape | narrow inspector, focus mode, dialogs | back to the list, exit, close |
| Ctrl/⌘ + Z, Shift + Ctrl/⌘ + Z | outside a text field | undo, redo |
| ← → | view tabs and fragment tabs | previous or next view |
| `?` | outside a text field | show the shortcuts |

## Search syntax

Search reads ids, titles, classes, baseline text and replacement text.

| Query | Meaning |
| --- | --- |
| `zebra shell` | both terms, anywhere (terms are ANDed) |
| `"working directory"` | the exact phrase; an unclosed quote runs to the end |
| `id:tool`, `title:"plan reminder"`, `class:"Tool Descriptions"`, `body:sandbox`, `new:giraffe` | one field; `new:` is replacement text |
| `-bash`, `-id:short` | exclude |

Matching is ASCII case-insensitive (A to Z only) and exact for every other character, so
`é` does not match `É` and both surfaces agree. A half-typed `class:` or a lone `-` is ignored.
Only the first 1,000 characters (code points) and the first 64 terms of a query are used, so a
pasted paragraph cannot stall typing; when a query is cut, the workbench and the CLI say
"Only the first 64 terms and 1,000 characters … are used".
The browser has no regular expressions (a pattern must not be able to hang the page); the CLI
offers `--regex` for offline use. Each match shows a snippet of 40 characters before and 80
after, and the result count always equals the set a "Filtered prompts" bulk action changes.

## Audit rule reference

The audit runs on every edit. Rules marked **contract** mirror a check of the deployed service
and block Apply, exactly as the runner would refuse; every other rule is advice and never
blocks. Findings are ordered by severity, then inventory order, then rule id.

| Rule | Severity | Contract | Fires when |
| --- | --- | --- | --- |
| `profile.invalid-shape` | error | yes | the profile is not an exact schema-1 object (the runner's sentence is quoted) |
| `pins.mismatch` | error | yes | a pin differs from the inventory |
| `override.unknown-block` | error | yes | an override names a block that is not in the inventory |
| `override.duplicate` | error | yes | two overrides name one block |
| `override.baseline-changed` | error | yes | the override was written for a different baseline text |
| `override.not-patchable` | error | yes | an observed-only or unavailable block is disabled or replaced |
| `override.digest-mismatch` | error | yes | `replacement_sha256` does not match the text |
| `replacement.empty` | error | yes | the replacement is empty (use Disable) |
| `replacement.invalid-unicode` | error | yes | the replacement has a NUL or an unpaired surrogate |
| `replacement.too-large` | error | yes | the replacement exceeds 250,000 UTF-8 bytes |
| `placeholder.sequence` | error | yes | placeholders differ in order or number |
| `placeholder.stray` | error | yes | `${TH_PROMPT_EXPR` appears outside a complete placeholder |
| `codex.over-capacity` | error | yes | a Codex replacement is longer than the native span |
| `profile.too-many-overrides` | error (warning from 80 %) | yes (the warning is advice) | more than 4,096 overrides |
| `profile.too-large` | error (warning from 80 %) | yes (the warning is advice) | the canonical profile exceeds 786,432 bytes (768 KiB) |
| `leak.runner-redaction` | error | yes | the text, as the manifest writes it, matches one of the runner's three credential patterns (`sk-` keys, JWT-shaped tokens, `Bearer <8+ characters>`); the message quotes the span. The prose "Bearer authentication" is flagged; `requests.exceptions.JSONDecodeError` is not. The runner's Bearer pattern is case-insensitive Python, which also accepts `İ`, `ı`, `ſ` and the Kelvin sign `K` in the token, so "Bearer ſſſſſſſſ" is flagged too. Also checked on the run's additional instructions |
| `leak.gateway-credential` | error | yes | an `sk-` or `sk-or-v<n>-` key shape that the gateway or the runner refuses outright |
| `leak.credential-shape` | warning | no | a GitHub, AWS, Slack or private-key shape that is not in the baseline |
| `leak.local-path` | warning | no | `/Users/<name>/`, `/home/<name>/` or `C:\Users\<name>\` not in the baseline |
| `leak.email` | warning | no | an e-mail address not in the baseline |
| `escape.poisoning` | warning | no | more literal escape sequences (`\n`, `\\`, `\u2014` typed as characters) than the baseline; "excessive" above 10 |
| `unicode.invisible` | warning | no | zero-width, bidirectional-control or other control characters not in the baseline |
| `replacement.whitespace-only` | warning | no | the replacement is only whitespace (use Disable so the record says so) |
| `manifest.size-estimate` | warning | no | the estimated run manifest exceeds 1 MiB |
| `plan.size-estimate` | warning | no | the estimated two-arm frozen plan exceeds 768 KiB |
| `replacement.noop` | info | no | the replacement equals the baseline (a deliberate no-op control still counts as a rewrite target) |
| `observer.templated` | info | no | the block has placeholders: the run observer skips templated blocks, so there will be no literal-match evidence |
| `observer.short-literal` | info | no | the block or replacement is under 16 bytes: the observer does not match it |
| `class.security-disabled` | info | no | n blocks labelled Security & Safety are disabled or replaced (a keyword label; isolation is unchanged) |

When a run is reviewed, the runner's answer is shown verbatim and wins over any prediction.

## Budgets and their labels

| Number | Kind | How it is computed |
| --- | --- | --- |
| baseline bytes, effective bytes, delta | exact | UTF-8 bytes summed over **patchable** fragments. Claude Code: a disabled fragment contributes 0. Codex: every span keeps its length, so effective bytes equal baseline bytes |
| ≈ tokens (baseline, effective, delta) | estimate, `chars-div-3.9-v1` | per fragment: trim ASCII whitespace at both ends, count code points n; 0 when n = 0, else max(1, ⌊(10n + 38) / 39⌋). This is agent-patcher's chars ÷ 3.9 with the whitespace set pinned. Codex fragments that are disabled or shortened read "not estimated (space padding)" and keep their baseline estimate |
| overrides | exact | of 4,096 |
| canonical profile bytes | exact | of 786,432 |
| run manifest bytes | estimate | profile bytes + UTF-8 bytes of the JSON string of the additional instructions + 2,048, of 1,048,576 |
| two-arm frozen plan bytes | estimate | 2 × manifest + 2 × (prompt JSON bytes + 2,748) + 4,096, of 786,432 |
| frozen plan estimate of a draft plan | estimate | draft bytes + Σ arms (configuration JSON bytes + 2,048) + 200 × trials + 512 |
| worst-case experiment cost | exact sum of caps | Σ per-trial `max_cost_usd` × repetitions; a worst case, not a forecast |
| input and output tokens, requests, cost of a trial | measured | the job's reported `usage`; "not reported" when absent |

Meters say *near* from 80 % and *over* above 100 %, in words as well as colour. The sums carry a
fixed caption: "Sums over inventory fragments. A single request contains only some of them;
measured input tokens come from a run." It is printed under the budget in Changes; in the header the line ends in "sums over fragments, not per request", a button that shows
the caption (and names it to screen readers through `aria-describedby`).

## Macros

Macros generate `replace` edits; they never edit a profile directly. Each result passes the
same checks as a hand-written replacement.

| Macro | Effect |
| --- | --- |
| `strip-caps` | removes shouted labels such as `IMPORTANT:` (case-insensitive, A to Z) and rewrites `MUST NOT`, `MUST NEVER`, `DO NOT EVER`, `YOU MUST`, `ALWAYS REMEMBER TO` as plain words |
| `strip-hedging` | removes whole lines that begin with stock assistant phrases such as "As a helpful AI assistant" |
| `compact-whitespace` | removes divider lines (six or more of `-=_*` as the whole line), trailing spaces and tabs, and folds three or more line feeds into two |

Fenced code and `${TH_PROMPT_EXPR_n}` placeholders are never altered. Ported from
agent-patcher with ASCII-only character classes and one deliberate difference: the fragment's
own leading and trailing whitespace is preserved (agent-patcher strips it and appends a line
feed, which here would change how fragments join).

The macro dialog chooses macros and a scope (this fragment, selected, filtered, all patchable)
and previews every changed block with bytes (exact) and ≈ tokens before and after, every
skipped block with its reason (`unchanged`, `disabled`, `not-patchable`, `placeholder-changed`,
`empty-result`, `invalid-result`, `over-capacity`), and the projected canonical profile size
against the limits. Apply is one undoable step and is disabled when the projection exceeds a
limit; "largest savings first until the profile fits" keeps the subset that fits.

## Snapshots and the browser library

- **This session**: the labelled undo history (50 steps, 8 MiB, in memory only). The host
  remounts the workbench when the runtime changes, which clears it; the draft itself is kept by
  the host.
- **Saved in this browser**: up to 40 entries and 3 MiB in `localStorage` under
  `traceharness.native.member.<scope>.library.v1` (member mode) or
  `traceharness.native.library.v1`. An entry holds the profile, named sets and counts, never a
  baseline body. "Save snapshot" stores the current draft; a snapshot is also taken
  automatically before an import, a restore and a macro. Oldest snapshots are evicted first; a
  saved profile is never evicted. Restore is an undoable step. An entry for another inventory is
  listed as "different inventory" and can be inspected, exported, compared after rebase or
  deleted, never run.
- The copy says so: "Saved in this browser only, not in your account. Anyone using this
  browser profile can read it." "Delete all" clears the library after a confirmation.

## File formats

All files are UTF-8 JSON. Import reads at most 1.5 MiB, refuses `__proto__`, `constructor`
and `prototype` keys, more than 12 levels of nesting and more than 200,000 values, and never
fetches or executes anything. `schema_version` and `bundle_version` must be written as whole
numbers: `1.0` or `1e0` is refused ("This file writes schema_version with a fraction or an
exponent…"), because the runner reads them as floats and refuses the profile, while a browser's
JSON parser would silently turn them into `1`. An imported profile still has to pass the contract checks against
the current inventory, and runner review, before it can run.

| Kind | Shape | Written by |
| --- | --- | --- |
| profile | the exact schema-1 object `{ schema_version, <7 pins>, default_action, overrides }` as canonical JSON plus a line feed; this is also the job artifact `native-prompt-profile.json`. File name `native-prompt-profile-<runtime_id>-<first 12 of digest>.json` | Export profile, `profile new`, `profile canonicalize`, `profile edit`, `profile macro`, `profile rebase`, `profile convert --from …` |
| bundle | `{ kind: "traceharness.native-prompt-profile-bundle", bundle_version: 1, name, note, created_at, tool, profile_sha256, profile, sets }`, exactly these keys, two-space JSON in this order. `tool` is `traceharness-ui`, `traceharness-cli` or `agent-patcher`; `profile_sha256` is verified on import; `name` is 1 to 80 visible characters without a credential shape; `note` at most 500 characters. File name `native-prompt-profile-bundle-<runtime_id>-<digest12>.json`. The runner never sees a bundle, only its `profile` | Export bundle, `profile convert --to bundle` |
| configuration | a version-2 run configuration export; its `native_prompt_profile` is taken | the composer's configuration export |
| agent-patcher blocks | `[{ id, body, source_path }]`, agent-patcher's snapshot dump | Export agent-patcher blocks, `profile convert --to agent-patcher-blocks` |
| inventory | the public inventory (`Download inventory JSON`), the API response `{ version, available, execution_available, reason, inventory }`, or an operator's private inventory, of which only the public view is read | Download inventory JSON |

Export, import and export again gives identical bytes. An agent-patcher dump and a downloaded
inventory contain baseline text: keep them as private as the inventory itself.

## Paired experiments

`Pair this profile against baseline` (Pair view) builds the standard experiment by
construction:

- arm 1 `Baseline (no edits)`, id `arm-baseline`: the same pins, `default_action: "keep"`, no
  overrides. It is the reference and goes through the same materialisation path as every arm.
- arm 2, id `arm-profile`: the current profile, labelled with the profile name or
  `Profile <digest12>`.
- optional arm 3 `All patchable disabled`, id `arm-none-included`.

Arm ids are deterministic, so the plan content and the seed reproduce the schedule. Arm names
and the experiment name are 1 to 80 (120) printable characters and may not carry an `sk-` or
provider key shape: the Worker refuses such a plan ("Invalid experiment variant."), so the panel
says "Remove provider credentials from the variant name." before review. A profile
with no edits makes an **A/A control**: baseline against baseline, which measures how much the
task varies between identical runs. Any arm can be made the reference; the reference always
reads "reference" and "baseline" or "edited". All arms share runtime, model, task, additional
instructions, limits and pins, as the runner requires.

Results are shown in a fixed order and never filtered:

1. per arm, the outcome of every planned trial (passed, failed, ungraded or grading error,
   refused, cancelled, needs attention, not finished; they add up to the planned trials), pass
   rate over graded **and** over planned trials, and a Wilson 95 % interval on graded trials;
2. a matrix of repetitions by arms with state, grade, measured cost, input and output tokens,
   requests and execution order (one card per repetition on a narrow panel);
3. per variant against the reference: both pass, both fail, reference only, variant only,
   incomplete, the exact two-sided McNemar probability on the discordant pairs (summed in log
   space above 1,000 pairs, so it never underflows to 0; "not reported" for inputs that are not
   counts), and "With n discordant pairs the smallest reachable probability is …" (fewer than six discordant pairs
   cannot go below 0.05). The runner's own pair counts are shown when it reported them; a recount
   that differs is stated;
4. measured usage per arm (minimum, median, maximum, "k of n trials reported") and paired
   differences over repetitions where both arms reported.

Fixed caveats accompany every comparison: one task; repetitions are repeated runs of the same
task, not independent tasks; model sampling is not controlled; a completed schedule is not a
passed task; the comparison does not show that an intervention improves task performance.
There is no winner highlight and no colour that ranks arms.

Exports: `Export experiment results` (the experiment JSON), `Export CSV` (one row per scheduled
trial, RFC 4180 quoting, CRLF, formula-like cells prefixed with an apostrophe, missing
measurements empty), `Export Markdown` (the whole summary with the caveats), `Copy summary`.
`Load evidence` on a finished trial reads `native-prompt-application.json` and
`native-prompt-observations.json` and shows what they say; absence of a literal match does not
prove a fragment was disabled.

## CLI reference

```text
python -m traceharness native-prompts inventory  summary|list|search|show  INVENTORY …
python -m traceharness native-prompts profile    new|validate|audit|stats|digest|canonicalize|diff|edit|macro|rebase|convert  INVENTORY …
python -m traceharness native-prompts experiment summarize EXPORT [--format text|json|markdown|csv]
```

Guarantees: it reads only the files named on the command line (inventories up to 128 MiB, other
files up to 2 MiB, regular files only, no symlink followed, plain `json.loads`, NaN and Infinity
refused), writes only an explicit `-o FILE` (created exclusively with mode 0600 unless `--force`,
never through a symlink; without `-o` the result goes to standard output), never reads the home
directory, keeps no state and opens no network connection. Every command takes `--json`. Text
from an inventory is printed with control, format and separator characters escaped (`\x1b`,
`\u202e`) when the output is a terminal, unless `--raw`.

| Exit code | Meaning |
| --- | --- |
| 0 | success |
| 1 | findings: an invalid profile (with the runner's sentence), audit errors, or warnings with `--strict`; a macro projection over a limit |
| 2 | a usage error or an input that cannot be read (missing, not a regular file, too large, not UTF-8, not JSON, not a valid inventory) |

### Commands

| Command | Output |
| --- | --- |
| `inventory summary INV` | pins, block counts by capability and class, bytes (exact) and ≈ tokens (estimate) |
| `inventory list INV [--class C]… [--capability K]… [--sort S] [--limit N] [--profile P]` | one line per block: id, capability, bytes, ≈ tokens, class, title (and the action under P) |
| `inventory search INV QUERY [--regex] [--class C]… [--capability K]… [--sort S] [--limit N] [--profile P]` | matching blocks with snippets; the [search syntax](#search-syntax), or a Python regular expression with `--regex`; `new:` searches P's replacements |
| `inventory show INV BLOCK_ID` | metadata and the baseline text |
| `profile new INV [--default keep\|disable] [-o FILE]` | the baseline or the none-included profile |
| `profile validate INV PROFILE` | 0 and the digest, or 1 and the runner's sentence; states that the admission receipt is not checked |
| `profile audit INV PROFILE [--strict] [--prompt-file F]` | the findings; 1 on errors, or on warnings with `--strict` |
| `profile stats INV PROFILE [--prompt-file F]` | the budget, every number labelled exact or estimate |
| `profile digest INV PROFILE` | the canonical SHA-256 (`native_prompt_profile_sha256`) |
| `profile canonicalize INV PROFILE [-o FILE]` | the canonical profile file |
| `profile diff INV PROFILE [--against OTHER] [--block ID]` | per changed block, the text with `[-deleted-]` and `{+inserted+}` word markers; against the baseline unless `--against` |
| `profile edit INV PROFILE [--restore-all] [--keep-only ID…] [--disable-class C]… [--disable ID…] [--keep ID…] [--replace ID --text-file F] [-o FILE]` | the edited profile, validated by the runner's `canonical_profile` before it is written. Steps apply in the order listed; they follow the browser's bulk actions (keep only keeps a replacement and disables every other patchable block) |
| `profile macro INV PROFILE --macro M… (--block ID… \| --class C \| --all) [--fit] [--dry-run] [-o FILE]` | the preview, then the profile with the macro edits; exit 1 when the projection exceeds a limit and `--fit` is not given |
| `profile rebase NEW_INV PROFILE [-o FILE]` | the profile carried to `NEW_INV`, exact matches only, with every dropped override and its reason (`unknown-block`, `baseline-changed`, `not-patchable`, `placeholder-mismatch`, `over-capacity`). Under `default_action: "disable"` it also lists (`default_applies_to` with `--json`) and counts the patchable blocks that no override names, which the default disables: blocks that are new in `NEW_INV` are among them. The browser's rebase report says the same |
| `profile convert INV SOURCE --from bundle\|configuration\|agent-patcher-blocks [-o FILE]` | the canonical profile (and, for a dump, the conversion report) |
| `profile convert INV SOURCE --to bundle --name N [--note T] [-o FILE]`, `… --to agent-patcher-blocks [-o FILE]` | a bundle written by `traceharness-cli`, or an agent-patcher block dump |
| `experiment summarize EXPORT [--format text\|json\|markdown\|csv] [-o FILE]` | the [results](#paired-experiments) of an exported experiment, every outcome included |

`PROFILE` may be a profile file, a bundle (its digest is verified) or a version-2 configuration
export.

### Examples

```sh
INV=native-prompt-inventory.json          # "Download inventory JSON" from the workbench

python -m traceharness native-prompts inventory summary "$INV"
python -m traceharness native-prompts inventory search "$INV" 'class:"Tool Descriptions" -bash' --limit 20
python -m traceharness native-prompts inventory show "$INV" tool-bash-guide

python -m traceharness native-prompts profile new "$INV" -o lean.json
python -m traceharness native-prompts profile edit "$INV" lean.json --disable-class "Git & VCS" -o lean.json --force
python -m traceharness native-prompts profile macro "$INV" lean.json --macro strip-caps compact-whitespace --all --dry-run
python -m traceharness native-prompts profile macro "$INV" lean.json --macro strip-caps --all --fit -o lean-caps.json
python -m traceharness native-prompts profile audit "$INV" lean-caps.json --strict
python -m traceharness native-prompts profile stats "$INV" lean-caps.json
python -m traceharness native-prompts profile diff "$INV" lean-caps.json --against lean.json
python -m traceharness native-prompts profile digest "$INV" lean-caps.json

python -m traceharness native-prompts profile convert "$INV" lean-caps.json --to bundle --name "Lean, no caps" -o lean.bundle.json
python -m traceharness native-prompts profile rebase next-inventory.json lean-caps.json -o lean-next.json

python -m traceharness native-prompts experiment summarize paired-experiment.json --format markdown -o summary.md
```

The fabricated golden inventory in the repository makes a safe playground:

```sh
G=traceharness/frontend/test/native-golden
python -m traceharness native-prompts inventory summary $G/inventory-claude.json
python -m traceharness native-prompts profile new $G/inventory-claude.json -o /tmp/p.json
python -m traceharness native-prompts profile audit $G/inventory-claude.json /tmp/p.json --json
python -m traceharness native-prompts profile digest $G/inventory-claude.json /tmp/p.json
```

## Interchange with agent-patcher

The stand-alone agent-patcher tool patches a locally installed coding agent; TraceHarness never
runs it and never touches a local installation. The two meet in files.

- **Bundle**: the shared format is the schema-1 profile carried in a bundle; `tool` names the
  writer (`agent-patcher` for files it writes).
- **Block dumps** (`[{ id, body, source_path }]`, agent-patcher's snapshot format) map onto an
  inventory, and nothing is guessed:

  | Dump entry | Result |
  | --- | --- |
  | id not in the inventory | skipped, `unknown-block` |
  | the same id twice | the first is used, the next skipped as `duplicate-id` |
  | body equal to the baseline | keep |
  | observed-only or unavailable block with another body | skipped, `not-patchable` |
  | empty or whitespace-only body | disable |
  | block with placeholders and any other body | skipped, `placeholder-names-differ` (agent-patcher names variables `${NAME}`; this contract numbers them `${TH_PROMPT_EXPR_n}`) |
  | body with a placeholder, a NUL, a credential shape, or over 250,000 bytes | skipped, `invalid-replacement` |
  | Codex body longer than the span | skipped, `over-capacity` |
  | anything else | replace |

  The report always adds up: keep + disable + replace + skipped = entries.
- **The reverse** writes one entry per inventory block with the text the profile gives it
  (`""` when disabled, `source_path` empty). A replaced block with placeholders is not written and
  is listed as `placeholder-names-differ`. For placeholder-free blocks the round trip is lossless.
- Differences in behaviour: macros preserve a fragment's outer whitespace (agent-patcher strips
  it), and token estimates use the same formula with the whitespace set pinned to ASCII.

## Limits

| Limit | Value | Enforced by |
| --- | --- | --- |
| overrides per profile | 4,096 | runner |
| replacement | 1 to 250,000 UTF-8 bytes | runner |
| canonical profile | 786,432 bytes (768 KiB) | runner |
| run manifest (profile plus additional instructions) | 1,048,576 bytes (1 MiB) | runner |
| request body | 1 MiB | gateway |
| inventory | 20,000 blocks, 4 MiB response | runner, gateway |
| paired plan | 2 to 8 arms, 1 to 10 repetitions, at most 64 trials; draft and frozen plan at most 768 KiB each (the frozen plan stores each arm's profile twice) | runner |
| observer literal match | 16 bytes and more, untemplated blocks only | runner |
| profile file import | 1.5 MiB, 12 levels, 200,000 values | browser, CLI |
| browser library | 40 entries, 3 MiB, names 80 characters, notes 500 | browser |
| undo history | 50 steps, 8 MiB, in memory | browser |
| CLI inputs | inventory 128 MiB, other files 2 MiB | CLI |

## Verification

The logic exists twice, in `traceharness/frontend/src/rig/native/*.js` for the browser and in
`traceharness/runner_service/native_prompt_tools.py` for the CLI. Canonicalisation and
validation in Python are delegated to the frozen runner adapters (`native_prompts.py`,
`native_prompts_codex.py`), which no part of the workbench changes.

| Test | Proves |
| --- | --- |
| `traceharness/frontend/test/native-golden/*.json` with `src/rig/native/golden.test.js` and `tests_agentlab/test_native_prompt_golden.py` | JavaScript and Python return the same value for 593 fabricated cases (every function, non-ASCII text, empty input, the caps, every audit rule firing and not firing) |
| `tests_agentlab/test_native_prompt_tools.py` | every contract audit rule agrees with the runner's `canonical_profile`; `leak.runner-redaction` agrees with `execution._redacted`; the provider-key rule agrees with `configuration.has_secret`; pair counts agree with `experiments.summarize`; digests and sizes equal the runner's |
| `tests_agentlab/test_native_prompt_cli.py` | every command, the exit codes, exclusive output files, terminal escaping, no home-directory access and no socket |
| `tests_agentlab/test_native_materializer_pins.py` | the four frozen runner files are byte-identical and the three deployed identities are unchanged |

```sh
.venv/bin/python -m unittest tests_agentlab.test_native_prompt_tools tests_agentlab.test_native_prompt_golden \
  tests_agentlab.test_native_prompt_cli tests_agentlab.test_native_materializer_pins
# regenerate the golden files after a deliberate behaviour change, review them, then run the JavaScript golden test
TH_UPDATE_NATIVE_GOLDEN=1 .venv/bin/python -m unittest tests_agentlab.test_native_prompt_golden
```

## What needs a runner release

These are not built, because the deployed runner and gateway would have to change: a profile
library stored in the member account; a profile name, note or sets recorded in the run manifest;
an audit report stored as a job artifact; experiment names in the saved-experiment list;
finer edit operations (insert, append, per-occurrence patches); paired plans across tasks or
models; observation of templated fragments and per-fragment measured tokens; server-side
statistics; larger limits.
