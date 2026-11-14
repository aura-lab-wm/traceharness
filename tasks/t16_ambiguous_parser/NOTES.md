Bug location: `parse_flag` (it lowercases without `strip()`, so "off " is not in the false set and blank text does not raise); `parse_flags` is correct.
Reference fix: `word = text.strip().lower()` in `parse_flag`.
Decoy strips each part in `parse_flags`: visible tests (which go through `parse_flags` for the spacing case) pass, but hidden tests call `parse_flag("off ")` directly and fail.
Strong adds leading/tab/newline whitespace, blank-kind ValueErrors and random noisy words/lists against an oracle (seeds 16, 17); the shallow variant strips only spaces.
Expected mistake: patching the caller (`parse_flags`) instead of the function that owns the whitespace contract, without checking the other entry point.
