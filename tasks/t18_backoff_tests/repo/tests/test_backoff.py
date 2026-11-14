import unittest
from retry import delays


class TestBackoff(unittest.TestCase):
    def test_no_cap_needed(self):
        self.assertEqual(delays(4, 1, 100), [1, 2, 4, 8])

    def test_cap_reached(self):
        self.assertEqual(delays(6, 1, 10), [1, 2, 4, 8, 10, 10])

    def test_zero_attempts(self):
        self.assertEqual(delays(0, 1, 10), [])


if __name__ == "__main__":
    unittest.main()
