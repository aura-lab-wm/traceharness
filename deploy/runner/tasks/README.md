# Real repository task packages

Four curated Requests recipes cover distinct upstream failures. They are real
repository issues with pinned broken revisions and upstream fixes, not invented
examples or claims of unrestricted repository execution. Each task discloses a
narrow static edit policy and supplies independent offline behavioral checks.

| Recipe | Real behavior under test | Upstream issue / fix |
| --- | --- | --- |
| `requests-jsondecode-pickle` | JSON exceptions survive pickle and process pools without losing formatted error state | [#6628](https://github.com/psf/requests/issues/6628), [fix](https://github.com/psf/requests/commit/3ff3ff21dd45957c9e143cd500291959bb15f690) |
| `requests-unicode-length` | Upload Content-Length counts UTF-8 bytes while binary/file behavior stays intact | [#6586](https://github.com/psf/requests/issues/6586), [fix](https://github.com/psf/requests/commit/3fd309a5c14e4cfbd96bea6c8e71b4958fe090bb) |
| `requests-leading-slashes` | Origin-form targets normalize leading slashes without changing HTTP proxy absolute-form targets | [#6643](https://github.com/psf/requests/issues/6643), [fix](https://github.com/psf/requests/commit/60389df6d69ce833164696dcf36cbb43336d3426) |
| `requests-empty-netrc` | Empty netrc profiles do not inject Authorization while populated/explicit auth still works | [#6928](https://github.com/psf/requests/issues/6928), [fix](https://github.com/psf/requests/commit/47914226c2968802f2cdee3f6f0f6e06e4472f64) |

The added recipes use the same pinned dependencies and Python 3.12 environment
as the initial task. They do not require sockets, services or extra packages.
Netrc tests create their own temporary input and never read a host credential
file. The original JSON package remains immutable; new recipes do not alter it.

The first package repairs an actual Requests failure: [upstream issue #6628](https://github.com/psf/requests/issues/6628), where a JSON decoding exception cannot be deserialized and can terminate a process pool. The source is the immutable parent of [the upstream fix](https://github.com/psf/requests/commit/3ff3ff21dd45957c9e143cd500291959bb15f690). This is a TraceHarness task with upstream provenance, not a claimed SWE-bench result.

The source archive is pinned to revision `96b22fa18c00831656ee4b286bf1c9062459b00a` and SHA-256 `b9a1f599c259a4e29edeefb0a0690a31c89a4d038212bd44ea9b9d8321908ca5`. Original Requests LICENSE and NOTICE files are retained. The task provides the complete repository, a public offline reproduction and an independent hidden grader. It does not include the reference solution in the agent-visible repository.

## Package an operator-reviewed recipe

Use Python 3.10 or later from the repository root. Choose an output outside the tracked `data/runs`; the builder refuses to replace an existing directory.

```sh
python scripts/package_runner_task.py \
  deploy/runner/tasks/requests-jsondecode-pickle/recipe.json \
  --output /srv/traceharness-inventory/tasks/requests-jsondecode-pickle-6628
```

An optional `--archive` path reuses a downloaded archive. The exact digest is still checked. Archive extraction rejects traversal, hardlinks, special files, duplicates and excessive contents. Symlinks are rejected unless an operator-reviewed recipe explicitly names an exact path/target pair to omit. Such an omission never follows or creates the link; missing or changed entries fail, and provenance records the omission. The empty-netrc recipe omits two unrelated upstream TLS-certificate-fixture links using this rule. The output manifest includes the final `content_sha256` using the runner registry's tree hash. Package creation never creates a compatibility receipt or claims successful execution.

The package contains:

- `repo/`: pristine upstream repository plus `public_tests/`, which the agent can inspect and run.
- `repo/TRACEHARNESS_TASK_POLICY.json`: the explicit edit contract for this curated task.
- `issue.md` and `task.json`: instructions and the explicit visible-test command consumed by the runtime.
- `grader/checks.py` and `grading.json`: trusted independent offline checks, unavailable in the task container.
- `requirements.lock`: task dependencies pinned to exact versions and pure-wheel hashes.
- `provenance.json`: immutable source identity, original issue and license attribution.

New recipes declare `public_test_filename` and `expected_checks`; the original
JSON recipe keeps its existing filename and four-check default so its package
hash is unchanged. Every grader requires a known edit contract. There is no
fallback that imports unrestricted candidate source when a contract is missing
or unknown. Unicode and URL tasks permit one documented guarded assignment at
an exact function location; netrc permits one documented predicate replacement.
The remainder of each module AST and all other original files stay protected.
Each new package has four hidden methods, including preservation cases beyond
the reported failure. Baseline/reference checks do not establish live-model
compatibility; each task/runtime/model combination needs its own actual run.

The visible command is `PYTHONPATH=src python -m unittest discover -s public_tests -v`. It does not use the upstream network-dependent pytest suite. The independent grader covers all pickle protocols, invalid Response.json payloads with and without explicit encoding, exception identity/attributes, a real ProcessPool failure followed by a successful task, and unchanged valid-JSON/ordinary-error behavior. Both original and restored JSON errors must retain the formatted message and args of an independent standard-library JSON decoder; comparing a regressed exception only with itself is insufficient. Constructor request/response keyword behavior is checked without requiring pickle to preserve metadata that the upstream fix itself does not retain. The current recipe deliberately tests the standard-library JSON backend; optional simplejson is not installed or claimed verified.

## Supply pinned dependencies and grader

Download the four pure Python dependency wheels on the operator's build machine with hash enforcement. Install them into the reviewed runtime and grader image without fetching anything during a member run. The Requests repository itself is **not** pip-installed; tests import the candidate `src/requests` tree.

```sh
python -m pip download --only-binary=:all: --platform any --no-deps \
  --require-hashes -r deploy/runner/tasks/requests-jsondecode-pickle/requirements.lock \
  --dest /srv/traceharness-build/task-wheels
python -m pip install --no-index --find-links /srv/traceharness-build/task-wheels \
  --require-hashes --no-deps \
  -r deploy/runner/tasks/requests-jsondecode-pickle/requirements.lock
```

Use the reviewed image recipe to copy executable `deploy/runner/tasks/grade.py` to `/opt/traceharness-grade`. The executor invokes this path in a separate network-none isolated grader container. This wrapper is not a host sandbox and must not be used to grade untrusted candidate code directly on a host.

Production grading requires the root result writer with only SETUID/SETGID container capabilities. `/output` belongs to root and is not group/other writable; `/workspace` and `/task` are read-only. The wrapper reconstructs a pristine repository in bounded container `/tmp`, rejects changed protected files and overlays only permitted Python source. It launches the candidate tests as UID/GID10002 with supplementary groups cleared, no-new-privileges and an environment allowlist. Python isolated mode ignores inherited PYTHONPATH, user site and workspace startup hooks. The candidate process group is terminated before root creates `grade.json` with exclusive/no-follow creation. No provider socket or credentials are mounted in this grader.

This Requests task additionally applies a static edit contract **before importing candidate code**. Every original file except `src/requests/exceptions.py` must remain byte-identical. The editable module must preserve the entire baseline AST after removing exactly one added `JSONDecodeError.__reduce__` method; the unchanged baseline is also admitted so behavioral tests can demonstrate failure. The method takes only `self`, has no decorators, defaults, annotations or type parameters, and contains only an optional literal docstring plus one return. Its expression must be `CompatJSONDecodeError.__reduce__(self)`, `(self.__class__, (self.msg, self.doc, self.pos))`, or `(type(self), (self.msg, self.doc, self.pos))`. Source encoding must resolve to UTF-8 and accepted source is normalized to UTF-8. New workspace files, including bytecode and native modules, never enter the pristine reconstruction.

The narrow policy is disclosed in the issue and public metadata. It prevents this task's candidate from forging the final stdout test marker through modified imports, constructors, decorators or arbitrary executable code. After validation, the four behavioral methods must complete successfully. This is a deliberately curated repair contract, not a claim that a subprocess or a stdout summary can safely grade arbitrary Python edits. General task packaging and harness/model configuration remain flexible; each new task needs its own reviewed grading boundary.

## Evidence required before registration

Before enabling this package, run the unmodified baseline, immutable upstream reference fix, observed message-regression patch and original stdout/exit forgery through the deployed isolated grader. Require baseline `failed`, reference `passed` and both invalid candidates `failed`; the forgery must be rejected before candidate import. Archive the exact task hash, grader image/source identities and results. The local `--local-validation` option is for explicitly trusted baseline/reference checkouts only and skips UID isolation; its result is not container or live-model evidence. Malicious candidates must never be evaluated on the host.

Register the package's tree hash, immutable revision, actual runtime image digests, actual grader digest and compatible runtime IDs. The `environment_digests` mapping binds each runtime ID to its pinned dependency image. Actual native/model compatibility receipts must come from actual isolated runs against the installed task and grader; packaging does not manufacture them. A replacement task or grader requires retiring prior task-bound release evidence and repeating the proofs. Preserve old packages and reports as history, and compare embedded identities rather than inferring task version from a filename.

The following remains independent of the package: host provisioning, image build/push, runtime compatibility, model calls, account credentials and member execution. Local recipe/unit tests do not establish those capabilities.


## Grader regression history

The first task package (`52bef0b2c617611c46231df20e679cfcf213c338bf2427e7a1a0b0f439f85177`) accepted an observed model patch that repaired pickling but reduced the formatted exception message to its bare `msg`. Its tests compared the restored object against the already altered original, so both agreed on the regression. That task's acceptance evidence does not validate a stronger replacement package.

The strengthened package adds independent stdlib message/args/attribute oracles to the public reproduction and the same four hidden check methods. Local validation requires baseline failure, upstream reference success, and rejection of the exact observed bad patch. The original package and proof remain historical; deployment must install the new tree hash, retire old task-bound compatibility evidence, and repeat isolated grading and real execution. The permanent regression fixture is `tests_agentlab/runner_service/fixtures/requests-jsondecode-observed-invalid.patch`.

The second package (`88996c3db95a5e82bb0c72a0bb40bc0fb7c3fe8efb6069b894155c7023b9eee0`) still allowed arbitrary Python changes under `src/requests/`. Adversarial review demonstrated that a candidate could print the success marker and exit from `requests/__init__.py`, bypassing behavioral checks. Version 3 adds the pre-import static contract above and requires a rebuilt grader image, a new task hash, fresh isolated proofs and new task-bound execution evidence. Previous packages and reports remain immutable. Unit fixtures for this boundary are inert strings, including the observed stdout/exit forgery, hostile method definitions and a non-UTF-8 encoding-cookie attack; they are rejected without launching candidate code.
