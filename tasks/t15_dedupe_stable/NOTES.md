Bug: with `key`, `latest[key(item)] = item` overwrites, so the last item of each key group is kept (key order is still first-seen).
Reference fix: `latest.setdefault(key(item), item)`.
Decoy iterates reversed and reverses the result: keeps first items but orders keys by last occurrence, so [("x",1),("y",2),("x",3)] comes out wrong.
Strong adds an O(n^2) brute force (seed 15), a check that `key` is called exactly once per item in order (shallow calls it twice), no mutation, unhashable items with a key.
Expected mistake: fixing the choice of item but breaking order, or re-evaluating `key` in a rewritten loop.
