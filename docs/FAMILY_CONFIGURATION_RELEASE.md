# Recorded configurations beside the family matrix

The [member Family matrix](https://traceharness.dev/app#/rig/an:llma4se_live:family) now shows what each recorded harness contains. Column summaries expose tools, policy, model-call cap and prompt bytes. **Inspect configuration** opens the exact recorded settings, standing prompt, baseline differences, provenance and a matching run ledger in the same analysis view.

The inspector follows the model filter and reports its matching-run coverage. Multiple snapshots are selectable, including different configurations under the same recorded harness hash. Missing fields remain unknown; current preset files and normalized defaults never replace historical settings. Imported settings are labelled as reconstructions, with observed values distinguished from configured limits. Explicit runtime metadata is displayed with its source; model names do not establish an agent executable.

## What the screenshot's dataset actually records

`llma4se_live` contains 1,632 runs and six configurations, with 272 runs per harness across the dataset. Each configuration has a complete recorded harness snapshot, but none records a native executable identity or version. The inspector therefore displays **Agent / runtime: Not recorded**.

- `baseline`: seven tools, strict policy, 20 model calls, full history, 6,000 characters per observation and a 332-byte standing prompt.
- `no_test_tool`: removes both `run_tests` and `bash`.
- `permissive`: changes the recorded policy to permissive.
- `short_context`: retains two tool observations and 1,500 characters per observation.
- `terse_prompt`: replaces the standing prompt with 37 bytes.
- `tight_budget`: lowers the model-call cap to six.

## Verification

**Live:** A real operator login loaded the exact published HTML, identified by SHA-256 `fe4533d68b05f26a25ab337f43bfa443568158f7948a76f61d93785d643f2654`. Headless Chromium checked all six exact prompts/tool lists, model-filtered coverage, baseline differences, reload and matching-ledger navigation. Ten layout checks covered 320, 390, 640, 1024 and 1440 pixels in dark and light themes; neither the matrix nor inspector overflowed. There were no application JavaScript or application CSP errors. Cloudflare's separately injected analytics remained blocked by CSP.

**Live anonymous gates:** Eleven headless curl checks used `User-Agent: traceharness-proof` and `--max-redirs 0`. `/app`, `/app/shallow` and `/link` returned `302 /login`. Shallow and runner APIs returned `401 {"error":"Sign in required."}` with and without a hostile Origin, without `Access-Control-Allow-Origin`.

**Local implementation checks:** 911 frontend tests passed across 48 files. After the layout adjustment, 145 targeted frontend tests passed; 48 backend/build tests and the final two build-source checks passed. These are implementation tests, not live model-execution evidence.

**Publication:** KV upload exited 0. The gzip SHA-256 is `aa1e0d0719274105ca42671cbea364f8e6c9a417b6880bdea66f101e6e8e8c0c`. No Worker or runner deployment was performed; the last known Worker version remains `a84991b5-a7f0-4ea1-90c5-ee48dbaaff5b`. All eight published datasets and 3,453 run details were preserved. Only frontend assets and the eight embedded harness-version metadata responses changed.

**Not established by this release:** Native prompt-class patching remains a [design specification](NATIVE_PROMPT_INTERVENTIONS.md). Its execution and paired performance effects are **UNVERIFIED**. This UI proof made no harness writes, job submissions or model calls. It does not reconstruct missing historical agent identity.

Machine-readable evidence: [FAMILY_CONFIGURATION_RELEASE.json](FAMILY_CONFIGURATION_RELEASE.json).
