# Astra review repairs — November 11, 2026

All seven findings in the pinned Astra review have code repairs and regression coverage. **Production capture remains explicitly unavailable** until its service configuration and atomic storage RPC are provisioned and tested. This is not an all-green platform claim or a completed live capture-upload proof.

The public code is `03b249f6a2e243025d7aca0233a07afb255911f6`. The companion site's local commit is `32b8d991207da6bd96b9efffddde21e81d8fdafb`; that repository has no remote and was not pushed. The concurrently published capture push, member-link and plugin work was merged rather than overwritten. The strict client and those tools share one origin-bound credential store.

## What changed

| Finding | Repair | Evidence |
| --- | --- | --- |
| F1: stale capture tabs act as another current account | Verified account marker in both pages; scope headers checked before capture writes and on supplied read scopes | Local A/B stateful regressions; real member missing/stale writes return 409 |
| F2: details and Delete can target different runs | Abort/generation checks, returned-ID validation, disabled pending deletion, frozen confirmed ID | Deferred-response regressions and actual headless clicks |
| F3: advertised client commands are absent | Real device login/identity/logout, explicitly consented watch sync, shared credentials, redaction and no automatic upload retry; existing push/link/plugin retained | Mock HTTPS plus real local watcher; six installed console entry points in a fresh venv |
| F4: approval URL lands on Pages | Canonical `/app/device` uses the existing `/app/*` Worker coverage | Route-contract test; real member approval page; anonymous 302 `/login` |
| F5: quota check races with writes | One server-only PostgreSQL function serializes quota admission and upsert per member; missing function returns 503 with no direct-table fallback | Twelve real temporary-PostgreSQL tests, including deterministic lock contention and rollback |
| F6: refreshed rows reuse an old outcomes join | Removed the outcomes-only memo; hook memoization retains both input dependencies | Added/removed/corrected run and outcome regressions |
| F7: list limits hide old runs/devices | Bounded timestamp/ID cursor pages, admin owner tie-break, Next/Previous controls | More-than-one-page tests; later-page run deletion and active-device revocation |

Headless checks also caught and repaired mobile header clipping, preformatted-command horizontal overflow and detail headings hidden under the sticky header. Those checks use local fixtures and fallback fonts; they are not real-account browser isolation proof.

## Verification in this pass

- Python: **1,329 run; 1,262 passed; 67 skipped**, from an isolated archive of the final merged code. Skips remain skips; their reasons are in the structured record. One SQLite warning check requires Python 3.13+ and is skipped under the 3.12 interpreter used here.
- Frontend: **1,093 passed** in 65 files; lint passed with warnings enforced as failures. The 103-file frontend source stamp is unchanged by the later capture-only merge.
- Worker: **266 passed**. Real local PostgreSQL: **12 passed**. Local headless Chromium: **40/40**, zero uncaught JavaScript errors, with 24 retained screenshots.
- Fresh installed wheel: six CLI help entry points passed, including login, watch sync, push, identity, logout and member link. Real device approval and upload were not attempted against production.
- Fresh live anonymous checks: `/app`, `/app/shallow`, `/link`, `/app/device` and `/app/capture` return **302 `/login`**. The tested APIs return exact **401 `{"error":"Sign in required."}`** without ACAO, including the hostile-Origin shallow request.
- A real operator session verified the correct account marker on both capture pages, **409** for missing/stale mutation scope and **403** for hostile Origin. The new `/app` snapshot was read back byte-for-byte after removing only the known Worker injections, then opened in headless Chromium without uncaught JavaScript errors. No browser writes were allowed.
- **New TraceHarness execution jobs/provider requests: zero.** The prior successful and failed/ungraded executions, unknown historical charges, and performance limits were not rewritten or rerun.

The 1,176-route rendering sweep and earlier prompt-durability/native execution proofs belong to the previous verification pass; they are not counted as newly rerun here. Existing Vite bundle-size and test-environment deprecation/test-fixture advisories were not suppressed.

## Publication

Worker deploy exit: **0**. Version: `e9805314-b341-427b-be1c-541e56dbed31`. Existing routes and secrets were retained; no new route, Durable Object, migration, secret, `workers.dev` target or apex attachment was added. The temporary config was deleted.

Last ten Worker log lines:

```text
Worker Startup Time: 2 ms
Your Worker has access to the following bindings:
Binding                                                  Resource
env.SNAPSHOT (8a74dd2fba124b1a8d82e6eeff5ba3ae)          KV Namespace
env.ADMIN_EMAILS ("amastropaolo@wm.edu")                 Environment Variable

Uploaded traceharness-platform (1.99 sec)
No deploy targets for traceharness-platform (0.56 sec)
Current Version ID: e9805314-b341-427b-be1c-541e56dbed31

```

KV upload exit: **0**, exact file `app-review-fixes.html.gz`, 15,295,622 bytes. Gzip SHA-256: `ba814c8707f27efc72bd8cee045f8c9dfbf7588dbb02ec94c64400d2617b0027`. Live HTML SHA-256: `5c254fac4a76ad017c9d0dece8f8da75d91baec1d445711ced0e1fa518b740fd`. All eight recorded datasets, **3,453 runs** and **five narration chapters** are retained; encoded recorded data is unchanged. The live readback initially saw the previous snapshot five times before the sixth read matched; all observations are retained in the structured record.

Last available KV log lines:

```text

 ⛅️ wrangler 4.90.1 (update available 4.160.1)
──────────────────────────────────────────────
Resource location: remote

Writing the contents of /Users/amastro/Documents/TraceHarness-review-fixes-2026-11-11/app-review-fixes.html.gz to the key "app.html.gz" on namespace id: "8a74dd2fba124b1a8d82e6eeff5ba3ae".

```

## Availability and manual review

1. Open `/app/device` and `/app/capture` in a private window: both must send you to `/login`.
2. Sign in and open `/app/capture`: the current production host must say capture uploads are unavailable and disable connection instructions. `/app/device` must render its own approval page with approval disabled, rather than the marketing page. Existing inventory may also report unavailable service configuration; no empty result is substituted for an error.
3. Open `/app#/rig/harnesses`: the hosted harness/model/task workspace remains the member entry. Saving or reviewing a configuration must not start an execution.
4. After storage/service setup is explicitly enabled and verified, follow [CAPTURE_SYNC.md](CAPTURE_SYNC.md). Choose session paths, verify the signed-in identity, and type consent at the terminal. Capture does not require or start a model run. Later-page inventory and deletion tests currently have local fixture coverage, not live populated-account coverage.

The new `auth/capture-storage.sql` in the companion site repository is a separate function over the existing tables. It was tested only in temporary local PostgreSQL clusters, which were stopped. **No production SQL was applied and no existing SQL was reapplied.** Uploads and new device starts fail closed on hosts without compatible atomic storage. Readiness is not inferred from a committed SQL file.

Live capture-token issuance/upload/revocation, two-real-member isolation, valid email/OAuth/PKCE exchange, general performance improvement and arbitrary native prompt/model/task combinations remain **UNVERIFIED**. The earlier intermittent native UI guard failure also remains unresolved. Remote member linking still depends on infrastructure omitted by the standing deployment constraints; retaining its client command does not establish a working live room.

[Structured outcomes, source/build pins, skip reasons and evidence hashes](ASTRA_REVIEW_FIXES.json).
