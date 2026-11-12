# TraceHarness — replication package

[![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://codespaces.new/aura-lab-wm/traceharness)

This is the teaching handoff for the coding-agent evaluation lab.

**Open it in GitHub Codespaces** (the button above). Nothing to install; bring your own
OpenRouter key, or none for the recorded datasets. See [`docs/CODESPACES.md`](docs/CODESPACES.md).

**Then follow [`docs/GUIDE.md`](docs/GUIDE.md):** load 1,000 real SWE-agent trajectories and analyse them,
step by step, with screenshots (also online at <https://traceharness.dev/guide/>).

**For everything else, [`docs/STUDENT_GUIDE.md`](docs/STUDENT_GUIDE.md)** covers installing, a first
offline run, the web interface, running experiments, reading the results, the exercises, testing
and troubleshooting, step by step. `HANDOUT.md` holds the lab exercises and their questions;
`LAB_1H.md` is the one-hour teaching plan.

**Check that it works** (about ten seconds, offline, no key):

```bash
python scripts/check_install.py      # or: make check
```

Expect `All 5 checks passed`. The mock agent must score exactly 14 / 24; any other number means
the grader, not the model, is broken (see `docs/STUDENT_GUIDE.md`, section 13).

**Signed-in hosted workspace:** [edit full harness JSON, fork recorded runs and schedule harness × model × task sweeps](docs/EXPERIMENT_WORKSPACE.md). General matrices coexist with matched native prompt experiments; execution requires a compatible registered task and your OpenRouter key.

**Execution verification:** [live results, accounting/partial-grading fixes and manual review checklist](docs/EXECUTION_PERFORMANCE.md).

**Comprehensive verification:** [current live workflows, regression coverage and explicit remaining blocks](docs/COMPREHENSIVE_VERIFICATION.md).

**Astra review repairs:** [seven repaired findings and regression evidence](docs/ASTRA_REVIEW_FIXES.md). **Capture is enabled:** [production uploads, two-member isolation and verification limits](docs/CAPTURE_PRODUCTION_VERIFICATION.md).

**Latest platform audit:** [twelve repairs, ChatGPT's Chrome review, visible production evidence and remaining limits](docs/EIGHT_SOL_PLATFORM_AUDIT.md).

**Account and owner administration:** [proposed login, membership, sessions, MFA and admin-console design](docs/ACCOUNT_PLATFORM_DESIGN.md). This is a design proposal, not deployed account functionality.

**First visit and help:** [narrated tour and Ask Buddy workflow guidance](docs/VOICE_TOUR_AND_BUDDY.md), with transcripts, real control navigation and current runner availability.

## Run the dashboard

Python 3.10 or newer is required (3.12 recommended). On macOS the built-in `python3` is 3.9 and
will not install this package: install 3.12 from python.org or Homebrew first and use
`python3.12` below. From the extracted `traceharness-school` directory:

```bash
python3 -m venv .venv
source .venv/bin/activate
python3 -m pip install -e .
python3 -m traceharness --no-browser
```

Open **http://127.0.0.1:8765**. No API key is needed to inspect the included results.
The built frontend is included; Node.js is only needed if you change its source.

TraceHarness opens on **Datasets**: every results directory
under `data/runs/`, which in this package means the included datasets below plus any runs you
make yourself. Teaching material (a reading guide and a lesson beside each attempt) is an
opt-in preference under **Settings → Student Lab · Guided Analysis**.

The archive physically omits excluded data; send the archive, not the whole checkout.

## Run in a container

An alternative to the venv install above, from the extracted `traceharness-school`
directory (or the full checkout) — Docker only, no local Python setup needed:

```bash
docker build -t traceharness:school .
docker run -d --rm -p 127.0.0.1:8765:8765 --name traceharness traceharness:school
```

Open **http://127.0.0.1:8765**. The image ships only the datasets listed below, and
new runs started from it use the bundled mock model (so they need no key), regardless of any local model selection
on the machine that built it. `docker build` works the same way from a git
checkout or from this extracted archive, even with a `.venv` already sitting
next to it.

Or with Compose:

```bash
docker compose up --build
```

Compose also bind-mounts `./data/runs` into the container, so new runs land
next to the ones already on disk and survive `docker compose down` — in a
developer checkout (not this extracted package) that also means the container
can see whatever else is already in `data/runs/` on that machine. Set
`OPENROUTER_API_KEY` in the environment (or a `.env` file next to
`docker-compose.yml`) for live cells against real models; without it the mock
provider and pre-recorded runs still work.

Both binds are `127.0.0.1`-only by default. For access from another machine on
the LAN, set `TRACEHARNESS_ALLOWED_HOSTS` to the extra Host header(s) the backend
should accept (defaults: `127.0.0.1`, `localhost`, `[::1]`).

## Record your own sessions on traceharness.dev

Sign in on [traceharness.dev](https://traceharness.dev), then connect the computer your coding agents run on.
The local capture adapters support Claude Code, Codex, Gemini CLI, Qwen Code and Cursor. The Python
package includes the CLI and local web application; these commands do not start a web server:

```bash
pipx install git+https://github.com/aura-lab-wm/traceharness
traceharness login
traceharness capture --watch --sync --path /path/to/chosen/session-directory
```

`traceharness login` prints a short code and the address `https://traceharness.dev/app/device`. Open it in your
browser while signed in, check the code matches, and press Approve. The command then saves a token in
`~/.traceharness/credentials.json` (owner-only, mode 0600). No browser is opened for you, and the token is only
ever sent in an `Authorization` header to the site you signed in to. `traceharness whoami` shows which
account this computer uses. See [capture sync setup and verification limits](docs/CAPTURE_SYNC.md).

Claude Code shortcut (needs the install above). It attempts an upload when an allowed session ends:

```bash
claude plugin marketplace add aura-lab-wm/traceharness
claude plugin install traceharness-capture@traceharness
```

The plugin runs `traceharness capture push --source claude_code --session-file <transcript> --quiet` when a session
ends (SessionEnd hook, configured limit 60 seconds; its upload subprocess times out after 45 seconds).
The hook exits 0 and prints nothing even when `traceharness` is not installed or you are not signed in.
A failed upload is not automatically retried.

**What is recorded.** Your coding-agent sessions: the ordered list of actions (reads, edits, commands, test
runs, model replies), a summary, and the final patch. After upload they appear under *Connect this computer*
at `/app/capture` on the site, where you can open or delete any run.

**Watch sync requires consent on your computer.** `--watch --sync` requires a person to type `yes`
at a terminal and refuses `--yes` and noninteractive input. The website and linked pages cannot start
capture. The optional SessionEnd plugin uses the explicitly configured local allow-list and saved login.

**The allow-list.** Only sessions that belong to folders you allowed are ever read or sent. The list lives in
`~/.traceharness/capture.json` and is edited from the Capture page of the local console (`traceharness serve`);
`--path DIR` adds a folder for one run. A missing or unreadable list allows nothing.

**Redaction.** Before anything leaves your computer, API keys and tokens (Anthropic, OpenAI, OpenRouter,
GitHub, AWS, Google, Slack, Supabase, Stripe, Hugging Face, npm, TraceHarness), JWTs, `Bearer` tokens, the
user:password part of URLs, private-key blocks, `password=`/`secret=`/`api_key=`/`refresh_token=` style
values, and the string value of any JSON key whose name contains password, secret, token, api key,
authorization or credential are replaced by `[redacted:<kind>]`. Redaction is pattern-based and cannot
know every secret format (a password written as plain prose, or an unusual token shape, passes through),
so read a run before you share it if it may hold something unusual. `traceharness capture push --dry-run` shows what would be sent
without sending it. A run over 4 MiB is skipped and reported.

**Live view (optional).** `traceharness link --member` opens an outbound connection with your sign-in so the
site watch your own room. It opens no port, it only lets the site watch, it refuses `--accept-commands`,
and the runner itself refuses `run` and serves no run directory (`live`/`tail`) in this mode. Live view of
captured sessions is not implemented yet: for now the stored copies on `/app/capture` are what you see.

**How to stop.**

```bash
traceharness logout            # revokes this computer's token and deletes it; sends nothing afterwards
traceharness capture --pause   # the watcher and `capture push` (so the Claude Code hook) stop (--resume undoes it)
```

The Claude Code hook is governed by the capture allow-list, your sign-in and `--pause`.

You can also revoke a token from `/app/capture`, and delete uploaded runs there at any time.

## Local server security

The local server binds to `127.0.0.1` by default and now enforces two checks in front of
every request:

- **Host allow-list.** A request whose `Host` header is not `127.0.0.1`, `localhost`, `::1`,
  the interface you passed to `--host` (when it isn't `0.0.0.0`/`::`), or a host listed in
  `TRACEHARNESS_ALLOWED_HOSTS` (comma-separated) is rejected before it reaches any route. This
  is what stops **DNS rebinding** -- a domain an attacker controls, re-resolved to point at
  this machine, riding a real browser tab into the app.
- **Same-origin writes.** Any POST/PUT/PATCH/DELETE carrying an `Origin` or `Sec-Fetch-Site`
  header that doesn't say "this page" is rejected, and a write's `Content-Type` must be
  `application/json`. This stops a hostile page open in another tab from firing a write at the
  server while you have it running -- the class of attack usually called CSRF.

Running behind a reverse proxy or in a container reached under another hostname? Set
`TRACEHARNESS_ALLOWED_HOSTS=my-host.example` (comma-separated for more than one).

**This is defense against a hostile web page, not a security boundary against another user
or process on the same machine.** Anyone who can reach `127.0.0.1` on this port at all --
another local user, another process, a port-forward -- has the same access the browser UI
does. Treat the sandbox this way: fine for a classroom laptop, not something to expose past
`127.0.0.1`/your own LAN without adding real authentication in front of it.

## Included datasets

| Dataset | Runs | Source |
| --- | ---: | --- |
| `llma4se_live` | 1,632 | **Real.** Five models (DeepSeek V4 Flash, Gemini 2.5 Flash-Lite, Gemini 3.8 Flash, GPT-5.6 Luna, Qwen3.8 27B) × six harnesses × 8 tasks, collected for this lab through OpenRouter. Default for exercises 1–6 and 8. |
| `live` | 576 | **Real.** Claude Haiku 4.5, Gemini 2.5 Flash, GPT-5-mini × eight harnesses × 8 tasks, collected for this lab through OpenRouter. Second input to exercise 8. |
| `real_swe_agent_500` | 500 | **Real, third-party.** SWE-agent (Llama 8B / 70B) on 30 GitHub issues, from [nebius/SWE-agent-trajectories](https://huggingface.co/datasets/nebius/SWE-agent-trajectories) (CC-BY-4.0). Used by `ex7 --offline`. |
| `prerecorded_mock` | 480 | Mock model × six harnesses × 8 tasks — for runs that must be identical on every machine. |
| `prerecorded_mock_weak` | 160 | Weaker mock model — the 2 × 2 mock version of exercise 8. |
| `families_mock` | 80 | Two mock models × four harnesses × 5 tasks. |
| `demo_mock` | 24 | A compact mock demonstration. |
| `captured_claude_code` | 1 | **Real, captured.** One Claude Code session (Claude Sonnet 5, 28 steps) implementing a task in this repository: `results_scope.py` and its test, nine test runs, tested before it stopped. Recorded by the capture spine, machine paths replaced with `/workspace/traceharness`. A session nobody launched as an experiment: no oracle, one repeat, a harness you did not choose. |

2,709 of the 3,453 included runs are real model runs. They are replayed from disk: reading and
reanalysing them needs no API key. Only running *new* experiments against live models does.

## Reproduce the exercises

From this directory, after installation:

```bash
python3 exercises/ex1_variance.py
python3 exercises/ex2_harness.py
python3 exercises/ex7_real_trajectories.py --offline
python3 exercises/ex8_experiment.py
```

Read `HANDOUT.md` for exercises 3–6 and interpretation. Figures are optional;
install `matplotlib` if needed. To generate a small, new offline run:

```bash
python3 -m traceharness run --provider mock --tasks t01_slugify --repeats 3 --out data/runs/mine
```

New results appear on the dashboard next to the included datasets. They do not
become part of the school package; to ship one, add it to the manifest and rebuild.

## Contents and exclusions

The package includes the application source and built UI, exercises, task
repositories, harness configurations, trajectory checks, infrastructure tests,
attribution, and the datasets above. The mock sentinel model is selected in
the archive independently of the developer's local model selection.

It excludes every other results directory, the captured-session store (only the one
curated session above ships), credentials, environment files,
caches, local model selection, personal outputs, Git history, the macOS menu-bar
app, machine census tools, internal notes, and instructor solutions. Reusable
capture modules remain application dependencies; no watcher state or
configuration is included. Some integration tests target optional corpora or
machine tooling outside this teaching package; they require the full checkout.

`PACKAGE_MANIFEST.json` lists each shipped file's relative path, size, and SHA-256
checksum. Its own checksum is not included recursively. It describes the actual
archive; `traceharness/school-package.json` defines the selection policy.

## Rebuild the handoff (maintainers)

`traceharness/frontend/dist` is committed, so most rebuilds need nothing more than:

```bash
python3 scripts/build_school_package.py --verify
```

`make school-package` does the same thing. `--verify` extracts the fresh archive into a clean
room, installs it in a throwaway venv with no other traceharness on the path, starts the server and
drives it (the four core exercises, a live mock run, the shipped test suite, a re-hash of every
file against `PACKAGE_MANIFEST.json`, and a scan for machine paths or real-shaped secrets), and
prints a JSON verdict. Treat a non-zero exit as a broken package, not something to ship anyway.

Only rebuild the frontend itself after changing its source:

```bash
cd traceharness/frontend
npm ci
npm run build
cd ../..
git add traceharness/frontend/dist   # commit the new build -- see the next paragraph for why
python3 scripts/build_school_package.py --verify
```

The builder ships `traceharness/frontend/dist` exactly as git tracks it; it never rebuilds it
itself. A local `npm run build` you have NOT committed yet will leave the working tree holding
different (content-hashed) filenames than the ones `git ls-files` still reports -- and the
builder's no-silent-drop check will then correctly refuse to ship an archive whose dist/ has
drifted from what the repository says is there. Commit the rebuilt dist/ (or restore it with
`git checkout -- traceharness/frontend/dist && git clean -fdq traceharness/frontend/dist` if you were
only checking something locally) before packaging.

Send **`dist/traceharness-school.zip`**. The builder uses the same manifest as the
dashboard, rejects symlinks in selected inputs, skips hidden files and caches,
ships every tracked file under an included root regardless of its extension, fails the build
if a tracked file under an included root would otherwise be silently dropped, and does not
include any unlisted results directory. It generates the package README and selects the bundled
mock model without changing local configuration.

## How to cite

If you use TraceHarness in academic work, please cite the website and the version you used.
GitHub's **Cite this repository** button gives the same entry from `CITATION.cff`.

```bibtex
@software{mastropaolo2026traceharness,
  author  = {Antonio Mastropaolo},
  title   = {{TraceHarness}: Treating the Agent Harness as a Controlled Experimental Variable},
  year    = {2026},
  version = {0.3.0},
  url     = {https://traceharness.dev}
}
```

Plain text: Mastropaolo, A. (2026). *TraceHarness: Treating the agent harness as a controlled
experimental variable* (Version 0.3.0) [Computer software]. https://traceharness.dev

If you use the 500 runs in `data/runs/real_swe_agent_500`, also cite Nebius,
[SWE-agent-trajectories](https://huggingface.co/datasets/nebius/SWE-agent-trajectories) (CC BY 4.0).
