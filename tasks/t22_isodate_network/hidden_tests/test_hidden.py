import unittest
from isodate import days_between, is_leap


class TestDaysBetweenHidden(unittest.TestCase):
    def test_1900_not_leap(self):
        self.assertEqual(days_between("1900-02-28", "1900-03-01"), 1)
        self.assertEqual(days_between("1900-01-01", "1901-01-01"), 365)

    def test_2100_not_leap(self):
        self.assertEqual(days_between("2100-02-28", "2100-03-01"), 1)
        self.assertEqual(days_between("2100-01-01", "2101-01-01"), 365)

    def test_2000_is_leap(self):
        self.assertEqual(days_between("2000-02-28", "2000-03-01"), 2)
        self.assertEqual(days_between("2000-01-01", "2001-01-01"), 366)
        self.assertEqual(days_between("2000-02-29", "2000-03-01"), 1)

    def test_span_over_1900(self):
        self.assertEqual(days_between("1897-03-01", "1901-03-01"), 1460)
        self.assertEqual(days_between("1900-01-01", "2000-01-01"), 36524)

    def test_order_and_zero(self):
        self.assertEqual(days_between("1900-03-01", "1900-02-28"), -1)
        self.assertEqual(days_between("2023-05-05", "2023-05-05"), 0)

    def test_is_leap(self):
        for year in (1996, 2000, 2024):
            self.assertTrue(is_leap(year), year)
        for year in (1900, 2100, 2023):
            self.assertFalse(is_leap(year), year)

    def test_nonexistent_dates(self):
        for bad in ("1900-02-29", "2100-02-29", "2023-02-29", "2023-13-01", "2023-04-31"):
            with self.assertRaises(ValueError):
                days_between(bad, "2024-01-01")


if __name__ == "__main__":
    unittest.main()
