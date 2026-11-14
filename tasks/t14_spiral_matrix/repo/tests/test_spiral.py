import unittest
from grid import spiral


class TestSpiral(unittest.TestCase):
    def test_two_by_two(self):
        self.assertEqual(spiral([[1, 2], [3, 4]]), [1, 2, 4, 3])

    def test_three_by_three(self):
        m = [[1, 2, 3], [4, 5, 6], [7, 8, 9]]
        self.assertEqual(spiral(m), [1, 2, 3, 6, 9, 8, 7, 4, 5])

    def test_four_by_four(self):
        m = [[1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16]]
        self.assertEqual(spiral(m), [1, 2, 3, 4, 8, 12, 16, 15, 14, 13, 9, 5, 6, 7, 11, 10])


if __name__ == "__main__":
    unittest.main()
