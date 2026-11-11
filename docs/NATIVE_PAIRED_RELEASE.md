# Native Codex editing and paired experiments

The 2026-11-11 follow-up adds **native Codex embedded asset editing** and a
**paired native experiment scheduler** to the existing member
[Harnesses workspace](https://traceharness.dev/app#/rig/harnesses).
The two specifications and three implementation assignments were followed by
an independent integration review. The workbench's eight datasets and 3,453
recorded runs remain in the exported snapshot with an unchanged data payload.

## Native prompt editing

Claude retains its existing 1,829 patchable fragment groups and 853 read-only
groups. Codex CLI 0.167.1 now exposes **22 source-owned asset groups: 13
patchable assets at 16 source occurrences, and nine read-only templates**.
The Codex counts describe whole matched assets, not every native instruction or
every prompt emitted during a run. Classes use the documented heuristic;
member-defined named sets can span classes.

Codex's inventory was prepared from the official source revision
`0a94398fa60c4fac0e7659e4213a0a36e613dd46` and matched to the exact registered
Linux executable. Only whole assets in the allocated, read-only, non-executable
`.rodata` section qualify. All occurrences must match; aliases, overlaps,
baseline drift, invalid Unicode and unsupported binary layouts refuse.
Dynamic templates remain read-only.

Codex uses fixed-size Rust text slices. **Disable blanks an asset with spaces;
it retains the original slice capacity.** Replacements must fit that asset's
UTF-8 byte capacity, with trailing spaces filling the remainder. The UI and
server both reject oversized replacements and distinguish content bytes from
the padded native span. A shorter replacement does not establish a token or cost
reduction. Claude's separate Bun source/cache mechanism is unchanged.

The existing editor supports selection, classes, named sets, Keep/Replace/Disable,
restore, undo, configuration import/export and checkpoints for both inventories.
Native overlays remain a separate field. Each run binds exact inventory, binary,
image, taxonomy, materializer and profile identities, with owner-bound application
and request-observation artifacts.

## Paired experiment workflow

Open **Compare prompt variants** in Harnesses. Capture the current configuration
as a named reference, edit its native profile, and capture another variant.
Choose paired repetitions and a schedule seed, then review and freeze the plan.
Freezing creates no model calls. **Start experiment** uses the member's existing
OpenRouter connection and may spend up to the displayed aggregate ceiling.

An experiment supports 2–8 native version-2 variants, 1–10 repetitions and at most
64 trials. Runtime, model, task, additional instructions, limits and seven native
inventory pins must match across arms; only the native profile can differ.
The maximum aggregate budget is the Decimal sum of all planned per-job caps,
bounded to $100. Savings never create extra trials.

The persisted `sha256-cyclic-v1` schedule uses a seeded arm order and rotates
positions across repetitions. Every repetition contains every arm once.
The seed controls scheduling, not native model sampling. Each trial has an
immutable identity and runs sequentially in a fresh workspace. Plan review and
every subsequent dispatch revalidate the exact manifests against current support.

The scheduler preserves every planned trial and outcome, including failed,
ungraded, refused, cancelled and incomplete trials. Restarted or uncertain work
does not automatically retry. Owner-bound submission reconciliation adopts an
existing job after acknowledgement loss or credential rotation. A paused worker
must finish before a successor can start; its cleanup cannot clear a successor's
credential. Cancellation waits for confirmed job termination.

Results show process state, grades, confirmed cost subtotals, unknown cost counts,
and paired grade denominators. Only pairs with two known task grades enter the
pass/fail comparison. A completed schedule does not mean its tasks passed.
One task and one repetition cannot establish general performance improvement.
Provider routing, changing prices and native sampling remain uncontrolled.

Experiments are stored outside the job directory, with private atomic state
writes. Credentials stay in memory. Copied terminal summaries survive normal
job expiry; downloadable job artifacts retain their existing expiry. Limits are
32 saved experiments per member, 128 globally, 768 KiB per frozen plan and
64 MiB total retained state. Corrupt, unsafe or oversized state blocks execution
instead of deleting evidence or silently dropping outcomes.

## Budget reservation diagnosis and output limits

The prior $0.25 run reported $0.101166 before the next conservative reservation
was refused. A new, explicitly separate $0.35 attempt on the real
`requests-unicode-length` task made five provider calls and reported $0.173281;
its sixth request was also refused. That attempt is retained as **failed and
ungraded**. It does not replace the original result or establish task completion.
Its temporary credential was successfully revoked.

The guard reserves a conservative bound for the next input, maximum output and
request fee. Explicit settled provider cost can release a completed reservation;
unknown charges retain their reservation. Consequently, reported spend can be
below the cap when the next request cannot fit. New diagnostics show the next
required reservation, remaining allowance and reviewed cap without reflecting
request or provider error text.

An optional reviewed `limits.max_output_tokens` lets members reduce the enforced
per-request output ceiling and the matching reservation together. Other runtimes
accept 1–8,192 tokens; Claude requires 2,049–8,192 to preserve its fixed
2,048-token native thinking budget. Incompatible explicit thinking budgets refuse
before transport; thinking is not silently disabled. The pinned native image
keeps its launch environment; the trusted broker enforces this ceiling before
provider transport. Missing fields preserve prior manifests and the 8,192-token
default. A small ceiling can truncate output and does not guarantee completion.

## Verification and retained evidence

The machine-readable [release evidence](NATIVE_PAIRED_RELEASE.json) records exact
published identities, live UI and API checks, actual provider outcomes, private
proof hashes and the remaining verification limits.

- **Automated checks:** 979 frontend tests, 177 Worker tests, and 278 runner tests
  (277 passed, one Linux-only local skip). Two distribution freshness checks pass.
  These are separate from native execution and live member verification.
- **Actual Codex CLI:** six offline captures exercise original, Keep, no-op
  Replace, marked Replace, selective Disable and all-off. The offline endpoint
  deliberately returns HTTP 400 after capture, producing native exit 1; these
  runs are instruction-application evidence, not successful task runs.
- **Control comparison:** Keep/no-op match original model/input/tools after
  removing only four validated per-message transport UUID fields. No prompt
  content is normalized away. The native checklist renderer's 20,903-byte source
  asset becomes an exactly checked 17,119-byte instruction string.
- **Edited comparison:** marked replacement and Disable change only the selected
  developer text; the exact marker and padded spans are checked. Other messages,
  model and tools remain equal. All-off also blanks the previously observed
  permissions asset. Unobserved and conditional coverage remains unverified.
- **Member UI:** headless checks use a real operator session, exact frozen HTML,
  real inventories and preflights; they exercise both native editors and paired
  authoring, review invalidation, mobile layout and preserved corpus contents.
- **Live gates:** 25 checks cover page redirects and API 401 responses, including
  both inventories and experiment routes with hostile Origin. No ACAO is present.

The integration review reproduced and fixed credential-lease cleanup, scheduler
resume cleanup, requested experiment-ID binding and native thinking/output-cap
issues. Failed proofs and early comparison scripts are retained separately;
corrected evidence never overwrites a failed outcome with a success claim.
Concurrent cold readiness reads also share one fresh check within a seven-second
wait bound. They reuse its verified success or failure, while expired passing
results remain unavailable on timeout. Barrier tests cover concurrent success,
failure and the actual timeout; anonymous gates remain responsive while checks wait.

## Actual provider-backed experiment

The final frozen experiment used native Codex with the verified
`openai/gpt-5.1-codex-mini` model on the real `requests-unicode-length` task,
revision `f6707042d8b18d2a3737380bf58ff020872fb07b`. One repetition compared Keep
against a marked replacement of one 120-byte permission-text asset. Both arms
used the same overlay, task, model, 16-request limit, 180-second limit,
2,048-token output ceiling and $0.12 per-job cap: **$0.24 aggregate maximum**.

The schedule completed both planned trials without creating an extra job:

| Arm | Outcome | Usage evidence |
| --- | --- | --- |
| Keep native baseline | Process succeeded; **task grade passed** | Eight calls; 75,363 input tokens, 1,256 output tokens; reported cost **$0.00913131** |
| Replace one permission fragment | Process failed; **ungraded** | Two broker-recorded requests; model transport outcome uncertain; cost **unknown** |

Both jobs verified native materialization readback. The edited job's actual
client request contained the replacement, independently recorded in its
owner-bound observations. Its uncertain transport was not retried. The scheduler
reports two finalized trials, one incomplete pair, zero graded pairs and one
trial with unknown cost. The known cost subtotal is not the total experiment
cost. The temporary credential was successfully revoked.

Before this corrected run, live verification uncovered a gateway bug: valid
copied job summaries were compared using JSON property order. The gateway
returned 502 after submission, and the proof client's cleanup revoked its
connection. That earlier experiment is retained with one failed, ungraded job
with zero provider requests and one explicitly cancelled, unsubmitted trial.
The remaining trial was cancelled before the separate post-fix experiment.
Canonical object comparison now preserves exact content independent of property
order; a regression failed before the fix and all Worker tests pass afterward.
A separate incompatible-model preflight also stopped before any job or key
connection; the successful run used the actual live compatibility catalog.

This verifies live native application, a real baseline task completion, and
the scheduler's handling of incomplete provider outcomes. **Task completion for
the edited profile and performance improvement remain UNVERIFIED.** No failing
or ungraded result is counted as a passing grade or silently replaced.

See the [Codex preparation guide](../deploy/runner/CODEX_NATIVE_PROMPTS.md) and
[runner operations](../deploy/runner/README.md). Proprietary native bodies,
executables, raw request captures, passwords and JWTs are absent from Git.

The experimental-design workflow informed blocking, balanced run order and
all-outcome reporting: Timothy Kassis, Vinayak Agarwal, Yuhuan He, Darshil Patel
and Aubrey M. Brueckner (2026), [Scientific Agent Skills: A Library of Procedural
Knowledge for Research Agents](https://doi.org/10.48550/arXiv.2609.00065).
