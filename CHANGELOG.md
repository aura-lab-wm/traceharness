# Changelog

## 0.6.0 (2026-11-17): local only

TraceHarness now runs only on your machine (package, container image, Codespaces, school package). traceharness.dev is a
static page with the guide and the screencast.

- **Hosted site retired.** The hosted console, the sign-in, the Worker and the hosted runner are gone. Records written
  while they existed are in `docs/history/`.
- **Local runner.** Container runs of third-party agents, experiment matrices and paired native-prompt experiments run in
  the runner embedded in the local console (`/api/runner/*`, Docker). `traceharness runner setup` builds the images on
  your machine (gVisor is used when installed, plain Docker isolation otherwise), `traceharness runner status` reports
  readiness, and `traceharness runner verify` (optional, paid) writes compatibility receipts. The Codespaces dev container
  now includes Docker-in-Docker for this.
- **Console without members' mode.** Two modes remain, `local` and `export`. Run controls say "needs the local runner"
  with the setup command when it is not set up.
- **Capture export and import.** No sign-in and no upload: `traceharness capture export --out FILE.zip` writes the
  redacted sessions and `traceharness capture import FILE.zip` (or `traceharness import FILE.zip`) reads them elsewhere.
- **`traceharness doctor` is offline.** `--site` and `--compare` and the site and runner-image checks are removed; a
  `runner` row reports whether the local runner is set up (optional, never changes the exit code).
- **One tag releases everything:** the wheel, the school package and the console container image. No site step, no runner
  deploy.
