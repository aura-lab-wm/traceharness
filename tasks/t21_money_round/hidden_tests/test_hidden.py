import unittest
from money import split_bill


class TestSplitHidden(unittest.TestCase):
    def test_round_up_case(self):
        self.assertEqual(split_bill(200, 3), [67, 67, 66])

    def test_round_down_case(self):
        self.assertEqual(split_bill(100, 3), [34, 33, 33])

    def test_two_extra_cents(self):
        self.assertEqual(split_bill(10, 4), [3, 3, 2, 2])

    def test_three_extra_cents(self):
        self.assertEqual(split_bill(11, 4), [3, 3, 3, 2])

    def test_less_than_one_cent_each(self):
        self.assertEqual(split_bill(1, 5), [1, 0, 0, 0, 0])
        self.assertEqual(split_bill(0, 3), [0, 0, 0])

    def test_shares_differ_by_at_most_one(self):
        shares = split_bill(1007, 9)
        self.assertEqual(sum(shares), 1007)
        self.assertLessEqual(max(shares) - min(shares), 1)
        self.assertEqual(shares, sorted(shares, reverse=True))

    def test_invalid(self):
        with self.assertRaises(ValueError):
            split_bill(100, 0)
        with self.assertRaises(ValueError):
            split_bill(-1, 3)
        with self.assertRaises(TypeError):
            split_bill(10.5, 3)


if __name__ == "__main__":
    unittest.main()
