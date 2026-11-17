<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/img/brand/lockup-dark.svg">
    <img alt="TraceHarness" src="docs/img/brand/lockup-light.svg" width="420">
  </picture>
</p>

![TraceHarness: treat the agent harness as a controlled experimental variable](docs/img/readme/hero.svg)

[![CI](https://github.com/aura-lab-wm/traceharness/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/aura-lab-wm/traceharness/actions/workflows/ci.yml) [![CodeQL](https://github.com/aura-lab-wm/traceharness/actions/workflows/codeql.yml/badge.svg?branch=main)](https://github.com/aura-lab-wm/traceharness/actions/workflows/codeql.yml)

[![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://codespaces.new/aura-lab-wm/traceharness)

**TraceHarness** measures coding agents from their trajectories and treats the harness as an experimental variable. This repository is the replication and teaching package for the evaluation lab: it bundles the local console, the session-capture CLI, recorded multi-harness datasets, and step-by-step lab exercises for loading and analysing 1,000 real SWE-agent trajectories at <https://traceharness.dev/guide/> (also in [`docs/GUIDE.md`](docs/GUIDE.md), [`docs/STUDENT_GUIDE.md`](docs/STUDENT_GUIDE.md), [`docs/CODESPACES.md`](docs/CODESPACES.md), `HANDOUT.md`, and `LAB_1H.md`). Open it directly in GitHub Codespaces with the badge above; an OpenRouter key is needed only when running new experiments against live models.

![Record, compare, read](docs/img/readme/path.svg)

## Check that it works

Run the offline self-check (about ten seconds, no API key):

```bash
python scripts/check_install.py      # or: make check
```

Expect `All 5 checks passed`. The deterministic mock agent must score **exactly `14 / 24`**; any other score indicates a broken grader (see [`docs/STUDENT_GUIDE.md`](docs/STUDENT_GUIDE.md), section 13).

## Run the dashboard

Python 3.10 or newer is required (**Python 3.12** recommended). On macOS, the built-in `python3` is 3.9 and fails to install this package—install Python 3.12 from python.org or Homebrew and substitute `python3.12` below. From this checkout or the extracted `traceharness-school` directory:

```bash
python3 -m venv .venv
source .venv/bin/activate
python3 -m pip install -e .
python3 -m traceharness --no-browser
```

Open **http://127.0.0.1:8765**. No API key is needed to inspect the included results. Prebuilt frontend assets (`traceharness/frontend/dist`) ship in the repository, so Node.js is required only if you modify frontend source.

The UI opens on **Datasets**, listing every directory under `data/runs/` (the included datasets below plus any runs you generate locally). Optional guided teaching notes beside each attempt can be enabled under **Settings → Student Lab · Guided Analysis**. When distributing the teaching handoff, share the built `dist/traceharness-school.zip` archive, which physically omits excluded local data.

## Container and Compose

To run via Docker without a local Python environment (works identically from a git checkout or an extracted `traceharness-school` archive, even if `.venv` exists beside it):

```bash
docker build -t traceharness:school .
docker run -d --rm -p 127.0.0.1:8765:8765 --name traceharness traceharness:school
```

Open **http://127.0.0.1:8765**. The image contains only the datasets listed below, and runs launched inside it default to the bundled mock model (requiring no key) regardless of the build machine's local model selection.

Or run with Docker Compose:

```bash
docker compose up --build
```

Compose bind-mounts `./data/runs` into the container so new runs persist on disk across `docker compose down` (in a developer checkout, the container also sees any other directories already present in `data/runs/`). Set `OPENROUTER_API_KEY` in your shell or a `.env` file beside `docker-compose.yml` for live model sweeps; without it, pre-recorded datasets and the mock provider continue to work.

Both container setups bind to `127.0.0.1` only by default. To reach the server from another LAN host, set `TRACEHARNESS_ALLOWED_HOSTS` to the extra `Host` header(s) the backend should accept (defaults: `127.0.0.1`, `localhost`, `[::1]`).

## Run third-party agents

`traceharness agents` runs mini-SWE-agent 2.4.6, Codex CLI 0.167.1 and Claude Code 2.1.322 on the lab's tasks (or on the eight real-repository task packages in `deploy/runner/tasks`), with a pinned model and pinned hosts, and writes the same results directory as `traceharness run`. The agent's own log is turned into the ledger by the import adapters, and its workspace is graded by the same grader, so the console and every analysis treat these runs like the lab's own. Docker is required (on macOS, `colima start` gives a headless one).

`traceharness import PATH` converts the logs of agents TraceHarness did not run into the same ledger: Claude Code, Codex, Cursor, agy (Antigravity CLI), Qwen Code, Kimi Code, ZCode, Grok CLI, GitHub Copilot CLI, Muse Code, OpenHands, SWE-agent, mini-SWE-agent, Inspect logs and Trajectory v1 files. `--detect` names the adapter it would pick. A source that does not record something (Copilot CLI records no token usage) imports it as unknown, never as an estimate. `traceharness import-swebench <submission_dir>` imports one public submission of the [SWE-bench experiments](https://github.com/SWE-bench/experiments) repository, with its resolved verdicts ([`docs/IMPORT_SWEBENCH.md`](docs/IMPORT_SWEBENCH.md)).

```bash
traceharness agents build                      # the image (add --real-repos for the task packages)
export OPENROUTER_API_KEY=...
traceharness agents run --agent mini-swe-agent --model google/gemini-2.5-flash-lite \
    --route "Google AI Studio" --tasks full --repeats 5 --out data/runs/mini_flash_lite
```

Each run uses separate containers. The **broker** is the only one with network access and the only place the key exists; it serves the model on a Unix socket and fixes the model, the hosts (fallbacks off), the output cap, the number of calls and the bytes sent. The **agent** container has no network, no capabilities, a read-only root and a non-root user, and works in a size-capped in-memory workspace. A separate container exports the workspace as regular files only, and the **grader** container (no network, read-only mounts) grades it. Every call's host and cost come from OpenRouter's generation records and are shown on the run page under **Model calls**; `traceharness agents resolve DIR` prices calls whose record arrived late. This is ordinary Docker isolation; for agents you do not trust, pass `--runtime runsc` (gVisor).

## Capture your coding-agent sessions

Capture runs on your machine only: no account, no upload. It supports **Claude Code**, **Codex**, **agy** (Antigravity CLI), **Qwen Code**, and **Cursor**, reads only the folders you allow, and writes ledgers into the local console (the Capture page of `traceharness serve`).

```bash
traceharness capture --watch --path /path/to/session-directory      # follow sessions as they are written
traceharness capture export --out sessions.zip [--source codex] [--since 2026-11-01]
traceharness capture import sessions.zip                            # on another machine (also: traceharness import sessions.zip)
```

An export is one zip of the captured sessions, redacted (known key and token shapes, `Bearer` tokens, URL passwords, private keys, secret-looking values), with a `manifest.json` that records a SHA-256 for every file. Import checks every hash and refuses archives with unsafe names, links, oversize members or an unknown version; it writes nothing unless the whole archive verifies, and runs nothing from it. Redaction is pattern-based and cannot know every secret format, so read an export before you share it. See [`docs/CAPTURE.md`](docs/CAPTURE.md).

## Local server security

The local server binds to `127.0.0.1` by default and applies two request checks ahead of every route:

- **Host allow-list.** Requests whose `Host` header is outside `127.0.0.1`, `localhost`, `::1`, an explicit `--host` address (excluding `0.0.0.0` and `::`), or comma-separated hosts in `TRACEHARNESS_ALLOWED_HOSTS` (for example `TRACEHARNESS_ALLOWED_HOSTS=my-host.example` behind a reverse proxy or container hostname) are rejected. This blocks DNS-rebinding requests originating from a browser tab.
- **Same-origin writes.** `POST`, `PUT`, `PATCH`, and `DELETE` requests carrying a cross-origin `Origin` or `Sec-Fetch-Site` header are rejected, and write requests must declare `Content-Type: application/json`. This blocks cross-site request forgery (CSRF) from other open tabs.

**Single-machine boundary.** These checks protect against a hostile web page in your browser; they provide no isolation against other users or processes on the same machine. Any local user, process, or port-forward reaching `127.0.0.1` on the server port has the same access as the browser UI. Add authentication in front of the server before exposing it past `127.0.0.1` or a trusted LAN.

## Included datasets

| Dataset | Runs | Source |
| --- | ---: | --- |
| `study_v04` | 3,240 | **Real.** Gemini 2.5 Flash-Lite, GPT-5.6 Luna and Qwen3.8 27B × nine harnesses (`baseline`, `reprompt`, `long_output`, `short_history`, `short_observations`, `no_test_tool`, `terse_prompt`, `tight_budget`, `permissive`) × 24 tasks (8 core + 16 extended) × 5 repeats, collected through OpenRouter on November 14, 2026 ($7.75). Every run records the upstream host that served it (`served_by`). In the repository only, not in the school package. |
| `llma4se_live` | 1,248 | **Real.** Four models (Gemini 2.5 Flash-Lite, Gemini 3.8 Flash, GPT-5.6 Luna, Qwen3.8 27B) × six harnesses × 8 tasks, collected for this lab through OpenRouter. Default for exercises 1–6 and 8. |
| `live` | 576 | **Real.** Claude Haiku 4.5, Gemini 2.5 Flash, GPT-5-mini × eight harnesses × 8 tasks, collected for this lab through OpenRouter. Second input to exercise 8. |
| `real_swe_agent_500` | 500 | **Real, third-party.** SWE-agent (Llama 8B / 70B) on 30 GitHub issues, from [nebius/SWE-agent-trajectories](https://huggingface.co/datasets/nebius/SWE-agent-trajectories) (CC-BY-4.0). Used by `ex7 --offline`. |
| `prerecorded_mock` | 480 | Mock model × six harnesses × 8 tasks — deterministic baseline identical on every machine. |
| `prerecorded_mock_weak` | 160 | Weaker mock model — the 2 × 2 mock version of exercise 8. |
| `families_mock` | 80 | Two mock models × four harnesses × 5 tasks. |
| `demo_mock` | 24 | Compact mock demonstration. |
| `captured_claude_code` | 1 | **Real, captured.** One Claude Code session (Claude Sonnet 5, 28 steps) implementing `results_scope.py` and its test in this repository (nine test runs, tested before exit). Recorded by the capture pipeline with machine paths normalized to `/workspace/traceharness`: an organic session with no oracle, one repeat, and an unchosen harness. |

The runs of the Sentinel experiment (`sentinel_v1`, 1,800) and of the third-party agents (`third_party_agents`, 600; `third_party_real`, 120) are published on Hugging Face as [aura-lab-wm/traceharness-runs](https://huggingface.co/datasets/aura-lab-wm/traceharness-runs); copy a folder under `data/runs/` to open it in the console.

2,325 of the 3,069 included runs are real model runs. The repository also carries `study_v04` (3,240 runs, all real), which the school package leaves out. All included runs replay from disk with no API key; an OpenRouter key is needed only to execute new runs against live models.

## Reproduce the exercises

From the repository root after installation:

```bash
python3 exercises/ex1_variance.py
python3 exercises/ex2_harness.py
python3 exercises/ex7_real_trajectories.py --offline
python3 exercises/ex8_experiment.py
```

See `HANDOUT.md` for exercises 3–6 and analysis questions (`matplotlib` is optional for plotting). To execute a new offline mock run:

```bash
python3 -m traceharness run --provider mock --tasks t01_slugify --repeats 3 --out data/runs/mine
```

New run directories appear on the dashboard alongside the included datasets. To ship a new dataset in the school archive, add it to `traceharness/school-package.json` and rebuild.

## Contents and exclusions

**Included:** application source and prebuilt UI (`traceharness/frontend/dist`), lab exercises, task repositories, harness configurations, trajectory checks, infrastructure tests, attribution, and the eight datasets above (with the bundled mock sentinel model selected independently of local machine configuration).

**Excluded from the school archive:** unlisted `data/runs/` directories, local captured-session stores and watcher state (only the single curated session above ships), credentials, environment files, caches, local model selection, personal outputs, Git history, the macOS menu-bar app, machine census tools, internal notes, and instructor solutions. Optional corpus/tooling integration tests require the full checkout. `PACKAGE_MANIFEST.json` records each shipped file's relative path, size, and SHA-256 checksum (excluding itself) as selected by `traceharness/school-package.json`.

**Maintainer archive build:** run `python3 scripts/build_school_package.py --verify` (or `make school-package`) to build and clean-room verify `dist/traceharness-school.zip` (runs the four core exercises, a live mock run, the shipped tests, SHA-256 checks, and a path/secret scan; rejects symlinks, caches, hidden files, dropped tracked files, and non-zero exits). If you change frontend source, rebuild and stage `dist/` first (`cd traceharness/frontend && npm ci && npm run build && cd ../.. && git add traceharness/frontend/dist`), or restore tracked assets with `git checkout -- traceharness/frontend/dist && git clean -fdq traceharness/frontend/dist`.

**Further documentation:** [`docs/EXPERIMENT_WORKSPACE.md`](docs/EXPERIMENT_WORKSPACE.md) (signed-in harness editor, forked runs, and OpenRouter sweeps), [`docs/EXECUTION_PERFORMANCE.md`](docs/EXECUTION_PERFORMANCE.md), [`docs/COMPREHENSIVE_VERIFICATION.md`](docs/COMPREHENSIVE_VERIFICATION.md), [`docs/ASTRA_REVIEW_FIXES.md`](docs/ASTRA_REVIEW_FIXES.md) (seven repaired review findings), [`docs/CAPTURE_PRODUCTION_VERIFICATION.md`](docs/CAPTURE_PRODUCTION_VERIFICATION.md) (production uploads and two-member isolation), [`docs/EIGHT_SOL_PLATFORM_AUDIT.md`](docs/EIGHT_SOL_PLATFORM_AUDIT.md) (twelve platform audit repairs), [`docs/VOICE_TOUR_AND_BUDDY.md`](docs/VOICE_TOUR_AND_BUDDY.md) (narrated tour and Ask Buddy), and [`docs/ACCOUNT_PLATFORM_DESIGN.md`](docs/ACCOUNT_PLATFORM_DESIGN.md) (undeployed account/MFA/admin design proposal).

## How to cite

If you use TraceHarness in academic work, cite the software and the version used (`CITATION.cff` powers GitHub's **Cite this repository** button):

```bibtex
@software{mastropaolo2026traceharness,
  author  = {Antonio Mastropaolo},
  title   = {{TraceHarness}: Treating the Agent Harness as a Controlled Experimental Variable},
  year    = {2026},
  version = {0.5.5},
  url     = {https://traceharness.dev}
}
```

Plain text: Mastropaolo, A. (2026). *TraceHarness: Treating the agent harness as a controlled experimental variable* (Version 0.5.5) [Computer software]. https://traceharness.dev

If you use the 500 runs in `data/runs/real_swe_agent_500`, also cite Nebius, [SWE-agent-trajectories](https://huggingface.co/datasets/nebius/SWE-agent-trajectories) (CC BY 4.0).

## License

MIT for the software (see [`LICENSE`](LICENSE)); the Nebius trajectories in `data/runs/real_swe_agent_500/` stay CC-BY-4.0 and fall outside the MIT grant.
