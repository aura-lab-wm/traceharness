# Requests: ignore malformed Content-Type parameters

Upstream issue: https://github.com/psf/requests/issues/6646
Upstream merged fix: https://github.com/psf/requests/pull/7309
Baseline revision: bc7dd0fc4d56e808bcdd85ac2d797b3107c89259

An HTTP Content-Type parameter without an equals sign is incorrectly stored as boolean True. A header such as text/plain; charset then crashes encoding selection with AttributeError. Ignore malformed flag parameters while preserving valid charset values, quoted values, case-insensitive parameter names, duplicate ordering and established content-type fallbacks.

This is a real upstream issue packaged as a curated TraceHarness repair task, not a general benchmark or unrestricted repository-editing claim. Python 3.12 and the existing pinned dependencies suffice. All checks operate offline; no service, TLS connection, model key or credential file is needed. Both public and hidden checks verify that the imported package lives inside this exact candidate checkout.

Run the public reproduction:

    PYTHONPATH=src python -m unittest discover -s public_tests -v

The independent grader enforces TRACEHARNESS_TASK_POLICY.json before importing candidate code, then runs four behavioral checks. Preserve all original files except the one documented editable module; comments and formatting in that module may change, but unrelated AST changes are rejected. New workspace files are excluded from grading.

Public edit contract: Only _parse_content_type_header may change. Preserve its module, function signature, tokenization, content type, parameter dictionary and return. Permitted repairs: (1) keep the original loop and replace its outer `if param` guard with `if param and "=" in param`, `if "=" in param`, or `if param and param.find("=") != -1`; or (2) strip each parameter and put the existing key/value slicing plus dictionary assignment inside a guard that requires both a nonempty parameter and find("=") != -1, using either a walrus condition or nested if blocks. A third permitted loop form strips each parameter, uses `if param and param.find("=") != -1:`, then assigns `index_of_equals = param.find("=")` (or the same assignment to idx) before the original key/value slices and dictionary update. This exact form removes the dead `key, value = param, True` initialization and the redundant inner conditional; no other statements are added. The index variable may be idx or index_of_equals; the quote-stripping variable may be items_to_strip or strip_chars. Existing quote-stripping literal, key.lower(), slicing and dictionary update must remain. The two punctuation additions in the upstream function docstring are optional; no other docstring rewrites or executable changes are allowed.
