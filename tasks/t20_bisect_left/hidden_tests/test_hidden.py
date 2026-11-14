import unittest
from search import first_index, count


class TestLookupHidden(unittest.TestCase):
    def test_run_in_the_middle(self):
        self.assertEqual(first_index([1, 2, 2, 2, 2, 2, 3], 2), 1)

    def test_all_equal(self):
        self.assertEqual(first_index([4] * 7, 4), 0)
        self.assertEqual(first_index([4] * 8, 4), 0)

    def test_run_at_the_start_and_end(self):
        self.assertEqual(first_index([0, 0, 0, 0, 0, 1, 2], 0), 0)
        self.assertEqual(first_index([1, 2, 3, 9, 9, 9, 9], 9), 3)

    def test_two_equal_values(self):
        self.assertEqual(first_index([5, 5], 5), 0)

    def test_single_element(self):
        self.assertEqual(first_index([5], 5), 0)
        self.assertEqual(first_index([5], 6), -1)

    def test_absent_around_duplicates(self):
        data = [2, 2, 4, 4, 4, 6]
        self.assertEqual(first_index(data, 1), -1)
        self.assertEqual(first_index(data, 5), -1)
        self.assertEqual(first_index(data, 7), -1)

    def test_count_with_runs(self):
        self.assertEqual(count([1, 2, 2, 2, 2, 2, 3], 2), 5)
        self.assertEqual(count([7] * 9, 7), 9)
        self.assertEqual(count([1, 1, 2], 3), 0)

    def test_strings(self):
        self.assertEqual(first_index(["a", "b", "b", "b", "b", "c"], "b"), 1)


if __name__ == "__main__":
    unittest.main()
