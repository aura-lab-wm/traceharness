# Integrated Harness Editing and Experiment Workspace Specification

## 1. Purpose, Scope, and Epistemic Status

This document specifies the design, user workflows, component and protocol contracts, failure modes, risks, integration seams, and acceptance criteria for integrating current-draft JSON configuration editing, recording fork reconstruction, and general multi-cell (`harness × model × task`) experiment dispatch into the `/app` React Harnesses workspace.

### Status and evidence

The design alternatives below were explored before implementation. The editor, recorded forks and version-2 matrix protocol are now implemented. This document describes decisions and contracts; it is not test evidence. Consult [the workflow guide](EXPERIMENT_WORKSPACE.md) and [the verification report](EXPERIMENT_WORKSPACE_VERIFICATION.md) for observed behavior and limits. General matrix execution does not establish causal performance improvement.

---

## 2. Design Brainstorming: Six Distinct Architectural Approaches

Before converging on the contract architecture, six distinct design directions were evaluated across the spectrum from **eliminating any separate experiment screen** ("zero-screen inline batch") to the **opposite pole of a task-first benchmark suite builder**, plus intermediate storage, orchestration, and state-linking models.

### Approach 1: Eliminate Separate Screen — Inline Single-Form Batch Bar ("Zero-Screen")
- **Concept**: No dedicated experiment panel, no separate screen, and no snapshot abstraction. Inside the existing single-run Harnesses form, replace single-select `Model` and `Task` dropdowns with multi-select pills and add a `Repeats` stepper next to the existing `Run` button. Clicking `Run` fans out the currently active form draft across selected `models × tasks`.
- **Strengths**: Zero navigation overhead; minimal UI surface area; immediate transition from single trial to multi-model/multi-task sweep for a single harness.
- **Fatal Flaws**:
  - **Cannot compare multiple harnesses** (e.g., stock vs. custom system prompt vs. native intervention) in a single reproducible plan because only one active form state exists at dispatch time.
  - **No freeze/review checkpoint** before multi-trial spend; editing a form field mid-setup mutates every cell implicitly.
  - Conflates ad-hoc single-job execution with multi-trial experiment lifecycle (seed, aggregate budget cap, manifest freeze, resumable queue).

### Approach 2: Opposite Pole — Task-First Benchmark Suite Screen (`/app/benchmarks`)
- **Concept**: Invert the hierarchy around tasks and evaluation cohorts on a dedicated `/app/benchmarks` screen. Users first curate a named **Task Suite** (selecting runnable tasks, grading rubrics, seeds, and suite-level budget policies), save the suite, and only then attach "Candidate Contenders" (`harness + model` pairs) from a picker modal to run against the suite.
- **Strengths**: Natural mental model for leaderboard maintainers and instructors who hold a problem set constant across a semester and evaluate incoming harnesses against it; makes task-level pass-rate aggregation primary.
- **Fatal Flaws**:
  - **Breaks single-surface authoring**: Forces users out of `/app` Harnesses just to test whether a prompt or native intervention edit generalizes across 3 tasks; harness iteration becomes second-class behind modal pickers.
  - **Splits draft state and provenance**: Forking a recording or tweaking JSON in Harnesses requires saving/exporting a preset before `/app/benchmarks` can see it, encouraging preset sprawl or new server persistence routes forbidden by the architecture.
  - Poor fit for 1-task multi-harness or model-ablation studies where the harness intervention—not a benchmark suite—is the primary object of study.

### Approach 3: Dedicated Experiment Studio Route + Normalized Backend Storage
- **Concept**: Add `/app/experiments` as a full-screen multi-step wizard backed by new Worker endpoints and normalized SQL/DO tables (`experiment_drafts`, `experiment_arms`, `experiment_trials`), storing server-side mutable drafts prior to freeze.
- **Strengths**: Rich server-persisted draft collaboration, URL-addressable draft workspaces, relational querying across historical experiments.
- **Fatal Flaws**:
  - **Violates infrastructure constraints**: Requires new routes, schema migrations/SQL/DO structures, and server-side draft CRUD outside `/api/runner/experiments`.
  - **Duplicates configuration authoring**: Either duplicates form + JSON editing on `/app/experiments` or forces constant route ping-ponging back to `/app` Harnesses.

### Approach 4: Browser-Orchestrated Loop Over Single-Job `/api/runner/jobs`
- **Concept**: Keep `/app` Harnesses as one screen and add a client-side matrix UI, but leave `/api/runner/experiments` v1 untouched. The browser stores the N-cell queue in `localStorage` and dispatches sequential `/api/runner/jobs` requests from an active browser tab.
- **Strengths**: Zero Worker protocol changes; trivial backend blast radius.
- **Fatal Flaws**:
  - **Breaks durability and scientific integrity**: Closing the laptop lid, losing Wi-Fi, or refreshing mid-run halts scheduling without server-owned freeze manifests or deterministic server-recorded trial ordering.
  - **Unsafe failure/cost semantics**: A tab reload during an in-flight submission cannot safely distinguish uncertain submission from unstarted work without server-side experiment reconciliation, risking duplicate spend or orphaned budget enforcement.

### Approach 5: Integrated Matrix with Live-Linked Mutable Drafts & Auto-Syncing JSON
- **Concept**: Embed the experiment matrix inside `/app` Harnesses and add a live `JSON` `<textarea>` that auto-parses on every keystroke (`onChange` -> mutate parent draft), while matrix rows hold live pointers to editable harness slots rather than frozen snapshots.
- **Strengths**: Zero extra clicks ("Capture snapshot" / "Apply JSON" eliminated); instant reactivity when valid.
- **Fatal Flaws**:
  - **Corrupts Undo history and partial-edit safety**: Keystroke-level auto-apply either floods the Undo stack on every valid intermediate character or partially mutates/clears fields during transient states; external form edits collide destructively with half-typed JSON.
  - **Silent experiment drift**: Tweaking a prompt field in the rig silently mutates already-configured matrix arms, invalidating reviewed cell assumptions right before freeze.

