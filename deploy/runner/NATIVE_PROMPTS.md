# Native prompt inventory and materialization

This guide describes preparation and operation of the version-bound adapter. It
does not assert that an inventory is deployed, that a member run has completed,
or that an intervention improves task performance. Release evidence must record
those outcomes separately.

This guide covers the inspected **Claude Code 2.1.322 Linux
x86_64 Bun executable**. Native Codex instruction overlays and TraceHarness
standing prompts are different mechanisms. An absent native inventory remains
unavailable; do not substitute a catalog or a stand-in harness.

For the separate Codex fixed-span adapter, see [Codex native prompts](CODEX_NATIVE_PROMPTS.md).

## Scope and identities

The inspected executable contains 3,150 Bun modules, including 2,902 executable
JavaScript modules. Preparation parsed all 2,902 JavaScript modules. From the
specified catalog it found **2,682 catalog-named fragment groups**: **1,829
patchable blocks at 1,865 nonoverlapping source occurrences**, plus **853
observed-only blocks**. These are source inventory counts, not counts of
instructions emitted in a particular request.

The catalog's 17,189 rows are candidates, not the runtime inventory. The extractor
considers only nonasset IDs beginning with `system-prompt-`, `system-reminder-`,
or `tool-description-`: 3,011 rows, deduplicated to 2,837 candidate records for
this catalog. It matches complete parsed literals, rather than arbitrary byte
substrings. All matching contexts contribute to the capability decision,
including structural uses that cannot become patch anchors. Invalid Unicode
and unmatched candidates are excluded. Arbitrary native strings, assets,
unmatched catalog entries, and dynamically assembled instructions outside this
scope are not claimed to be covered.

The preparation policy marks a complete block observed-only if its text is
shorter than 64 UTF-8 bytes or any occurrence has a known control, comparison,
schema, structural-key, pattern/membership, tagged-template or nested-template
context. Expression wrappers do not erase those exclusions. Descriptive fields
stop ambiguous enclosing-field propagation but cannot override a known control
or schema use. Unsafe reasons propagate across aliases with the same baseline
digest. Overlap also disqualifies the whole affected block; there is no partial
patchability and observed-only blocks have no private patch anchors.

This is a finite conservative syntax policy, not complete dataflow analysis.
For example, a long returned or assigned literal without a known unsafe context
can remain addressable even when its eventual semantic role is unknown.
**Patchable means that the source mutation and read-back are supported; semantic
ownership as prompt text remains UNVERIFIED outside the requests actually
observed.** “Disable all” therefore means all patchable inventory fragments,
not every native instruction, internal constraint or safety mechanism.

Older individual catalog row versions are retained as content provenance. They
are not grounds for excluding an otherwise exact match in a newer executable.
Identical duplicate catalog rows do not establish multiple runtime occurrences;
the parsed source anchors establish those occurrences.

The inspected inputs have these identities:

| Input | Identity |
| --- | --- |
| Base runtime image | `sha256:78ecae96cd0fc1702f513787e0dee8ab8b8125e163e343d6826a625558e96988` |
| Native executable | `bfb3703ad5380242328459bc62ada4bde8ae7ba57c6e1eeadb9c00e08874c478` — 341,914,128 bytes |
| Extracted JavaScript source graph | `be648176127ae08eef11311fd96afa2babd93a6b5fe8b9bd8854dc4c3a143b9a` — 53,890,195 bytes |
| Catalog `prompts-2.1.322.json` | `4adfa3af067c5e8a510773b509430312fea5c3c1e37d57a83bf50b26e9bd2a32` |
| Acorn 8.18.0 `dist/acorn.mjs` | `953573b8fdab71599749ea5f2b33d3e760c2116178f9423ee7458dbe39d59453` |
| Candidate extractor in this revision | `6659f9dac59cfb495292b6d623a9b1ab288cd72eba6cf11f6e15b70175fd4ee1` |
| Inventory finalizer in this revision | `c6f63ed99d7f3d2a55a2251804eb517574bc599d5dbe2aeaf0b000849cd0d91d` |

These pins identify inspected inputs. They do not replace a runtime application
receipt. Do not select the newest cache, fetch an unpinned `latest` package,
invoke agent-patcher's apply/update workflow, patch an operator home installation,
or mount that home into a job.

