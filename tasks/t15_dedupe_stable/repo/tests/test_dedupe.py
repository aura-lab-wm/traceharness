import unittest
from uniq import dedupe


class TestDedupe(unittest.TestCase):
    def test_numbers(self):
        self.assertEqual(dedupe([3, 1, 3, 2, 1]), [3, 1, 2])

    def test_strings(self):
        self.assertEqual(dedupe(["b", "a", "b", "c", "a"]), ["b", "a", "c"])

    def test_empty(self):
        self.assertEqual(dedupe([]), [])

    def test_no_duplicates(self):
        self.assertEqual(dedupe([5, 4, 3]), [5, 4, 3])


if __name__ == "__main__":
    unittest.main()