### Approach 6: Integrated `/app` Harnesses Workspace + Immutable Snapshot Matrix + Explicit-Apply Draft JSON + General Durable Plan v2 (Converged Architecture)
- **Concept**: Keep `/app` React Harnesses as the **single member surface**. Preserve the read-only JSON inspector for historical/recorded evidence, and add an explicit current-draft `ConfigurationEditor` (`Apply JSON` / `Discard JSON edits` + full diff + conflict detection + dirty dispatch lock). Alongside the preserved narrow paired-native v1 UI, mount `ExperimentWorkspace` inside `/app` Harnesses: users capture immutable named snapshots of the current validated harness draft (ignoring captured `model_id`/`task_id` on expansion), select multiple models and runnable tasks from the live `catalog`, deterministically expand all `snapshot × model × task` cells into a `version: 2` experiment plan (`1–64` arms, `1–10` repeats, `<= 64` trials, `<= $100` budget, `<= 768 KiB` frozen limit), and execute preflight, freeze, sequential durable scheduling, pause/resume, cancel, and export through existing `/api/runner/experiments` endpoints.

### Comparison Matrix

| Criterion | 1. Zero-Screen Inline Bar | 2. Task-First `/benchmarks` | 3. Studio Route + SQL/DO | 4. Browser Job Loop | 5. Live-Linked + Auto-JSON | **6. Integrated Snapshot Matrix + Explicit v2** |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| Single member surface (`/app` Harnesses) | Yes | No (new screen) | No (new route) | Yes | Yes | **Yes** |
| Multi-harness (`stock`/`custom`/`native`) comparison | No (1 active draft) | Indirect (via saved presets) | Yes | Yes | Fragile (mutable drift) | **Yes (immutable named snapshots)** |
| Multi-task cohort evaluation | Partial | Strong | Strong | Strong | Strong | **Strong (catalog task multi-select)** |
| No new routes / DOs / SQL / services | Yes | Likely no | No (violates constraint) | Yes | Yes | **Yes (reuses `/api/runner/experiments`)** |
| Durable server freeze & crash-safe scheduling | No | Yes | Yes | No (tab-bound) | Yes | **Yes (existing sequential scheduler)** |
| Safe JSON <-> Form roundtrip & Undo integrity | N/A | Separate | Separate | N/A | Poor (auto-sync hazards) | **High (explicit Apply/Discard + conflict lock)** |
| Preserves existing paired-native v1 compatibility | Risky (replaces form) | Yes | Yes | Yes | Risky | **Yes (v1 byte/schema + narrow UI kept)** |

### Convergence Rationale
Approach 6 captures the core ergonomic insight of **Approach 1** (never leave the Harnesses rig where configurations are authored and forked) AND the multi-task cohort power of **Approach 2** (selecting a runnable task set + model set once and crossing them deterministically), while eliminating Approach 1's single-harness ceiling via **immutable named harness snapshots**, eliminating Approach 4's durability hazards via **Frozen Plan v2 on `/api/runner/experiments`**, and eliminating Approach 5's state-corruption bugs via **immutable captures and explicit-apply `ConfigurationEditor` with dirty-state locking**.

---

## 3. End-to-End User Flows

### 3.1 Class / Instructor Flow (Curating & Auditing a Reproducible Assignment)
1. **Author baseline harness**: Instructor opens `/app` Harnesses, configures a stock or custom harness with conservative per-trial `limits.max_cost_usd` (e.g., `$0.25`), verifies canonical configuration in `ConfigurationEditor` (diff is empty, state clean), and runs or exports a reference recording/manifest for students.
2. **Verify task × model feasibility**: Instructor captures `"Baseline Stock"` and `"Reference Guided Prompt"` snapshots in `ExperimentWorkspace`, selects 2 class-approved models and 3 runnable catalog tasks (`2 × 2 × 3 = 12` arms, `repeats = 1`, `seed = 20261111`, `budget_usd = 3.00`, worst-case ceiling `12 × $0.25 × 1 = $3.00 <= $3.00`).
3. **Preflight, freeze, and run**: Instructor runs Review/Preflight (all 12 manifests verified, no incompatible cells), freezes the v2 plan, starts execution with their transient runner credential (never persisted), and exports the completed v2 results artifact showing manifest hashes, grades, and costs per cell.
4. **Audit student submissions**: When students submit exported experiment results or recordings, the instructor inspects exact config/prompt manifest hashes and grades in the read-only historical JSON inspector without ever handling student API credentials.

### 3.2 Student Flow (Forking a Recording, Editing Safely, Running Bounded Ablations)
1. **Fork from class recording**: Student opens a recorded run or hosted manifest and triggers **Fork to Draft** (`configurationFromManifest` or `configurationFromRecordedHarness`).
2. **Inspect provenance & caps**: Root UI populates the editable draft while preserving the raw source snapshot + cryptographic hash alongside it, visibly flagging any newly applied dispatch resource caps (e.g., `limits.max_cost_usd` clamped for live dispatch) and warning if the recorded `model_id`, `task_id`, or `runtime` is stale/unregistered so re-review of the new manifest is mandatory.
3. **Edit via form + `ConfigurationEditor`**: Student edits prompt/intervention JSON in `ConfigurationEditor`. While typing invalid JSON or unapplied changes, `onPendingChange(true)` disables single-run dispatch, **Capture Snapshot**, and **Review Experiment** with a clear banner (`"Apply or discard pending JSON edits before capturing or dispatching"`). Student views the full diff, clicks **Apply JSON** (committed via `applyDraft(applyConfiguration(...))`, enabling single-step Undo), and captures `"My V1 Prompt"`.
4. **Iterate & capture second arm**: Student tweaks temperature/intervention in form controls, captures `"My V2 Tool Policy"` (confirming `"My V1 Prompt"` remains immutable), selects 1 model and 3 runnable tasks (`6` arms, `repeats = 2` -> `12` trials), sets `budget_usd = 5.00`.
5. **Hit & recover from guardrails**: If `12 × $0.50 = $6.00 > $5.00`, `ExperimentWorkspace` blocks Review with exact ceiling math (`Worst-case $6.00 exceeds budget $5.00`). Student lowers per-trial `max_cost_usd` (explicitly clicking **Replace Snapshot** on each captured harness so updated limits take effect) or raises `budget_usd` to `$6.00`, freezes, runs, clicks **Open Job** (`onOpenJob`) on a failing trial to inspect its trace, and exports results.

### 3.3 Researcher Flow (Factorial Matrix, Native Interventions, Expiry Recovery, Scientific Export)
1. **Capture heterogeneous harnesses**: Researcher authors three harnesses in `/app`:
   - Snapshot A: `version: 1` stock harness (no profile).
   - Snapshot B: `version: 1` custom engine harness with edited blocks.
   - Snapshot C: `version: 2` native intervention harness with pinned native inventory.
