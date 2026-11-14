"""A small least-recently-used cache."""


class LRUCache:
    """Cache holding at most `capacity` entries.

    Both get() (on a hit) and put() count as a use of the key. When a new key
    is added to a full cache, the least recently used key is evicted first.
    Updating the value of an existing key never evicts anything.
    """

    def __init__(self, capacity):
        if capacity < 1:
            raise ValueError("capacity must be at least 1")
        self.capacity = capacity
        self._data = {}  # insertion order is recency order, oldest first

    def get(self, key, default=None):
        """Return the value for key and mark it most recently used.

        A miss returns `default` and leaves the cache unchanged.
        """
        if key not in self._data:
            return default
        return self._data[key]

    def put(self, key, value):
        """Store value under key and mark key most recently used."""
        if key in self._data:
            del self._data[key]
        elif len(self._data) >= self.capacity:
            oldest = next(iter(self._data))
            del self._data[oldest]
        self._data[key] = value

    def keys(self):
        """Return the keys as a list, least recently used first."""
        return list(self._data)

    def __contains__(self, key):
        """Membership test; it does not count as a use."""
        return key in self._data

    def __len__(self):
        return len(self._data)
