import unittest
from lru import LRUCache


class TestCache(unittest.TestCase):
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
        self.assertNotIn("a", c)
        self.assertEqual(c.keys(), ["b", "c"])

    def test_update_does_not_evict(self):
        c = LRUCache(2)
        c.put("a", 1)
        c.put("b", 2)
        c.put("b", 20)
        self.assertEqual(len(c), 2)
        self.assertEqual(c.get("b"), 20)


if __name__ == "__main__":
    unittest.main()
