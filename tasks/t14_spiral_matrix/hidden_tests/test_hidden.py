import unittest
from grid import spiral


class TestSpiralHidden(unittest.TestCase):
    def test_square(self):
        self.assertEqual(spiral([[1, 2], [3, 4]]), [1, 2, 4, 3])
        self.assertEqual(spiral([[7]]), [7])

    def test_single_row(self):
        self.assertEqual(spiral([[1, 2, 3]]), [1, 2, 3])

    def test_single_column(self):
        self.assertEqual(spiral([[1], [2], [3]]), [1, 2, 3])

    def test_wide(self):
        m = [[1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12]]
        self.assertEqual(spiral(m), [1, 2, 3, 4, 8, 12, 11, 10, 9, 5, 6, 7])

    def test_tall(self):
        m = [[1, 2, 3], [4, 5, 6], [7, 8, 9], [10, 11, 12]]
        self.assertEqual(spiral(m), [1, 2, 3, 6, 9, 12, 11, 10, 7, 4, 5, 8])

    def test_two_rows(self):
        m = [[1, 2, 3, 4, 5], [6, 7, 8, 9, 10]]
        self.assertEqual(spiral(m), [1, 2, 3, 4, 5, 10, 9, 8, 7, 6])

    def test_middle_row_left_over(self):
        m = [[1, 2, 3, 4, 5], [6, 7, 8, 9, 10], [11, 12, 13, 14, 15]]
        self.assertEqual(spiral(m), [1, 2, 3, 4, 5, 10, 15, 14, 13, 12, 11, 6, 7, 8, 9])

    def test_empty(self):
        self.assertEqual(spiral([]), [])
        self.assertEqual(spiral([[]]), [])


if __name__ == "__main__":
    unittest.main()
