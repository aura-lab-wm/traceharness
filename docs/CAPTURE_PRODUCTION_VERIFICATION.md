# Capture production activation — November 11, 2026

Capture is enabled at [the member capture page](https://traceharness.dev/app/capture). Its device approval page is [Connect this computer](https://traceharness.dev/app/device). The full workbench remains at `/app`; its published snapshot is unchanged.

This supersedes the capture-unavailable status in the [earlier Astra repair record](ASTRA_REVIEW_FIXES.md). Activation and proof ran on November 11 Eastern time / November 12 UTC. It is a capture verification, not a claim that every TraceHarness capability is verified.

## What was installed

- Applied the separate `capture_store_run(uuid,jsonb)` function through Supabase's tracked migration API on production project `gclowkdcyvyhgbsfcyqk`. Migration: `20261112021420_serialize_capture_storage_admission`. SQL SHA-256: `420066152887d70a059904cb44d75c3112acf56bc985d3046fccde55641fd5b7`. The existing capture tables, RLS policies, auth schema and shallow schema were inspected and were **not reapplied**.
- Configured `SUPABASE_SERVICE_ROLE_KEY` as a Worker secret, supplied through stdin and retained only in process memory outside Cloudflare. It is never a member credential or browser value. Existing runner secrets and Supabase URL/anon settings were retained.
- The secret change created Worker version **`4b0d1d11-83b1-42f4-844b-0256ace83c8e`**, exit **0**, using pinned Wrangler 4.90.1 and the prescribed temporary configuration. The config was deleted. No Worker route, binding, Durable Object, migration binding, apex attachment or workers.dev target was added. No KV upload or frontend rebuild was needed.

Effective production grants were checked directly: only `service_role` can execute the new RPC. `anon`, `authenticated` and `authenticator` cannot. Members can select/delete their own captured runs through RLS, but cannot insert/update them directly or access the device-code/token tables. Security advisors returned **zero new findings**. Two existing INFO findings describe intentionally policy-free server-only tables; the existing leaked-password-protection WARN remains unresolved.

## Proved live, with real sessions

The production script completed **131 assertions**. These include repeated header/status assertions; they are not 131 independent test scenarios. Both accounts authenticated normally by password and were verified to have ordinary `member` profiles. Sessions and capture tokens were never fabricated or printed. Existing signup allowlisting rejected an attempted temporary test account; it was left intact. Two existing operator-supplied logins were used instead, without account or password changes.

| Flow | Observed result |
| --- | --- |
| Shipped Python `CaptureClient` device login | Each real member approved a code; the client polled, received a token and verified the correct owner with `whoami` |
| Upload and replacement | Production HTTPS upload was stored and read back; stable-ID replacement affected only that member; forged owner/byte fields did not control storage |
| Actual watcher and sync | The real Claude Code parser and `CaptureSync` uploaded controlled fixture output to production; unchanged payload hashes were retained without a second upload |
| Two ordinary members | Both used the same run ID with different content; reads/replacements stayed separate; explicit cross-member read/delete/token-revoke attempts were rejected |
| Direct RLS attacks | Real member JWTs could not read/delete another member's rows, insert captures, change quota bytes, inspect secret tables, or invoke the server-only RPC |
| Stale account / hostile origin | Stale-scope deletion returned 409; signed-in hostile-origin reads returned 403; no ACAO header was returned |
| Headless UI | Both members opened enabled capture/approval controls and saw their own saved run details, with no uncaught JavaScript errors |
| Atomic quota race | Four simultaneous Worker uploads at 499 rows produced **one 200 and three 429s**; PostgreSQL contained exactly 500 rows; replacement at the cap succeeded |
| Pagination | Three live pages returned all 500 run IDs exactly once, with a cursor until the final page |
| Delete and revoke | Own-run deletion was confirmed absent; client logout confirmed revocation; revoked tokens failed identity and upload requests with 401 |
| Anonymous gate | **11 fresh curl checks**, User-Agent `traceharness-proof`, `--max-redirs 0`: `/app`, `/app/shallow`, `/link`, `/app/device`, `/app/capture` returned 302 `/login`; protected APIs returned 401 `{"error":"Sign in required."}`, including hostile Origins, without ACAO |
| Existing member entry | Real owner sign-in still served the exact published `/app` HTML SHA-256 `5c254fac4a76ad017c9d0dece8f8da75d91baec1d445711ced0e1fa518b740fd` |
| Cleanup | Only exact newly created fixture IDs, device codes and tokens were removed. Both accounts' original run-ID sets matched their initial state |

All uploaded transcripts were clearly labelled **synthetic verification fixtures**. The transport, authentication, parser, Worker and database were real. No private coding-session directories were read and no paid model or harness execution was started.

The headless proof was corrected to wait for the completed detail fetch. A subsequent diagnostic also confirmed that production CSP intentionally blocks Playwright string evaluation; the final proof uses a normal locator wait. These were verification-script corrections. No CSP weakening or application change was made.

## Performance evidence and remaining limits

Twelve sequential unique uploads with approximately 4 KiB of verification content, using the warmed real client connection from this Mac, had median **93.852 ms**, observed range **80.866–168.144 ms**. This measures the current production upload endpoint under a small sequential workload. **Performance improvement remains UNVERIFIED** because there is no comparable historical live baseline. Model completion, model cost/performance gains and runner throughput were not tested in this pass.

The live byte-cap boundary/oversized physical-row refusal, real private-session capture, other source adapters, interactive terminal consent against production, the SessionEnd plugin and remote member-link room were not tested live here. Email/OAuth/PKCE callbacks and arbitrary native prompt/model/task combinations also remain outside this proof. The prior repair pass's 1,262 Python passes / 67 skips, 1,093 frontend passes, 266 Worker passes, 12 local PostgreSQL cases and 40 fixture-browser cases were **not rerun** for this configuration-only activation. Those tests are not substituted for live evidence.

## Manual check

1. Open `/app/capture` while signed out: expect `/login`. Sign in and confirm capture connection is available.
2. Install the pinned package revision, run `traceharness login`, open the printed `/app/device` URL yourself and approve its code. Run `traceharness whoami` and verify the destination account.
3. Follow [Capture sync setup](CAPTURE_SYNC.md). Select only directories you intend to upload and type the terminal consent. Inspect the saved run, ledger and patch on `/app/capture`.
4. Sign into another ordinary member account and confirm it cannot see the first account's run, including by specifying that member's UUID in the request. An admin has different read permissions by design.
5. Delete your test run. Run `traceharness logout`; subsequent use of that computer's revoked token must fail. Revocation does not delete previously saved runs.

## Secret-change deployment log

The command emitted fewer than ten log lines; all available lines are retained here. Exit: **0**. Deployed version: **`4b0d1d11-83b1-42f4-844b-0256ace83c8e`**.

```text

 ⛅️ wrangler 4.90.1
───────────────────
🌀 Creating the secret for the Worker "traceharness-platform"
✨ Success! Uploaded secret SUPABASE_SERVICE_ROLE_KEY

```

[Structured results, check labels, latency samples and private-evidence hashes](CAPTURE_PRODUCTION_VERIFICATION.json). The local evidence directory is `TraceHarness-capture-activation-2026-11-11`; private account identifiers and credentials are excluded from this public record.
