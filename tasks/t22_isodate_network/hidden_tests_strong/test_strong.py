import random
import unittest
from isodate import days_between, is_leap


def leap(y):
    return (y % 4 == 0 and y % 100 != 0) or y % 400 == 0


def step(y, m, d):
    """Next calendar day, counted by hand."""
    dim = [31, 29 if leap(y) else 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]
    if d < dim:
        return y, m, d + 1
    if m < 12:
        return y, m + 1, 1
    return y + 1, 1, 1


def fmt(y, m, d):
    return "%04d-%02d-%02d" % (y, m, d)


class TestDaysBetweenStrong(unittest.TestCase):
    def test_random_against_day_counter(self):
        rng = random.Random(22)
        for _ in range(300):
            y = rng.randint(1850, 2150)
            m = rng.randint(1, 12)
            d = rng.randint(1, 28)
            start = (y, m, d)
            cur = start
            span = rng.randint(0, 800)
            for _ in range(span):
                cur = step(*cur)
            a, b = fmt(*start), fmt(*cur)
            self.assertEqual(days_between(a, b), span, (a, b))
            self.assertEqual(days_between(b, a), -span, (b, a))

    def test_400_year_cycles(self):
        self.assertEqual(days_between("1600-01-01", "2000-01-01"), 146097)
        self.assertEqual(days_between("2000-01-01", "2400-01-01"), 146097)
        self.assertEqual(days_between("2400-02-28", "2400-03-01"), 2)
        self.assertEqual(days_between("1600-02-28", "1600-03-01"), 2)
        self.assertEqual(days_between("0001-01-01", "9999-12-31"), 3652058)

    def test_is_leap_matches_rule(self):
        for y in range(1, 2600):
            self.assertEqual(is_leap(y), leap(y), y)

    def test_malformed_input(self):
        for bad in ("", "2023-1-01", "20230101", "2023-01-01 ", "abcd-01-01", "0000-01-01", "2023-00-10", "2023-01-1x"):
            with self.assertRaises(ValueError, msg=bad):
                days_between(bad, "2023-01-01")
            with self.assertRaises(ValueError, msg=bad):
                days_between("2023-01-01", bad)


if __name__ == "__main__":
    unittest.main()
