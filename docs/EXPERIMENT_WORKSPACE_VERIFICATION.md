# Experiment workspace verification — 2026-11-11

## Evidence boundaries

A real member session and the production registry/runner were used headlessly. Candidate browser checks replaced only `/app` HTML with the exact build listed below; API responses, registered repository tasks, compiler manifests and job execution came from production. Tests and fixtures are distinguished from these checks. No performance improvement is claimed.

## Production API and candidate browser checks

- Four engine cells (two prompts × Requests unicode-length and leading-slashes tasks) passed real manifest review with an exact $0.04 aggregate ceiling.
- A five-cell mixed engine/native-Codex-profile plan passed production admission, freeze, identical-request replay, reload and cancellation. An incompatible real model/runtime/task refused the entire plan and identified its cell. No jobs were submitted by that check.
- Candidate browser checks passed JSON apply/discard and invalid-edit dispatch blocking; independent full-JSON harness captures; model/task-set selection; budget refusal; stale-review invalidation; manifest freeze; cancellation; queue/history reload without credentials; complete results export; layouts at 320, 390, 768 and 1440 pixels.
- Both hosted-run and published-ledger forks passed real-member browser checks. Original settings and source documents were preserved independently of later draft edits; no account saves or jobs were created.
- Inspector regression checks passed all eight published datasets, the family matrix, all six stock shells, both native baseline inventories, native profile JSON, hosted manifests, legacy fixed/wizard/flexible views and clipboard/download roundtrips.
- All 37 logged-out curl checks (25 read gates plus 12 mutation gates) passed using `User-Agent: traceharness-proof` and zero redirects: `/app`, `/app/shallow` and `/link` returned 302 `/login`; tested APIs returned exact 401 `{"error":"Sign in required."}`, including hostile Origin. No Access-Control-Allow-Origin was returned.

## Real execution evidence

Experiment `21b348521cffbbf46c49aaa595e205bdc2b2ad412d672eef` completed its four-cell schedule using the real engine, OpenAI GPT-4.1 Mini and registered Requests tasks. The hard aggregate cap was $0.04.

| Cell | Execution | Task grade | Reported charge |
| --- | --- | --- | --- |
| Baseline / unicode-length | Succeeded | Passed | $0.0011724 |
| Baseline / leading-slashes | Failed at request-reservation limit | Ungraded | $0.0006176 |
| Variant / unicode-length | Failed at request-reservation limit | Ungraded | $0.0015388 |
| Variant / leading-slashes | Failed after premature credential disconnect in the initial proof script | Ungraded | Unknown |

Confirmed subtotal: **$0.0033288, plus one unknown charge**. The initial proof script polled before the Start response completed and disconnected too early. The durable queue paused. A corrected browser proof waited for the Start acknowledgement and resumed that same queue; it did not retry the failed trial or create another experiment. All four original trial identities remained. The connection was revoked after completion, and the browser verified the queue and full results export. A completed schedule includes failed trials; it does not mean all tasks passed.

## Automated checks (fixtures/local execution)

- Frontend: **1,053 tests passed** in 62 files, including JSON conflicts, signed-zero identity, strict configuration parsing, immutable captures, native profiles, compatibility, budgets, stale responses, freeze replay, uncertain Start, expiry, leases, history, cancellation and result integrity. The keyboard-accessible queue check and connection-hold race regressions also passed. Per-experiment holds prevent a late history read from the other experiment view from releasing credentials for unresolved or active work.
- Runner: **293 tests passed, 9 skipped, 542 subtests passed**. The skipped integrations remain unverified by that run.
- Worker: **193 tests passed**. An additional Worker → actual ASGI/compiler/scheduler bridge passed with two fixture executions and zero provider calls; it verified real compiled-manifest shape and signed-zero transport.
- Built-source consistency: **2 tests passed**. Lint completed with existing unrelated warnings; the new workspace/editor/fork files had no lint warnings. The production bundle retains the existing size warning.

## Build and deployments

- Built member gzip SHA-256: `e03a0ca6326dd7f645cfeaf3dcabd4e4f438bd08bbc2688930fd1238e42aee16`.
- Decompressed HTML SHA-256: `90e96039deadeb4440534a3888c5b763adc03be9cec5ea75b71ef153000e13e5`.
- The opaque eight-dataset / 3,453-row payload is unchanged.
- Worker `0240ae8f-8671-4acc-9761-372a953662c8`, deploy exit 0. No new routes, Durable Objects, migrations or workers.dev target. The ephemeral deployment config was deleted.
- Fly runner release v15, image `registry.fly.io/traceharness-runner@sha256:9efe316875a3711b7892bf33ba74381b8f7194d3c457e8faa2abb71f18781388`, deploy exit 0; 1/1 machine started and 1/1 health checks passed. Only scheduler control-plane code changed; task/runtime/grader images and registry receipts were retained.
- Final KV upload exited 0 and its temporary config was deleted. Signed-in checks against the unmodified published HTML passed with the exact HTML SHA above: editor, capture, task selection, budget/stale-review refusal, freeze, cancellation, queue/results reload and export, responsive layout, retained real execution grades/unknown cost, and job-to-manifest navigation. Both fork paths passed on the published page. A live mixed-runtime browser plan retained eight candidates and explicitly selected four compatible cells across two models and two tasks before freeze/cancel. No additional paid jobs were submitted by these final checks. An initial read during KV propagation returned the previous snapshot; the repeated proof matched the final bytes.

## Remaining limits

- Paid native-profile execution through a general matrix, multiple different models in one paid matrix, maximum-size 64-trial live schedules, and a second member's cross-account live isolation: **UNVERIFIED in this change**. Related contract and ownership tests passed; they do not replace these live checks.
- Exhaustive production crash/restart and provider-failure permutations: **UNVERIFIED live**; covered in part by local scheduler and boundary tests.
- Fresh PostgreSQL account-save → reload verification was not repeated in this change; it is **UNVERIFIED by these checks**. No unit-test result is presented as proof of member-JWT PostgreSQL paint.
- Improved model performance or reliable edited-profile task completion: **UNVERIFIED**. One real task passed; three trials remain failed/ungraded.
- Five actual `gemini-4-carbon-high`, high-effort subscription conversations contributed design, scheduler tests, gateway work, matrix UI and editor/fork review. Several CLI print phases timed out despite producing files. All retained output was independently integrated and tested; timeout receipts are not treated as successful test runs.

One broad live inspector pass encountered a legacy builder read timeout. The same fixed, wizard and flexible pages passed a focused check in a fresh real session. The timeout remains recorded; this is not a claim that production reads can never fail.

Private operator evidence, including candidate/API/execution receipts and deploy log tails, is under `/Users/amastro/Documents/TraceHarness-experiment-workspace-2026-11-11`. It contains no committed credential or session material.

## Published source

Implementation: `b32fadf`; connection-hold integration fix: `9ca5c11`. Public `main` contains the implementation; the site gateway commit is local-only `f5da80f`. The member snapshot was uploaded explicitly from the tested file, rather than assuming a source edit updates KV.