`native_prompts.materializer_sha256()` hashes the canonical mapping of the exact
bytes of **both** `native_prompts.py` and `native_prompts_elf.py`. The taxonomy
digest binds the ordered keyword rules and their agent-patcher revision,
`8d3c17099974c06f2cfb1547bb4744c05f845b56`. Those class labels are the original
first-match heuristic, with General Behavior as fallback. They do not prove
that a class contains every fragment relevant to that behavior or that removing
it has a measured effect.

## Prepare an inventory outside the repository

Use a new private workspace and the executable exported from the exact
registered image. Verify its SHA256 before extraction. Keep the native binary,
source graph, catalog, baseline text, parsed candidates and inventories outside
Git with restrictive permissions. The public inventory is an authenticated
member response containing baseline text; “public” here means the response
shape without private anchors, not permission to publish proprietary source.

1. Extract the source graph with
   `traceharness.runner_service.native_prompts_elf.extract_native_source(binary)`
   and its map with `native_source_layout(binary)`. Write the returned bytes as
   `source-graph.bin` and the map as `source-layout.json`. Both operations are
   bounded parsing; they do not launch Claude. The binary limit is 512 MiB.
   The source graph is a sequence of separate modules, not a runnable combined
   JavaScript program.
2. Run the static parser with explicit files and exact dependency hashes:

   ```sh
   node deploy/runner/prepare_native_prompt_inventory.mjs \
     "$NATIVE_WORKSPACE/source-graph.bin" \
     "$NATIVE_WORKSPACE/source-layout.json" \
     "$NATIVE_CATALOG" "$PINNED_ACORN_MODULE" \
     "$NATIVE_WORKSPACE/parsed-candidates.json" 2.1.322 \
     953573b8fdab71599749ea5f2b33d3e760c2116178f9423ee7458dbe39d59453 \
     4adfa3af067c5e8a510773b509430312fea5c3c1e37d57a83bf50b26e9bd2a32
   ```

   The parser imports only the explicitly hashed Acorn module. It never
   evaluates the native source or a candidate template expression. Its output
   records the catalog, parser and extractor hashes, parse coverage, exclusions,
   exact byte anchors, baseline text and immutable template expression slices.
   Output creation is exclusive: an existing file is not overwritten.
3. Finalize the inventory against the original executable:

   ```sh
   python deploy/runner/finalize_native_prompt_inventory.py \
     --binary "$NATIVE_WORKSPACE/claude-pristine" \
     --binary-sha256 bfb3703ad5380242328459bc62ada4bde8ae7ba57c6e1eeadb9c00e08874c478 \
     --candidates "$NATIVE_WORKSPACE/parsed-candidates.json" \
     --image-digest sha256:78ecae96cd0fc1702f513787e0dee8ab8b8125e163e343d6826a625558e96988 \
     --version 2.1.322 \
     --output "$NATIVE_WORKSPACE/inventory.private.json"
   ```

   Finalization refuses source drift, incomplete module parsing, extractor
   drift, stale ownership-policy revisions, inconsistent capability/context/
   exclusion records, duplicate IDs, overlapping anchors and invalid template
   structures. It verifies same-body aliases receive the same unsafe reasons.
   It binds the binary, source map, all anchors, catalog provenance, taxonomy
   and materializer. It creates no application receipt.

The private document adds `_private` to the public schema. Its canonical
`inventory_sha256` covers the complete private document except that digest
field itself. `public_inventory(private)` strips `_private` and retains the
trusted digest; a client cannot recompute that digest from the stripped view.
The registry separately pins the private JSON file's exact bytes, so its file
SHA256 and its canonical inventory SHA256 have different meanings.

## Profiles and materialization

A schema-1 profile contains the seven exact inventory pins, `default_action`
(`keep` or `disable`) and explicit overrides. The runtime/version, image,
binary, inventory, taxonomy and materializer must all match. An override names
one block and its baseline SHA256, then chooses Keep, Disable or Replace.
Only Replace contains `replacement_utf8` and `replacement_sha256`.

Default Disable applies only to patchable inventory blocks. Observed-only and
unavailable entries remain Keep. Thus all-off and keep-only profiles do not
need thousands of repeated Disable entries. Class and named-set operations
resolve to block actions before execution; a class name is not reevaluated by
the runner. Restore-all is Default Keep with no overrides.

Replacement limits are 250,000 UTF-8 bytes per block, 4,096 overrides and 768 KiB
for the canonical profile. The full run manifest has its own 1 MiB bound and
can reject a profile whose formatted enclosing manifest exceeds that limit.
An empty replacement is refused; use Disable. NUL, invalid Unicode, unknown
fields, duplicate IDs, changed baselines and unpatchable targets are refused.

