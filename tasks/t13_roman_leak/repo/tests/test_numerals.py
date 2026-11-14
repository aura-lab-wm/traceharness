import unittest
from roman import to_int


class TestRoman(unittest.TestCase):
    def test_additive(self):
        self.assertEqual(to_int("III"), 3)
        self.assertEqual(to_int("VIII"), 8)
        self.assertEqual(to_int("MMXX"), 2020)

    def test_subtractive(self):
        self.assertEqual(to_int("IV"), 4)
        self.assertEqual(to_int("IX"), 9)

    def test_invalid(self):
        with self.assertRaises(ValueError):
            to_int("ABC")


if __name__ == "__main__":
    unittest.main()
