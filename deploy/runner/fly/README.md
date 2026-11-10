# Dedicated Fly runner

This recipe runs the privileged coordinator in a dedicated Fly VM. Member code
runs in separate gVisor containers inside it. Do not install the coordinator in
a container on a shared production Docker host. The browser continues to use
`https://traceharness.dev/app` and the existing authenticated Worker gateway.

The VM exposes only the HMAC-authenticated control API through Fly's HTTPS
proxy. Uvicorn binds the VM's actual private IPv4 address, not a wildcard.
The local lab command remains `python -m harnesslab` on `127.0.0.1:8742`.
This recipe does not add Cloudflare routes or expose a Docker TCP socket.

## Build inputs

Build on Linux amd64 with the checked-in Dockerfile. Its base images, native
CLI versions, Python packages, and gVisor archive are pinned. The resulting
image identities, wheel hash, inventory hash and task hashes belong in the
release record; a successful build is not a compatibility receipt.

The build context contains:

- `Dockerfile`, `start.py`, and `../verify_runtime.py` from this directory tree.
- `harnesslab/`: the reviewed coordinator source, without caches or secrets.
- `harnesslab-0.3.0-py3-none-any.whl`: a wheel built from that same source.
- `requirements.lock`: the reviewed task's dependency lock file.
- `grader/grade.py`: `../tasks/grade.py`.
- `gvisor-x86_64.tar.bz2`: release `20261102.0`, checked against the SHA-256
  embedded in the Dockerfile.
- `inventory/`: reviewed registry and immutable task packages.
- `images.tar.gz`: `docker save` output for the three runtime images and grader.

Build the `runtime` target three times, setting `RUNTIME_ID` and
`RUNTIME_VERSION` to `traceharness`/`0.3.0`, `native-claude-code`/`2.1.322`, and
`native-codex`/`0.167.1`. Build the `grader` target separately. Record each actual
immutable image ID in the registry and its task environment map, then create
the image archive. Finally build/push the `control` target and deploy its
registry digest. Runtime containers import the installed wheel, avoiding two
competing copies of the execution adapter.

The runtime profile disables hosted web search, experimental gateway fields,
prompt-cache writes and native transport retries. Claude's output limit is
8,192 tokens with a 2,048-token thinking budget. The broker still applies the
reviewed model, request/time/cost limits and fixed OpenRouter destination.

## Boot and enablement

`fly.toml` requires an encrypted persistent `runner_data` volume and defaults
to execution disabled. Set `RUNNER_SHARED_SECRET` through Fly's secret manager
using protected stdin. Configure the same secret and the HTTPS origin in the
Worker's secret manager; never put a member JWT or OpenRouter key there.

Boot provides the conventional aliases for Fly's combined cgroup-v1 mounts so
gVisor can enforce CPU limits. It refuses conflicting aliases. It loads missing
pinned images and verifies their identities; an unchanged restart reuses the
verified installed images. Existing inventory is preserved, so an upgrade must
explicitly migrate its reviewed task/image references rather than silently
replace compatibility evidence.

Before enabling member execution:

1. Verify the deployed grader rejects the original broken source and accepts
   the immutable upstream reference. Include any previously observed incorrect
   solution as a regression case. For the curated Requests package, also verify
   the original stdout/exit forgery is refused before candidate import. Its
   public edit contract permits only the documented safe serialization method;
   see `../tasks/README.md` for the exact scope.
2. Run `python /opt/verify_runtime.py --runtime RUNTIME --model MODEL` on the
   dedicated VM, supplying the operator's OpenRouter key through protected stdin.
   It installs a receipt only after real model responses, a passed independent
   grade and verified manifest/trace/patch artifacts.
3. Enable `RUNNER_EXECUTION_ENABLED=1` and restart to load the reviewed receipts.
4. Verify real signed-in selection, preflight, launch, artifacts and reload on
   `/app`; verify anonymous and hostile-origin refusals separately.

An operator compatibility run is not evidence of member authentication. Keep
those proof records distinct. Do not register model/runtime pairs using mocked
transport diagnostics or unit-test fixtures.

When installing a replacement task package or grader image, retain the previous
immutable package and reports, migrate the registry's exact task/grader hashes,
retire prior task-bound release evidence and repeat grading and compatibility
runs. Deployment iteration numbers are not task versions: confirm the hashes
inside each report before treating it as evidence for the new release.

The checked-in capacity is one active job per member and one execution worker.
Jobs and artifacts expire after 24 hours; provider keys live only in memory and
are forgotten on restart. Before redeploying, drain active jobs. An interrupted
job fails closed as `needs_attention`; inspect its containers and mounts before
archiving its state. Never clear that record merely to re-enable admission.
