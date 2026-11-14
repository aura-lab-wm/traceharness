Bug: the duplicate test uses `<=` so an event exactly one window later is still suppressed, and expired keys are never removed from the table.
Fix: purge entries with `now - t >= window` on each call and treat a key as duplicate only if still present.
Decoy: fixes the boundary with `<` but refreshes the timestamp on every sighting (sliding window); passes visible, fails the "duplicates do not extend the window" hidden test.
Shallow: only changes `<=` to `<`; passes hidden, strong checks len() against an oracle and that the table stays bounded.
Expected weak-agent mistake: fixing only the visible boundary symptom and ignoring the memory growth mentioned in the issue.
