import random
import unittest
from lru import LRUCache


class Model:
    """Straightforward list-based LRU used as the oracle."""

    def __init__(self, capacity):
        self.capacity = capacity
        self.order = []  # (key, value) pairs, oldest first

    def get(self, key, default=None):
        for i, (k, v) in enumerate(self.order):
            if k == key:
                self.order.append(self.order.pop(i))
                return v
        return default

    def put(self, key, value):
        for i, (k, _) in enumerate(self.order):
            if k == key:
                self.order.pop(i)
                break
        else:
            if len(self.order) == self.capacity:
                self.order.pop(0)
        self.order.append((key, value))


class TestCacheStrong(unittest.TestCase):
    def test_read_middle_key_protects_it(self):
        c = LRUCache(3)
        for k in "abc":
            c.put(k, k.upper())
        self.assertEqual(c.get("b"), "B")
        c.put("d", "D")
        self.assertEqual(c.keys(), ["c", "b", "d"])
        c.put("e", "E")
        self.assertEqual(c.keys(), ["b", "d", "e"])

    def test_random_against_model(self):
        rng = random.Random(20240601)
        for _ in range(60):
            cap = rng.randint(1, 5)
            cache, model = LRUCache(cap), Model(cap)
            for step in range(120):
                key = rng.choice("abcdefgh")
                if rng.random() < 0.5:
                    self.assertEqual(cache.get(key, -1), model.get(key, -1), (cap, step))
                else:
                    val = rng.randint(0, 9)
                    cache.put(key, val)
                    model.put(key, val)
                self.assertEqual(cache.keys(), [k for k, _ in model.order], (cap, step))
                self.assertLessEqual(len(cache), cap)
                self.assertEqual(len(cache), len(model.order))

    def test_invalid_capacity(self):
        for bad in (0, -2):
            with self.assertRaises(ValueError):
                LRUCache(bad)

    def test_falsy_values_are_hits(self):
        c = LRUCache(2)
        c.put("a", 0)
        c.put("b", None)
        self.assertEqual(c.get("a", "miss"), 0)
        c.put("c", 1)
        self.assertIn("a", c)
        self.assertNotIn("b", c)


if __name__ == "__main__":
    unittest.main()