2. **Expand matrix & diagnose incompatibilities**: Researcher selects 3 catalog models and 2 runnable tasks (`3 × 3 × 2 = 18` cells) with `repeats = 3` (`54 <= 64` total trials) and deterministic `seed`. Suppose Model 3 does not support Snapshot C's native runtime/intervention: the 2 affected cells render inline in the matrix as **Incompatible** with explicit diagnostic text rather than disappearing silently. Researcher explicitly excludes incompatible cells using the per-cell checkboxes or Select verified cells, keeping excluded candidates visible. They can also deselect a model (`3 × 2 × 2 = 12` arms × `3` repeats = `36` trials), verifying estimated frozen size is well below `768 KiB` and worst-case ceiling `<= budget_usd <= $100`.
3. **Freeze & durable execution**: Preflight resolves all 12 arm manifests and validates Snapshot C's native inventory/pins. Freeze persists reviewed configurations, manifests, deterministic 36-trial schedule, `budget_usd`, `reference_arm_id: arms[0].id`, and `comparisons: []`.
4. **Mid-run credential expiry & uncertain-cost safety**: At trial 21/36, the transient runner credential expires; scheduler halts cleanly without persisting credentials or auto-retrying any in-flight uncertain trial. Researcher supplies a fresh credential and clicks **Resume**; remaining unstarted trials execute sequentially in frozen schedule order. Any trial whose cost is unknown displays `unknown` cost explicitly rather than `$0.00`.
5. **Export without spurious causal claims**: Researcher exports the v2 experiment record. Every trial carries runtime, model, task, prompt/config manifest hash, state, grade, and known/unknown cost; `comparisons` is `[]` so N-way observational grids are never misrepresented as matched v1 contrasts.

---

## 4. System Specification & Exact Contracts

### 4.1 Surface Architecture (`/app` React Harnesses Workspace)
- **Single surface rule**: All authoring and experiment dispatch occur inside `/app` Harnesses. No arbitrary user code executes in `/app`; all trial execution happens on the existing private runner.
- **Separation of historical evidence vs. mutable draft**:
  - The **existing JSON inspector** remains strictly **read-only** when viewing historical jobs, recordings, or frozen manifests.
  - **Current-draft editing** happens exclusively through existing structured form fields and the new `ConfigurationEditor` component bound to the active mutable draft.
- **Coexistence with v1 paired-native UI**:
  - The existing narrow paired-native v1 experiment UI remains available and functional for matched native-profile studies (`version: 1`).
  - `ExperimentWorkspace` provides the general `version: 2` matrix workflow (`harness snapshots × models × tasks`) within the same `/app` Harnesses surface using existing rig design tokens.

### 4.2 Protocol Contract: General Experiment Plan v2 (`/api/runner/experiments`)

No new routes, services, Durable Objects, `workers.dev` hosts, or SQL tables are introduced. Existing auth, `Origin`, CSRF/method, lease, and per-member ownership gates remain unchanged.

#### Draft / Preflight / Freeze Input Payload (`version: 2`)
```json
{
  "version": 2,
  "name": "string (existing name charset/length constraints)",
  "seed": 20261111,
  "repeats": 3,
  "budget_usd": 25.0,
  "arms": [
    {
      "id": "arm-01",
      "label": "baseline-stock / claude-sonnet / task-parse-url",
      "configuration": {
        "version": 1
      }
    }
  ]
}
```

#### Normative Protocol Invariants
1. **Orthogonal versioning**:
   - Plan `version` is literal `2` (distinguishing general matrix plans from `version: 1` paired plans).
   - Each `arm.configuration` is an existing strict `version: 1` (standard stock/custom) or `version: 2` (native intervention) run configuration. Both `configuration.version === 1` and `configuration.version === 2` are valid within a `version: 2` experiment plan, and may coexist across different arms of the same v2 plan.
2. **Cardinality & payload bounds**:
   - `arms`: non-empty array of `1` to `64` items (`1 <= arms.length <= 64`).
   - `repeats`: integer in `[1, 10]`.
   - Total trials: `arms.length * repeats <= 64`.
   - Existing `name`, `arm.id`, `arm.label`, secret-scanning/redaction, and HTTP request body size restrictions remain enforced; `arm.id` values must be unique within `arms`.
   - Serialized frozen plan record size **must not exceed `768 KiB` (`786,432` bytes)** enforced on the server prior to committing freeze.
3. **Configuration uniqueness across arms**:
   - No two arms in `arms` may resolve to an identical canonical configuration (ignoring `arm.id` and `arm.label`). Duplicate configurations reject the whole plan naming both colliding arm labels/ids.
4. **Budget & worst-case ceiling**:
   - `budget_usd`: finite `number`, `budget_usd > 0 && budget_usd <= 100`.
   - Every `arm.configuration.limits.max_cost_usd` must be a finite positive number per existing strict run configuration rules.
   - Aggregate worst-case cost ceiling:
     $$\left(\sum_{i=1}^{|arms|} \text{arm}_i.\text{configuration.limits.max\_cost\_usd}\right) \times \text{repeats} \le \min(\text{budget\_usd}, 100)$$
   - Arithmetic comparison must avoid binary floating-point false positives/negatives (see §7.2: normalize currency amounts to integer microdollars `Math.round(usd * 1_000_000)` after validating precision, or apply canonical fixed-point arithmetic identically in client and Worker).
5. **All-or-nothing validation & preflight**:
   - Every arm is resolved through the existing runner preflight pipeline (verifying catalog `model_id`, runnable `task_id`, runtime availability, native inventories/pins, and manifest cryptographic hashes).
   - Any invalid or incompatible arm **refuses the entire plan** with an error message identifying the offending arm's `label` (and `id`). Silent dropping or filtering of arms is forbidden on both client and server.
6. **Frozen v2 Plan Schema & Comparison Suppression**:
   - Retains all existing frozen experiment fields (`version: 2`, `id`, `name`, `seed`, `repeats`, `arms` with frozen reviewed configurations + full manifests + manifest hashes, deterministic trial `schedule`, `status`, timestamps, owner identity) and adds `budget_usd`.
   - `reference_arm_id` is set to `arms[0].id` for structural schema compatibility.
   - **Causal comparison suppression**: For `version === 2`, `comparisons` is always `[]` (empty array); paired/causal summary computation is skipped. Existing `version === 1` plans retain paired comparison behavior byte-for-byte and schema-for-schema.
7. **Execution, Durability, and Credentials**:
   - Reuses existing sequential durable scheduler, deterministic trial identities, cancellation, worker restart reconciliation, per-member ownership, and credential expiry pause/resume semantics.
   - Uncertain runner submissions are **never** automatically retried.
   - Runner credentials are **never** persisted in frozen plans, checkpoints, DO storage, or logs.

