# What backs each dot of Table 2

Table 2 of the FSE 2027 tool-demonstration paper compares TraceHarness with ten related tools on ten
columns. This page gives, for each column, the criterion the dots are scored against, and for
TraceHarness's row the command, the modules, the tests that exercise the behaviour, and the recorded
runs that show it working on real models. `tests_agentlab/test_paper_table.py` has one test class per
column; each runs the behaviour end to end on the offline mock agent instead of checking that a file
exists.

Recorded runs named `data/runs/...` are in the repository. `sentinel_v1`, `third_party_agents` and
`third_party_real` are published on Hugging Face as [aura-lab-wm/traceharness-runs](https://huggingface.co/datasets/aura-lab-wm/traceharness-runs):
copy a folder under `data/runs/` to open it in the console.

A dot for another tool means its paper or documentation **describes** the feature (● described,
◐ partially described, ○ not described): "not described" is not "not supported". The quotes behind
the contested cells are in the paper folder (`notes/related-tools-matrix.md`).

| Column | Criterion (a tool gets ● when it...) |
|---|---|
| Runs the agents | launches the agent runs itself |
| Third-party agents | works with agents it did not write, from their logs or by running them |
| Compares harnesses | compares runs whose harness (prompt, tools, policy, budgets) differs |
| Repeats, intervals | repeats a task and reports the uncertainty of the outcome |
| Multiple graders | grades a run with more than one oracle or scorer |
| Step-level view | shows every step of a run, in order |
| Matches two runs | aligns two trajectories step by step |
| Failure analysis | relates what the agent did to its failures |
| Trajectory tests | lets the user write assertions over what the agent did |
| In-run intervention | lets a person or a monitor change a run while it executes |

## TraceHarness

### Runs the agents
- **Command:** `traceharness run --provider openrouter --model M --harness H.json --tasks full --repeats 5 --out DIR`; also the console's run setup.
- **Modules:** `core/runner.py`, `core/harness.py` (the loop), `core/tools.py` (sandbox, permission policy), `core/ledger.py`.
- **Tests:** `test_paper_table.RunsTheAgents`, `test_agentlab.py`.
- **Runs:** `data/runs/study_v04` (3,240 runs: 3 models × 9 harnesses × 24 tasks × 5 repeats, 2026-11-14); `sentinel_v1` (Hugging Face) (1,800 runs, 2026-11-15).

### Third-party agents
- **Command:** `traceharness import PATH` reads the logs of fifteen sources (Claude Code, Codex, Cursor, agy (Antigravity CLI), Qwen Code, Kimi Code, ZCode, Grok CLI, GitHub Copilot CLI, Muse Code, OpenHands, SWE-agent, mini-SWE-agent, Inspect, Trajectory v1). `traceharness agents run --agent mini-swe-agent|codex|claude-code` runs three of them in containers on the lab's tasks or on real-repository task packages.
- **Modules:** `backend/importers/*`, `traceharness/agents/{run,broker,inside,grade}.py`.
- **Tests:** `test_paper_table.ThirdPartyAgents`, `test_importers.py`, `test_agents_containers.py`.
- **Runs:** `data/runs/real_swe_agent_500` (imported SWE-agent trajectories); `third_party_agents` (Hugging Face) (mini-SWE-agent 2.4.6 with the three study models, Codex CLI 0.167.1, Claude Code 2.1.322, 24 tasks × 5 repeats, 2026-11-15); `third_party_real` (Hugging Face) (the same five agent/model pairs on the eight real-repository packages of `deploy/runner/tasks`, 3 repeats).

### Compares harnesses
- **Command:** harness files in `harnesses/` (baseline plus nine variants); `traceharness comparisons DIR --baseline baseline`; `traceharness fit DIR` (variance decomposition); the console's harness comparison.
- **Modules:** `core/harness.py` (`HarnessConfig`, `content_hash`, recorded on every run), `core/analysis.py` (`comparisons_for`, `paired_bootstrap`).
- **Tests:** `test_paper_table.ComparesHarnesses`.
- **Runs:** `data/runs/study_v04` (nine harnesses).

### Repeats, intervals
- **Command:** `--repeats N`; pass@k, flip rate and intervals in the console and in `traceharness oracle DIR`.
- **Modules:** `core/analysis.py` (`aggregate`, `per_task_rates`, `bootstrap_ci`, `flip_rate`, `paired_bootstrap`).
- **Tests:** `test_paper_table.RepeatsIntervals`.
- **Runs:** `data/runs/study_v04`, `sentinel_v1` (Hugging Face), `third_party_agents` (Hugging Face) (5 repeats each).

### Multiple graders
- **Command:** every run is graded by three suites (visible, hidden, strengthened); `scripts/validate_task.py` checks each task's tiers against its reference patch; real-repository packages bring their own independent checks.
- **Modules:** `core/grader.py` (pristine tests restored, nonce-checked report, static test count), `core/_grade_runner.py`, `deploy/runner/tasks/grade.py`.
- **Tests:** `test_paper_table.MultipleGraders`, `test_grader_forgery.py`.
- **Runs:** the `grade` span of every run above.

### Step-level view
- **Command:** the console's run page; `GET /api/results/DIR/runs/RUN_ID`; `traceharness watch DIR/RUN_ID`.
- **Modules:** `backend/app.py` (`run_detail`), `frontend/src/rig/views/trajectory.jsx`, `frontend/src/rig/views/console.jsx`.
- **Tests:** `test_paper_table.StepLevelView`, `frontend/src/rig/views/trajectory.dom.test.jsx`.

### Matches two runs
- **Command:** the console's Compare view (two runs aligned by tool and canonical arguments, first divergence marked); `GET /api/fork/DIR/compare?a=A&b=B`.
- **Modules:** `backend/fork.py` (`steps_of`, `canon_args`, `align`), `frontend/src/rig/lib/align.js` (the same alignment, checked against the backend by `scripts/align_parity_fixture.py`).
- **Tests:** `test_paper_table.MatchesTwoRuns`, `frontend/src/rig/lib/align.test.js`.

### Failure analysis
- **Command:** `traceharness patterns DIR`; the console's failure labels, trajectory features and Ochiai ranking.
- **Modules:** `core/real_traj.py` (features), `core/analysis.py` (`ochiai_attribution`, `stratified_risk_difference`), `core/patterns.py`.
- **Tests:** `test_paper_table.FailureAnalysis`.
- **Runs:** `data/runs/real_swe_agent_500` and the Nebius trajectories of RQ2.

### Trajectory tests
- **Command:** a unittest over `trajtest.load_runs(DIR)`; `python -m unittest discover -s trajectory_tests` (the examples shipped in `trajectory_tests/`).
- **Modules:** `core/trajtest.py`.
- **Tests:** `test_paper_table.TrajectoryTests`.

### In-run intervention
- **Command:**
  - A harness with `sentinel` (flag or intervene: nudge, block, abort) scores each partial trajectory before its tool calls run.
  - A harness with `pause` stops a run for a person: before chosen tools, at chosen steps, on the first edit, or above a risk. The person decides through `traceharness paused` / `traceharness decide RUN approve|deny|edit|inject|abort` or the console.
  - Runs a person steered are left out of aggregate statistics.
- **Modules:** `backend/sentinel.py` (`hook_for`), `core/harness.py` (`step_hook`), `core/pause.py`, `backend/pause_api.py`, `frontend/src/rig/PausePanel.jsx`.
- **Tests:** `test_paper_table.InRunIntervention`, `test_pause.py`, `test_sentinel_wiring.py`.
- **Runs:** `sentinel_v1` (Hugging Face) (the Sentinel as nudge, block and abort on top of `reprompt`, risk models trained without the task they monitor).
