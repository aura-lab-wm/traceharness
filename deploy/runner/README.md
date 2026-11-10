# Private execution service

This package implements the private execution control plane, isolated task and
native runtime adapters, independent grading, and owner-authorized artifact
retrieval. The checked-in default registry is empty and execution is disabled
until an operator installs a verified inventory. Tests use explicit fixtures;
fixtures never register a real task or runtime compatibility receipt.

The real Requests task and its reproducible package builder are documented in
[tasks/README.md](tasks/README.md). The deployed November 10 execution scope and
separate operator/member evidence are recorded in
[the release report](releases/2026-11-10.md). A fresh installation still requires
its own host, grading and runtime/model verification. An implementation or built
image alone does not establish readiness.

The member continues to use `https://traceharness.dev/app`. Its runner requests
go through the existing authenticated Worker at `/api/runner/*`. The private
service never receives a member JWT and is not a browser-facing application.
`python -m harnesslab` remains the local lab on `127.0.0.1:8742`; this package
does not change that command or the existing compiler.

## Boundaries

The Worker signs method, complete `/api/runner/` path, canonical member UUID,
timestamp, nonce and SHA-256 of exact body bytes. The service accepts a 60-second
clock window and a bounded nonce replay table. The shared secret has no default.
Query strings are unsupported. Every credential and job belongs to the signed
UUID; another member receives no job data. No endpoint enables CORS.

OpenRouter keys are held only in the bounded in-memory vault for one hour, with
at most four handles per member and 200 globally. Restart forgets all keys. Key
validation is limited to four concurrent operations globally and one per member.
Validation failures, malformed JSON and provider errors never echo input values.
Credential requests have an overall deadline and cannot create a late handle
after a timed-out response.

Jobs retain a public manifest and status in a private directory outside the lab's
tracked `data/runs`. No key, credential handle, or process environment is serialized
in job metadata. Model responses can appear in owner-authorized trace artifacts.
Admission is bounded to two active jobs per
member, eight queued/running jobs with default settings, 100 retained jobs per
member, 2,000 records globally, and a 64-MiB serialized-manifest budget. Terminal
records expire after 24 hours. List responses omit manifests; detail responses
return the complete manifest and its digest.

Each task container has `--network none`. Its only model connection is its own
Unix-domain socket, mounted read-only from a private job directory. A relay
inside the container listens only on that container's loopback interface. It
forwards to the socket; the host broker resolves the member's credential for
each request. The `runner-socket` value passed to native SDKs is a nonsecret
placeholder, not an OpenRouter key. Neither the host home nor the Docker socket
is mounted into task or grader containers.

The broker fixes the model and destination, blocks alternate routes, background
responses, external image/file/audio fetches and web-search tools, caps output at
8,192 tokens, and limits model requests. For Claude Code it additionally fixes
`provider.only=["anthropic"]` and `allow_fallbacks=false`. Model calls run in a
killable transport process with a total deadline, including slow response
headers; there are no automatic paid retries. Streaming protocol frames are
preserved but buffered within a 4-MiB response limit. Compatibility with each
native CLI must be demonstrated against that exact transport before registration.

The `max_steps` field limits **model requests**, including for native agents. It
does not count every native tool action. Cost control reserves a conservative
byte-based input bound, output cap, and current listed request price before a
call. A complete successful response with a validated final cost replaces that
request's reservation with its actual reported charge. Partial, errored or
unpriced responses keep their reservation; earlier uncertain charges are never
refunded. This is not a guarantee about
provider billing changes or costs outside this service. Actual token/cost totals
are not fabricated. Request count is always reported; input/output tokens and
cost are included only when a valid terminal provider response actually supplies
them. Streaming usage is read from terminal protocol records, not estimated from
a displayed model price. Missing billing fields remain absent.

## Host requirements and failure handling

Use a dedicated Linux execution VM or host with a separately installed `runsc`
or Kata Docker runtime and enough capacity. A shared Virginia Docker daemon
using ordinary `runc` does not satisfy this requirement. The current deployment
contract targets a dedicated Fly VM with its own Docker daemon and gVisor
runtime; the isolation checks are unchanged by the choice of VM provider.

The trusted control service needs Docker administration and host mount capability
(root with `CAP_SYS_ADMIN`). This is **not** a permission granted to task containers.
Do not install this privileged service on a shared host merely because Docker
is available. An audited VM or dedicated host is an appropriate boundary; this
package's service entrypoint does not provision one. Provisioning, private-network
binding, persistent storage and image installation belong to the operator's
reviewed deployment configuration. Never add capabilities to a shared daemon
merely to pass readiness.

