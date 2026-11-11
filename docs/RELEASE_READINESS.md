# Release readiness verification — November 11, 2026

The shipped release checks pass. This verifies the cases below; it does not turn unsupported combinations, historical failures, or missing measurements into successes.

Open [the member Harnesses workspace](https://traceharness.dev/app#/rig/harnesses). The Worker serves this URL from `app.html.gz`; the React source and rebuilt distribution were exported into that exact snapshot. `/app/shallow` remains a separate page.

## What changed

Case-file and narrator-key helpers now use browser storage only. Node imports previously touched host storage; two new tests reproduced that defect before the fix and pass afterward. Browser blocked-storage behavior remains covered. The lint pass resolves 22 warnings, removes an unused trajectory component, and preserves subscriber snapshots when notifying listeners. `npm run lint` now rejects warnings. The download DOM test verifies its generated file without triggering unsupported jsdom navigation.

The new snapshot retains all eight recorded datasets, 3,453 runs, and five narration chapters. No Worker, runner image, zone route, SQL policy, or marketing file changed in this release.

## Proved live with a real member session

- Nine harness choices reached an enabled Run button after selecting a real model/task, connecting a transient key, and completing server review: six fixed stand-ins, the custom harness, Claude Code, and Codex CLI.
- All 72 harness/task review cases behaved correctly: 67 supported combinations were accepted; five unverified native combinations were rejected. Selecting an unsupported task blocks Review and Run. Those five combinations remain **UNVERIFIED for execution**.
- Editing a reviewed configuration or entering an invalid limit disables dispatch until the configuration is repaired and reviewed again. Disconnecting revokes the credential and disables Run. The browser checks created zero jobs and kept the key out of storage.
- Native prompt replacements, selection, bulk edits, named sets, profile opt-in/out, reload, and layouts at 320/390/768/1440/1920 pixels pass against the production inventory. An excluded profile stays editable and is absent from the dispatch JSON.
- The new Claude edited-profile job `f7437f477858ef916a71bf9d5bedb7dac589209189480ff6` **succeeded and passed the trusted task grader** on `requests-unicode-length`. It used the all-disabled native profile, verified 1,865 changed source occurrences, and retained the exact inventory/materializer pins. This was one separately registered completion check with a $0.50 ceiling and zero paid retries: 68 seconds, 10 requests, 162,113 input tokens, 2,988 output tokens, and **$0.177053 confirmed cost**. Its credential was revoked.
- The live page reopens that saved result, paints Passed and the confirmed charge, shows the exact historical JSON, and downloads the original manifest with its advertised SHA-256 verified. No new execution occurs during this review.
- All 41 anonymous gate cases pass. Logged-out `/app`, `/app/shallow`, and `/link` return 302 to `/login`. Anonymous APIs return the exact 401 sign-in JSON without ACAO, including hostile-Origin requests. Proof clients use `traceharness-proof` and disable redirect following.
- Fly v16 remains complete, its machine is started, and its health check passes. The cleanup audit finds zero active jobs, active experiments, needs-attention jobs, containers, or residual task mounts. The pinned registry digest is unchanged.

## Local checks

| Check | Result |
| --- | --- |
| Frontend | 1,090 passed in 65 files; no storage/navigation diagnostics |
| Worker | 198 passed |
| Runner | 302 passed; nine skipped out of 311 |
| Distribution/source freshness | Two passed |
| Lint | Exit 0, zero warnings, warnings enforced as failures |
| Production build | Exit 0; existing size advisory remains |

The runner suite is local automated coverage. It is not evidence that every native task was executed successfully. Previous engine/Codex live execution evidence is retained in the earlier verification reports; this release adds the single Claude job above.

## Exact publication

Source commit: `81eb9e5c9188898d941986d414abed082681960e`. KV upload exit: **0**. Retained Worker version: `5ff30c89-62aa-4c90-ba78-b37a24ef4bf4`; no Worker redeployment occurred. The temporary config was deleted.

- Gzip file SHA-256: `af95f8ece69391a39e8145c908e48833950d0a55942afb360effb859661bed91` (15,295,616 bytes).
- Published HTML SHA-256, after removing only the per-member injected marker: `43229536af3b2c13e02d133e62fb98c930229843bd2efe4fdb55dccc0ec55be6`. The live native editor, readiness, and saved-result proofs all read back this exact fingerprint.
- Build source SHA-256: `d1e27d98eb3b12a30de1250e2fb27e774fc654e4eafc894d5652e0db90261806`.

Last available upload log lines (the command emitted fewer than ten):

```text

 ⛅️ wrangler 4.90.1
───────────────────
Resource location: remote

Writing the contents of /Users/amastro/Documents/TraceHarness-release-green-2026-11-11/app-release-green.html.gz to the key "app.html.gz" on namespace id: "8a74dd2fba124b1a8d82e6eeff5ba3ae".

```

## Limits and remaining work

The five blocked combinations are Claude Code with `requests-invalid-charset`, `urllib3-partial-gzip-read`, `urllib3-unseekable-rewind`, and `urllib3-invalid-fingerprint`, plus Codex CLI with `urllib3-invalid-fingerprint`. Their rejection gates pass; their execution is not verified.

General performance improvement remains **UNVERIFIED**. The new Claude completion is not a controlled baseline comparison. Historical failed/ungraded records and unknown charges are preserved. Complete native-instruction coverage and live isolation across two real accounts were not proved in this pass.

Two non-failing environment/build advisories remain visible: Vite's existing large single-file bundle warning (about 1.94 MB, including narration) and the local Python environment's Starlette/httpx deprecation. No warning limits were raised or diagnostics suppressed to claim success. The nine skipped runner tests are not counted as passed.

See [the structured verification record](RELEASE_READINESS_VERIFICATION.json) for live results, configuration/manifest pins, deployment log, and private evidence hashes. Credentials are excluded.
