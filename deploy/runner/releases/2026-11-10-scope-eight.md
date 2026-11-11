# Eight-task member workbench expansion — 10 November 2026

The [member workbench](https://traceharness.dev/app#/rig/harnesses) now exposes eight real upstream repair tasks and 19 verified task/runtime/model combinations. Seven newly enabled combinations passed the actual signed-in selection, execution, independent grading, artifact download and reload flow. All 23 existing and new member jobs survived a runner restart with unchanged metadata and artifact bytes.

This is a curated task catalog with disclosed edit contracts. It does not claim arbitrary repository execution, universal model compatibility, or benchmark scores. The full React workbench remains on `/app`; its eight embedded datasets and 3,453 recorded run details are preserved. These archived records are distinct from the eight runnable tasks. `/app/shallow` remains the separate plain-JavaScript editor.

## What changed

- Added malformed Content-Type charset, compressed partial-read, unseekable upload-retry and malformed fingerprint tasks from real Requests/urllib3 issues. Each pins upstream source and preserves public reproductions, independent behavioral checks and provenance. Original four packages and their 12 receipts are unchanged.
- Model choices now follow the selected task and runtime. Unavailable choices remain visible with a reason; changing compatibility invalidates the previous review. Prompt and task choices remain under the member's control. A refresh action is always available.
- Missing terminal usage displays **Cost unknown**, rather than inventing a zero. Buffered model responses now reject malformed JSON and in-band error envelopes with a constant diagnostic; valid responses and native SSE remain intact. No automatic paid retries were added.
- Built a separate Python grader image: its compressed archive is 49,002,956 bytes. This is a size observation, not a measured runtime speedup.
- Added a bounded TraceHarness operator observation option, matching the existing UI control. New TraceHarness proofs selected 50,000 characters, 4,096 output tokens and temperature 0, with 20 requests, $0.12 and 240-second caps. The operator default remains 20,000 characters. A pass establishes the recorded configuration, not every possible setting.

## Live results and limits

| New task | TraceHarness / GPT-4.1 Mini | Codex / GPT-5.1 Codex Mini | Claude / Haiku 4.5 |
| --- | --- | --- | --- |
| Requests malformed charset (#6646) | Member flow passed | Member flow passed | Unavailable; unverified |
| urllib3 compressed partial reads (#3636) | Member flow passed | Member flow passed | Unavailable; unverified |
| urllib3 unseekable retries (#3779) | Member flow passed | Member flow passed | Unavailable; unverified |
| urllib3 malformed fingerprints (#5211) | Member flow passed | Unavailable; operator run failed | Unavailable; unverified |

The live read-only UI pass selected and reviewed all 19 receipt-backed pairs and refused all five unavailable planned pairs. It preserved incompatible selections, cleared stale reviews, displayed the actual earlier unknown-cost failure, and passed 1440px/390px layout checks without creating jobs. Each of the seven new member executions proved exact preflight/launch, same-job idempotency, separate execution and task-grade states, API/UI artifact byte agreement, authenticated hostile-Origin refusal, credential revocation and reload reopening. Restart recovery rehashed every artifact for all 23 retained member jobs and reopened all seven new results.

Nine original-task member combinations were proved in the previous release, yielding 16 distinct member-verified combinations across both passes. Three original Claude member combinations remain pending after the earlier provider credit refusal, although their original operator receipts remain valid. No new Claude calls were made.

## Failures retained and corrected

A real charset repair exposed an overly narrow grader rule. Its repeated-find guard was behaviorally valid but rejected. The public policy and finite AST validator now permit that exact form while still rejecting unrelated code, altered guards/slices and forged results. The task package and grader received new hashes; fresh proofs bind to those identities. The exact previously rejected patch also passed a deployed regression case.

An earlier TraceHarness attempt exhausted its token budget repeatedly reading a clipped file and made no edits. A separate 50,000-character configuration resolved that observation problem; both attempts remain recorded. Another provider response reached the old client without choices and failed. Its original upstream cause is unknown; the new envelope guard was tested locally, and valid live calls passed after deployment. The original failed attempt's confirmed total cost is unknown.

The final Codex fingerprint attempt stopped after a preamble and submitted an empty patch. Independent grading correctly failed it. No receipt was issued and no automatic retry concealed the failure. The live UI and server preflight both refuse that combination. A read-only proof also initially used a mobile-only selector on desktop; the incomplete report is preserved and the corrected proof passed.

## Evidence boundaries

- **Live:** 13 deployed isolated grader cases, nine candidate import-origin probes, UID/capability/output-write/termination checks and cleanup; 19 positive and five negative member selections; seven successful member executions; restart recovery of 23 jobs; 16 anonymous site checks and six unsigned direct-runner checks.
- **Local/fixture:** 175 runner tests passed, one skipped; 893 frontend tests across 47 files; six grouped exported-HTML fixture checks after the final CSS adjustment; 19 offline receipt/proof checks. Fixtures made no live model calls and are not app authentication proof.
- **UNVERIFIED:** second real member isolation, forced cold Postgres saved-prompt paint, actual email/OAuth callback exchange and UI Cancel in this pass. The unavailable and pending combinations above are not passed cells.

The urllib3 checks load the reconstructed candidate tree, not the image's installed dependency. Generated version metadata is explicit, hashed and protected. The gzip task uses the older issue-linked affected revision; its reference applies the exact upstream buffer-drain insertion as a documented backport. No fabricated private buffer state or live TLS handshake is claimed.

## Deployment

Fly release **v10**, deploy exit **0**, one machine started and its health check passing. Exact control, grader, runtime, task, receipt and export hashes are in [the evidence JSON](2026-11-10-scope-eight-evidence.json). The active inventory is `/data/inventory-eight-v2/registry.json`; earlier inventories remain intact. The Worker remains `a84991b5-a7f0-4ea1-90c5-ee48dbaaff5b`; no Worker deploy, route, Durable Object or SQL change occurred in this pass. The exact approved KV gzip was uploaded and its bytes read back successfully.

The Virginia server built trusted images; member code ran inside the dedicated Fly sandbox. The site repository had no source changes in this pass. See the [task recipes](../tasks/README.md) for primary upstream links and policies.

## Deployment log tails

### Fly v8 — exit 0

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

### Fly v9 — exit 0

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

### Fly v10 — exit 0

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

### KV app.html.gz upload — exit 0

```text

 ⛅️ wrangler 4.90.1
───────────────────
Resource location: remote

Writing the contents of /Users/amastro/Documents/TraceHarness-unified-workspace-2026-11-10/scope-eight/app-scope-eight-v2.html.gz to the key "app.html.gz" on namespace id: "8a74dd2fba124b1a8d82e6eeff5ba3ae".
```
