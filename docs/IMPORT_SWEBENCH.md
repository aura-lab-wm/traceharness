# Importing SWE-bench `experiments` submissions into TraceHarness

Command: `traceharness import-swebench <submission_dir>` (also `python3 scripts/import_swebench_experiments.py <submission_dir>` from a checkout).
Test: `tests_agentlab/test_import_swebench.py` (offline; it uses small cuts of real submission files under
`tests_agentlab/fixtures/importers/swebench_experiments/`).
The run format it writes: see `IMPORT_SWEBENCH_FORMAT.md` next to this file.

## 1. Getting a submission's files

The `SWE-bench/experiments` repository holds *entries*, not artifacts. Each
`evaluation/verified/<submission>/` folder has `metadata.yaml`, `README.md`, `logo.png` and
`results/results.json`; the trajectories and logs live wherever the entry's `assets` block points:

* most entries (everything before mid-2026): `s3://swe-bench-submissions/<split>/<submission>/trajs`
  (a public bucket; `python -m analysis.download_logs evaluation/verified/<submission>` in the
  experiments repo fetches it without credentials, or any S3 client with unsigned requests);
* newer entries: a public GitHub repo named in `assets.repo`, with `trajs/` and `logs/` at its root.

Put the pieces together as one folder:

```
<submission>/
  metadata.yaml
  results/results.json
  trajs/<instance_id>.traj.json          (or trajs/<instance_id>/<instance_id>.traj, *.json, *.jsonl, ...)
  logs/<instance_id>/report.json, patch.diff, test_output.txt.gz     (optional)
```

Some entries keep their trajectories on GitHub (a fork named after the submission), others in an S3 bucket
named in the entry's `assets` block. Fetch what the entry points to, put it next to `metadata.yaml` in the layout
above, and import that folder. You do not need the whole repository: a treeless
`git clone --filter=tree:0 --no-checkout` of `SWE-bench/experiments` lists all entries in about 200 KB.

## 2. Running the importer

With the package installed (`python3 -m pip install traceharness`, or `python3 -m pip install -e .` in a checkout):

```bash
traceharness import-swebench /path/to/20260901_mini-v2.4.2_gemini-3-5-flash
traceharness import-swebench /path/to/20250524_openhands_claude_4_sonnet
traceharness import-swebench /path/to/20250225_sweagent_claude-3-7-sonnet
traceharness --no-browser                     # open http://127.0.0.1:8765, dataset "swebench_experiments"
```

Options:

| flag | meaning |
|---|---|
| `--dataset NAME` | results directory under `data/runs/` (default `swebench_experiments`). Several submissions imported into the same dataset appear side by side: the dashboard groups by `model` and `harness_id`, so one model across scaffolds and one scaffold across models are both one dataset away |
| `--runs-root DIR` | write somewhere other than the checkout's `data/runs/` |
| `--harness-id X` | override the scaffold name (default: `metadata.yaml` `tags.agent`) |
| `--model X` | override the model name (default: `tags.model[0]`) |
| `--limit N` | first N instances only |
| `--force` | re-import runs already in the dataset (otherwise they are skipped; imports are idempotent) |
| `--dry-run` | detect formats and verdicts, write nothing |
| `--json` | machine-readable report |
| `-q` | no per-instance warnings |

The report prints the formats seen, how many runs were imported, skipped or left unparsed, how
many resolved instances have no trajectory file, and whether `logs/<id>/report.json` ever
disagrees with `results.json`. PyYAML is used when installed; otherwise a small built-in reader
handles the shape `metadata.yaml` has.

## 3. What is mapped

