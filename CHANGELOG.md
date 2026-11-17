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
- **Runner results are datasets.** A finished job is written to `data/runs/runner_jobs/<id>/` (an experiment's trials to
  `data/runs/experiment_<id>/`) with an `evidence/` folder: the manifest, grade, raw trace, native prompt files and a
  `provenance.json` with each file's sha256, synced to disk before the job may leave the 24-hour retention. Runtime
  output that is not finite JSON or not a readable ledger is kept out of the dataset, under `data/runner/quarantine/`.
- **A grader error is not a failed solution.** Only a passed or failed grade sets `hidden_pass`; an error or a missing
  grade is recorded as ungraded with its diagnostic, and pass rates leave it out. Runs saved earlier are corrected from
  their own `evidence/grade.json` when the console starts.
- **Runs you confirm.** A combination without a compatibility receipt, and every native prompt profile, runs only after
  you confirm it as not verified on this machine; its manifest records `verified: false` and the isolation used
  (`runsc` or `runc`). Storage limits are a budget enforced by a per-job scan and a filesystem backstop, not a quota.
- **One console owns the runner.** A second console on the same data directory serves recorded jobs read-only; `runner
  setup` refuses while a console or a job is running. The saved OpenRouter key never enters a container or a response.
- **Console without members' mode.** Two modes remain, `local` and `export`. Run controls say "needs the local runner"
  with the setup command when it is not set up.
- **Capture export and import.** No sign-in and no upload: `traceharness capture export --out FILE.zip` writes the
  redacted sessions and `traceharness capture import FILE.zip` (or `traceharness import FILE.zip`) reads them elsewhere.
- **`traceharness doctor` is offline.** `--site` and `--compare` and the site and runner-image checks are removed; a
  `runner` row reports whether the local runner is set up (optional, never changes the exit code).
- **One tag releases everything:** the wheel, the school package and the console container image. No site step, no runner
  deploy.