### 4.3 Frontend Matrix Component: `ExperimentWorkspace`

#### Signature
```js
ExperimentWorkspace({
  configuration, // Strict active run configuration from Harnesses rig
  catalog,       // Real runner catalog (models, tasks with runnable metadata, runtimes/profiles)
  credential,    // Transient member runner credential state (present/valid/expired; never persisted)
  available,     // Boolean: runner/experiment service availability
  disabled,      // Boolean: parent lock (true when ConfigurationEditor has pending/invalid/conflict edits or parent busy)
  lease,         // Current member execution lease state
  onOpenJob,     // Callback (jobId) => void to inspect a specific trial job in /app
})
```

#### Functional Behavior
1. **Immutable Harness Snapshot Capture**:
   - User enters/confirms a human-readable snapshot label (e.g., `"Stock v1"`, `"Native Pinned"`) and captures `configuration`.
   - Captured snapshot deep-clones and freezes `configuration` at capture time, recording its non-axis settings (harness kind: stock/custom/native, profile presence/absence, prompt/instructions, native intervention v2 settings, limits including `max_cost_usd`). Captured `model_id` and `task_id` are ignored during matrix expansion (recorded only as capture provenance metadata if helpful for display).
   - **Immutability**: Editing parent `configuration` fields after capture **never** mutates existing snapshots. Each snapshot card exposes explicit **Replace with Current Draft** (disabled when `disabled === true`) and **Remove** actions.
2. **Catalog Model & Task Multi-Selection**:
   - Multi-select controls for **Models** (from `catalog.models`) and **Runnable Tasks** (filtered/badged from `catalog.tasks` so only registered runnable tasks can be selected, with search/filter and responsive layout for large task catalogs).
3. **Deterministic Cell Expansion & Compatibility Diagnostics**:
   - Expands `snapshots × selectedModels × selectedTasks` in deterministic major-to-minor order (`snapshotIndex -> modelIndex -> taskIndex`).
   - Each expanded cell constructs its candidate arm configuration by substituting `model_id` and `task_id` onto the captured snapshot's immutable configuration, generating deterministic `arm.id` and human-readable `arm.label` (`"<snapshotLabel> · <modelId> · <taskId>"`).
   - Evaluates local compatibility rules (e.g., model/runtime mismatch, native intervention unsupported on target model/task, duplicate resulting canonical configuration across two identically configured snapshots) and displays explicit per-cell **Incompatibility / Duplicate** diagnostics inline. **Never silently omits an expanded cell.**
4. **Plan Parameters & Live Guardrail Meters**:
   - Inputs: `name`, `repeats` (`1–10`), `seed` (integer), `budget_usd` (`> 0`, `<= 100`).
   - Live readouts & pre-review blockers:
     - Arm count (`1–64`), total trials (`arms.length * repeats <= 64`).
     - Worst-case cost ceiling (`sum(arm.max_cost_usd) * repeats`) compared against `budget_usd` and `$100.00`.
     - Estimated serialized payload / frozen plan size budget against `768 KiB`, showing bounded authoring size errors when exceeded.
     - Pending JSON editor lock (`disabled === true`), incompatible cell count (`> 0`), duplicate arm config count (`> 0`).
5. **Lifecycle Actions via `runnerRequest`**:
   - **Review / Preflight** -> displays resolved manifest hashes per arm, schedule preview (`<= 64` trials), `budget_usd`, and worst-case ceiling.
   - **Freeze Plan** -> persists frozen v2 plan on server; locks plan inputs.
   - **Start / Resume** -> requires valid transient `credential` and compatible `lease`/`available` state; explicitly confirms `budget_usd` ceiling.
   - **Cancel** -> cancels active experiment cleanly via existing endpoint.
   - **History & Reload** -> lists member's existing v1 and v2 experiments via existing endpoints and loads selected experiment into queue/results view.
6. **Queue, Results, and Export**:
   - Scrollable, accessible table displaying every cell × repetition trial with columns:
     1. Trial `#` & Arm Label (`id` / `label`, repetition `r / repeats`)
     2. Runtime & Harness Kind (`stock` / `custom` / `native`, profile indicator)
     3. Model (`model_id`)
     4. Task (`task_id`)
     5. Manifest Identity (prompt/config manifest hash/short-id with full copyable hash)
     6. Execution State (`queued`, `running`, `completed`, `failed`, `cancelled`, `uncertain`, `blocked_credential`, etc.)
     7. Grade / Outcome
     8. Cost (`$X.XXXX` when known; explicit `unknown` badge when null/uncertain—never coerced to `$0.00`)
     9. Action: **Open Job** button invoking `onOpenJob(trial.job_id)` when `job_id` exists.
   - **Export**: Downloads structured experiment summary + trial rows + frozen manifest identities + `budget_usd` (with `comparisons: []` for v2; no causal delta columns rendered for v2).
7. **Design System & Accessibility**:
   - Uses existing rig CSS custom properties / design tokens; every input has an explicit `<label htmlFor>` or `aria-label`; incompatible/error banners use `role="alert"` / `aria-live="polite"`; task picker is keyboard-operable and responsive across narrow/wide viewports; results table scrolls horizontally/vertically without breaking page layout.

### 4.4 Frontend Current-Draft JSON Editor: `ConfigurationEditor`

#### Signature
```js
ConfigurationEditor({
  configuration,   // Current canonical validated configuration object owned by parent
  disabled,        // Boolean: disables editing/applying while parent run/freeze mutation is in flight
  onApply,         // (validatedConfigurationObject) => void; parent wraps in applyDraft(applyConfiguration(...))
  onPendingChange, // (hasPendingOrInvalidOrConflict: boolean) => void
})
```

#### State Machine & Invariants
Let `canonicalJson = formatCanonicalConfiguration(configuration)` (deterministic 2-space indented JSON of the complete current configuration).

