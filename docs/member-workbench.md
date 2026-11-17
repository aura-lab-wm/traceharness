# Member workbench and local execution

The member workbench combines recorded TraceHarness evidence and shallow harness authoring in one React surface. The authenticated Worker serves `/app` from an exported `app.html.gz` snapshot of the console. It inserts an account-scoped, credential-free marker before the React bundle runs. `/app/shallow` remains the Plain harness editor, an independent plain-JavaScript page with a link back to the console.

The hosted console retains datasets, analysis, recorded trajectories, questions, reports, and case files. Fixed harnesses, the Minimal harness, and the block builder use a narrow same-origin member API for previews and confirmed saves. Designing a harness from a recorded run retains the evidence link and the selected dataset/model/harness. Customize, Back to Minimal Wizard, and Reset to Wizard Answers preserve the intended answers and edits. Drafts and personal annotations are scoped to the signed-in account.

A save is shown as saved only when account storage returns `stored: true`. Fixed-prompt updates use the previously read hash; first saves use an atomic insert-if-absent. Conflicting or unconfirmed responses retain the draft. Compiler warnings belong to the response wrapper and do not alter the harness or its hash. The fixed shells are TraceHarness stand-ins; their limits are lab choices, not verified limits of vendor products.

## Recorded evidence

The November 9 candidate includes all 3,453 bundled run ledgers: 2,709 recorded runs and 744 explicitly labelled mock controls. Recorded datasets appear first. Controls validate the measurement and are not model-performance evidence. No new model runs are created by publishing this snapshot.

Imported SWE-agent recordings retain their source and license attribution. Their bundled ledgers can be truncated by the original importer; tokens and configuration can be estimates or synthesized metadata. The interface names these limitations. Unknown grades remain unknown, selected-model report cards use that model's cohort, and oracle comparisons distinguish losses, gains, and net change. Replay on recorded trajectories does not establish the outcome of a live intervention.

## Local execution

Run the local console, the full Python backend, only on loopback:

```sh
python -m traceharness --host 127.0.0.1 --port 8765
```

and open `http://127.0.0.1:8765`. Hosted `/app` does not run watch, launch, import, capture, judge, or model calls, and does not accept model keys. Those workflows belong to the local console. The hosted member API permits only the supported harness read, compile, and save operations.

## Exporting and proof

After building the frontend, create a complete local export from the intended corpus:

```sh
python -m traceharness --export /absolute/path/app.html --export-runs 2000 --export-compress-data
```

The run limit is per dataset; choose a limit at least as large as the largest dataset. Review `ledger_coverage`, not only the requested limit. The command fails if any requested endpoint fails. Compressed exports include all data, JavaScript, CSS, fonts, and the favicon, and fail visibly on corrupt or oversized payloads. Compression requires a browser with `DecompressionStream`.

The deployment operator must approve the exact gzip artifact and its SHA256 before KV upload. A frontend build or test run does not change the hosted snapshot. Offline member fixtures prove routing and interaction behavior; they do not prove a real session or production Postgres persistence. Production proof requires a real operator-provided session, exact-artifact matching, saved-prompt readback, and the anonymous redirect/API gates. Evidence must state which of these was actually run.
