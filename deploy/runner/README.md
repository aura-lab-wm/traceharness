# Runner files

The runner is local since TraceHarness 0.6.0. Set it up from the command line (Docker required; gVisor is used when
installed, plain Docker isolation otherwise):

```bash
traceharness runner setup      # builds the images and writes <lab>/data/runner/registry.json
traceharness runner status
traceharness runner verify     # optional, paid
```

Its code, Dockerfiles, task packages and native prompt inventory scripts live in `traceharness/runner/` (see
`traceharness/runner/assets/`), and the service it embeds in `traceharness/runner_service/`. The console reaches it through the
local backend at `/api/runner/*`; there is no separate deployment.

What remains in this directory:

- [NATIVE_PROMPTS.md](NATIVE_PROMPTS.md): preparation and operation of the Claude Code native prompt inventory.
- [CODEX_NATIVE_PROMPTS.md](CODEX_NATIVE_PROMPTS.md): the same for the Codex adapter.

Records of the hosted runner releases (2026-11-10 to 2026-11-17) are in
[docs/history/runner-releases/](../../docs/history/runner-releases/).
