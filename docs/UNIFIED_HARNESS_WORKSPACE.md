# One harness workspace

The member workbench's **Harnesses** destination combines harness selection,
model selection, task selection and prompt editing in one configuration. Guided
setup and advanced blocks are editors within that workspace. The recorded-data
workbench remains available alongside it.

The canonical member URL is `https://traceharness.dev/app#/rig/harnesses`.
`/app` still comes from the authenticated Worker's `serveApp` function, which
decompresses the `app.html.gz` KV snapshot. Editing this React source alone does
not update that URL. Build and test an exact export, obtain the operator's
approval for that file, and only then upload it. The plain-JavaScript editor at
`/app/shallow` remains a separate renderer in the site repository.

## Harness identity

| Selection | What executes when a verified runner is connected | Prompt behavior |
| --- | --- | --- |
| Custom or saved TraceHarness harness | The TraceHarness engine with server-compiled blocks | Replaces the harness standing prompt |
| One of the six fixed presets | The TraceHarness engine with that preset's shell | Edits its standing prompt; shell controls remain fixed |
| Native Claude Code | A separately installed and pinned Claude Code adapter | Adds instructions to the native runtime |
| Native Codex CLI | A separately installed and pinned Codex adapter | Adds instructions to the native runtime |

The fixed presets are stand-ins. Choosing the Claude preset does not launch
Claude Code, and choosing the Codex preset does not launch the Codex CLI. Native
selections discard TraceHarness compiler blocks from the execution configuration.
Runtime versions and compatible models come from the private service; public
OpenRouter model metadata alone is not evidence of compatibility.

## Editing and saving

The member can carry a prompt to another harness or restore that harness's own
draft. Drafts are scoped to the signed-in account and tab. Each native runtime
keeps a separate prompt draft. Existing fixed, minimal and block deep links are
preserved so old links and drafts still open.

Guided answers and advanced blocks share one configuration. Returning to guidance
does not silently discard a customized prompt. **Reset to Wizard Answers** is
the explicit regeneration action. Read-only and permissive-policy warnings are
shown with compilation results.

Fixed and minimal account saves still require confirmed storage. Fixed updates
use the existing compare-and-swap preconditions. An account change, storage
failure or conflicting edit cannot produce a confirmed saved state. Native
configurations can be exported and retained as tab drafts; they are not silently
stored as TraceHarness fixed/minimal account records.

## Running and credentials

The browser calls only same-origin `/api/runner/*` endpoints. The Worker checks
the authenticated UUID, origin and member scope, then signs requests to the
operator-configured private service. It never sends the member JWT to that
service. Existing hosted workbench execution/import/capture routes remain
disabled. The local lab runner remains a separate loopback workflow.

With no configured service, the page remains an authoring workspace. It states
that the runner is unavailable, disables execution and does not collect an
OpenRouter key. Empty task inventories are shown as empty; recorded trajectories
are not promoted into executable task packages.

When a service is ready, the key connection returns a short-lived, owner-bound
handle. The actual key is kept in service memory and excluded from saved
harnesses, exported configurations, job manifests and task containers. Closing
the workspace requests revocation; failed revocation is not reported as
confirmed, and expiry remains the fallback.

Preflight is pure validation. Launch validates again, requires the hash of the
reviewed manifest, and uses an idempotency key
so a retry after an uncertain response cannot silently create another job.
Cancellation remains pending until the service confirms termination. A process
completion and a task's grading outcome are separate facts.

If the runtime image, task contents or other manifest fields change after review,
the service refuses launch and requires a fresh review before spending credits.

## Verification and release boundaries

Frontend tests cover selection, drafts, warnings, account saves, stale responses,
credential clearing and launch retries. The site repository includes a headless
`member-unified-flow.py` proof against an exact exported HTML artifact and the
real Worker with fixture authentication/database. Its separate
`runner-service-contract.mjs` proof crosses the actual JavaScript gateway and
Python ASGI service using an explicitly synthetic provider and executor.

These fixtures prove integration behavior. They do not prove a live member
session, native-runtime compatibility, real model billing, production database
painting, container isolation or deployment. Record those results separately and
mark any unperformed checks **UNVERIFIED**.

The private runner is disabled by default. Connecting Fly.io or a Virginia host
requires a reviewed deployment, pinned runtime/task/grader images, compatibility
receipts and verified isolation/resource limits. This source change does not
provision a host or make a service live.
