import unittest, random
from uniq import dedupe


def brute(items, key):
    out = []
    for i, item in enumerate(items):
        k = key(item)
        if not any(key(items[j]) == k for j in range(i)):
            out.append(item)
    return out


class TestDedupeStrong(unittest.TestCase):
    def test_random_against_brute(self):
        rng = random.Random(15)
        for _ in range(300):
            items = [(rng.randint(0, 5), rng.randint(0, 99)) for _ in range(rng.randint(0, 14))]
            self.assertEqual(dedupe(items, key=lambda p: p[0]), brute(items, lambda p: p[0]), items)
            self.assertEqual(dedupe(items), brute(items, lambda p: p), items)
            self.assertEqual(dedupe(items, key=lambda p: p[1] % 4), brute(items, lambda p: p[1] % 4), items)

    def test_key_called_once_per_item_in_order(self):
        calls = []

        def key(n):
            calls.append(n)
            return n % 3

        items = [5, 3, 8, 4, 6, 1, 9]
        self.assertEqual(dedupe(items, key=key), [5, 3, 4])
        self.assertEqual(calls, items)

    def test_input_not_modified(self):
        items = [{"id": 1}, {"id": 2}, {"id": 1}]
        snapshot = list(items)
        out = dedupe(items, key=lambda d: d["id"])
        self.assertEqual(items, snapshot)
        self.assertIs(out[0], items[0])
        self.assertIsNot(out, items)

    def test_unhashable_items_with_key(self):
        rows = [{"id": 2, "v": "a"}, {"id": 1, "v": "b"}, {"id": 2, "v": "c"}]
        self.assertEqual(dedupe(rows, key=lambda d: d["id"]), rows[:2])


if __name__ == "__main__":
    unittest.main()
