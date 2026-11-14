# Issue #21: `dedupe(..., key=...)` returns the later duplicate

`dedupe(["a", "B", "A", "b"], key=str.lower)` returns `["A", "b"]`. We expected
`["a", "B"]`, the first item seen for each key, in the order they were first seen.
Without `key` everything is fine.
