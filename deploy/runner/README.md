# Private execution service

This is an implementation and an operator integration contract. It has **not**
been provisioned, deployed, or verified with a live model. The checked-in registry
is empty and execution is disabled by default. Tests use explicitly injected
fixtures; no fixture is a real task, compatibility result, or runnable default.

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
tracked `data/runs`. No key, credential handle, provider response, or process
environment is serialized in a job. Admission is bounded to two active jobs per
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
call. Uncertain reservations are not refunded. This is not a guarantee about
provider billing changes or costs outside this service. Actual token/cost totals
are not fabricated; the current public usage report contains request count only.

## Host requirements and failure handling

Use a dedicated Linux execution host with a separately installed `runsc` or Kata
Docker runtime and enough capacity. The existing Virginia host is shared, and
its observed standard `runc` runtime does not satisfy this requirement. No host
configuration was changed by this work.

The trusted control service needs Docker administration and host mount capability
(root with `CAP_SYS_ADMIN`). This is **not** a permission granted to task containers.
Do not install this privileged service on a shared host merely because Docker
is available. An audited VM or dedicated host is an appropriate boundary; this
repository does not provision one.

Workspace, runtime output, and grader output use per-job bounded tmpfs mounts
(2 GiB, 64 MiB, and 16 MiB respectively). Task containers have a read-only root,
non-root UID, no capabilities, no-new-privileges, 4-GiB memory, two CPUs, 256 PIDs,
and a bounded `/tmp`. There are no published ports. The inner entrypoint also
enforces a wall deadline, so loss of the control process does not grant an
unlimited task lifetime. A trusted offline grader runs separately, without the
model socket, and reads the resulting workspace plus the original task package.

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
grader supplies it. Current artifacts expose the normalized grade's name, size
and SHA-256; arbitrary agent files and stdout are not published. Full trace/patch
export and artifact download are not implemented by this service.

## Inventory and runtime images

Start from `registry.empty.json`. Inventory paths must be relative to its
directory and may not traverse symlinks. Task packages are operator-installed,
not uploaded or fetched from browser URLs. A package contains `repo/`, `issue.md`,
and any grader inputs. The agent sees only `repo/` and `issue.md`; hidden grading
inputs are mounted only into the offline grader.

Each task entry requires `id`, `title`, HTTPS `repository`, immutable Git
`revision` (40 or 64 hex characters), relative `path`, `content_sha256` from
`harnesslab.runner_service.registry.tree_hash`, pinned `environment_digest`,
pinned `grader_image_digest`, and registered `runtime_ids`. The grader image
must provide `/opt/traceharness-grade`, read `/workspace` and `/task`, and write
`/output/grade.json` with `{"outcome":"passed"}`, `failed`, or `error`. Missing,
oversized, symlinked or malformed grade files fail the execution.

Runtime entries require `id`, exact `version`, digest-pinned `image_digest`, and
`compatibility_receipts`. IDs are `traceharness`, `native-claude-code`, and
`native-codex`. Runtime image labels must match the ID/version. The v1 task
environment must be the same pinned image as its registered runtime. V1 permits
only one image per runtime ID in an installation. Compatible task dependencies
must share that image; incompatible dependencies require a separately reviewed
installation and registry. Multiple dependency images for the same runtime ID
are not supported yet. There is no untrusted image build or package installation
at run time.

Each compatibility receipt entry has a relative `path` and SHA-256 of its bytes.
Its JSON must bind `status:"passed"`, `runtime_id`, `runtime_version`,
`image_digest`, `model_id`, `verified_at`, and a real `run_id`. Models must also be
explicitly registered (`id`, `name`) and present in the current OpenRouter
catalog. Do not create receipts from unit fixtures, the existence of a binary,
or a model's marketing name. Receipts are operator attestations, not automatic
proof of all future provider behavior.

The Dockerfile is a runtime wrapper only. Supply an audited digest-pinned base
that already contains Python and, for native modes, the exact native binary.
Supply a local `wheelhouse/` containing this project's wheel and all dependency
wheels plus an independently reviewed `SHA256SUMS`. The build has no network
dependency installation or latest-version fallback. The output image must be
pushed and registered by digest only after independent build review and actual
isolated compatibility testing. No image was built by this task.

Native Claude Code uses safe mode, a fresh empty HOME, no settings sources,
strict empty MCP configuration, no skills or Chrome, and an appended prompt
file. It uses a placeholder auth token and blank API key following OpenRouter's
[Claude Code integration](https://openrouter.ai/docs/cookbook/coding-agents/claude-code-integration).
The [provider routing reference](https://openrouter.ai/docs/guides/routing/provider-selection)
documents the `anthropic` allowlist slug. Native Codex uses a fresh CODEX_HOME,
an explicit local Responses provider, ephemeral execution, disabled rules, and
developer instructions in a generated UTF-8 TOML file. Both use noninteractive
permission bypass **only inside the externally isolated container**. No host
agent session or account state is read. These adapter launch paths are implemented;
native execution and appended-prompt behavior remain **UNVERIFIED** until real
compatibility receipts exist.

## Starting a reviewed installation

Set `RUNNER_SHARED_SECRET` through the host secret manager; do not put it or a
member key on a command line. Set `RUNNER_STATE_DIR` to an exclusive private
directory and `RUNNER_REGISTRY` to the reviewed inventory. Only after the host,
images, task packages and compatibility evidence are ready set
`RUNNER_EXECUTION_ENABLED=1`, `RUNNER_DOCKER`, and `RUNNER_ISOLATION_RUNTIME`.
The command `python -m harnesslab.runner_service` binds only `127.0.0.1:8743`.
Provide a separately reviewed private HTTPS connection from the Worker; do not
expose this port directly to the public internet. No Cloudflare route, KV value,
Worker secret, Fly app, or Virginia service is configured by this package.

For tests, `create_app(Settings(...), registry=..., provider=..., executor=...,
clock=...)` supports explicit dependency injection. Production imports create
no server and select no fixture executor. Run the isolated suite with
`python -m unittest discover -s tests_agentlab/runner_service -v`.
