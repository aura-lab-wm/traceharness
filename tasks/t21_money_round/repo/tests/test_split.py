import unittest
from money import split_bill


class TestSplit(unittest.TestCase):
    def test_even(self):
        self.assertEqual(split_bill(100, 4), [25, 25, 25, 25])

    def test_single_person(self):
        self.assertEqual(split_bill(999, 1), [999])

    def test_adds_up(self):
        self.assertEqual(sum(split_bill(200, 3)), 200)


if __name__ == "__main__":
    unittest.main()
