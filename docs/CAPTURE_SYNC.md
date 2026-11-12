# Capture sync client

This checkout provides `traceharness login`, `whoami`, `logout`, and `capture --watch --sync`.
These commands use only `https://traceharness.dev`. Installing the Python package does not
install a Claude marketplace plugin; this repository does not provide one.

Install from the checked-out release revision with Python 3.10 or later:

```sh
python3 -m venv .venv
.venv/bin/python -m pip install .
.venv/bin/traceharness login
```

Login prints `https://traceharness.dev/app/device` and a short code. Open that address yourself,
sign in, and approve the code. The command polls at the server's interval, respects expiry and
slow-down responses, and verifies the account through `whoami` before replacing local credentials.
It opens no browser automatically. `traceharness whoami` reads the current identity from the server.

Choose the session directory you want to capture and an independent local lab directory:

```sh
.venv/bin/traceharness capture --watch --sync \
  --path /path/to/chosen/session-directory \
  --lab /path/to/private-capture-lab
```

Repeat `--path` for more directories. With no `--path`, the command uses the existing local
allow-list in `~/.traceharness/capture.json`; an absent or empty allow-list captures nothing.
The watcher supports the same Claude Code, Codex, Gemini CLI, Qwen Code and Cursor adapters as
local capture. It does not discover and authorize session stores on your behalf.

A person must type `yes` at the terminal before sync starts. This consents to reading the chosen
session paths and uploading their captured summaries, transcripts, tool output and patches,
including runs already captured from those paths. Those records may contain private data or
secrets. `--yes` and noninteractive input cannot bypass sync consent. This additional sync gate
does not change the existing local-only watcher or installed LaunchAgent behavior. Add
`--no-archive` to disable the local gzip copies of captured source sessions.

Only runs attributed to the chosen roots are uploaded. Unchanged payloads are skipped during the
current process. Uploads retain their stable `run_id`, so an explicit restart can safely repeat a
previous upload as a replacement of that same run. A failed upload ends sync; it is not retried
automatically. A rejected or oversized record is reported as a failure, never silently truncated.
No command here starts a model or a paid harness run.

Credentials are stored in `~/.traceharness/capture-auth.json`, bound to the exact origin, with file
mode `0600` and directory mode `0700`. Writes use an atomic replacement. Tokens are never passed in
command arguments or printed. HTTPS requests have timeouts and refuse redirects. Sync stays bound
to the server-verified account for that process, even if another process signs into a different
account. Restart sync to change the destination account.

```sh
.venv/bin/traceharness logout
```

Logout revokes this computer's token before removing its local credential. If the server cannot
confirm revocation, the command fails and retains the file so revocation can be attempted again.
Revocation does not delete runs already uploaded.

## Verification boundary

The offline regression suite uses a mock HTTPS device approval/token service and synthetic
session fixtures under temporary directories. It exercises the real console dispatch, local
watcher, credential store and upload serialization. It does not use live credentials, real
session stores, a browser, a production database, or a running model.

The client does not establish that capture infrastructure is enabled on a deployed host. A host
without the required service configuration or atomic storage endpoint can return HTTP 503; the
client reports capture as unavailable and stops without retrying. Production provisioning,
route deployment, storage schema and real account isolation require separate verification.
