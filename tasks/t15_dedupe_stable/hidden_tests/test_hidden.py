import unittest
from uniq import dedupe


class TestDedupeHidden(unittest.TestCase):
    def test_no_key(self):
        self.assertEqual(dedupe([3, 1, 3, 2, 1]), [3, 1, 2])
        self.assertEqual(dedupe([3, 1, 3, 2, 1], key=None), [3, 1, 2])

    def test_key_keeps_first(self):
        self.assertEqual(dedupe(["a", "B", "A", "b"], key=str.lower), ["a", "B"])

    def test_key_first_seen_order(self):
        pairs = [("x", 1), ("y", 2), ("x", 3)]
        self.assertEqual(dedupe(pairs, key=lambda p: p[0]), [("x", 1), ("y", 2)])

    def test_key_by_first_letter(self):
        words = ["apple", "Avocado", "banana", "blueberry", "cherry"]
        self.assertEqual(dedupe(words, key=lambda w: w[0].lower()), ["apple", "banana", "cherry"])

    def test_key_without_duplicates(self):
        self.assertEqual(dedupe([4, 5, 6], key=lambda n: n * 2), [4, 5, 6])

    def test_generator_input(self):
        self.assertEqual(dedupe((n % 3 for n in range(7))), [0, 1, 2])
        self.assertEqual(dedupe((n for n in range(7)), key=lambda n: n % 3), [0, 1, 2])

    def test_empty_with_key(self):
        self.assertEqual(dedupe([], key=len), [])


if __name__ == "__main__":
    unittest.main()
