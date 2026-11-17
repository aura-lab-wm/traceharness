# TraceHarness 0.6.0: local only

Decided 2026-11-17 by the owner: TraceHarness is deployed only on the user's machine (package, container image,
Codespaces, school package). traceharness.dev keeps the landing page, the guide and the screencast. Every feature
that existed only on the hosted member console moves into the local console, and the hosted code is removed.

## Already done (2026-11-17, reversible)

- traceharness.dev is static (site repo PRs #25, #26): landing rewritten for local use, `/app`, `/login`, `/request`,
  `/pending`, `/link` redirect to the landing page, unknown paths answer 404. The hosted site code is kept at the site
  repo tag `archive/hosted-2026-11-17`.
- The Worker `traceharness-platform` has no route and no custom domain (list kept in
  `~/Documents/TraceHarness-local-only-2026-11-17/worker-routes-before-removal.json`).
- Fly app `traceharness-runner`: machine stopped, autostart off, volume and image kept.
- Permanent deletion (Fly app, Worker, KV, Supabase project with 12 member accounts) waits for the owner's explicit
  confirmation and a data export.

## Decisions

1. **The hosted runner becomes the local runner.** `traceharness/runner_service` is already a FastAPI app whose routes
   are `/api/runner/*`, the same paths the console used through the Worker. The local backend mounts it in-process.
   The console calls the same routes on `127.0.0.1:8765` with the same payloads. The Worker's HMAC (`auth.py`) is
   replaced by the local backend's existing Host, Origin and content-type guards; the owner is the constant `local`.
2. **Isolation.** The local runner uses gVisor (`runsc`) when `docker info` lists it, and plain Docker otherwise
   (no network except the model broker, read-only task mounts, memory, CPU and wall limits, as `traceharness agents run`
   already does). The console shows which isolation a job used. Running your own agent on your own machine in a
   container is the normal case; the hosted requirement for gVisor protected a multi-tenant server.
3. **Images are built on the user's machine**, never published by us: Claude Code is proprietary and its prompt
   inventory is extracted text. `traceharness runner setup` builds the three runtimes (`traceharness`,
   `native-claude-code` 2.1.322, `native-codex` 0.167.1; the `runtime` target of `deploy/runner/fly/Dockerfile`, to be
   moved) and the two graders (`grader.Dockerfile` with the eight task packages), generates the native-prompt
   inventories from the built images (`prepare_native_prompt_inventory.mjs`, `finalize_native_prompt_inventory.py`,
   `prepare_codex_prompt_inventory.py`), and writes `data/runner/registry.json` with the local image IDs.
4. **Compatibility receipts are optional.** A combination without a receipt runs after an explicit confirmation in the
   console ("not verified on this machine"). `traceharness runner verify` produces receipts with paid calls, with the
   caps the hosted release used, only when asked.
5. **Credentials.** The runner reads the OpenRouter key saved in Settings (`settings.server_key`); the hosted
   per-member credential store is not used. The key never enters a container: the broker holds it.
6. **Experiment matrices and paired experiments** run through the embedded runner, as on the hosted runner. Their
   state lives under `data/runner/`; finished trials are readable as datasets.
7. **Capture.** No sign-in and no upload. `traceharness capture export --out FILE.zip` writes the captured sessions
   (redacted, as today) and `traceharness import FILE.zip` reads them on another machine.
8. **Two modes**: `local` and `export`. `member`, `hosted_only`, `capture.computers` and `account` disappear.
9. **One release = one tag**: wheel, school package, console container image. No site step, no runner deploy.

## Capability table after 0.6.0

| capability | local | export |
|---|---|---|
| data.read | ok | ok |
| data.import, data.live_events, judge.run, capture.local, settings.server_key, assistant.model | ok | export_read_only |
| harness.compile, harness.save | ok | export_read_only |
| run.local | ok | export_read_only |
| run.container (was run.hosted), run.native, run.experiments | ok when `runner setup` has run and Docker answers, else not_configured | export_read_only |

`not_configured` reads: "{what} needs the local runner. Run `traceharness runner setup` (Docker required)."

## Work packages

Each package runs in its own worktree on a branch from `local-only`, with its tests, and merges into `local-only`.

- **WP0 seam (lead)**: contract (two modes, the table above, the new message), regenerated shared sources, this spec.
- **WP1 local runner (backend + CLI)**: mount `runner_service` in `traceharness/backend/app.py`; local settings
  (state `data/runner/`, registry `data/runner/registry.json`, isolation auto-detect, workers 2); drop the HMAC path and
  the Fly entry point; capability resolution from runner readiness; `traceharness runner setup|status|verify`;
  move `deploy/runner/{Dockerfile,grader.Dockerfile,tasks,*inventory*}` to `traceharness/runner/` (or keep the paths and
  package them); tests. Live proof on a Docker host (Virginia over ssh): setup, a mock-model `traceharness` job, a
  2x2 matrix, and one `native-codex` job with a $1 cap.
- **WP2 console (frontend)**: `member-api.js` becomes a same-origin local runner client; remove `member` mode,
  `MemberCapture.jsx`, `member-capture-api.js`, `MemberSite`, every `IS_MEMBER`/`MODE === 'member'` branch;
  `Unavailable` shows `not_configured` with the setup command; the run views show the isolation a job used;
  rebuild `frontend/dist`; vitest and dom tests.
- **WP3 capture**: remove sign-in, push and remote upload from `traceharness/capture`; add `capture export` and the zip
  import; tests on recorded fixtures.
- **WP4 cleanup and docs (lead, after WP1-3)**: remove `deploy/runner/fly`, the hosted release records move to
  `docs/history/`, `doctor` drops `site_live` and `runner_image` and gains `runner_ready`, the release workflow loses the
  runner pin, README / STUDENT_GUIDE / CODESPACES (Docker-in-Docker feature for native runs) / SPEC updated, hosted-only
  docs moved to `docs/history/`. Version 0.6.0.
- **Review**: one reviewer over the merged branch (security: the local runner listens only through the backend;
  hostile Origin and Host get 403; the key never reaches a container; a job cannot write outside its workspace).
- **Release** 0.6.0; then the paper (my-paper-voice) and Alvi's tracker (11 experiments that used the site).

## Not in scope

Pyodide or any browser-only console; a shared lab server; publishing runtime images.
