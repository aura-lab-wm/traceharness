# Execution verification and reviewer checklist — 11 November 2026

Open [the signed-in Harnesses workspace](https://traceharness.dev/app#/rig/harnesses). The hosted React workbench is served at `/app` from its published KV snapshot. `/app/shallow` is the separate plain-JavaScript editor. The Python lab, local tests and private runner are distinct surfaces.

## What changed

A runtime that stops with an ordinary nonzero exit can leave a valid solution. The runner now waits for confirmed runtime teardown, closes its model proxy, and grades that workspace using the same pinned, offline trusted grader and original deadline. It preserves the failed execution status and records the independently measured task grade and `grade.json`. Cancellation, exhausted deadlines and unsafe cleanup do not acquire an invented grade. Invalid grader output is refused.

A definitive terminal run that never attempted a provider request now reports exactly zero requests, input tokens, output tokens and dollars. Issued calls with incomplete or uncertain usage remain unknown. The broker closes its call gate and waits for in-flight accounting before publishing a terminal record; retained callbacks cannot issue new calls afterward. Malformed executor responses become `needs_attention` instead of leaving a job running indefinitely.

Matched-pair summaries now include trusted passed/failed task grades from ordinary failed executions. They still exclude active, cancelled, unsafe and ungraded runs. General matrices remain descriptive and produce no paired causal statistics.

Conservative request reservations, hard caps, no automatic billable retries, pinned runtime/task/grader receipts, isolated grading, ownership checks and Origin gates are retained. No runtime, task, grader, Worker route or database policy was changed by this release. Only three runner control modules were deployed; the pinned runtime still uses the old `harnesslab` module name, so one documented module-name compatibility substitution was applied when building the control image.

## Live results

See [the complete sanitized result record](EXECUTION_PERFORMANCE.json) for every job identity, manifest hash, task/runtime/grader pin, token count, cost, timing and artifact hash. The [preregistered protocol](EXECUTION_PERFORMANCE_PLAN.md) was frozen before the new provider calls. All outcomes are retained; no paid trial was retried.

| Live cohort | Actual tasks and outcomes | Reported cost | Job wall time |
| --- | --- | --- | --- |
| Engine: two prompts × two Requests tasks × two repeats | **8/8 succeeded and passed** (`requests-unicode-length`, `requests-leading-slashes`; GPT-4.1 Mini) | **$0.0190248**, zero unknown charges | 11–12 seconds; mean 11.375 seconds |
| Native Codex: control versus one edited fragment × two repeats | **4/4 succeeded and passed** (`requests-unicode-length`; GPT-5.1 Codex Mini). Both edited and both baseline runs verified native readback and emitted literals. | **$0.03707668**, zero unknown charges | Control mean 65 seconds; edited mean 51.5 seconds |
| Deliberate pre-transport budget refusal | **1 expected failed execution / trusted failed task grade**; zero provider calls, zero tokens | **$0**, known zero | 6 seconds |

**Total: 13 live jobs, 12 passing model-backed tasks and one expected negative case; $0.05610148 reported against a $1.19 aggregate hard cap.** All artifacts were downloaded and checked against their byte counts and SHA-256s. Credentials were revoked after terminal completion. A final host audit found zero active jobs/experiments, zero `needs_attention` jobs, zero runtime containers and zero residual workspace mounts.

Reference experiment IDs: engine `f499a677019e64b273045ad044bde920a9c44e53a72a02ce`; native `ab93a85eec693081750a52116e180e72bdbcefa41ec4ccb1`. Zero-call job: `190ca7721cc9944a2712b1a28c2aedce6ea24e3cda3c44cd`.

Native descriptive resource totals (two trials each): control **204,014 input / 5,168 output tokens**, 21 requests, $0.02273214; edited **167,822 input / 2,471 output tokens**, 18 requests, $0.01434454. The edited arm used fewer resources in this small sample while retaining success. This does **not** establish a general or statistically significant performance improvement, or attribute all differences to that fragment.

The original four jobs were left unchanged. Their original report remains **one passed, three failed/ungraded, $0.0033288 confirmed plus one unknown charge**. Replaying their saved patches with the unchanged pinned offline grader, without model calls, yielded **two passed and two failed**: the previously ungraded unicode-length patch already solved its task. This replay is additional evidence, not a rewrite of historical job grades or billing.

The new engine cohort has larger step and dollar limits than that historical sample. It cannot establish a causal before/after model improvement. Two repeats per cell are descriptive; provider caching, routing, sampling and host load are not controlled. Task completion, prompt-application evidence, wall time, tokens and costs must be assessed separately.

## Manual review for Alvi, Fahim, Shemar and Yli

Reference jobs belong to the operator’s proof account. Other reviewers should inspect the sanitized public result record or reproduce a small test in their own account; another member must not gain access to those private jobs.

Most checks below are free: inspecting, editing, reviewing, freezing, downloading and cancelling an unstarted experiment do not execute a model. Starting a run uses your OpenRouter account. Keep the connection active until the server confirms terminal completion or cancellation; use the displayed hard caps rather than treating reported spend as a remaining-request allowance.

| Check | Steps | Expected behavior / evidence |
| --- | --- | --- |
| Member gate | Open `/app`, `/app/shallow` and `/link` in a logged-out window. | Redirect to `/login`. Anonymous runner and shallow APIs return 401, exact `{"error":"Sign in required."}`, without ACAO, including hostile Origin. |
| Complete harness inspection | In Harnesses, choose a stock shell, custom engine harness and a registered native runtime. Expand full JSON. Open a recorded job and its manifest. | Stock/custom settings, prompt, model, task, limits and recorded pins are visible. Native inventory/profile evidence is distinct from the extra instruction overlay; unrecorded internals are not presented as known. |
| JSON editing | Expand **Edit configuration JSON**. Change a prompt/limit, inspect the diff, apply, then try malformed JSON and an unknown setting. | Valid edits update the form. Invalid text is retained with a reason. Pending edits block dispatch/capture. **Discard JSON edits** restores the applied fields. No job starts. |
| Fork a result | Use **Fork this run configuration** from a hosted job, or **Fork recorded harness** from a complete recorded ledger. Edit the draft. | Original source JSON stays inspectable and unchanged. Incomplete ledger configurations are refused rather than filled silently from a preset. New runs require current review. |
| Native prompt classes | Choose native Codex/Claude, inspect inventory and one patchable fragment. Try keep, replace and disable; inspect profile JSON and reset. | Only supported fragments are editable. Overrides identify exact block and inventory/binary pins. “Disable all” means patchable inventory fragments, not all possible native instructions. An overlay alone is not embedded prompt editing. |
| Independent captures | Expand **Experiment matrix**; capture one harness, edit it, capture a second and inspect both JSON documents. | Earlier captures remain unchanged. **Update with current** explicitly replaces one. |
| Models and task sets | Choose models and runnable tasks, search/filter them and inspect expanded cells. Include an unsupported combination. | Every candidate identifies runtime/model/task. Unsupported cells show reasons and block review until explicitly excluded. **Select verified cells** is explicit; exclusions remain visible. |
| Limits and review | Set repetitions, schedule seed and aggregate budget. Try an insufficient budget, review a valid matrix, then change the seed or a capture. | Sum of per-trial caps × repetitions must fit. At most 64 included trials and 1–10 repeats. Any changed input/catalog invalidates the previous review. The seed orders trials; it does not seed model sampling. |
| Freeze and cancel for free | Review and **Freeze matrix experiment** without connecting a key. Inspect frozen JSON, then cancel. | Resolved manifests and complete schedule persist. Freeze creates no jobs; Start stays disabled without a credential. Cancelling an unstarted queue submits no jobs. |
| Bounded real run | For the engine, use GPT-4.1 Mini, a registered Requests task, 12 steps, 180 seconds, 512 output tokens and a $0.05 per-trial cap. Review/freeze a small matrix, connect your key, then Start once. | Start acknowledgement precedes monitoring. The queue records every actual job and terminal state. Task grades and artifacts come from the private runner. These settings are the tested example, not a guarantee for every task. |
| Native matched run | Compare native Codex keep-all versus a single supported replacement on the same task/model/pins/limits. This release tested 16 requests, 300 seconds, 4096 output tokens and $0.195 per trial. | Download `native-prompt-profile.json`, `native-prompt-application.json` and `native-prompt-observations.json`. Verify readback and the replacement/baseline literal in outgoing requests. Grade and resource use are separate outcomes. |
| Execution versus grade | In the owning account, open the zero-request negative job listed in the result record, plus successful and historically ungraded jobs; otherwise inspect the sanitized record. | Failed execution can have a trusted passed or failed task grade. Cancelled/unsafe/deadline cases are not represented as task passes. Historical unknowns stay unknown. |
| Money and artifacts | Inspect requests/tokens/cost in **Open job**. Download manifest, grade, patch and summary; compare SHA-256 with retained metadata. | No-call refusal shows exact zeros. Missing charges say Unconfirmed/Cost unknown. Downloads are checked before delivery. Job timestamps measure preparation + execution + grading; engine `summary.json` has narrower `wall_ms`. The queue itself has no token/latency columns. |
| Reload and export | After terminal completion disconnect the key, reload, open Saved experiments/Recent runs and export results. | Frozen identities, queue, grades and costs remain available without reconnecting or starting work. No credential appears in exports. A paused queue may resume only remaining trials; failed or uncertain trials are not retried silently. |
| Narrow screen and keyboard | Repeat inspection at 320/390/768/1440 pixels and navigate with Tab. | Controls stay within the results panel. The queue scrolls inside its own focusable region; full JSON remains inspectable. |

For each defect, include the URL, browser/viewport, exact steps, expected versus actual behavior, experiment/job ID, manifest SHA-256 and relevant artifact/error names. Share screenshots with sensitive fields removed. Never send an OpenRouter key, password, cookie or JWT. Report an uncertain start/charge as uncertain; do not repeatedly click Start to try to make it disappear.

## Local regression evidence and remaining limits

- Runner: **312 passed, 9 skipped, 554 subtests passed**. Cases include stopped-runtime grading, cancellation/deadline/cleanup exclusion, malformed results, no-call accounting, ambiguous transport, retained callbacks and in-flight finalization races.
- Worker: **193 passed**. The actual Worker-to-ASGI/compiler/scheduler bridge also passed two fixture executions with zero provider calls.
- The published React snapshot was unchanged by this release; its earlier 1,053-test frontend run is historical evidence, not a newly repeated suite. The current live browser checks are reported separately in the result record.
- All **37** current anonymous curl checks passed with `traceharness-proof` and `--max-redirs 0`. Signed-in hostile-Origin and published results UI checks are listed in the result record.
- Maximum-size paid matrices, multiple models in one paid matrix, a second member's live cross-account isolation, exhaustive crash/cancel/cleanup/provider-failure permutations and all conditional native paths remain **UNVERIFIED live**. Related unit/contract tests do not establish those production outcomes.
- A fresh member-JWT PostgreSQL save/reload was not repeated. No claim of production PostgreSQL paint follows from these runner tests.

## Deployment

Fly runner **v16**, complete, deploy exit **0**, one machine started and one health check passing. Image: `registry.fly.io/traceharness-runner@sha256:b336f41a0d10dfab76989443ed67ec11a203df103f5d284a6ba1e552e6ab8c89`. Three deployed module hashes and the unchanged registry hash were read back and matched. Runtime and grader images were not rebuilt. No Worker or KV upload was needed for these backend-compatible changes.

Last ten deployment log lines (including blank lines):

```text
> Updating 8e64d7b7d01e68 [app]
> Updated machine config for 8e64d7b7d01e68
✔ Machine 8e64d7b7d01e68 is now in a good state
> Clearing lease for 8e64d7b7d01e68
✔ Cleared lease for 8e64d7b7d01e68
Checking DNS configuration for traceharness-runner.fly.dev
✓ DNS configuration verified

Visit your newly deployed app at https://traceharness-runner.fly.dev/

```

Three actual Gemini 4 Carbon High subscription conversations supplied the production fixes and analysis. Retained changes were independently reviewed and tested; timed-out intermediate CLI phases are not counted as successful test runs.
