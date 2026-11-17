# Requests: count UTF-8 bytes in upload Content-Length

Upstream issue: https://github.com/psf/requests/issues/6586
Upstream merged fix: https://github.com/psf/requests/pull/6589
Baseline revision: f6707042d8b18d2a3737380bf58ff020872fb07b

A string body containing multibyte Unicode is assigned a Content-Length based on its character count. Servers that obey that header can truncate the encoded upload. Repair body-length calculation so string data uses its UTF-8 byte count with urllib3 2.x, while preserving binary, file, iterator and ASCII behavior. Preserve the prepared body itself.

This is a real upstream Requests bug, packaged as a curated TraceHarness task rather than a SWE-bench benchmark claim. The runtime supplies Python 3.12 and the pinned Requests dependencies, including urllib3 2.x. No network service, dependency installation, model secret or external credential file is needed.

Run the public reproduction:

    PYTHONPATH=src python -m unittest discover -s public_tests -v

The independent grader first enforces the public edit contract in TRACEHARNESS_TASK_POLICY.json before importing candidate code, then runs four behavioral checks. In src/requests/utils.py, add one guarded conversion immediately after current_position = 0 in super_len(o). Preserve every existing module AST node and all other original files. Comments/formatting may change in the editable file; use UTF-8. New workspace files are excluded from grading.

The inserted statement must be one if block, with no else or additional statements. Its condition is one of `isinstance(o, str)`, `isinstance(o, (str,))`. Its single assignment is to `o`, using one of `o.encode()`, `o.encode("utf-8")`, `o.encode("utf8")`, `o.encode("UTF-8")`, `o.encode(encoding="utf-8")`, `o.encode("utf-8", "strict")`, `str.encode(o, "utf-8")`, `bytes(o, "utf-8")`.