| TraceHarness field | source |
|---|---|
| `run_id` | `<submission folder>--<instance id>` (e.g. `20260901_mini-v2.4.2_gemini-3-5-flash--astropy__astropy-12907`) |
| `task_id` | the SWE-bench instance id, from the start of the trajectory file name or the `trajs/<id>/` folder (see "Task ids" below) |
| `harness_id` | `tags.agent` from metadata.yaml (`mini-SWE-agent`, `SWE-agent`, `OpenHands`, ...) |
| `model` | `tags.model[0]` from metadata.yaml (`gemini-3-5-flash`) |
| `provider` | `SWE-bench/experiments` |
| `repeat_index` | 0; if a second submission in the same dataset has the same (model, harness, task), it becomes repeat 1, and so on |
| `hidden_pass` | `instance_id in results.json["resolved"]` (the leaderboard verdict); also written on the `grade` span. When `logs/<id>/report.json` says otherwise, `results.json` wins and a warning names the instance |
| `visible_pass`, `strong_pass` | `null`: a submission has no visible test suite and no strengthened grade |
| `agent_last_test_passed` (extra field) | the verdict of the agent's own last test-looking command, from the same output heuristic the other importers use; kept under its own name so it is not mistaken for a grade |
| `steps` | number of model calls parsed |
| `tool_calls`, `execute_tool` spans | one per tool call; the native tool is mapped onto the lab's tool set by `traceharness.backend.importers.common.map_tool` (`bash`, `read_file`, `edit_file`, `list_files`, `submit`, ...), after the script's `normalise_call` has folded each scaffold's tool names and sub-commands onto that set; the span keeps the original under `native_tool` (e.g. `str_replace_editor/view`, `search/search_class`). mini-SWE-agent's `echo COMPLETE_TASK_AND_SUBMIT_FINAL_OUTPUT ...` (or `MINI_SWE_AGENT_FINAL_OUTPUT`) is mapped to `submit`. OpenHands' `think` is a model call without a tool call. A span whose arguments the export did not keep says `arguments_known: false` |
| `edits`, `edit` spans, `files_touched` | an `edit_file`/`write_file` tool call, or, for bash-only scaffolds, a shell command that writes a file (`sed -i`, `python -c "... open(p, 'w') ..."`, `cat > file`, `tee`, `git apply`, `patch`); these spans carry `detected_by: "shell command heuristic"`. Files named in the final patch are added to `files_touched` |
| `lines_added`, `lines_removed`, `patch_bytes` | from the final patch (`info.submission` / `git_patch`, else `logs/<id>/patch.diff`) |
| `tests_run_by_agent`, `ran_tests_before_submit`, `tests_modified` | from the tool spans (test-looking commands, edits of test paths) and the patch |
| `boundary_events` | destructive or network commands observed (`rm -rf`, `pip install`, `git checkout --`, ...), status `allowed` |
| `input_tokens`, `output_tokens` | run-level `model_stats.tokens_sent/tokens_received` when the trajectory has them (SWE-agent `.traj`); else the sum of per-call usage (mini-SWE-agent `extra.response.usage`, Composio `usage_metadata`; also written per `chat` span with `gen_ai.usage.reasoning_tokens` when present); else `null` (every OpenHands export, Engine Labs, AutoCodeRover and all text logs). The end span's `token_source` says which |
| `cost_usd` | the recorded run-level cost when it is > 0 (`model_stats.instance_cost`, OpenHands `metrics.accumulated_cost`), else the sum of per-call `extra.cost` when > 0, else `null`. A recorded `0.0` beside real token counts is treated as unpriced (mini-SWE-agent writes 0.0 when its price table has no entry, `cost_tracking: ignore_errors`), not as free; `cost_source` on the end span says so |
| `started_at`, `finished_at`, `wall_ms` | first and last per-message timestamps when the trajectory has a clock (mini-SWE-agent epoch seconds, OpenHands ISO strings); `""`/0 otherwise. `wall_ms` is therefore first model call to last tool result, not container start to finish |
| `exit_reason` | from the native exit status (`Submitted` -> `submitted`; cost/context/token limits -> `budget_exceeded`; step limits -> `max_steps`; errors -> `error`), else `unknown` |
| `chat` spans | `text` (the model's prose), `tool_calls`, `gen_ai.response.finish_reasons` (from the recorded `finish_reason`; `["tool_calls"]`/`["stop"]` by whether the call carried a tool call when nothing is recorded), `gen_ai.response.model` when the trajectory's model string differs from `model` (Composio: per call), `conversation` for multi-conversation files |
| extra index fields | `submission`, `submission_name`, `scaffold`, `scaffold_version`, `scaffold_org`, `model_display`, `model_org`, `model_in_trajectory`, `trajectory_format`, `trajectory_file`, `trajectory_parsed`, `agent_last_test_passed`, plus per-format facts: `trials`/`trial_used`/`best_trial_by_reward_model` (AgentScope), `attempts`/`attempt_used`/`selected_patch_reason`/`conversations` (AutoCodeRover, EPAM), `conversations`/`models_in_trajectory` (Composio), `tool_calls_with_arguments`/`tool_calls_without_arguments` (flattened OpenHands), `assistant_turns` (Learn-by-interact), `raw_log_bytes`/`raw_log_truncated` (text logs). `load_index` keeps unknown keys, so they are available to anything reading `index.jsonl` (and under `GET /api/results/<ds>/runs`) without touching `RunSummary` |

Task ids: the instance id is read from the start of the file name (`astropy__astropy-12907.traj`,
`..._traj.json`, `..._trail_0.txt`, `..._voting.json` all give `astropy__astropy-12907`), else from the
nearest `trajs/<id>/` ancestor folder (`trajs/<id>/attempt_0/patching_agent.json`). One run per
instance; when an instance has several files the native trajectory wins over sidecars, and the
parsers that need the siblings (AgentScope trials, AutoCodeRover attempts) find them next to it.

Formats parsed into steps (`trajectory_parsed: true`):

* **mini-SWE-agent** (`trajectory_format: mini-swe-agent-1.x`): parsed in the script. Function-calling
  turns (`tool_calls` + `extra.actions`, `tool` messages with `tool_call_id`, `returncode`,
  `raw_output`) and the older fenced ```` ```bash ```` turns followed by a `user` observation.
* **SWE-agent `.traj`**: delegated to `traceharness.backend.importers.swe_agent`.
* **OpenHands** (event list, or SWE-bench `output.jsonl` with `history`): delegated to
  `traceharness.backend.importers.openhands`.
* **`openhands-messages`** (the OpenHands SWE-bench exports of 2024-2025, nine of the downloaded
  submissions): a JSON list of OpenAI-style messages. Each assistant message is one model call
  (`chat` span); each of its `tool_calls` is an `execute_tool` span and the `tool` message with the
  same `tool_call_id` is its observation. Native tools: `execute_bash` -> `bash`;
  `str_replace_editor` `view` -> `read_file`, `create`/`str_replace`/`insert`/`undo_edit` ->
  `edit_file`; `finish` -> `submit`; `think` -> a chat-only step (the thought is appended to the
  step's text); `execute_ipython_cell`, `browser`, `web_read` -> `bash` with the native name in the
  command. The span's `native_tool` keeps the original name and sub-command
  (`str_replace_editor/view`). The bash exit code comes from the observation's
  `[Command finished with exit code N]` line. These files record no tokens, cost, clock or model
  name, so those fields are `null`/`""`. The `finish` action is not in these exports either, so
  `exit_reason` is `unknown` for them.
* **`openhands-flat`** (`20250520_openhands_devstral_small`, `20251127_openhands_claude-opus-4-5`):
  `{role, content}` strings only. Devstral's assistant turns hold `<function=X><parameter=k>v</parameter></function>`
  blocks and the next user turn starts with `EXECUTION RESULT of [X]:`, so the arguments are
  recovered (`arguments_known: true`). The opus-4-5 export has `Action: unknown` rows followed by
  `[tool] [{'type': 'text', 'text': ...}]` rows (the string repr of a content list): the tool name
  and observation are known, the arguments are not (`arguments_known: false`, `tool_calls_without_arguments`
  on the index row). For `file_editor` without arguments the lab tool is read off the observation
  text (`Here's the result of running cat -n` -> `read_file`, `File created successfully` /
  `has been edited` -> `edit_file`; the span says `detected_by: observation text`); `terminal`
  becomes `bash` with an empty command, so no test or edit heuristic fires on it.
