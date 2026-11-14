import random
import unittest
from money import split_bill


def brute(total, people):
    shares = [0] * people
    for i in range(total):
        shares[i % people] += 1
    return shares


class TestSplitStrong(unittest.TestCase):
    def test_random_against_brute(self):
        rng = random.Random(21)
        for _ in range(400):
            total = rng.randint(0, 600)
            people = rng.randint(1, 15)
            self.assertEqual(split_bill(total, people), brute(total, people), (total, people))

    def test_huge_amounts_are_exact(self):
        for total, people in [(2 ** 80 + 5, 3), (10 ** 21 + 13, 7), (2 ** 64 - 1, 1000), (10 ** 30, 9)]:
            shares = split_bill(total, people)
            base, rem = divmod(total, people)
            self.assertEqual(shares, [base + 1] * rem + [base] * (people - rem))
            self.assertEqual(sum(shares), total)

    def test_results_are_ints(self):
        for share in split_bill(1001, 7):
            self.assertIs(type(share), int)


if __name__ == "__main__":
    unittest.main()