Workspace, runtime output, and grader output use per-job bounded tmpfs mounts
(2 GiB, 64 MiB, and 16 MiB respectively). Task containers have a read-only root,
non-root UID, no capabilities, no-new-privileges, 4-GiB memory, two CPUs, 256 PIDs,
and a bounded `/tmp`. There are no published ports. The inner entrypoint also
enforces a wall deadline, so loss of the control process does not grant an
unlimited task lifetime. A trusted offline grader runs separately, without the
model socket, and reads the resulting workspace plus the original task package.
The trusted grader result writer runs as root with only SETUID and SETGID added;
its output tmpfs is root-owned mode0700. Candidate Python is evaluated as
UID/GID10002 with supplementary groups cleared, no-new-privileges and a minimal
environment. The grader reconstructs pristine source and immutable tests instead
of accepting agent-modified pytest configuration or startup hooks. The curated
Requests task also validates a disclosed static edit contract before any candidate
import: only a safe serialization method may be added, with the original module
otherwise unchanged. This closes its stdout-marker forgery path. It does not make
arbitrary Python edits safe to grade using subprocess output; every further task
needs a reviewed grading boundary. See the task documentation for its exact policy.

Cancellation is first `cancel_requested`. It becomes `cancelled` only after the
executor returns or confirms cleanup. An already-issued provider call can still
incur its provider charge. Container or tmpfs cleanup failure becomes
`needs_attention` and blocks all new admission and readiness. Restart converts
unfinished records to the same state; unknown, missing, oversized or malformed
job records also block admission. Startup checks for runner-named containers and
leftover state-directory mounts even when records are missing. These barriers
are never automatically purged or treated as proof that old resources stopped.

An operator must inspect the affected job, ensure its containers and mounts are
gone, archive the affected record/state directory, then restart the control
service. Do not delete records first to bypass reconciliation. A job whose
request outcome is uncertain must not be retried automatically. Idempotency keys
deduplicate exact submissions per member; reusing one for another manifest or
credential returns a conflict.
Launch also requires the exact `manifest_sha256` returned by the member's
preflight. The service recomputes it and refuses changed runtime, task, grader,
prompt or limits before admitting a job.

`succeeded` means execution completed, **not** that the issue was solved. The
separate `grade` enum is `ungraded`, `passed`, `failed`, or `error`. Only the trusted
grader supplies it. Finalized artifacts can include `manifest.json`, `grade.json`,
`trace.jsonl`, `messages.json`, `patch.diff` and `summary.json`. Each artifact is
bounded to 1 MiB, opened without following links, restricted to regular UTF-8
files and scrubbed for credential-shaped text before its published SHA-256 is
computed. Oversized or invalid artifacts are explicitly omitted with an issue;
a truncated trace is not presented as complete.

`GET /api/runner/jobs/{job_id}/artifacts/{name}` verifies the requesting owner,
allowlisted name, recorded byte count and SHA-256 before returning bounded
base64 content through the authenticated Worker. The member UI can download
these artifacts. Arbitrary agent files, host paths, Docker output and credentials
are never exposed by that endpoint. Failed or cancelled executions retain any
valid artifacts recovered before temporary storage is removed.

## Inventory and runtime images

Start from `registry.empty.json`. Inventory paths must be relative to its
directory and may not traverse symlinks. Task packages are operator-installed,
not uploaded or fetched from browser URLs. A package contains `repo/`, `issue.md`,
`task.json`, and any grader inputs. `task.json` supplies the explicit public
`visible_test_command`; the TraceHarness `run_tests` tool executes that command
inside the sandbox. The agent receives repository/instructions/public metadata;
hidden grading inputs are mounted only into the offline grader. An absent or
invalid visible command prevents the task from becoming ready.

Each task entry requires `id`, `title`, HTTPS `repository`, immutable Git
`revision` (40 or 64 hex characters), relative `path`, `content_sha256` from
`harnesslab.runner_service.registry.tree_hash`, pinned `grader_image_digest`,
registered `runtime_ids`, and an `environment_digests` mapping whose keys exactly
match those runtime IDs. Each value must match that runtime's pinned image.
Legacy `environment_digest` inventories remain accepted for a shared image.
The selected runtime's environment digest is bound into the preflight manifest.
The grader image
must provide `/opt/traceharness-grade`, read `/workspace` and `/task`, and write
`/output/grade.json` with `{"outcome":"passed"}`, `failed`, or `error`. Missing,
oversized, symlinked or malformed grade files fail the execution.

Runtime entries require `id`, exact `version`, digest-pinned `image_digest`, and
`compatibility_receipts`. IDs are `traceharness`, `native-claude-code`, and
`native-codex`. Runtime image labels must match the ID/version. Immutable local
Docker IDs (`sha256:...`) and registry references (`name@sha256:...`) are accepted
only when Docker inspection confirms the exact identity; mutable tags are not.

