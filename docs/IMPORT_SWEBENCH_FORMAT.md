# TraceHarness run format written by the SWE-bench importer

What an imported dataset directory under `data/runs/<dataset>/` has to contain so that the
console (`traceharness --no-browser`, http://127.0.0.1:8765) lists it and opens its
runs. It follows the lab's own runner output.

## 1. Directory layout

```
data/runs/<dataset>/
  index.jsonl              one JSON object per run (the RunSummary row); this is what every list,
                           matrix and statistic reads
  <run_id>/
    ledger.jsonl           one JSON "span" per line; what the run page, the failure-mode chips,
                           the patterns page and the trajectory tests read
    summary.json           the same RunSummary as the index row, pretty-printed
    messages.json          the conversation as a list of {role, content, ...} messages (the run
                           page's transcript view)
    patch.diff             the final unified diff ("" when there is none)
```

A directory is a dataset as soon as it has an `index.jsonl` (`results_scope.list_results_dirs`).
Names: no `/`, no leading `.`, no control characters (`repeats_api._safe_name`); the same rule
applies to `run_id`, which is also the folder name.

`real_swe_agent_500/` additionally has `real_features.jsonl`, which only exercise 7 uses.

## 2. The index row / summary.json (`RunSummary`, `traceharness/core/ledger.py`)

| field | type | what the dashboard does with it |
|---|---|---|
| `run_id` | str | folder name, run page URL |
| `task_id` | str | task column; SWE-bench instance ids are used verbatim (`common.SWEBENCH_ID`) |
| `harness_id` | str | **group/filter axis** (`/api/results/{name}/runs?harness=`, matrix rows in `metrics.cells`) |
| `model` | str | **group/filter axis** (`?model=`, `results_dirs().models`, `model_runs`); a dataset whose models all start with `mock` is shown as a mock dataset |
| `provider` | str | provenance string; lab runs use the API provider (`openai`, ...), the Nebius import uses `nebius/SWE-agent-trajectories`, the generic importers use `import:<source>` |
| `repeat_index` | int | repeat number inside a (model, harness, task) cell; 0 for a single attempt |
| `started_at`, `finished_at` | str | ISO-8601 or `""` when the source has no clock |
| `exit_reason` | str | one of `submitted`, `no_action`, `max_steps`, `budget_exceeded`, `sentinel_abort`, `error`, or `unknown` for imports |
| `sentinel_interventions`, `sentinel_max_risk`, `sentinel_cost_usd` | int, float, float | 0 for imported runs |
| `steps` | int | number of model calls |
| `tool_calls`, `edits`, `lines_added`, `lines_removed`, `files_touched`, `boundary_events`, `boundary_kinds`, `tests_run_by_agent`, `ran_tests_before_submit`, `tests_modified`, `patch_bytes` | int / list / bool, each Optional | what the agent did; `null` means "the source does not record this", never 0 |
| `input_tokens`, `output_tokens`, `cost_usd` | Optional int/int/float | usage; `null` = unknown. The run list shows `—` for null |
| `wall_ms` | int | wall time; 0 when unknown |
| `visible_pass`, `hidden_pass`, `strong_pass` | Optional bool | the three grades. `hidden_pass` is the oracle the matrix and pass@k use; `null` = ungraded, shown as `?` and never counted as a failure |
| `error` | str | message when `exit_reason == "error"` |
| `harness_hash` | str | `traceharness.core.harness.content_hash(harness_dict)`; older rows lack it |

`load_index` reads the rows as plain dicts and `filter_rows` only looks at `harness_id`, `task_id`
and `model`, so **extra keys in an index row are preserved and ignored** by the analyses. That is
how an importer can carry additional provenance (the SWE-bench submission name, for instance)
without touching `RunSummary`.

Two frontend rules worth knowing (`frontend/src/rig/data.js::normRun`):

* a run with `started_at == ""` and `wall_ms == 0` is treated as "imported without a clock" and
  its `cost_usd` and `wall_ms` are displayed as absent, whatever the row says;
* `usageEstimated` is true only when `provider == "nebius/SWE-agent-trajectories"`.

## 3. The ledger (`ledger.jsonl`)

Every span carries `run_id`, `task_id`, `harness_id`, `gen_ai.request.model`, `seq` (0-based
line number), `ts` (ISO string or `""`), and `span`. Field names follow the OpenTelemetry GenAI
conventions. The spans, in the order a run writes them:

| `span` | fields observed |
|---|---|
| `invoke_agent` (status `start`) | `status: "start"`, `harness: {...}` (see below), `seed`, `repeat_index`; the importers add `import_source`, `source_path`, `session_id` |
| `chat` | `gen_ai.operation.name: "chat"`, `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens` (ints, or `null` when unknown), `gen_ai.response.finish_reasons` (list, e.g. `["tool_calls"]`, `["stop"]`, `["length"]`), `duration_ms`, `cost_usd`, `step` (0-based model call index), `text` (the model's prose, clipped), `tool_calls: [{"name", "arguments"}]` |
| `execute_tool` | `gen_ai.operation.name: "execute_tool"`, `gen_ai.tool.name` (one of the lab tools: `list_files`, `read_file`, `write_file`, `edit_file`, `run_tests`, `bash`, `submit`), `args` (dict), `status` (`ok` / `blocked` / `error`), `duration_ms`, `result_preview` (clipped observation), optional `tests_passed` (bool, only when the command looked like a test run), importers add `native_tool`, `import_source`; the Nebius import adds `swe_agent_action` and `swe_agent_command` |
| `edit` | `path`, `lines_added`, `lines_removed`, `tool` |
| `boundary_event` | `kind` (e.g. `rm_rf`, `network_install`), `status` (`allowed` for observed external runs), `tool`, `args`, `note` |
| `grade` | `visible`, `hidden`, `strong` (Optional bool each), `tests_modified`, `source` (where the verdict came from) |
| `invoke_agent` (status `end`) | `status: "end"`, `exit_reason`, `hidden_pass`, `cost_usd`, `total_tokens`; importers add `native_exit_status`, `outcome_known`, `unmeasured` (list of summary fields that are null) |

The `harness` dict on the start span is HarnessConfig-shaped: `id`, `system_prompt` (`""` for an
external harness; only a hash is kept), `tools` (lab tool names), `policy` (`unknown` or
`permissive`), `max_steps`, `max_total_tokens`, `context_window`, `observation_chars`,
`temperature`, `max_tokens_per_call`, `include_file_listing`, `notes`, `sentinel`, and for imports
`fingerprint` (what the trace itself shows) and `hash`.

What reads what:

* the failure-mode chip (`outcomes_api`) uses the index row (`hidden_pass`, `patch_bytes`,
  `exit_reason`) plus every chat span's `gen_ai.response.finish_reasons`;
* the trajectory tests and the patterns page (`core/trajtest.py`, `core/patterns.py`) use
  `execute_tool` spans (`gen_ai.tool.name`, `args`, `status`, `tests_passed`), `edit` and
  `boundary_event` spans;
* exercise 7's feature table (`real_traj.ledger_rows_as_features_with_ids`) uses the same tool
  spans and prefers `swe_agent_action` when a span carries it;
* the run page (`GET /api/results/{name}/runs/{run_id}`) returns `summary.json`, all spans,
  `patch.diff`, `messages.json`, and a sentinel replay computed from the spans.

## 4. messages.json

A list of chat messages: `{"role": "system"|"user"|"assistant"|"tool", "content": str}`;
assistant messages may carry `tool_calls: [{"id", "name", "arguments"}]` and tool messages carry
`tool_call_id`. The generic importers replace the external system prompt with a one-line
placeholder holding its sha256 and length.

## 5. How the existing imports fill the fields

`real_swe_agent_500` (Nebius SWE-agent rows, written by `real_traj.to_results_dir` and later
post-processed): `harness_id = "swe-agent"`, `model = "swe-agent-llama-70b"` (the dataset's
`model_name`), `provider = "nebius/SWE-agent-trajectories"`, `hidden_pass` = the dataset's
resolved label, `visible_pass = null`, `strong_pass = null`, tokens are character-based
estimates (hence the frontend's `usageEstimated` rule), `cost_usd = 0.0`, no timestamps, one
`chat` + one `execute_tool` per SWE-agent step with `gen_ai.tool.name = "bash"` and the SWE-agent
action class in `swe_agent_action`.

The generic importers (`traceharness/backend/importers/`, `traceharness import <path>`):
`harness_id` from `common.harness_id_for` (`swe-agent`, `openhands@0.x`, `claude-code@1.0.x`),
`model` from the trace, `provider = "import:<source>"`, `run_id = imp-<source>-<12 hex>`,
`hidden_pass` only from a real verdict (a `resolved` flag in the trace or a sibling
`results.json` / `report.json` in the shapes `{"resolved": [ids]}`, `{"<id>": {"resolved": bool}}`,
`{"<id>": bool}`), usage summed from per-call usage when the trace has it.

## 6. HTTP routes used to check an import

```
GET /api/results                          every dataset: name, runs, harnesses, models, model_runs, tasks, pass_rate
GET /api/results/{name}/runs              index rows, optional ?harness= ?task= ?model=
GET /api/results/{name}/runs/{run_id}     summary, spans, patch, messages, replay, issue
GET /api/results/{name}/metrics           per (model, harness) cell summaries
GET /api/outcomes/{name}                  failure-mode chip per run
```

All routes are `127.0.0.1` only and check the `Host` header.