| State | Condition | `onPendingChange` | Allowed Actions |
| :--- | :--- | :---: | :--- |
| `clean` | `text === canonicalJson` and no external conflict | `false` | Edit textarea |
| `dirty_valid` | `text !== baseCanonicalJson`, `configuration` unchanged since edit began, `parseConfiguration(text)` succeeds, and parsed canonical differs from `configuration` | `true` | **Apply JSON**, **Discard JSON edits**, inspect full diff |
| `dirty_noop` | Whitespace-only edit where `parseConfiguration(text)` equals `configuration` canonically | `true` until formatted/applied or discarded (or normalize on Apply; never mutate without click) | **Apply JSON** (normalizes formatting) / **Discard JSON edits** |
| `dirty_invalid` | `text !== canonicalJson` and (`JSON.parse` throws OR `parseConfiguration` throws, including unknown fields) | `true` | Fix text, **Discard JSON edits** (**Apply JSON** disabled; error message shown) |
| `conflict` | User had unapplied `text !== baseCanonicalJson` AND parent `configuration` prop changed externally to a new value whose canonical serialization `!== text` | `true` | Inspect diff against **current** `configuration`; **Discard JSON edits** (adopt parent's new `configuration`) or **Apply JSON** (only if `parseConfiguration(text)` is valid, explicitly overwriting parent's field edit via `onApply` so Undo still records both steps) |

#### Critical Behavioral Rules
1. **Complete schema validation without silent stripping**:
   - `parseConfiguration` must validate against the exact known strict v1/v2 run configuration schema and **reject unknown keys at root and nested objects** rather than silently dropping them.
2. **Zero partial mutation**:
   - Invalid or unapplied JSON never mutates parent state. Parent state changes ONLY when user clicks **Apply JSON** on valid JSON, invoking `onApply(validatedConfig)`.
3. **Undo / Checkpoint / Import-Export Preservation**:
   - Parent handles `onApply(nextConfig)` through existing `applyDraft(applyConfiguration(...))` so browser-session Undo/Redo, checkpoints, and JSON import/export treat JSON edits identically to structured form edits.
4. **Full Diff View**:
   - Whenever `text !== canonicalJson`, render a complete line/field diff comparing current `configuration` (`canonicalJson`) against candidate `text` (or against parsed canonical JSON when valid, and raw line diff when invalid/conflicted).
5. **Lifecycle & Unmount Cleanup**:
   - Calls `onPendingChange(false)` when transitioning back to `clean` and inside unmount cleanup (`() => onPendingChange?.(false)`).
   - **Mount persistence requirement**: Parent in `/app` must not unmount `ConfigurationEditor` merely via decorative accordion collapse while `pending === true` (hide via CSS `hidden` or confirm discard before collapse—see §7.5).

### 4.5 Recording Fork Helper: `configuration-from-recording.js`

#### Exported API
```js
export function configurationFromManifest(manifest) -> strictConfiguration
export function configurationFromRecordedHarness({ harness, modelId, taskId }) -> strictConfiguration
```

#### Behavioral Rules
1. **Strict reconstruction only — never substitute current presets**:
   - Every field of the returned object must come from the recorded manifest / recorded harness engine configuration (plus explicit `modelId` / `taskId` arguments in `configurationFromRecordedHarness`) and pass strict `parseConfiguration`.
   - If a recording predates required fields or contains only partial summary metadata (e.g., native/imported recording lacking full intervention spec, prompt body, runtime inventory pin, or tool policy), **throw a human-readable `Error`** explaining the exact missing/insufficient field(s). Never fall back to current default presets.
2. **Refusal on unsupported non-empty settings**:
   - If the recorded configuration or manifest contains unsupported or non-dispatchable non-empty engine settings (e.g., non-empty `sentinel` configuration, private runner-only hooks, or unknown schema version/fields), **throw a human-readable `Error`** naming the unsupported setting rather than silently dropping it.
3. **Deliberate new dispatch resource caps**:
   - `configurationFromManifest(manifest)`: Reconstructs the exact strict v1 or v2 run configuration encoded in a complete hosted/recorded manifest; throws if incomplete, malformed, or containing unsupported fields.
   - `configurationFromRecordedHarness({ harness, modelId, taskId })`: Maps a complete recorded engine `harness` object plus `modelId` and `taskId` into a strict v1/v2 run configuration. Where recorded historical runs had unbounded, missing, or out-of-range execution caps relative to live member runner limits (`limits.max_cost_usd`, step/turn/timeout caps), applies explicit bounded live dispatch caps so the resulting configuration is valid for editing, while ensuring Root UI can compare recorded `harness` caps vs. returned `strictConfiguration.limits` to display an explicit **"New dispatch resource caps applied"** notice.
4. **Root UI Provenance & Re-Review Obligations**:
   - Alongside the forked draft, Root preserves `{ rawSourceSnapshot, sourceHash, sourceKind }` as immutable provenance metadata (outside the strict config payload itself).
   - Root cross-checks forked `model_id`, `task_id`, and `runtime` against live `catalog` and badges stale/unregistered identifiers immediately.
   - Forking **always** clears any prior reviewed/frozen manifest state so re-review of the newly computed manifest is required before dispatch or experiment freeze.

---

## 5. Explicit Assumptions & Non-Goals

### Assumptions
1. Existing `/api/runner/experiments` routes already implement authentication, origin/CSRF checks, per-member ownership isolation, runner preflight invocation, manifest hashing, durable sequential trial execution, lease checks, and v1 paired experiment storage.
2. Existing `parseConfiguration` and `applyConfiguration` define the canonical strict v1 (stock/custom) and v2 (native intervention) run configuration shapes used across `/app` and Worker preflight.
3. `catalog` passed to `ExperimentWorkspace` exposes registered models, tasks (with sufficient flags/status to distinguish registered **runnable** tasks from retired/non-runnable tasks), and runtime/profile metadata.
4. Transient `credential` is held in client memory / existing session mechanism only and passed on start/resume requests exactly as in v1.

### Non-Goals
- No causal/paired statistical inference (`comparisons`) on v2 experiments (multi-factor matrices are observational/comparative across trials; paired causal analysis remains the domain of v1).
- No parallel multi-worker fan-out changes to the sequential durable scheduler.
- No server-side persistence of un-frozen drafts or multi-user collaborative editing.
- No arbitrary JavaScript/code execution in `/app`.

---

## 6. Failure Cases & Recovery Matrix