* **`enginelabs-messages`**: the same message shape with `sendShellInput` (-> `bash`),
  `stringReplaceEditor` (as above), `searchDirectory`/`searchFile`/`findFile` (-> `list_files`),
  `finish` (-> `submit`); `is_error` on the tool message gives the span status.
* **`composio-langchain`**: a list of `[messages, LLMResult]` pairs, one per sub-agent conversation
  (three solver rollouts, three summaries, a judge). Every `AIMessage`, plus the final generation
  of each pair, is one model call with its own `usage_metadata` (summed into `input_tokens` /
  `output_tokens`; `token_source: sum of per-call usage`) and `response_metadata` model
  (`gen_ai.response.model` on each `chat` span: `anthropic.claude-3-5-sonnet-20241022-v2:0` or
  `o1-mini-2024-09-12`; the index row lists them under `models_in_trajectory`). Tools:
  `FILETOOL_OPEN_FILE`/`SCROLL` -> `read_file`, `FILETOOL_EDIT_FILE`/`WRITE`/`CREATE_FILE` ->
  `edit_file`, `FILETOOL_FIND_FILE`/`SEARCH_WORD`/`GIT_REPO_TREE` and `CODE_ANALYSIS_TOOL_*` ->
  `list_files`, `FILETOOL_GIT_PATCH` -> `submit`. `conversations` (7) is on the index row and each
  span carries its `conversation` index.
* **`autocoderover-v2-agents`**: `trajs/<id>/attempt_N/` folders. `selected_patch.json`
  (`output_N/extracted_patch_M.diff`) names the attempt and patch that were submitted; the run is
  that attempt (else `attempt_0`), its message lists concatenated in pipeline order
  (`reproducer_agent.jsonl`, `context_retrieval_agent.json`, `patching_agent.json`, `review-*.json`,
  then the instance-level `selection_agent.json`); the patch is `attempt_N/patch_M.diff`. Tools:
  `terminal` -> `bash`, `search` -> `list_files` (the action in `native_tool`, e.g. `search/search_class`),
  `file` read/write/list -> `read_file`/`edit_file`/`list_files`. AutoCodeRover logs most assistant
  messages twice (text, then the same text with `tool_calls`); the pair counts as one model call.
  Index row: `attempts`, `attempt_used`, `conversations`, `selected_patch_reason`.

