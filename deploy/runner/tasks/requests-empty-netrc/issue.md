# Requests: ignore empty netrc authentication entries

Upstream issue: https://github.com/psf/requests/issues/6928
Upstream merged fix: https://github.com/psf/requests/pull/7205
Baseline revision: 1b40fdd004bfc8ba5301bcf8a6908264e9b6b877

Python 3.11+ can parse an empty netrc entry as three empty strings. Requests treats that tuple as usable credentials and adds an unintended Basic Authorization header, potentially replacing an explicitly supplied header. Ignore entirely empty netrc profiles while preserving populated or partially populated login/account/password entries, explicit auth=("", ""), and trust_env=False.

This is a real upstream Requests bug, packaged as a curated TraceHarness task rather than a SWE-bench benchmark claim. The runtime supplies Python 3.12 and the pinned Requests dependencies, including urllib3 2.x. No network service, dependency installation, model secret or external credential file is needed. The netrc reproduction uses a temporary file it creates itself.

Run the public reproduction:

    PYTHONPATH=src python -m unittest discover -s public_tests -v

The independent grader first enforces the public edit contract in TRACEHARNESS_TASK_POLICY.json before importing candidate code, then runs four behavioral checks. In src/requests/utils.py, replace only the if _netrc condition in get_netrc_auth with a predicate that requires at least one nonempty field. Preserve the rest of the complete module AST and every other original file. Comments/formatting may change in the editable file; use UTF-8. New workspace files are excluded from grading.

The replacement condition is one of `_netrc and any(_netrc)`, `_netrc is not None and any(_netrc)`, `any(_netrc or ())`, `bool(_netrc) and any(_netrc)`, `_netrc and (_netrc[0] or _netrc[1] or _netrc[2])`.

Two unrelated upstream TLS certificate-fixture symlinks are explicitly omitted from this source package: tests/certs/mtls/client/ca -> ../../expired/ca/ and tests/certs/valid/ca -> ../expired/ca. They are never followed; exact omissions are recorded in provenance. All task source and relevant auth tests remain intact.