| Failure Scenario | Layer | Expected Behavior & User-Facing Recovery |
| :--- | :--- | :--- |
| Malformed JSON syntax or unknown key in `ConfigurationEditor` | Client (`ConfigurationEditor`) | Parse fails; `Apply JSON` disabled; exact syntax/unknown-key message displayed; `onPendingChange(true)` blocks single-run dispatch, snapshot capture, and experiment review. `Discard JSON edits` restores clean canonical JSON. |
| Parent form edited while `ConfigurationEditor` has unapplied text | Client (`ConfigurationEditor`) | Editor detects `configuration` prop change while dirty, transitions to `conflict` state without overwriting textarea text, keeps `onPendingChange(true)`, shows diff against updated `configuration`, requires explicit Discard or valid Apply. |
| Captured snapshot combined with incompatible model or task | Client (`ExperimentWorkspace`) + Worker Preflight | Client renders the cell inline with explicit incompatibility reason and blocks Review/Freeze. If sent to Worker `/api/runner/experiments`, server rejects the whole plan with `4xx` naming the offending arm `label` / `id`. |
| Two captured snapshots produce identical canonical configurations for same `(model, task)` | Client + Worker | Flagged inline as duplicate arm configuration (ignoring `id`/`label`); Review/Freeze blocked until duplicate snapshot/arm is updated or removed; server also rejects duplicate canonical configs. |
| Trial count `> 64`, arms `> 64`, arms `< 1`, or `repeats` outside `1..10` | Client + Worker | Live counter turns invalid and disables Review; server enforces `1 <= arms <= 64`, `1 <= repeats <= 10`, `arms * repeats <= 64`. |
| Worst-case cost `sum(max_cost_usd) * repeats > budget_usd` or `> $100`, or `budget_usd <= 0` / `NaN` / `Infinity` | Client + Worker | Live ceiling meter highlights breach (`Worst-case $X.XX > budget $Y.YY`); Review/Freeze refused on both client and server. |
| Frozen plan exceeds `768 KiB` (`786,432` bytes) due to large prompts/manifests across many arms | Client + Worker | Client shows bounded authoring size estimate warning/blocker before freeze; Worker measures serialized frozen record bytes and rejects `> 768 KiB` atomically before persisting. |
| Forked recording has partial native state, missing engine fields, or non-empty `sentinel` | Client (`configuration-from-recording.js`) | Helper throws human-readable `Error` naming the unsupported/missing field; current draft is untouched; error banner shown in `/app` without substituting presets. |
| Forked recording references deprecated `model_id`, retired `task_id`, or unavailable `runtime` | Client (Root + `ExperimentWorkspace`) | Fork succeeds if config schema is complete, but Root flags stale/unregistered `model_id`/`task_id`/`runtime`; re-review is required and preflight refuses until valid catalog targets are chosen. |
| Runner credential expires mid-experiment | Worker Scheduler + `ExperimentWorkspace` | Active/completed trials remain intact; scheduler pauses before starting subsequent trials; credentials never written to disk; UI shows expired-credential banner and **Resume** button once fresh credential is provided. |
| Network drop / uncertain runner submission on trial $k$ | Worker Scheduler + `ExperimentWorkspace` | Scheduler marks trial $k$ as uncertain/non-retried (never auto-retries); trial cost displays `unknown` if unreported; worst-case budget remains safe because `max_cost_usd` was pre-reserved in ceiling math and no retry occurs. |
| Member closes browser tab during active v2 experiment | Worker Scheduler + `ExperimentWorkspace` | Sequential durable scheduler continues independently on server until completion, cancellation, or credential expiry; reopening `/app` reconciles live queue/results from `/api/runner/experiments`. |

---

## 7. Contract Challenges, Risks, and Integration Seams

The following challenges and seams in `CONTRACT.md` carry high integration risk across parallel collaborators and **must** be enforced consistently by Root:

### 7.1 `INFERRED` Seam: Unknown-Key Stripping Inside Existing `parseConfiguration`
- **Challenge**: `CONTRACT.md` mandates for `ConfigurationEditor`: *"parseConfiguration validation... Use known schema, no silent stripping of unknown fields."* In many JS codebases, configuration parsers validate known fields and construct a clean normalized return object (`return { version, model_id, ... }`) without asserting that `Object.keys(input)` contains **only** known keys at every object level (`root`, `limits`, `prompt`, `profile`, `intervention`, etc.).
- **Risk**: If `parseConfiguration` silently drops unknown keys (e.g., a typo `"max_tokenss": 500` or unsupported `"sentinel": {...}`), clicking **Apply JSON** would silently erase user input while claiming success!
- **Required Guard**: Audit `parseConfiguration` (or wrap/extend strict mode) so unknown keys at any nesting level throw a descriptive validation `Error` naming the unexpected property path.

### 7.2 `PROVEN` Mathematical Challenge: IEEE-754 Float Drift in Budget Ceiling Validation
- **Challenge**: `CONTRACT.md` specifies `sum(configuration.limits.max_cost_usd) * repeats <= budget_usd AND <= 100`. In IEEE-754 `Number`, `(0.1 + 0.2) * 1 === 0.30000000000000004 > 0.3`, and `19.99 * 5` or `0.15 * 3` exhibit binary rounding drift.
- **Risk**: A user sets 3 arms at `$0.10` (`repeats = 1`) and `budget_usd = 0.30`; naive `<`/`<=` rejects `$0.30000000000000004 <= 0.30` on server or disagrees between client and Worker.
- **Required Guard**: Define canonical fixed-point comparison in microdollars (`1 USD = 1_000_000` units, rejecting sub-microdollar precision or using `Math.round(x * 1e6)` consistently on finite validated inputs) in **both** `ExperimentWorkspace` and Worker v2 validation.

### 7.3 `PROVEN` UX vs. Protocol Tension: Strict Cartesian Expansion vs. Incompatible Cells
- **Challenge**: `CONTRACT.md` simultaneously requires:
  1. *"select multiple models and registered runnable tasks from real catalog, expand all cells, display incompatibility reasons... Build explicit cells deterministically; no silent exclusions."*
  2. *"Invalid/incompatible cells refuse the whole plan with identifiable arm label; never silently drop them."*
- **Risk**: When comparing a `v1` stock snapshot and a `v2` native snapshot across 2 models where Model B lacks native support (`2 × 2 × 1 = 4` Cartesian cells, 1 incompatible), strict Cartesian expansion produces 1 incompatible cell that blocks the entire plan at preflight unless either (a) the user runs only models compatible with *all* captured snapshots, or (b) the user can **explicitly** (never silently!) exclude/uncheck a specific incompatible cell while keeping it visibly listed as `"Excluded by user (incompatible)"` in the matrix UI before constructing `arms[]`.
- **Specification Decision & Seam**: By default, `ExperimentWorkspace` expands the full deterministic Cartesian grid `snapshots × models × tasks` into `arms[]` with zero exclusions and blocks Review while any cell is incompatible (guiding the user to adjust snapshots/models/tasks). Whether an explicit user-toggled per-cell opt-out checkbox is permitted is surfaced in **§9 Open Questions** so `ExperimentWorkspace` does not invent undocumented silent filtering.