The same task may have a different pinned environment for each engine. One
image per runtime ID is supported in an installation; that image must include
the dependencies of every task registered for it. Multiple dependency images
for the same runtime ID remain unsupported. No member request builds an image,
fetches a repository or installs a package.

Each compatibility receipt entry has a relative `path` and SHA-256 of its bytes.
Its JSON must bind `status:"passed"`, `runtime_id`, `runtime_version`,
`image_digest`, `model_id`, `task_id`, `task_revision`, `task_content_sha256`,
`grader_image_digest`, `verified_at`, and a real `run_id`. Replacing any of those
runtime, model, task or grader identities invalidates the receipt. Models must also be
explicitly registered (`id`, `name`) and present in the current OpenRouter
catalog. Do not create receipts from unit fixtures, the existence of a binary,
or a model's marketing name. Receipts are operator attestations, not automatic
proof of all future provider behavior.

`manifest_sha256` hashes the server's compact, sorted-key UTF-8 JSON, whereas an
artifact's `sha256` hashes its exact downloadable bytes, including whitespace.
Verify both independently. Parsing the downloaded `manifest.json` preserves the
compiler's numeric types for canonical rehashing. The JavaScript gateway may
serialize a compiled temperature of `0.0` as `0`; a client that rehashes the
preflight object must restore only `harness.configuration.temperature` to its
declared float type. Do not coerce the request's sampling block or other fields.
The artifact's canonical hash must match the reviewed manifest hash, and its
parsed value must equal the reviewed manifest semantically.

The catalog exposes `task.model_ids_by_runtime`: each declared runtime maps to
the currently ready models for that exact task. Empty arrays mean unverified or
unavailable. Runtime `model_ids` is the union across ready tasks; it never grants
permission by itself. Member preflight checks the exact task/runtime/model
receipt and current task/image/provider health. A receipt for one task cannot
enable another task.

The Dockerfile is a runtime wrapper only. Supply an audited digest-pinned base
that already contains Python and, for native modes, the exact native binary.
Supply a local `wheelhouse/` containing this project's wheel and all dependency
wheels plus an independently reviewed `SHA256SUMS`. The build has no network
dependency installation or latest-version fallback. The output image must be
pushed and registered by digest only after independent build review and actual
isolated compatibility testing. Operator deployment builds may use a separate
reviewed recipe that pins the Python/native versions, task dependencies and
resulting immutable image IDs. Record those exact inputs and hashes with the
release rather than treating an image-build success as model compatibility.

Native Claude Code uses safe mode, a fresh empty HOME, no settings sources,
strict empty MCP configuration, no skills or Chrome, and an appended prompt
file. It uses a placeholder auth token and blank API key following OpenRouter's
[Claude Code integration](https://openrouter.ai/docs/cookbook/coding-agents/claude-code-integration).
The [provider routing reference](https://openrouter.ai/docs/guides/routing/provider-selection)
documents the `anthropic` allowlist slug. Native Codex uses a fresh CODEX_HOME,
an explicit local Responses provider, ephemeral execution, disabled rules, and
developer instructions in a generated UTF-8 TOML file. Both use noninteractive
permission bypass **only inside the externally isolated container**. No host
agent session or account state is read. Each installed task/runtime/model combination needs
its own real compatibility receipt. The release report lists the exact verified
versions, models, images, task and signed-in execution results.

## Starting a reviewed installation

Set `RUNNER_SHARED_SECRET` through the host secret manager; do not put it or a
member key on a command line. Set `RUNNER_STATE_DIR` to an exclusive private
directory and `RUNNER_REGISTRY` to the reviewed inventory. Only after the host,
images, task packages and compatibility evidence are ready set
`RUNNER_EXECUTION_ENABLED=1`, `RUNNER_DOCKER`, and `RUNNER_ISOLATION_RUNTIME`.
The command `python -m harnesslab.runner_service` binds only `127.0.0.1:8743`.
A dedicated VM launcher may instead bind the VM's explicit private interface
address behind its HTTPS proxy; do not bind `0.0.0.0` or publish task-container
ports. The service accepts no browser session or direct unsigned operation.

Configure the Worker's `RUNNER_URL` as the operator-owned HTTPS origin and set
`RUNNER_SHARED_SECRET` on both sides using secret storage. Existing same-origin
`/api/runner/*` routes remain the browser interface. Keep the member JWT in the
Worker; forward only the signed canonical UUID. The service package itself
does not modify Cloudflare routes, the apex, KV, Worker secrets, Fly apps or
Virginia services. Those deployment actions require an explicit operator scope
and their own release logs. Preserve the existing login and anonymous API gates.

For tests, `create_app(Settings(...), registry=..., provider=..., executor=...,
clock=...)` supports explicit dependency injection. Production imports create
no server and select no fixture executor. Run the isolated suite with
`python -m unittest discover -s tests_agentlab/runner_service -v`.