Templates expose ordered placeholders such as `${TH_PROMPT_EXPR_0}`. A replacement
must retain their exact order and multiplicity. Member text is escaped as text;
it cannot supply JavaScript expressions. Disable evaluates the original
template and discards its text, preserving expression order and coercion side
effects. It does not remove operating-system isolation or change the broker.

`materialize_source(pristine_bytes, private_inventory, profile)` checks every
anchor and produces a new source graph plus read-back evidence. It always
starts from pristine bytes. Keep is byte-identical at this source layer.
Replacement and Disable use the same complete occurrence set. A no-op Replace
can target an occurrence without changing its bytes: the evidence's
`changed_source_occurrences` counts rewrite targets, not guaranteed byte
differences. Use the baseline/result source hashes to establish byte equality.

`native_prompts_elf.materialize_native_binary(...)` wraps that source operation.
It supports the inspected ELF64 little-endian x86_64 Bun layout and refuses
unsupported layouts or an output exceeding the original `.bun` section's
capacity. It preserves module names, other assets, flags, execution arguments,
ELF load segments, virtual addresses and overall executable length. It rebuilds
source/data pointers, clears all derived bytecode and bytecode-origin paths,
updates the Bun and section sizes, and zero-fills unused original capacity.
These structural/cache changes are recorded as `non_prompt_binary_changes`;
do not describe the resulting ELF as changing only prompt bytes.

**Every v2 profile, including Keep and explicit no-op Replace, uses the same
cache-clearing policy.** Ordinary v1 execution retains the original executable
and cache. Comparing v1 and v2 cold-start latency directly would confound prompt
changes with source loading. Paired prompt experiments should compare v2 arms
with otherwise identical settings and report preparation time separately.

The control plane generates a new job-local executable, then mounts it read-only
over the fixed native executable path in the existing pinned image. A member
cannot choose that mount target or an arbitrary patch command. The base image
identity and materialized binary identity are recorded separately. The private
materialization evidence is created outside the untrusted task container.

## Admission requires actual native CLI evidence

Install the operator-owned inventory and pristine binary under the registry's
private root, referencing each by `{path, sha256}` as
`native_prompt_inventory` and `native_prompt_binary`. An inventory alone can be
inspectable but is not executable without its exact mechanism receipt.

Before creating a receipt, run the actual pinned CLI with fresh isolated homes
and the existing sandbox limits. At minimum retain:

- Original-binary baseline request capture.
- v2 Keep and explicit baseline-text Replace captures, compared against the
  baseline's actual system, tool and message instructions.
- A replacement whose distinctive text is observed in an actual emitted
  request, plus single-block Disable and all-patchable-block Disable attempts.
- Source/binary/profile hashes, read-back evidence, every process and transport
  outcome, and restoration evidence. Keep unsuccessful attempts as outcomes.

An offline fake API can establish that the CLI consumed the materialized binary
and emitted the intended instructions. It establishes neither provider
acceptance, task success, cost nor model performance. Unit tests, `--version`,
an exit-zero process, or a file written to disk cannot substitute for this
application evidence. Conditional fragments not exercised by the capture remain
unobserved. Absence of a fragment that was never observed is not ablation proof.

If only preparation provenance changes, re-materialize with the final inventory
and prove exact binary SHA256 equality with each captured candidate before
binding those captures to the new inventory. Preserve both identities and the
mapping; do not relabel an older proof silently.

The mechanism receipt schema binds all seven pins, `schema_version: 1`,
`status: "operationally_verified"`, `verified_at`, `run_id`, and four booleans:
`application_verified`, `baseline_verified`, `noop_verified`, and
`changed_verified`. Set those booleans only from retained actual CLI evidence.
Its exact JSON bytes are pinned by `native_prompt_receipts`. A changed adapter,
taxonomy, inventory, binary or base image invalidates admission.

The normal exact runtime/model/task/grader compatibility gate still applies.
The mechanism receipt admits the intervention machinery within that verified
base cohort; it does not require a treatment to pass the task before a study
can include it. A failing treatment is an experimental outcome, not evidence
to erase or replace with an undisclosed retry.

Public source and release notes should contain code, counts, hashes and scoped
findings. Keep native prompt bodies, captured request bodies and proprietary
binary/source artifacts in authorized private storage.
