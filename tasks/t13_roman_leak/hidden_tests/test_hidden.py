import unittest
from roman import to_int


class TestRomanHidden(unittest.TestCase):
    def test_additive(self):
        self.assertEqual(to_int("III"), 3)
        self.assertEqual(to_int("MMXX"), 2020)

    def test_single_pairs(self):
        self.assertEqual(to_int("IV"), 4)
        self.assertEqual(to_int("IX"), 9)
        self.assertEqual(to_int("XL"), 40)
        self.assertEqual(to_int("XC"), 90)

    def test_pair_inside_numeral(self):
        self.assertEqual(to_int("XIV"), 14)
        self.assertEqual(to_int("XLII"), 42)
        self.assertEqual(to_int("MMXXIV"), 2024)

    def test_case_and_whitespace(self):
        self.assertEqual(to_int("xiv"), 14)
        self.assertEqual(to_int(" IX\n"), 9)

    def test_not_canonical(self):
        self.assertEqual(to_int("IIII"), 4)

    def test_invalid(self):
        for bad in ["", "   ", "ABC", "IV5", "X V"]:
            with self.assertRaises(ValueError):
                to_int(bad)


if __name__ == "__main__":
    unittest.main()
