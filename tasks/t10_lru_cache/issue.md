# Issue #34: cache throws away the hot key

We use `LRUCache(2)` for session lookups. After `put("a", 1)`, `put("b", 2)`,
`get("a")`, `put("c", 3)` I expected `"b"` to be dropped, since `"a"` was just read.
Instead `"a"` disappears and `"b"` stays. Reads do not seem to count as use.
The code is in `lru/cache.py`.
