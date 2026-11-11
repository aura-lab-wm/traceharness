# Comprehensive platform verification — November 11, 2026

The independent checks below pass. **This is not an all-green platform claim:** account provisioning is blocked, and the requested Carbon review did not complete.

## Two outstanding blocks

1. The second operator account's saved 1Password credential was tested at the exact TraceHarness origin. Sign-in returned **401**. Its access request was still pending. Completing the previously authorized approval through the existing owner workflow returned **503: “Account creation is not configured on this host.”** No password was reset and no server secret was added. Live isolation across two real members therefore remains **UNVERIFIED**.
2. Gemini **4 Carbon High**, high effort, was requested through the available subscription CLI. Ultracode was not exposed as an executable, agent profile or connected plugin. Three CLI invocations ended in `print_timeout`; no completed audit was produced. **No Carbon test/review conclusion is claimed.** The verification below was run independently.

## Changes made and verified

- The member dataset home now provides one **Open Harnesses** action and accurate hosted-execution guidance. It previously directed members to local execution and showed three older entry points.
- CLI regression tests now use the active Python interpreter instead of assuming a `.venv` at the repository root.
- Failed SQLite initialization closes its handle before recovery; cached connections close at process shutdown. Three new lifecycle cases failed before the fix; all four lifecycle cases pass afterward.
- Legacy analysis, Sentinel, console and export readers now close their files explicitly. The final full suite reports no production-reader or SQLite ResourceWarnings. Some older test fixtures still emit file warnings.
The Python cleanup changes are in the local package's public source. Hosted changes in this pass were HTML snapshot updates; the Worker and runner image were not redeployed.

- The retained HTML wrapper's two old `harnesslab-export-error` identifiers were aligned with the current exporter. Recovery logic was already present. The recorded payload and compiled app bytes are unchanged by this final wrapper alignment.

## Verification matrix

| Area | Evidence | Outcome |
| --- | --- | --- |
| Public home, guide, login, member entry and protected email links | Live HTTP plus rendered-link checks | Pass |
| Recorded analysis and navigation | **1,176** render states: 196 routes, eight datasets, three widths, both themes | Pass; rendering coverage, not a model-performance experiment |
| Full JSON, Unicode editing, invalid/discard handling | Actual member UI and real compile/preflight endpoints | Pass |
| Checkpoints and portable import/export | Actual files and restored configuration compared | Pass |
| Guided/advanced editing, warnings and explicit reset | Real compiler responses and live controls | Pass |
| Native prompt editing | Exact production inventory, replacements, bulk selection, opt-in/out, reload and 320–1920 px layouts | Pass |
| Runtime/model/task selection | Nine UI choices reach Ready; **67** supported reviews pass and **five** unsupported reviews are rejected | Pass; rejected pairings are not claimed runnable |
| Provider connection and review gating | Key excluded from storage; changes/invalid limits invalidate review; disconnect revokes connection | Pass |
| Experiment queue | Real four-cell plan; freeze replay returns the same record; missing-key Start rejected; cancellation and exported results agree | Pass; zero jobs or model calls |
| Saved prompt durability | Conditional durable save, forced account/Postgres revalidation, exact paint in a fresh member context, conditional original restoration | **Live verified**, using the member session; no service-role key |
| Historical run and full harness JSON | Existing successful Claude result, exact manifest, verified original download | Pass |
| Voice tour and navigation Buddy | Five MP3s decode/play/pause; real workflow controls, mobile layouts, reload and fresh-context acknowledgement | Pass; no new LLM Buddy response was purchased |
| Anonymous security | **41** GET/POST/DELETE gate cases; exact 401 JSON without ACAO; member URLs redirect to `/login` | Pass |
| Authenticated boundaries | **16** checks: cookie attributes, hostile Origin, stale scope, blocked machine-local writes, invalid Pages code recovery | Pass |
| Offline export and damaged files | Eight browser cases: offline load, unsupported browser, truncation, gzip corruption, declared-size errors, encoding rejection and hosted fallback fixture | Pass |
| Runner cleanup | Zero active jobs, experiments, needs-attention jobs, containers or residual mounts; pinned registry unchanged | Pass |

The saved historical Claude result remains `succeeded` / `passed`, with **$0.177053** reported cost. This pass did not rerun it, erase earlier failures, or resolve historical unknown charges. It created one explicitly named experiment, cancelled before execution, and restored the prompt used for the durability check. **New hosted jobs/model calls/charges: zero.**

## Automated checks and provenance

- Python: **1,231 run; 1,165 passed; 66 skipped**. Skips include full-checkout-only capture/macOS components, instructor solutions and optional Inspect AI/real-data dependencies. They are not counted as passed.
- Frontend: **1,091 passed** in 65 files. Worker: **198 passed**. Distribution freshness: **two passed**. Lint: exit **0**, zero warnings, warnings enforced as failures.
- Tests ran in an isolated tracked-source archive to prevent FileStore writes in the operator's checkout. **412 source/distribution files** were hash-compared with committed code: no mismatch.
- Code commit: `a2a7e63929744f19977db941fb40c90137eda251`. UI publication source: `a2a7e63929744f19977db941fb40c90137eda251`.
- Final HTML SHA-256: `77e550efb1c311a09ce9169e0c06943b987a538c7d0a23d698d8bfd2568abc21`. The final member UI proofs read back this exact fingerprint after removing only the injected member marker.
- Gzip SHA-256: `6f217cc845cd4f601ffa67e6238dde9890813e8cc0c81e20164f6a01aad08636`; **15,295,627 bytes**. All eight datasets, **3,453 runs**, **80,396 spans**, and five narration files are retained.
- KV upload exit: **0**. Worker version retained: `5ff30c89-62aa-4c90-ba78-b37a24ef4bf4`. No Worker/Fly redeployment, routes, SQL, secret configuration or marketing files were changed. The temporary config was deleted.

Last available upload log lines (fewer than ten were emitted):

```text

 ⛅️ wrangler 4.90.1 (update available 4.160.1)
──────────────────────────────────────────────
Resource location: remote

Writing the contents of /Users/amastro/Documents/TraceHarness-comprehensive-verification-2026-11-11/app-comprehensive-current-bootstrap.html.gz to the key "app.html.gz" on namespace id: "8a74dd2fba124b1a8d82e6eeff5ba3ae".

```

## Limits that remain explicit

One final native-editor browser run completed its four feature steps but failed the aggregate no-error/no-job postcondition. Three instrumented repeats passed with no page errors, blocked requests or new jobs; the first failure’s cause remains **UNVERIFIED**. It is retained in the evidence rather than counted as a pass.

The five unsupported native pairings remain blocked. General performance improvement, every possible native prompt intervention, arbitrary models/repositories and a real email/OAuth/PKCE code exchange remain **UNVERIFIED**. The invalid Pages code test proves a clean Worker callback with a password-sign-in exit; it does not prove a valid code exchange.

Vite still reports its existing large single-file bundle advisory; the local Python environment reports a third-party Starlette/httpx advisory and some test-fixture file warnings. No warning limit was raised and no diagnostics were suppressed to claim success.

The [structured verification record](COMPREHENSIVE_VERIFICATION.json) contains outcome details, exact pins, skip reasons and hashes of the private evidence. Credentials and recovery prompt text are excluded.
