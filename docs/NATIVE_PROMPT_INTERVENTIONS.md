# Native prompt interventions and paired experiments

**Status: native Claude and Codex prompt editing and paired scheduling are implemented.**
The initial Claude release and its proof boundaries are recorded in
[Native prompt editing release](NATIVE_PROMPT_RELEASE.md). The
[Codex and paired-experiment follow-up](NATIVE_PAIRED_RELEASE.md) adds
source-bound Codex assets, frozen balanced schedules, owner-bound execution,
all-outcome summaries and reviewed output caps.

The broader design below retains its historical source baseline. Initial paired
scheduling compares profiles within one native runtime/model/task cell;
cross-model grids, multi-task scheduling and confirmatory performance inference
remain future work. Implementation is not a claim of improved task performance.

The design is grounded in TraceHarness commit
[`0e9f5fa62c5d8ed0f994a229778e3f302843c269`](https://github.com/aura-lab-wm/traceharness/tree/0e9f5fa62c5d8ed0f994a229778e3f302843c269)
and agent-patcher commit
[`8d3c17099974c06f2cfb1547bb4744c05f845b56`](https://github.com/antonio-mastropaolo/agent-patcher/tree/8d3c17099974c06f2cfb1547bb4744c05f845b56).
Links below identify source behavior at those revisions. They are not evidence
that a new intervention has been tested against a live native runtime.

## One member surface

The destination remains
[`https://traceharness.dev/app#/rig/harnesses`](https://traceharness.dev/app#/rig/harnesses).
Native prompt controls and comparisons belong inside the current **Harnesses**
workspace, beside its harness, model, task and instruction choices. Do not create
a third member application or replace the recorded-data workbench.

`/app` is the React export served by the authenticated Worker from `app.html.gz`.
Editing React source or agent-patcher does not update that snapshot.
`/app/shallow` remains the separate plain-JavaScript editor. The local lab remains
`python -m traceharness` on `127.0.0.1:8742`. See
[One harness workspace](UNIFIED_HARNESS_WORKSPACE.md) for the surface boundaries.

## Implementation at the design baseline

| Selection | Current implementation | Proposed intervention scope |
| --- | --- | --- |
| Custom or saved TraceHarness harness | TraceHarness engine with seven compiler blocks and a replaceable standing prompt | Existing prompt/block authoring; it is not a native vendor prompt inventory |
| Fixed Claude, Codex or other preset | TraceHarness stand-in with a fixed shell and editable standing prompt | Keep the stand-in label; do not display native binary patch controls |
| Native Claude Code | Pinned native executable; the member's text is appended using `--append-system-prompt-file` | Inventory and patch only fragments proven addressable in that exact native build |
| Native Codex CLI | Pinned native executable; the member's text becomes `developer_instructions` in a generated job-local configuration | Initially inventory the supported instruction overlay only; embedded prompt control remains unavailable until separately implemented and verified |

The frontend's [configuration builder](https://github.com/aura-lab-wm/traceharness/blob/0e9f5fa62c5d8ed0f994a229778e3f302843c269/harnesslab/frontend/src/rig/views/harness-composer-state.js#L56)
at that design baseline emitted an empty `harness` object for native runtimes. Its import parser
rejects native TraceHarness blocks. The
[container adapter](https://github.com/aura-lab-wm/traceharness/blob/0e9f5fa62c5d8ed0f994a229778e3f302843c269/harnesslab/runner_service/container_entrypoint.py#L26)
appends instructions and creates an isolated home; it does not run agent-patcher.
The [server configuration contract](https://github.com/aura-lab-wm/traceharness/blob/0e9f5fa62c5d8ed0f994a229778e3f302843c269/harnesslab/runner_service/configuration.py#L42)
accepts a fixed version-1 field set. New profile fields need an explicit schema,
Worker validation and server implementation; adding controls alone is insufficient.

Agent-patcher supplies useful editing semantics, but its local workbench must
not be treated as a version-pinned extraction service:

- Its [Claude loader](https://github.com/antonio-mastropaolo/agent-patcher/blob/8d3c17099974c06f2cfb1547bb4744c05f845b56/workbench.py#L361)
  reads local overrides, chooses the highest cached catalog version, and can
  fall back to other content. A missing pristine body can fall back to a lean
  or current body. None of those fallbacks proves the baseline of a runner image.
- Its [Codex loader](https://github.com/antonio-mastropaolo/agent-patcher/blob/8d3c17099974c06f2cfb1547bb4744c05f845b56/workbench.py#L446)
  segments local `AGENTS.override.md` or `AGENTS.md`. If neither exists, it creates
  seed text. This is not extraction of Codex's embedded system instructions.
- The [workbench constructor](https://github.com/antonio-mastropaolo/agent-patcher/blob/8d3c17099974c06f2cfb1547bb4744c05f845b56/workbench.py#L276)
  creates state and backup directories. Calling it is not a side-effect-free
  inventory read. The integration must not instantiate it against the operator's
  home or mount that home into a job.
- The documented local count of 1,421 Claude files is historical. It is not the
  number of prompts installed, patchable or injected in a particular runner job.
  The workbench's [token metric](https://github.com/antonio-mastropaolo/agent-patcher/blob/8d3c17099974c06f2cfb1547bb4744c05f845b56/workbench.py#L77)
  is a character-based estimate, not measured provider usage.

## Inventory identity and coverage

Generate an inventory from a clean, immutable runtime image in an isolated
build/inspection environment. Its identity binds the runtime ID and version,
image and executable digests, extractor and agent-patcher revisions, supported
application mechanism, inventory schema, taxonomy revision and canonical inventory
digest. Never choose a catalog merely because it has the highest version number.

Each block records a stable ID within that inventory, source layer, exact
baseline byte digest and byte length, deterministic target locator, template
requirements, classification provenance, and capability:

- **Patchable:** the adapter can locate, change and read back this exact target.
- **Observed only:** content or a component was observed, but no supported
  mutation mechanism is established.
- **Unavailable:** extraction, baseline identity or target matching is incomplete.

Source layers distinguish embedded native fragments, native reminders, task or
repository instructions, and the TraceHarness-supplied additional-instruction
overlay. Editing the last layer must never be described as editing all native
instructions. For Codex, that distinction is the initial supported boundary.

IDs cannot depend only on a row's sort order or an ordinal Markdown heading.
Each replacement is checked against its inventory ID and baseline digest.
Missing or ambiguous targets, unexpected versions and mismatched digests refuse
application. Do not insert fallback sample content into an actual inventory.

A catalog filename or declared catalog version is not proof of runtime presence.
An individual row's older `version` may describe content provenance: the extractor
can retain that metadata while mapping the content into a newer binary. Do not
filter inventory membership by `row.version == runtime.version`. Identical duplicate
catalog rows are candidate metadata to deduplicate, not necessarily conflicting
content. Preserve source occurrence anchors and validate every intended occurrence
against the pinned binary. Replacement and suppression must have the same declared
coverage: a first-match replacement and a global empty replacement must not silently
target different occurrence sets. Partial or uncertain coverage is explicit and
cannot be reported as a fully applied intervention.

Keep native prompt bodies in authorized private storage and job evidence, subject
to the application's data policy. Public source, this specification and release
reports contain metadata and hashes, not copied proprietary native prompt text.
Do not include credentials, host paths, account files or environment dumps in an
inventory export.

### Classes are labels, not measured effects

The agent-patcher
[classifier](https://github.com/antonio-mastropaolo/agent-patcher/blob/8d3c17099974c06f2cfb1547bb4744c05f845b56/workbench.py#L40)
has twelve Claude categories: Security & Safety, Autonomous Agent, Tool
Descriptions, System Reminders, Response Quality, Task Planning, Git & VCS,
File & Code Ops, Context & Memory, Environment & Platform, API & Integration,
and Testing & Validation, with General Behavior as fallback. It selects the
first keyword match in a block's ID/title. It is a heuristic, not a complete
functional analysis, and it does not currently define a Performance class.

Preserve that original category and its provenance. A reviewed taxonomy revision
may add cross-cutting tags such as Performance / context efficiency, with actual
block membership and a classification source. Empty or unclassified groups stay
empty or unclassified. Do not manufacture membership to fill a UI section.
An experiment freezes the resolved block IDs and taxonomy digest so later
reclassification cannot change the treatment.

Members may also create **named prompt sets** from explicit IDs, including a set
named Performance. Sets may span upstream classes. Preserve the upstream category
separately, identify member-defined sets as such, and freeze their membership in
the study. A member's set name is not a claim that the upstream classifier contains
that class or that changing it improves performance.

## Member controls and states

For a native selection, add **Native prompt inventory** below **Additional
instructions**. Show the pinned runtime and inventory identity, capability
coverage, a class filter, search, block list and inspector. Desktop can show the
list and baseline/replacement diff side by side. Mobile opens a full-width
inspector with a clear return to the list.

While loading, show loading. If no inventory exists, show **Inventory unavailable
for this runtime version** and explain the supported overlay scope. Never show a
zero count that could mean either no blocks or no inventory. The existing native
append workflow can remain available on its own verified contract.

### Proposed desktop and mobile layout

These wireframes describe placement, not an implemented prototype. `N`, `M`, `O`
and angle-bracketed values are fields populated from verified data, not example
measurements. Native prompt bodies are deliberately omitted.

```text
Desktop — existing Harnesses workspace
┌────────────────────────────────────────────────────────────────────┐
│ Harness: <native engine/version>   Model: <model>   Task: <task>     │
├───────────────────────────────────────────┬────────────────────────┤
│ Additional instructions                   │ Run / comparison review│
│ <member-owned overlay editor>             │ Runtime + image pin    │
├───────────────────────────────────────────┤ Task + grader pin      │
│ Native prompt inventory  <hash/coverage>  │ Selected N / M         │
│ Included N / M patchable · O observed only│ Profile / plan hashes  │
│ [Search] [Class / named set] [State]       │ Requests / time / cost │
│ [Include] [Exclude] [Restore] [Keep only]  │ Repetitions / job count│
├────────────────────┬──────────────────────┤                        │
│ Blocks and actions │ Inspector            │ [Review run]           │
│ <ID/title/class>   │ Baseline | Replacement│ [Compare variants]     │
│ Keep/Edit/Disable  │ Diff + occurrence map│                        │
│ Observed-only rows │ [Restore] [Undo]     │                        │
├────────────────────┴──────────────────────┴────────────────────────┤
│ Comparisons / Recent runs · all trial states, grades and artifacts │
└────────────────────────────────────────────────────────────────────┘

Mobile — same workspace, stacked sections
┌─────────────────────────────────────┐
│ Harness / Model / Task summary      │
│ [Edit selections]                   │
├─────────────────────────────────────┤
│ Additional instructions             │
│ Inventory <version / coverage>      │
│ Included N / M · O observed only     │
│ [Search] [Class / named set]         │
│ Block rows → full-width inspector   │
│ Inspector: [Back] Diff / Action      │
│ Bulk action scope + [Undo]          │
├─────────────────────────────────────┤
│ Profile / comparison plan review    │
│ Limits · repeats · planned jobs     │
│ [Review] [Run / Run comparison]      │
├─────────────────────────────────────┤
│ Trial list → paired result details  │
└─────────────────────────────────────┘
```

The inspector preserves list position and selection on return. Keyboard controls
must expose actions and mixed states without relying on color. Long IDs, hashes
and class labels wrap or remain inspectable without horizontal page overflow.

### Proposed user flow

1. Choose the native engine, model and task in the existing selectors. Load the
   exact inventory or show its unavailable state; retain stand-in distinctions.
2. Inspect source/coverage, then Keep, Replace or Disable individual blocks,
   a class, or a named set. Review the diff and inclusion count; Undo is local.
3. Run this profile, or choose Compare variants and select explicit baseline and
   treatment arms. Keep additional instructions and other factors fixed.
4. Choose paired repetitions and order. Review the immutable plan, total job
   count, budget ceiling, application support and any uncontrolled settings.
5. After actual preflight, submit the bounded plan through the existing member
   gateway. Show preparation and application outcomes before model execution.
6. Inspect every trial's execution state and independent grade, including errors
   and failures. Reload reopens the same experiment and existing job identities.
7. Export the plan and evidence. Editing any factor creates a new plan; it never
   rewrites completed results or quietly fills a failed cell with a retry.

| Control | Exact meaning |
| --- | --- |
| Keep baseline | Use the exact baseline bytes from the selected inventory |
| Replace | Substitute the member's validated text for that block |
| Disable | Suppress that particular patchable block through the verified adapter |
| Include | Re-enable the block, retaining its previous replacement if one exists |
| Restore baseline | Remove its replacement and re-enable its baseline |

Keep, Replace and Disable are execution actions. Restore is an editing operation.
An empty replacement is not an ambiguous synonym for Disable. A group is
**Baseline** when all its patchable blocks keep baseline, **Replacement** when all
are replaced, **Disabled** when all are disabled, and **Mixed** otherwise.
Observed-only entries remain visible without mutation controls.

Support all requested scopes without an artificial minimum selection:

- Disable zero, one or two individually selected patchable blocks.
- Disable one or more classes using their frozen membership.
- Include all, exclude all, or restore all patchable blocks.
- **Keep only selected:** disable every other patchable block; keep the selected
  blocks' current included content. An empty selection deliberately excludes all.
- Apply the same operations to selected rows or the filtered class, with the
  action's scope stated explicitly. A filter alone must not silently change the
  scope of an action labelled All.

Bulk actions operate on the draft, provide an immediate diff and support Undo.
Include preserves an edited block's previous text; Restore discards that edit.
The run review states how many blocks keep baseline, are replaced and are disabled.
Any edit, inventory refresh or profile change invalidates the previous review.

Keep these counts separate:

| Display | Denominator and interpretation |
| --- | --- |
| Selected for run: N of M patchable blocks | N included blocks; M exact patchable inventory entries |
| K rows selected | Temporary selection for a bulk edit, independent of inclusion |
| O observed-only components | Inventory components without a supported mutation mechanism |
| Blocks observed in this run | Distinct matched inventory IDs in the actual captured request stream |
| Occurrences / requests | Repeated injection events and model requests, reported separately |

Conditional native fragments may never appear in a particular run. Unmatched
content and incomplete observation must be reported explicitly. No observation
means **Unobserved**, not zero injected prompts. Exact bytes may be counted;
token estimates must be labelled and must not be presented as billed tokens.
Excluding all patchable blocks does not imply removing the task, every native
instruction, or the runner's isolation and authorization controls.

## Sparse immutable profiles

Profiles describe changes relative to an immutable inventory. Omitted patchable
IDs follow `default_action`; observed-only entries always remain Keep. Export
canonical data with a content digest; editing produces
a new profile revision and digest. A human-readable name is not an identity.
Keep restored editor drafts and undo history outside the execution profile.

The following summarizes the implemented schema-1 profile. See the
[validated contract](../traceharness/runner_service/native_prompts.py) and
[operational guide](../deploy/runner/NATIVE_PROMPTS.md) for exact field bounds and
canonicalization. `SHA256`, `ImageDigest`, `BlockId` and `RuntimeId` denote
validated values, not fabricated hashes or prompt contents.

```ts
type NativePromptProfile = {
  schema_version: 1;
  runtime_id: RuntimeId;
  runtime_version: string;
  image_digest: ImageDigest;
  binary_sha256: SHA256;
  inventory_sha256: SHA256;
  taxonomy_sha256: SHA256;
  materializer_sha256: SHA256;
  default_action: "keep" | "disable";
  overrides: Array<
    | { block_id: BlockId; baseline_sha256: SHA256; action: "keep" | "disable" }
    | { block_id: BlockId; baseline_sha256: SHA256; action: "replace";
        replacement_utf8: string; replacement_sha256: SHA256 }
  >;
};
```

Canonicalization rejects unknown or duplicate IDs, extra fields, invalid Unicode,
oversized content, hash mismatches and invalid template syntax. Ordering follows
the inventory's defined assembly order, not table sort order. Keep-only and
class actions resolve to explicit overrides before hashing; the service must not
reevaluate a class name at launch. Restore-all yields default Keep and an empty
override list; all-off uses default Disable with an empty override list.

Additional instructions are a separate, explicitly enabled/disabled overlay,
pinned identically across comparison arms unless that overlay is the declared
intervention. Version 2 permits an empty additional-instruction overlay; version
1 retains its prior validation. Any nonempty overlay must be disclosed as
**Native baseline + fixed additional instructions**, not unqualified stock behavior.

A profile is reusable authoring data. An execution manifest additionally binds
the exact model, task/revision/content, grader, limits, overlay, application
receipt and profile digest. Imported profiles remain drafts until the server
confirms the exact inventory and adapter support. Preserve stale drafts for
inspection/export, but refuse their execution; never silently migrate IDs to a
new runtime version.

## Isolated materialization and application proof

Extract reusable pure parsing, classification, diff and validation functions from
agent-patcher where appropriate. Do not call its home-mutating apply workflow
inside the web service or against a shared installation.

The trusted materializer receives only the approved immutable inventory and
profile. It produces a job-local overlay or patched executable from the pinned
baseline in an isolated preparation environment. The untrusted task cannot
choose a host path, arbitrary patch command, download URL or executable patcher.
Its root filesystem, network, filesystem, credential and resource boundaries
remain unchanged. Prompt-class exclusion does not disable those boundaries.

Before admitting the job, verify and record:

1. Exact baseline image/executable, inventory and materializer hashes.
2. Unique target matches and validated replacement/template syntax.
3. Read-back bytes for each affected source target and the resulting
   overlay/executable digest. At the source layer, only approved targets change;
   separately record required executable layout and derived-cache changes.
4. The actual launch configuration consuming that result; writing a file that
   the native runtime ignores is not application success.
5. A version-specific observation strategy: matched emitted fragments or other
   authoritative loading evidence, its coverage and any unmatched content.

Keep application proof distinct from runtime version output and from a successful
task grade. A self-reported CLI message or exit zero proves neither application
nor task success. Account-owned artifacts should include the profile and inventory
identities, intended actions, application result, observation coverage and job
manifest. New artifact names require explicit Worker/service/frontend allowlists.

The existing compatibility receipt does not automatically attest a changed native
executable or application mechanism. The new contract must bind the relevant
profile/materializer/result identities and prove operational compatibility.

## Paired experiments and all-outcome reporting

Add **Compare prompt variants** within the same Harnesses workspace. It creates a
reviewable experiment plan, not an implicit series of Run button clicks. Support
baseline versus one/two-block removal, class removal, keep-only selection, all
patchable blocks excluded, and explicit replacement profiles.

| Arm definition | Included content | Meaning |
| --- | --- | --- |
| None edited | All patchable baseline content; empty override list | No prompt intervention; it does **not** mean no prompts |
| No-op materialized | Same baseline content through the materializer | Tests the intervention machinery without changing content |
| None included | Default Disable with no overrides | Excludes that inventory's patchable scope; unpatchable and out-of-scope layers remain |
| Selected intervention | Resolved one/two-block, class, named-set, keep-only or replacement actions | Changes exactly the frozen target and occurrence set |

An optional study can span **model × task × runtime × prompt variant × repeat**.
Controlled paired estimates are formed within the same model/task/runtime cell.
Changing engines, models or tasks introduces additional factors: show those
comparisons separately, and never attribute a cross-engine difference solely to
prompt removal. Unsupported cells remain unavailable instead of substituting a
different engine or model.

Freeze every factor outside the declared intervention: runtime baseline and
application mechanism, model and provider routing where controllable, exact task
revision/content, grader, user/task input, additional instructions, supported
sampling settings, request/token/time/cost limits, taxonomy and observation policy.
Each arm pins its resulting overlay or executable digest. Different binaries must
share the same baseline, verified source-layer target changes and identical
documented structural/cache policy. Do not falsely claim identical executable
hashes or a whole-executable prompt-only change across a binary intervention.

For each task, run both arms for an explicit number of paired repetitions using
fresh workspaces and sessions. Record a predeclared balanced or randomized arm
order, task order and repeat identifiers. Persist the schedule before execution.
Where a native runtime does not expose a seed or sampling control, show
**Uncontrolled by this adapter**. Do not invent a common seed or promise
deterministic model outputs. Record actual model/version identifiers when the
provider supplies them, and disclose unresolved aliases.

The review computes planned jobs as tasks × arms × repetitions and the maximum
aggregate budget from the per-job limits. It states the queue/concurrency policy
and the treatment of transport failure and cancellation. A changed plan needs a
new identity. Credentials remain owner-bound and are not part of the plan or
profile. Resume addresses existing trial IDs; it cannot silently duplicate paid
submissions. There are no hidden retries or replacement runs.

### Do not select treatments by whether they solve the task

Separate **operational eligibility** from **task grade**. Inventory matching,
application verification, model transport, installed task/grader and sandbox
health establish whether an arm can execute. Its eventual task grade is the
experimental outcome. A treatment must not solve the task in advance to qualify
for inclusion in its comparison.

The current ordinary member Run path requires successful exact compatibility
receipts. A versioned experimental admission contract is therefore required;
do not bypass that existing gate or relabel a failing task as compatible. If
initial experiments use only already verified base pairs, disclose that restricted
cohort. Broader experimental base pairs need explicit operational verification
that can succeed even when the task grade fails. Preserve the grade failure as
data, not as a reason to erase the trial or hide the arm.

### No-op treatment control

Include a control that runs the materialization path with an empty override list
against an untouched baseline arm. Verify identical effective prompt/overlay
bytes and intended executable bytes before comparing behavior. This tests whether
packaging, launch flags or the materializer itself changes the treatment.
Record any unavoidable non-prompt difference. Native request metadata may vary;
exclude only explicitly documented volatile fields from a comparison and retain
unmatched content. Model outputs can still differ without a controlled seed:
one no-op run is not proof of behavioral equivalence or a performance improvement.

### Results matrix

Use rows for task and repeat, columns for arm, and retain every scheduled cell.
Each cell links its immutable manifest, application evidence, trace, patch and
independent grade. Distinguish:

- Pending, preparing, running and cancellation requested.
- Execution completed with grade passed or failed.
- Execution/transport error with ungraded or grading-error outcome.
- Cancelled, refused before execution, missing evidence and unresolved submission.

Never convert missing usage to zero or process completion to a passed grade.
Display confirmed cost subtotal separately from an unknown all-attempt total.
Keep failed and incomplete pairs visible in the denominator and report paired
wins, losses, both-pass and both-fail counts alongside per-task outcomes.
Cost, request count and elapsed-time comparisons must state which attempts have
measured values. If showing a successful-only subset, label it and show the
excluded counts; do not replace the all-attempt view with that subset.

Class-level results refer to the frozen class membership and the actual tested
tasks, model, limits and repeats. Repeats on the same task are not additional
independent tasks. Record uncertainty and sample size; no speed, cost, reliability
or quality improvement is claimed from a smaller prompt, an estimated token count,
a replayed trajectory, a fixture, or an unexecuted plan.

## Implementation phases

| Phase | Deliverable and integration points | Exit evidence |
| --- | --- | --- |
| 1. Exact inventory | Pure extractor/adapter interface; immutable inventory and taxonomy; read-only native inventory panel in `harness-composer.jsx`; additive catalog capability metadata | Real pinned-image extraction, known coverage, no home writes or synthetic fallback entries |
| 2. Profiles and authoring | Versioned state/import/export in `harness-composer-state.js`; explicit actions, counts, diff and Undo; checkpoint comparisons include inventory/profile identities | Round trips, stale-version refusal, accurate bulk scope and mobile/keyboard behavior |
| 3. Native application | Strict Worker/service schema; isolated materializer; native adapter launch integration; application/observation artifacts; operational verification contract | Real native application proof, baseline restoration and no-op control with unchanged isolation |
| 4. Experiment orchestration | Immutable experiment/trial store, bounded queue, owner-bound jobs, repeat/order plan, idempotent resume and cancellation | Exact scheduled-versus-observed trial sets; all failures and unknown costs retained |
| 5. Member release | Paired results within `/app#/rig/harnesses`; preserve full recorded workbench; build and review the exact export before publication | Actual signed-in native paired proof, artifact readback, anonymous gates and explicit verified/unverified release record |

Phases 1–2 may provide a member authoring preview while native intervention
execution remains unavailable. That preview must use a real, verified inventory
or show an honest unavailable state. Do not populate member previews with toy
prompts, fictitious inventories or fabricated results. Fixtures belong only in
tests and never establish member execution readiness.

## Acceptance criteria

1. The member stays on the existing Harnesses surface. Native engines and fixed
   stand-ins remain distinguishable in selection, review, export and results.
2. Counts derive from an exact inventory or actual run observation. Missing
   inventory, unobserved content and unsupported Codex embedded control are stated
   explicitly. Performance tags have versioned, auditable membership.
3. Zero/one/two/class/all/keep-only operations have tested inclusion semantics.
   Mixed states, Include versus Restore, Undo and filter scope are correct.
4. Exact baseline bytes can be restored. Unknown IDs, duplicate overrides,
   stale versions, changed digests, malformed templates and unsupported operations
   fail before model execution. These checks do not destroy the member's draft.
5. Materialization occurs only in an isolated job/preparation environment. Tests
   and host inspection show no home-directory, unrelated runtime or shared-image
   mutation and no relaxation of task isolation or credential boundaries.
6. An actual pinned native runtime consumes the intended profile. A no-op control
   verifies the unmodified effective content, while targeted interventions have
   read-back and loading/observation evidence. Application failure is not silently
   treated as baseline execution.
7. A signed-in operator opens the exact exported `/app` artifact, selects a real
   task/model/native runtime, reviews and launches an immutable paired plan with
   multiple repetitions, and retrieves matching job/application/grade artifacts
   after reload. At least one real native integration is proved before claiming
   native interventions live; each further runtime needs its own proof.
8. Tests deliberately exercise failed grades, provider errors, missing cost,
   cancelled or partially completed pairs and uncertain submissions. Those trials
   remain represented; compatibility logic cannot discard poor treatment outcomes.
9. Experiment manifests bind unchanged model/task/limits outside the declared
   intervention. Planned, submitted and terminal job sets reconcile without hidden
   paid retries. A profile or plan edit requires fresh review.
10. Headless member proofs verify account ownership, hostile-Origin refusal,
    secret-free exports, and the existing logged-out redirects/API rejection.
    Use a real supplied session; fixtures do not establish authentication or
    production prompt persistence. Mark every unrun check **UNVERIFIED**.
11. Release evidence distinguishes implementation tests, extraction/application
    proofs, signed-in execution, task outcomes and measured comparisons. Publishing
    this design or a UI prototype is never reported as completing those checks.
