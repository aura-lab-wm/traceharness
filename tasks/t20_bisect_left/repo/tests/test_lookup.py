import unittest
from search import first_index, count


class TestLookup(unittest.TestCase):
    def test_found(self):
        data = [1, 3, 5, 7, 9, 11]
        self.assertEqual(first_index(data, 1), 0)
        self.assertEqual(first_index(data, 7), 3)
        self.assertEqual(first_index(data, 11), 5)

    def test_missing(self):
        self.assertEqual(first_index([1, 3, 5], 4), -1)
        self.assertEqual(first_index([], 4), -1)

    def test_count_distinct(self):
        self.assertEqual(count([1, 3, 5], 3), 1)
        self.assertEqual(count([1, 3, 5], 2), 0)


if __name__ == "__main__":
    unittest.main()