### 7.4 `PROVEN` Namespace Seam: Plan `version: 2` vs. Run Configuration `version: 2`
- **Challenge**: Experiment plans have `version: 1 | 2`, and run configurations inside `arm.configuration` independently have `version: 1 | 2` (`2` = native intervention).
- **Risk**: Shared helper predicates (e.g., `isV2(obj)`), UI badges, or serializer switches can accidentally inspect `plan.version` when checking for native intervention or inspect `arm.configuration.version` when deciding whether to compute `comparisons`.
- **Required Guard**: Name predicates unambiguously (`isMatrixExperimentPlan(plan)` checking `plan.version === 2`; `isNativeInterventionConfig(config)` checking `config.version === 2`). Test all four combinations (`plan v1 + config v1/v2`, `plan v2 + config v1`, `plan v2 + config v2`, and mixed `config v1 + config v2` arms inside one `plan v2`).

### 7.5 `INFERRED` Lifecycle Seam: `ConfigurationEditor` Unmount Resetting Parent Dirty Lock
- **Challenge**: `CONTRACT.md` specifies `onPendingChange(bool) on dirty/error/conflict and false on clean/unmount`.
- **Risk**: If `/app` renders `ConfigurationEditor` inside a tab or `<details>`/collapsible drawer that **unmounts** children when closed, collapsing the JSON drawer while dirty fires `onPendingChange(false)`, **unlocking dispatch/capture** while discarding unapplied edits silently!
- **Required Guard**: Root integration in `/app` must either keep `ConfigurationEditor` mounted (toggling CSS visibility when collapsed) while on the Harnesses workspace, or block/confirm panel collapse whenever `hasPendingJsonEdits === true`.

### 7.6 `PROVEN` API Seam: `configurationFromRecordedHarness` Strict Return Type vs. Cap Provenance
- **Challenge**: `CONTRACT.md` specifies:
  - `configurationFromRecordedHarness({harness,modelId,taskId}) -> strict config with deliberate new resource caps clearly noted in root UI`
  - AND `parseConfiguration` requires strict schema with no unknown fields.
- **Risk**: If `configurationFromRecordedHarness` attaches `_provenance` or `appliedCaps` as enumerable properties on the returned config object, strict `parseConfiguration` will **reject** its own output! Conversely, if it returns only the plain strict config object, Root UI needs a deterministic way to know *which* caps were newly clamped/injected vs. originally recorded.
- **Required Guard**: `configurationFromRecordedHarness` and `configurationFromManifest` MUST return a pure, strict configuration object with zero extra enumerable keys. Root UI determines applied cap deltas either by comparing `recorded.harness?.limits` against `returnedConfig.limits` (deterministic pure diff in Root) or via an optional exported sidecar helper/non-enumerable metadata symbol—never by adding non-schema keys to the configuration object.

### 7.7 `PROVEN` Sizing Risk: Draft Size vs. `<= 768 KiB` Frozen Plan Size
- **Challenge**: A `version: 2` draft with 64 arms may be `< 100 KiB` over the wire during Review, yet once the Worker attaches 64 resolved full manifests, native inventory pins, and a 64-entry trial schedule, the **frozen** JSON document can exceed `768 KiB` (`786,432` bytes).
- **Required Guard**:
  1. Worker Freeze computes exact UTF-8 byte length of the complete frozen plan object before storage write and returns a structured `4xx`/`413` authoring size error if `byteLength > 786432`.
  2. `ExperimentWorkspace` estimates frozen byte footprint client-side (`serializedDraftBytes + arms.length * estimatedManifestOverheadBytes + trials * estimatedScheduleEntryBytes`) and surfaces early size warnings/errors as arm count or prompt length grows.

### 7.8 `PROVEN` Downstream Seam: `reference_arm_id` Present While `comparisons: []`
- **Challenge**: Frozen v2 plans keep `reference_arm_id = arms[0].id` for schema compatibility while setting `comparisons = []`.
- **Required Guard**: Existing v1 results viewers, history cards, and exporters must check `plan.version === 1` before rendering `"Reference / Control Arm"` badges on `reference_arm_id` or rendering causal comparison summary panels.

---

## 8. Concrete Acceptance Criteria

### 8.1 Protocol & Worker (`AC-PROTO`)
- **`AC-PROTO-01` (v1 Compatibility)**: Existing `version: 1` paired-native experiment requests, preflights, frozen records, `comparisons` summaries, and responses remain byte-for-byte and schema compatible.
- **`AC-PROTO-02` (v2 Shape & Bounds)**: `/api/runner/experiments` accepts `version: 2` plans with `1..64` unique arms, `1..10` integer `repeats`, `arms.length * repeats <= 64`, finite `0 < budget_usd <= 100`, and rejects any violation with `4xx`.
- **`AC-PROTO-03` (Mixed Config Versions)**: A `version: 2` experiment plan accepts arms with strict `configuration.version === 1` (stock/custom, with or without profile) and strict `configuration.version === 2` (native intervention) within the same plan.
- **`AC-PROTO-04` (Duplicate Arm Rejection)**: Two arms with distinct `id`/`label` bit-identical canonical configurations are rejected with an error identifying the colliding arm labels.
- **`AC-PROTO-05` (Worst-Case Budget Ceiling)**: Plans where `sum(arm.configuration.limits.max_cost_usd) * repeats` exceeds `budget_usd` or `100` are rejected; exact boundary values (e.g., `3` arms × `$0.10` × `1` repeat with `budget_usd: 0.30`) succeed without IEEE-754 false rejection.
- **`AC-PROTO-06` (All-or-Nothing Preflight)**: Any arm with an invalid configuration, incompatible model/task/runtime, or unverified native inventory/manifest hash refuses the entire plan with that arm's `label` in the error—never silently dropping the arm.
- **`AC-PROTO-07` (Frozen v2 Invariants & `768 KiB` Cap)**: Frozen v2 record persists reviewed configurations, full manifests, schedule, `budget_usd`, `reference_arm_id === arms[0].id`, and `comparisons: []`; serialized frozen payloads `> 786,432` bytes are refused cleanly.
- **`AC-PROTO-08` (Durable Execution & Security)**: Sequential scheduler, cancel, restart reconciliation, per-member ownership, no uncertain-submission auto-retry, credential expiry pause/resume, and zero credential persistence hold identically for v2.

