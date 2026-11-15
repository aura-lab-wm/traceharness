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
