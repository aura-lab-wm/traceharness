import unittest
from retry import delays


class TestBackoffHidden(unittest.TestCase):
    def test_cap_reached(self):
        self.assertEqual(delays(6, 1, 10), [1, 2, 4, 8, 10, 10])

    def test_cap_equal_to_a_step(self):
        self.assertEqual(delays(5, 1, 8), [1, 2, 4, 8, 8])

    def test_base_above_cap(self):
        self.assertEqual(delays(3, 10, 5), [5, 5, 5])

    def test_base_equals_cap(self):
        self.assertEqual(delays(3, 4, 4), [4, 4, 4])

    def test_never_exceeds_cap(self):
        self.assertTrue(all(d <= 30 for d in delays(12, 3, 30)))

    def test_float_base(self):
        self.assertEqual(delays(5, 0.5, 3), [0.5, 1.0, 2.0, 3, 3])

    def test_invalid_arguments(self):
        for args in [(-1, 1, 10), (3, 0, 10), (3, 1, 0), (3, -2, 10)]:
            with self.assertRaises(ValueError):
                delays(*args)


if __name__ == "__main__":
    unittest.main()
