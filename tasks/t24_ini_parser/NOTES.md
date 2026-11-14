Bug: `line.split("=")` keeps only the second piece and the value is additionally cut at `#`, so values with `=` or `#` are truncated; visible tests use simple values only.
Fix: `key, sep, value = line.partition("=")` and no inline-comment handling.
Decoy: `split("=", 1)` but still strips at `#`; passes visible, fails hidden (`color = #ff8800`).
Shallow: fixes the value but tests `"=" in line` before the section-header check, so `[a=b]` breaks; strong adds a random document round-trip (CRLF, padding, comments, `=#;[]` in values and section names).
Expected weak-agent mistake: fixing `=` but leaving the `#` strip, or treating `;` / `#` as inline comments.
