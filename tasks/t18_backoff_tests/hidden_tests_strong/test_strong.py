import random
import unittest
from retry import delays


def brute(attempts, base, cap):
    return [min(base * 2 ** i, cap) for i in range(attempts)]


class TestBackoffStrong(unittest.TestCase):
    def test_random_against_brute(self):
        rng = random.Random(18)
        for _ in range(400):
            attempts = rng.randint(0, 14)
            base = rng.randint(1, 20)
            cap = rng.randint(1, 500)
            self.assertEqual(delays(attempts, base, cap), brute(attempts, base, cap), (attempts, base, cap))

    def test_monotone_and_bounded(self):
        rng = random.Random(180)
        for _ in range(100):
            base, cap = rng.randint(1, 9), rng.randint(1, 200)
            out = delays(20, base, cap)
            self.assertEqual(len(out), 20)
            self.assertEqual(out, sorted(out))
            self.assertLessEqual(max(out), cap)
            self.assertEqual(out[-1], cap)

    def test_length_matches_attempts(self):
        for n in range(0, 10):
            self.assertEqual(len(delays(n, 2, 5)), n)


if __name__ == "__main__":
    unittest.main()
