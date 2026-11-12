# Fresh runner v17 execution verification

Four real member jobs completed on the unchanged production **v17** runner on November 12, 2026. Every native Codex turn completed, every independent task grade passed, and every downloaded artifact matched its declared size and SHA-256. The reported model cost was **$0.03564640**, with **zero unknown-cost trials**, within four $0.15 per-job ceilings and a $0.60 aggregate ceiling. No paid request or job was retried.

The [structured receipt](RUNNER_V17_EXECUTION_VERIFICATION_2026_11_12.json) contains exact job IDs, manifests, artifact hashes, image/task/inventory pins, usage and interpretation limits. This supersedes the earlier audit's unverified status for a fresh paid v17 execution and a matched baseline/edited mechanism check. It does **not** establish performance improvement, resolve historical unknown charges, or verify other runtime/model/task combinations.

## Pinned execution and observed results

All four jobs used native Codex **0.167.1**, `openai/gpt-5.1-codex-mini`, and `requests-unicode-length`, with identical task, environment, grader, additional instructions and limits. The limits were 20 model requests, 240 seconds and $0.15 per job. The controller remained image `9c3331292fe6c85de7fc2cdb1db2f41e188a123601368ad260cd8fdfca2d9d6d`; its controller module and registry hashes matched the prior v17 release before and after execution.

| Order | Native prompt treatment | Requests | Input / output tokens | Reported cost | Server elapsed | Completion / task grade |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| 1 | Conditional fragment edited | 8 | 71,539 / 1,579 | $0.01220051 | 50 s | Completed / Passed |
| 2 | Original baseline | 9 | 81,145 / 1,560 | $0.00803089 | 52 s | Completed / Passed |
| 3 | Original baseline | 8 | 70,756 / 1,153 | $0.00904076 | 45 s | Completed / Passed |
| 4 | Observed fragment edited | 8 | 69,960 / 933 | $0.00637424 | 45 s | Completed / Passed |

Server elapsed is `updated_at - created_at` in whole seconds, including admission/queue and completion bookkeeping. It is not isolated model latency. Controller-observed wall times are recorded separately where available; the third controller was deliberately paused, so its observed time is unavailable. All four real native traces ended with `turn.completed`, without a `turn.failed` event. The grader's separate `grade.json` reported `passed` in every case.

## Prompt application and model observation remain separate

The initial plan froze two repeats of the original baseline and an edited `approval_policy/on_request_rule_request_permission.md` fragment. The first edited binary had exactly one source occurrence changed, verified readback and no non-prompt binary changes. Its replacement was **not observed in any of its eight model requests**. The baseline also did not emit that conditional fragment. This pair proves materialization and successful execution; it does not prove a model-facing treatment.

After the first baseline, the controller was paused before its fourth dispatch. Its already acknowledged third baseline continued to successful completion. Read-only reconciliation confirmed its exact manifest and known usage before the original connection was revoked. No valid running job was cancelled.

The baseline observations identified a different patchable fragment, `approval_policy/never.md`, in every request. A separate one-repeat paired review froze the same baseline configuration and this 112-byte replacement within the original fragment's 116-byte capacity:

> Approval policy is never. Commands with sandbox_permissions are rejected. Inspect relevant files before editing.

The exact third baseline observed the original literal in all eight returned requests. The distinct final edited job verified one changed source occurrence, exact binary readback, no non-prompt binary changes, and the replacement literal in **all eight returned model requests**. Thus the second matched pair establishes actual model-facing native prompt application as well as task completion and independent grading.

Treatment selection for this second pair was adaptive, and its baseline preceded the second plan freeze. The original two-repeat plan was not completed as frozen: its fourth trial was never submitted; the final job used the newly reviewed configuration. Neither server experiment scheduler was started. Jobs were submitted individually in a guarded order, with exact current preflight/manifest identity, exclusive dispatch intents and unique idempotency keys. This must not be described as a completed four-trial frozen experiment or a preregistered performance study.

Two small matched pairs cannot establish a general or causal efficiency gain. Sampling, caching and provider routing can affect tokens, cost and elapsed time. The local seed controlled the proposed order, not native model sampling. Whole native instruction coverage and conditional branch coverage remain unverified.

## Reproduction and cleanup

The private reproducible controllers and receipt inputs are retained under `/Users/amastro/Documents/TraceHarness-finish-2026-11-12/execution/`: `paired_proof.py`, `observed_pair.py` and `finalize_proof.py`. They use the existing authorized owner/provider connection at its exact origin; credentials remain in process memory and never enter arguments, logs or proof artifacts. Their paid modes create exclusive intent files and refuse to repeat an existing dispatch. A stopped or uncertain attempt must be reconciled by its acknowledged identity before any further action.

To reproduce the workflow with a separately approved budget: read and pin production identity and inventory; perform current paired-plan preflight; retain the returned plan and manifest hashes; submit each reviewed configuration once with a unique replay identity; wait for terminal status and known usage before dispatching another; download and hash-check manifest, grade, trace, patch, application and observation artifacts; then distinguish binary readback, literal model-request presence, native completion, task grade and reported cost in the receipt. Select an actually observed patchable fragment before treating a native edit as model-facing evidence.

Both temporary provider connections were explicitly revoked. The final read-only VM check found **zero active or needs-attention jobs and zero job containers**; controller and registry hashes remained unchanged. Historical unknown charges remain unresolved. No provider balance delta was substituted for attributed request usage. There was no runner deployment, commit or push during this work.

## Local execution repair, not deployed

The fresh local runner suite exposed a reproducible process-boundary diagnostic failure: a spawned fixture reached its five-second deadline before returning the authored HTTP 429 status. Import timing traced an avoidable cause to `runner_service.__init__`, which eagerly imported the FastAPI service and all controller routes whenever a provider worker imported its own transport module.

The package now resolves its existing `create_app` export lazily. This preserves the public application factory while keeping ASGI imports out of provider worker initialization; reviewed request deadlines and retry policy are unchanged. A fresh-process import regression failed before this correction and passed afterward. The existing status-boundary regression also returned to passing.

The complete runner suite passed **316 tests and 554 subtests**, with **9 skips** and the existing Starlette/httpx deprecation warning. These are local source checks, separate from the unchanged v17 paid execution evidence. The local repair has not been deployed and cannot explain the paid run measurements above.