### 8.2 Current-Draft JSON Editor (`AC-EDIT`)
- **`AC-EDIT-01` (Canonical Roundtrip)**: `ConfigurationEditor` renders the complete canonical JSON of `configuration`; editing a parent form field updates the textarea when clean.
- **`AC-EDIT-02` (Strict Schema & Unknown Fields)**: Invalid JSON syntax, schema violations, or **any unknown field** fail `parseConfiguration` validation, disable `Apply JSON`, display a clear error, and do not mutate parent state.
- **`AC-EDIT-03` (Explicit Apply / Discard & Diff)**: Edits show a full diff from current `configuration`; parent state updates only on `Apply JSON` (via `onApply` -> `applyDraft(applyConfiguration(...))`, preserving Undo, checkpoints, import/export) and reverts cleanly on `Discard JSON edits`.
- **`AC-EDIT-04` (Pending Lock & External Conflict)**: `onPendingChange(true)` fires on dirty, invalid, and conflict states (blocking single-run dispatch, snapshot capture, and experiment review in parent), and `onPendingChange(false)` fires on clean and unmount. External edits to `configuration` while dirty trigger an explicit `conflict` state rather than overwriting pending textarea text.

### 8.3 Matrix Workspace (`AC-MATRIX`)
- **`AC-MATRIX-01` (Immutable Snapshot Capture)**: Capturing a named snapshot freezes its non-axis harness settings (stock/custom/native, profile/no-profile, prompt, limits, interventions), ignores captured `model_id`/`task_id` on expansion, remains unaffected by subsequent parent form edits, and supports explicit Replace/Update and Remove.
- **`AC-MATRIX-02` (Deterministic Expansion & Zero Silent Exclusions)**: Selecting $H$ snapshots, $M$ catalog models, and $T$ registered runnable catalog tasks expands all $H \times M \times T$ cells deterministically and displays explicit per-cell incompatibility reasons without silent omission.
- **`AC-MATRIX-03` (Authoring Bounds UI)**: Displays live arm count (`1–64`), trial count (`<= 64`), `repeats` (`1–10`), `seed`, `budget_usd` (`<= $100`), aggregate worst-case cost ceiling, and bounded authoring size errors (`<= 768 KiB`), blocking review/freeze when violated or when `disabled` is true.
- **`AC-MATRIX-04` (Lifecycle, Queue/Results, Export)**: Executes review, freeze, start, resume, cancel, history load, and export via existing `runnerRequest` endpoints; results table renders every cell × repetition with runtime, model, task, prompt/config manifest identity, state, grade, known/unknown cost, and `onOpenJob` trigger; uses existing rig design tokens, accessible labels, responsive task picker, and scrollable results while keeping narrow v1 paired UI available.

### 8.4 Recording Fork Helper & Provenance (`AC-FORK`)
- **`AC-FORK-01` (`configurationFromManifest`)**: Maps a complete hosted/recorded manifest to a strict v1/v2 configuration without preset substitution; throws a human-readable `Error` on missing required fields, partial native/imported manifests, or unsupported non-empty settings (e.g., `sentinel`).
- **`AC-FORK-02` (`configurationFromRecordedHarness`)**: Maps `{ harness, modelId, taskId }` to a strict v1/v2 configuration with deliberate bounded live dispatch caps; throws a human-readable `Error` when partial or unsupported; returns zero unknown schema properties.
- **`AC-FORK-03` (Root Provenance & Re-Review)**: Root preserves raw source snapshot + hash beside the forked draft, explicitly marks newly applied dispatch resource caps and any stale/unregistered `task_id`/`model_id`/`runtime`, and requires re-review of the new manifest.

---

## 9. Handoff Summary & Open Questions for Root

### Exact Public Interfaces Specified
1. **Worker `/api/runner/experiments` v2 Draft**:
   `{ version: 2, name: string, seed: number, repeats: 1..10, budget_usd: number, arms: Array<{ id: string, label: string, configuration: StrictConfigV1OrV2 }> }`
2. **Frontend Matrix Workspace**:
   `ExperimentWorkspace({ configuration, catalog, credential, available, disabled, lease, onOpenJob })`
3. **Frontend Current-Draft JSON Editor**:
   `ConfigurationEditor({ configuration, disabled, onApply, onPendingChange })`
4. **Recording Fork Helper (`configuration-from-recording.js`)**:
   - `configurationFromManifest(manifest) -> StrictConfigV1OrV2`
   - `configurationFromRecordedHarness({ harness, modelId, taskId }) -> StrictConfigV1OrV2`

### Open Questions for Root Integration
1. **Explicit Cell Opt-Out vs. Strict Rectangular Axes (§7.3)**: When a heterogeneous snapshot matrix (e.g., 1 stock + 1 native snapshot across 2 models where 1 model lacks native support) produces 1 incompatible cell, should `ExperimentWorkspace` strictly require rectangular compatibility across selected axes (user runs two experiments or narrows models), or allow an **explicit user-unchecked** cell toggle (visibly kept in the grid as `"Excluded by user"` so nothing is silent, while omitted from `arms[]`)? Spec defaults to strict rectangular blocking unless Root opts into explicit per-cell toggle.
2. **Cap-Delta Surfacing Contract for `configurationFromRecordedHarness` (§7.6)**: Because `configurationFromRecordedHarness` returns a pure `StrictConfig` (no unknown keys allowed by `parseConfiguration`), confirm Root computes the `"new resource caps applied"` UI badge by diffing `recordedHarness.limits` against `returnedConfig.limits` directly in Root (rather than expecting a wrapper return shape or symbol).
3. **`ConfigurationEditor` Mount Persistence in `/app` (§7.5)**: Confirm `ConfigurationEditor` remains mounted while on `/app` Harnesses (or blocks collapse when dirty) so unmount cleanup `onPendingChange(false)` cannot accidentally clear the parent's dirty-JSON dispatch lock when toggling UI panels.
4. **Fixed-Point Unit for Budget Ceiling Check (§7.2)**: Confirm microdollar integer comparison (`Math.round(usd * 1_000_000)`) matches existing cost/limit precision in `parseConfiguration` and Worker experiment validation so exact boundary budgets (`3 × $0.10 == $0.30`) never fail due to IEEE-754 drift.

## Implemented selection policy

All expanded cells are initially included. Unsupported cells block review until explicitly excluded or their axes are changed. Select verified cells is an explicit author action; excluded candidates stay visible and are omitted from the submitted arms. The preview supports at most 512 candidates, with at most 64 included trials. A captured snapshot exposes its full configuration JSON; a saved experiment exposes its frozen configurations, manifests and schedule. Current draft edits never mutate these snapshots or frozen records.
