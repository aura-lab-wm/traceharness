Bug: get() returns the value without moving the key to the most recent end.
Fix: self._data[key] = self._data.pop(key) before returning in get().
Decoy: one-liner self._data[key] = self._data.pop(key, default), which inserts the default on a miss (cache grows past capacity, phantom keys).
Strong adds: random get/put sequences against a list-based model, middle-key reads at capacity 3, falsy values, capacity validation. Shallow refreshes only when the read key is already the oldest.
Weak agent mistake: touching recency only in the easy case, or letting a miss mutate the cache.
