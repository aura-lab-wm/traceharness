import unittest
from isodate import days_between


class TestDaysBetween(unittest.TestCase):
    def test_same_month(self):
        self.assertEqual(days_between("2024-01-10", "2024-01-25"), 15)

    def test_leap_february(self):
        self.assertEqual(days_between("2024-02-28", "2024-03-01"), 2)

    def test_century_february(self):
        self.assertEqual(days_between("1900-02-28", "1900-03-01"), 1)


if __name__ == "__main__":
    unittest.main()
