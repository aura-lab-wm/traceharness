import unittest
from lru import LRUCache


class TestCacheHidden(unittest.TestCase):
    def test_put_get(self):
        c = LRUCache(2)
        c.put("a", 1)
        self.assertEqual(c.get("a"), 1)
        self.assertEqual(c.get("zzz", 7), 7)

    def test_evicts_oldest(self):
        c = LRUCache(2)
        c.put("a", 1)
        c.put("b", 2)
        c.put("c", 3)
        self.assertEqual(c.keys(), ["b", "c"])

    def test_get_refreshes_recency(self):
        c = LRUCache(2)
        c.put("a", 1)
        c.put("b", 2)
        self.assertEqual(c.get("a"), 1)
        c.put("c", 3)
        self.assertIn("a", c)
        self.assertNotIn("b", c)
        self.assertEqual(c.keys(), ["a", "c"])

    def test_get_moves_key_to_end(self):
        c = LRUCache(3)
        c.put("a", 1)
        c.put("b", 2)
        c.put("c", 3)
        c.get("a")
        self.assertEqual(c.keys(), ["b", "c", "a"])

    def test_put_existing_refreshes(self):
        c = LRUCache(2)
        c.put("a", 1)
        c.put("b", 2)
        c.put("a", 10)
        c.put("c", 3)
        self.assertEqual(c.keys(), ["a", "c"])
        self.assertEqual(c.get("a"), 10)

    def test_miss_leaves_cache_unchanged(self):
        c = LRUCache(2)
        c.put("a", 1)
        self.assertIsNone(c.get("nope"))
        self.assertEqual(len(c), 1)
        self.assertNotIn("nope", c)
        self.assertEqual(c.keys(), ["a"])

    def test_contains_is_not_a_use(self):
        c = LRUCache(2)
        c.put("a", 1)
        c.put("b", 2)
        self.assertIn("a", c)
        c.put("c", 3)
        self.assertNotIn("a", c)

    def test_capacity_one(self):
        c = LRUCache(1)
        c.put("a", 1)
        c.get("a")
        c.put("b", 2)
        self.assertEqual(c.keys(), ["b"])


if __name__ == "__main__":
    unittest.main()
