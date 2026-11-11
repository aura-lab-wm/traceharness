# Native prompt editing: release and evidence

The member workspace at **[traceharness.dev/app#/rig/harnesses](https://traceharness.dev/app#/rig/harnesses)**
now supports embedded prompt editing for the pinned **Claude Code 2.1.322**
native runtime. This is the React workbench exported to the authenticated
Worker's `app.html.gz` snapshot. The recorded-data workbench remains present:
its eight datasets and 3,453 recorded runs were preserved byte-for-byte in the
embedded data payload. `/app/shallow` remains a separate plain-JavaScript editor.

This release implements agent-patcher's class-oriented editing semantics with
a version-bound runner adapter. It does not launch agent-patcher's local
workbench or patch an operator's installed CLI. The classifier provenance is
agent-patcher revision `8d3c17099974c06f2cfb1547bb4744c05f845b56`.

## Member workflow

Choose **Claude Code** in Harnesses, then use its native prompt editor alongside
the model, real task, additional instructions and run limits.

- Browse and search 2,682 catalog-named fragment groups: **1,829 patchable** and
  **853 observed-only**. Pagination limits rendered rows, not edit scope.
- Keep, disable or replace one or several patchable fragments; apply actions
  by class or an explicitly selected, named set.
- Disable all patchable fragments, keep only a chosen subset, restore baselines
  or undo an edit. Observed-only entries remain read-only under every bulk action.
- Inspect the baseline, byte counts, replacement diff, source provenance and
  required template placeholders. Replacement text cannot introduce executable
  expressions or remove/reorder required placeholders.
- Export/import a configuration or compare and restore local checkpoints.
  The exact resolved profile accompanies preflight, execution and job evidence.

Native Codex retains its existing additional-instruction overlay. Its embedded
prompt editing is explicitly unavailable. TraceHarness stand-ins retain their
separate standing-prompt and block controls.

## What the inventory means

There are 1,865 patchable source occurrences across the 1,829 patchable groups.
These counts describe a finite catalog matched to parsed literals in the exact
native binary; they are not counts of prompts emitted during a run.

Known control, comparison, schema, structural and ambiguous contexts are excluded.
Fragments shorter than 64 UTF-8 bytes are observed-only. Exclusions propagate to
all occurrences and same-body aliases. An early candidate incorrectly admitted
a short timeout literal also used by control flow; it was rejected before
publication. All 36 occurrences are observed-only in the released inventory.

The policy is conservative syntax analysis, not complete semantic dataflow
analysis. **Patchable means addressable, mutable and independently readable
back. Semantic ownership as prompt text remains UNVERIFIED outside observed
requests.** Classes are heuristic labels, not measured behavioral categories.
Disable all means all patchable inventory fragments, not every native instruction
or the runner's isolation and permission boundaries.

## Execution and security boundaries

Configuration version 2 binds runtime/version, image, binary, inventory, taxonomy
and materializer digests. The Worker and runner reject stale identities, invalid
fields, unknown blocks, nonpatchable targets, invalid Unicode and digest or
placeholder mismatches. Canonical profiles are bounded to 768 KiB; the persisted
manifest is separately bounded to 1 MiB. Version 1 configurations remain valid.

Each v2 job materializes a fresh executable from pristine bytes, independently
reads the sources back, and mounts it read-only at a fixed path in the existing
pinned native image. The member cannot choose a patch command or mount target.
The pristine image is unchanged and job-local binaries are removed after use.
Application evidence is created outside the task container. Member ownership
checks apply to the new profile, application and observation artifacts.

The actual client request is observed before broker normalization. Evidence
contains bounded hashes, block identifiers and locations, not request bodies or
provider keys. Matching a literal proves its presence at that location; absence
does not establish suppression of a conditional or never-observed fragment.

All v2 variants, including Keep and a no-op replacement, clear derived Bun
bytecode. The ELF adapter also rebuilds source pointers and records these
non-prompt binary changes. Version 1 retains the original cache, so v1-versus-v2
cold-start timing is not an isolated prompt comparison. Future paired studies
must compare equivalent v2 arms and report preparation time separately.

## Verification on 2026-11-11

| Evidence | Result and limit |
| --- | --- |
| Published member UI, real operator session, headless Chromium | Exact deployed HTML checked; desktop 1440px and mobile 390px; editing, bulk operations, readonly entries, diff, checkpoints, import/export, reload and mobile focus verified. Five real preflights accepted. This UI check created no credentials or jobs. |
| Live anonymous HTTP gates | 15 checks passed. `/app`, `/app/shallow` and `/link` return 302 `/login`. Six API routes, including both inventories, return exact 401 `{"error":"Sign in required."}` with and without hostile Origin; no ACAO. |
| Actual pinned native CLI, isolated sandbox | Original plus five final profiles emitted real client requests to a deterministic offline capture endpoint. Keep and baseline replacement preserve the original model/messages/system/tools; marked replacement and selective disable change the selected tool fragment as expected. |
| Actual native all-disable capture | All 52 previously observed long static patchable fragments disappear from the captured system/tool instructions. Instruction bytes change from 91,650 to 23,082. This is not a provider token measurement or a performance result. Conditional and other unobserved coverage remains UNVERIFIED. |
| Live member job and real provider | Native Claude with `anthropic/claude-haiku-4.5` consumed a marked replacement on the real `requests-jsondecode-pickle` task. Application evidence and replacement presence were verified through owner-bound artifacts. Three provider calls reported 98,796 input tokens, 474 output tokens and $0.101166 usage. |
| That job's outcome | **Failed, ungraded.** The remaining reservation under the $0.25 cap could not cover a fourth request. No paid retry was substituted. Task completion and performance improvement are **UNVERIFIED**. |
| Frontend automated tests | 965 passed across 51 files. The mobile Back focus regression failed before its fix and passed afterward. |
| Runner automated tests | 228 run: 227 passed, one Linux-only test skipped locally. Preparation tests used the actual pinned Acorn parser; runtime execution was separately exercised on Linux. |
| Worker automated tests | 170 passed. These are boundary/unit evidence, not proof of a signed-in browser render. |
| Frontend distribution freshness | Two checks passed against the final rebuilt source. |

The offline captures intentionally end with HTTP 400 and native exit 1 after
capturing the outgoing request. They prove native consumption and emitted
instructions, not successful tasks or provider acceptance. The live job is a
separate proof of provider-backed application.

The live execution proof's cleanup client initially failed its credential DELETE
assertion and incorrectly retained `complete: true`. The original attempt is
preserved, its reporting logic was corrected, and the separate cleanup evidence
records an idle runner restart that cleared the volatile vault. No active jobs,
containers or task mounts existed before or after that restart. Individual
revocation for that original connection remains unverified; cleanup by process
restart is verified. Credentials and JWTs were never placed in source or reports.

## Published identities

| Component | Identity |
| --- | --- |
| Member HTML SHA256 | `6e5ede52d399e5ff8cffa702bcdd0b24ad8b931bb642215b2f2df8e1b54a8254` |
| Uploaded gzip SHA256 | `b70b8e8f579e2edbbc4244d1cdd06685317e271c9b379536645918d67ebf2ca4` |
| Inventory SHA256 | `94399d069ff5af15ce644eb5906470e75673e7417ef75210d6983eb79b83fcfa` |
| Materializer SHA256 | `ba6245da8b07901b6793898e70e2e974a1e641a2c3be0d357ba53d15101f4081` |
| Native base image | `sha256:78ecae96cd0fc1702f513787e0dee8ab8b8125e163e343d6826a625558e96988` |
| Native executable SHA256 | `bfb3703ad5380242328459bc62ada4bde8ae7ba57c6e1eeadb9c00e08874c478` |
| Worker version | `3cd05eb7-5844-44fd-bb96-7944e3987ca2` |
| Runner release | Fly v11, complete; one machine started, one health check passing |
| Runner control image | `sha256:bc991b89bc55f6ce31f197934b93e6fdf52f24457909ec728f1ed848889afeb2` |

Worker deploy, runner deploy and exact KV upload each exited 0. The Worker used
the temporary route-free configuration with existing variables preserved; the
temporary file was removed. No zone route, database policy or native base image
changed. The eight runnable task definitions and revisions were preserved.

See [machine-readable release evidence](NATIVE_PROMPT_RELEASE.json) and the
[preparation and operations guide](../deploy/runner/NATIVE_PROMPTS.md).
The retained private proof workspace contains full deployment log tails,
capture comparisons, failed attempts, screenshots and cleanup receipts; native
vendor bodies, binaries and raw request captures are deliberately absent from Git.

Still unimplemented: Native Codex embedded editing, the paired experiment
scheduler and automated comparative-result reporting. Still unverified: complete
native instruction coverage, conditional-path coverage, cross-account live
isolation with a second real member, task completion for this edited profile,
and performance or cost improvements.
