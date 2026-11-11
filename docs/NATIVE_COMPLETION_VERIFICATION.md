# Native completion and resource verification

This follow-up retains the earlier [paired release](NATIVE_PAIRED_RELEASE.md)
and its failed or ungraded outcomes. It adds separate provider-backed trials
against the production member API. The member workspace remains
[traceharness.dev/app#/rig/harnesses](https://traceharness.dev/app#/rig/harnesses).
The [machine-readable evidence](NATIVE_COMPLETION_VERIFICATION.json) records
deployment identities, job outcomes, artifact hashes, gate checks and limits.

## Transport repair

The model transport allowed a 30-second overall request deadline but applied
a three-second socket read timeout. A normal generation pause could therefore
abort a paid request before its reviewed allowance expired. Two real loopback
regressions reproduce this with delayed headers and a pause between SSE chunks;
both fail before the repair and pass afterward.

Model reads now use the existing overall allowance. The process watchdog and
monotonic deadline still enforce the same maximum 30 seconds. Connection, write
and pool waits remain bounded to three seconds; response-size limits, spending
reservations and the refusal to retry uncertain paid requests are unchanged.
A slow-drip regression verifies that incoming bytes cannot extend the total
deadline. This reproduced defect does not establish the cause of the old failed
request, whose retained artifacts lack that diagnostic.

Runner release **v14** deployed with exit **0** and one of one machines started
with its health check passing. Its image is
`registry.fly.io/traceharness-runner@sha256:6d6d8510ed9ec1efb54c677306139ff77121194e943ce514763c7892a7bbda68`.
The registered native images, inventories and task revision are unchanged.
There was no Worker deployment or KV upload in this follow-up.

## Edited Codex completion

Job `66ce15958aa7948d4bed9d9c3335c4e649503aac3eaee086` ran native Codex
0.167.1 with `openai/gpt-5.1-codex-mini` on the real
`requests-unicode-length` task, revision
`f6707042d8b18d2a3737380bf58ff020872fb07b`.
It used the same marked permission-fragment profile as the earlier ungraded
trial. **Execution succeeded and the independent task grade passed.**

Owner-bound application evidence verifies native materialization readback.
Request observations verify that the selected replacement appeared in actual
client requests. Artifact byte counts and SHA256 digests were checked through
the authenticated production API. Reported usage was 12 requests, 102,525 input
tokens, 1,483 output tokens and **$0.00911053**. Its reviewed cap was $0.05;
output was capped at 2,048 tokens per request. The temporary connection was
explicitly revoked.

The proof collector initially read `grade.json` using `grade` instead of its
documented `outcome` field. That failed collection is retained. A corrected,
read-only collection recovered the existing job and verified that it created
no new jobs. No replacement paid trial was launched. This completion result
does not change the old trial's ungraded outcome or establish a performance
comparison against it.

## Frozen resource comparison

Before any study jobs were launched, the plan fixed two repetitions of Keep
versus Disable for one native Codex base-instruction asset. Both arms used the
same pinned v2 runtime, model, task, additional instructions, 16-request limit,
240-second wall allowance, 2,048-token output ceiling and $0.04 per-job cap
($0.16 aggregate). The fixed seed was 20261112 and the realized order was
Keep, Disable, Disable, Keep. Fresh workspaces and all planned outcomes were
retained; no replacement trial was submitted.

The predeclared success rule required all four task grades to pass and the
edited arm's mean input tokens to fall by at least 20%. **That rule was not met.**

| Arm and repetition | Task outcome | Reported usage and limit |
| --- | --- | --- |
| Keep 1 | Failed, ungraded | Two issued requests; transport uncertain; tokens and cost unknown |
| Disable base 1 | **Passed** | Six requests; 31,741 input / 738 output tokens; $0.00403269 |
| Disable base 2 | **Passed** | Five requests; 26,793 input / 545 output tokens; $0.00314185 |
| Keep 2 | Failed, ungraded | Ten requests; 91,110 input / 1,862 output tokens; $0.01121062; next reservation refused |

The second control required a $0.029476 next-request reservation with only
$0.028789 left under its reviewed $0.04 cap. That refusal is retained as a
failed, ungraded result. The first control's 502 trace does not identify the
underlying transport cause. Neither failure is counted as a failed task grade.

Experiment `96a2fa376d92da2b39175f616234540fb25313f209eb7a68` finalized all
four jobs with zero graded pairs, two incomplete pairs and one trial with
unknown cost. The **$0.01838516 known subtotal is not the total study cost**.
Both edited trials verified materialization readback and passed the task, but
there is no valid completed-task efficiency estimate from these controls.
Differences in elapsed time or request counts between aborted and completed
jobs are not reported as gains. **Performance improvement remains UNVERIFIED.**
The study's transient credential was explicitly revoked.

## Claude completion remains open

Job `4ac360254835b1318d29229c31c0ca939a217d0d79d80793` used native Claude
Code 2.1.322 with `anthropic/claude-haiku-4.5` on the same real task. Its
Disable-all profile independently verified 1,865 changed source occurrences.
It made five provider calls reporting 74,472 input tokens, 739 output tokens
and $0.078167, then **failed and remained ungraded**. The next $0.128911
reservation exceeded the $0.071833 allowance remaining under its $0.15 cap.
The credential was explicitly revoked.

The retained trace shows a complete 40,540-byte source-file tool result before
the next reservation refusal. A separate follow-up configuration specifies
targeted inspections of at most 80 lines, a $0.19 cap and a 3,072-token output
ceiling. It was stopped before preflight, credential creation or job submission:
the provider's delayed credit update left approximately $0.14 available, below
the registered cap plus $0.02 headroom. This is an unexecuted configuration,
not a successful task. Further paid verification requires funding.

## Verification boundaries

The runner suite ran 281 tests: 280 passed and one Linux-only test was skipped
locally. The three new socket regressions are automated transport evidence;
provider-backed task grades are separate live evidence.

Twenty-five headless live anonymous checks passed using User-Agent
`traceharness-proof` and `--max-redirs 0`. `/app`, `/app/shallow` and `/link`
returned 302 to `/login`. The checked APIs returned exact 401
`{"error":"Sign in required."}`, including requests with a hostile Origin.
No checked response included Access-Control-Allow-Origin.

The old edited trial's exact charge remains **UNVERIFIED**. Its retained trace
contains no provider generation ID. The regular model key received HTTP 403
from the provider analytics endpoint; account credit changes cannot establish
a particular request's bill. Resolving this requires the old generation IDs or
read-only analytics access through a management key. Earlier failed Claude
trials also remain failed and ungraded.
