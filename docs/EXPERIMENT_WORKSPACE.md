# Edit a harness and dispatch a task matrix

Start the local console (`traceharness serve`, <http://127.0.0.1:8765>) and open **Harnesses**. The same workspace contains single-run configuration, native prompt interventions, the JSON editor and experiment scheduling. Execution takes place in the local runner: run `traceharness runner setup` once (Docker required; gVisor is used when installed, plain Docker isolation otherwise). Until then the run controls say what is missing and the editor works offline.

## Build the configuration

Choose a stock stand-in, a custom engine harness or a registered native runtime. Select its model, task and prompt using the form, or expand **Edit configuration JSON** to edit the complete configuration. JSON changes remain pending until **Apply JSON**. Invalid JSON, unknown settings, credentials and inconsistent limits are refused without erasing the pending text. The field-by-field diff shows exactly what Apply will replace. **Discard JSON edits** restores the current fields.

A recorded ledger run offers **Fork recorded harness** when all engine settings are present. A runner job offers **Fork this run configuration** from its recorded manifest. Forking creates an editable draft and preserves the original source separately. It does not change the run or silently fill missing settings from a preset. Recorded runtime and task pins remain inspectable in that source; a new dispatch must pass the local runner's review. Forked ledger configurations get explicit new time, dollar and output-token dispatch caps while retaining their original engine blocks.

## Select the sweep

1. Expand **Experiment matrix**. Name the current harness and choose **Capture current harness**. Change the editor and repeat for each candidate. Captures are independent snapshots; **Update with current** is the explicit way to replace one. Each capture exposes its full JSON.
2. Select one or more models and runnable tasks. Tasks can be searched or selected together with **Select runnable tasks**. The preview expands harness × model × task into concrete cells.
3. Keep the cells you want. All cells begin included. Unsupported combinations remain visible with reasons and block review. Uncheck individual cells or explicitly choose **Select verified cells**. Excluded candidates remain visible and are not submitted.
4. Set repetitions, schedule seed and aggregate experiment budget. The sum of all included per-trial caps, multiplied by repetitions, must fit that budget. Limits are 64 included trials, 1–10 repetitions and a budget greater than zero up to $100. Narrow axes when the preview exceeds 512 candidates. A frozen plan must fit 768 KiB.
5. Choose **Review matrix experiment**, inspect the resolved schedule and manifests, then **Freeze matrix experiment**. Any authoring or catalog change invalidates the review. Freezing stores the plan without submitting jobs.
6. Save your OpenRouter key in Settings and choose **Start experiment**. The key stays in the console's backend; it never enters a container and is excluded from configurations and exports. A seed controls deterministic trial ordering; it does not seed model sampling.

## Read the queue and results

The queue retains each trial's arm, repetition, runtime, model, task, manifest hash, execution state, task grade, reported cost and job link. The results table scrolls within its own keyboard-focusable region on narrow screens. Open a job to inspect its manifest and artifacts. **Frozen experiment JSON** shows every retained configuration, resolved manifest and schedule row. **Export experiment results** downloads the complete experiment record.

Reloading restores the experiment history stored under `data/runner/` without starting new work. **Resume experiment** supplies a current credential for remaining unstarted trials. Failed or uncertain trials are not silently retried. An uncertain Start response keeps dispatch blocked until an explicit refresh reconciles the durable record. **Cancel experiment** stops future trials and requests cancellation of active work.

Execution state and task grade are separate: a finished runtime may still fail its task. Missing charges remain **Unconfirmed**; the confirmed subtotal is not a complete bill when any cost is unknown. Reservations can stop a run before its cap is spent because another request's worst-case cost cannot fit.

General matrix results are descriptive. They can mix tasks, models and runtimes, so they do not produce paired causal statistics. The existing **Compare prompt variants** workflow remains available for the narrower matched native-profile case. Neither workflow establishes a performance improvement merely by completing a schedule.

See the historical [design alternatives and contracts](history/EXPERIMENT_WORKSPACE_SPEC.md) and [verification evidence](history/EXPERIMENT_WORKSPACE_VERIFICATION.md).
