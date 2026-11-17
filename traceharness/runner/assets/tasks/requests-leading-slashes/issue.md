# Requests: normalize excess leading request-target slashes

Upstream issue: https://github.com/psf/requests/issues/6643
Upstream merged fix: https://github.com/psf/requests/pull/6644
Baseline revision: 7a13c041dbef42f9f3feb14110f02626f6892e9a

A URL path such as //v:h reaches urllib3 in a form that may be reparsed as a host and port, failing before the intended request can be sent. Repair HTTPAdapter.request_url so origin-form request targets have one leading slash. Keep internal slashes, escaped paths and query data unchanged. Preserve absolute-form URLs for HTTP forward proxies and do not mutate the PreparedRequest.

This is a real upstream Requests bug, packaged as a curated TraceHarness task rather than a SWE-bench benchmark claim. The runtime supplies Python 3.12 and the pinned Requests dependencies, including urllib3 2.x. No network service, dependency installation, model secret or external credential file is needed.

Run the public reproduction:

    PYTHONPATH=src python -m unittest discover -s public_tests -v

The independent grader first enforces the public edit contract in TRACEHARNESS_TASK_POLICY.json before importing candidate code, then runs four behavioral checks. In src/requests/adapters.py, add one guarded normalization immediately after url = request.path_url in HTTPAdapter.request_url. Preserve every existing module AST node and all other original files. Comments/formatting may change in the editable file; use UTF-8. New workspace files are excluded from grading.

The inserted statement must be one if block, with no else or additional statements. Its condition is one of `url.startswith("//")`, `url.startswith(("//",))`, `url[:2] == "//"`. Its single assignment is to `url`, using one of `"/" + url.lstrip("/")`, `f"/{url.lstrip('/')}"`, `"/{}".format(url.lstrip("/"))`.
