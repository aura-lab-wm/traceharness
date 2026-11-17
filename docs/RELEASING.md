# CI and releases

## What runs, and when

| Workflow | Trigger | What it does |
|---|---|---|
| `ci.yml` | every pull request, every push to `main`, manual | unittest suite on Python 3.10, 3.12 and 3.13, then the offline self-check (`make check`); console lint, vitest (4 workers) and a throwaway Vite build; the school package with its clean-room verification, then the wheel installed in a fresh venv; the container image built and started |
| `codeql.yml` | pull requests, `main`, weekly | CodeQL `security-extended` on the Python, the JavaScript and the workflows themselves |
| `dependency-review.yml` | pull requests | fails on a new dependency with a high-severity advisory or a GPL/AGPL license |
| `release.yml` | a pushed tag `vX.Y.Z` only | see below |
| Dependabot | weekly | grouped updates for GitHub Actions, pip and the console's npm packages |

Every action is pinned to a commit SHA, the default token is read-only, pull requests never see a
secret (`pull_request`, never `pull_request_target`), and no workflow uses a repository secret.

## Cutting a release

1. Set `version` in `pyproject.toml` and merge to `main`.
2. Tag the merge commit and push the tag:
   ```bash
   git tag -a v0.5.0 -m "TraceHarness 0.5.0" && git push origin v0.5.0
   ```
3. `release.yml` then:
   - refuses a tag that differs from `pyproject.toml`;
   - re-runs all of CI on the tagged commit;
   - builds the school package (verified in a clean room) and the wheel, writes `SHA256SUMS`, and
     attaches SLSA build provenance (`gh attestation verify <file> -R aura-lab-wm/traceharness`);
   - creates the GitHub Release with those files and notes generated from the merged PRs;
   - pushes `ghcr.io/aura-lab-wm/traceharness:<version>`, `:<major.minor>` and `:latest`, with
     its own provenance attestation.

Nothing is published by a pull request or a push to `main`.

## Releasing with the site

traceharness.dev runs four things built from this repository: the Worker's vendored shared sources,
the hosted runner image, the `/app` snapshot of the console, and the pages. A version bump is not
done until each of them carries the new version. When you bump `version`, also regenerate the
shared-sources bundle, which records the package version and the hashes the site checks against:

```bash
python -m traceharness.shared.generate            # writes both copies; --check exits 1 when stale
```

Then release in this order. Each step starts only after the previous gate passed and the owner said go.

| # | Step | What to run | Gate |
|---|---|---|---|
| 1 | Package | bump `pyproject.toml` and every statement in `tests_agentlab/test_version_alignment.py`; `python -m traceharness.shared.generate`; `make build-frontend`; pull request, CI, merge, tag and push the tag (above) | `release.yml` green |
| 2 | Site sync | in the site checkout: `python3 tools/sync_shared.py --from <this checkout at the tag>`; pull request | `python3 tools/sync_shared.py --check --require-public` and `node --test test/*.test.mjs` |
| 3 | Runner | build the wheel at the tag, update the wheel name in `deploy/runner/fly/Dockerfile`, rebuild and verify per `deploy/runner/fly/README.md`, then deploy to Fly | `deploy/runner/verify_runtime.py`, both runner contract scripts, a dated record in `deploy/runner/releases/` |
| 4 | `/app` snapshot | `python3 auth/worker/publish_workbench.py --publish --dry-run --ref vX.Y.Z`, then `--publish` | every export check, both candidate checks, the KV read-back |
| 5 | Worker | `python3 -B auth/worker/release.py --state "$STATE_FILE" --expected-project "$EXPECTED_PROJECT" --workbench-export <export> --previous-version <id>` (checks only), then the same with `--deploy` | `PASS: release checks complete`; report the last ten log lines and `DEPLOY_EXIT` |
| 6 | Pages | `python3 tools/extract.py && python3 tools/build.py`, then the procedure in `auth/pages/README.md` | the entry proof |
| 7 | Drift | `traceharness doctor --compare https://traceharness.dev` | exit 0 |

One command says what still differs:

```bash
python scripts/release_all.py --check --site <site checkout>
```

It runs `traceharness doctor`'s local checks (package, UI build, shared sources, runner image) and
`site_checkout`, the retired-phrase check and `tests_agentlab.test_version_alignment`, prints one
line per check and then the steps above, and exits 1 naming whatever differs. Before step 1 it names
what the bump must change; after step 3 it must exit 0, and steps 4 to 7 start only then.
`python scripts/release_all.py --offline-gates --site <site checkout>` runs the offline test gates
of both repositories in order and stops at the first failure. Neither mode deploys, publishes, tags
or pushes: those commands appear only as printed text.