Formats kept as text (`trajectory_parsed: false`, `steps = 0`, activity and usage fields `null`,
the verdict from `results.json`, the patch from `logs/<id>/patch.diff` when present, and the raw
content in `messages.json` so the run page shows it):

* **`tools-log`, `devlo-log`, `codestory-midwit-log`, `agentless-log`** (and `plain-text-log (ext)`
  when none of the four is recognised): the whole file as one message with `role: "log"`, ANSI
  colour codes stripped, CRLF normalised. Files over 4 MB (`RAW_LOG_MAX_BYTES`; four of the 1,553
  logs) are cut there with a note at the end; `raw_log_bytes` and `raw_log_truncated` are on the
  index row. Steps are not reconstructed from these logs.
* **`agentscope-transcript`**: `<id>_trail_N.txt` transcripts plus `<id>_voting.json`. The run is the
  trial `best_trial_by_reward_model` names (else the lowest-numbered one), as one `log` message; the
  patch is the `model_patch` of the JSON block that ends the transcript (else the sidecar). Index
  row: `trials` (transcript files), `trial_used`, `best_trial_by_reward_model`, `trial_reward_score`.
* **`epam-ai-run`**: `{attempt_N: {traj: {uuid: {author_name, message}}, checks}, best_attempt}`. The
  best attempt's steps become messages (`Thoughts` -> `assistant`, a tool name -> `tool` with the
  `**Input:** ... **Result:** ...` text). Index row: `attempts`, `attempt_used`, `steps_in_attempt`,
  `epam_checks`.
* **`learn-by-interact-turns`**: a list of assistant strings, one `assistant` message each
  (`assistant_turns` on the row); the observations are not in the file.
* **`prompt-only`**: a message list with only the system and user prompt (111 files of
  `20250203_openhands_4x_scaled`, 57 of them resolved): the agent's turns were not exported, so
  nothing is counted.
* **anything else** (`.gz`, unknown JSON): the run is still written with its verdict and one `chat`
  span whose text starts with `trajectory not parsed`; a warning is printed per instance
  (`-q` silences the per-instance warnings for the kept-as-text formats too).

## 4. What cannot be mapped

* **The issue text.** Tasks are not in `tasks/`, so the run page says the issue lives in the
  source dataset. The first user message (which contains the PR description for mini-SWE-agent)
  is in `messages.json`.
* **Per-call latency and per-edit line counts.** `duration_ms` is 0 on every span and `edit` spans
  carry `lines_added: 0, lines_removed: 0`; the run totals come from the final patch.
* **Edits in bash-only scaffolds are a heuristic.** A command the heuristic does not recognise (an
  unusual write idiom) is counted as a plain `bash` call; a counted one may be a write to a scratch
  file rather than source. The final patch is the ground truth for what changed.
* **Cost when the tracker recorded 0.0**, and tokens when nothing was recorded: `null`, never
  estimated. This differs from `real_swe_agent_500`, whose tokens are character-based estimates.
* **Steps in the text-log scaffolds** (Tools, devlo, CodeStory Midwit, Agentless, AgentScope, EPAM,
  Learn-by-interact): not reconstructed; those runs count only in pass@1 and show their raw content.
* **Tool arguments in the opus-4-5 OpenHands export** and the dropped `finish` action in the other
  OpenHands exports: not in the files, so `arguments_known: false` and `exit_reason: unknown`.
* **Instances without a trajectory file** (`no_generation`, or simply not downloaded): no run is
  written for them; the report counts them. pass@1 in the dashboard is therefore over the imported
  runs, not over the 500 Verified instances (the sample here: 18/30 = 0.60 vs. the entry's 71.8 %).
* **Submission-level numbers in `metadata.yaml`** (`info.resolved`, `info.cost`, `info.instance_calls`)
  are not copied anywhere: they describe the whole submission, not a run.
* **`visible_pass` and `strong_pass`** stay `null`; the oracle page has nothing to compare for this
  dataset. `/api/results/<ds>/report` needs `?harness=<scaffold>` because there is no `baseline` harness.
* **System prompts** are hashed, not stored, like the other importers do.
* The S3 bucket itself is not fetched by the script: it reads a local folder.

## 5. Checks

* `python3 -m unittest tests_agentlab.test_import_swebench` runs the importer on synthetic submissions built from
  the repository's SWE-agent `.traj` and OpenHands `output.jsonl` fixtures, a mini-SWE-agent trajectory, and cuts
  of real files from each scaffold listed in section 3, plus a file in an unknown format.
* After an import, open the console (`traceharness --no-browser`, then http://127.0.0.1:8765): the dataset lists
  with its runs, harness and model; a run opens with its steps, patch and messages; the outcomes, patterns,
  oracle and comparisons views answer for it.
* `traceharness import-swebench <submission_dir> --dry-run --json` detects formats and verdicts and writes nothing.
