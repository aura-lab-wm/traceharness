import random
import unittest
from versions import compare


def oracle(a, b):
    """Independent semantic-version ordering via sort keys."""
    def key(v):
        release, dash, tag = v.strip().partition("-")
        nums = [int(p) for p in release.split(".")]
        while len(nums) < 5:
            nums.append(0)
        if not dash:
            return (nums, 1, [])
        ids = [(0, int(i), "") if i.isdigit() else (1, 0, i) for i in tag.split(".")]
        return (nums, 0, ids)
    ka, kb = key(a), key(b)
    return (ka > kb) - (ka < kb)


def random_version(rng):
    release = ".".join(str(rng.choice([0, 1, 2, 9, 10, 11, 99, 100]))
                       for _ in range(rng.randint(1, 4)))
    if rng.random() < 0.5:
        return release
    ids = [rng.choice(["0", "1", "2", "9", "10", "20", "alpha", "beta", "rc", "x-1", "Z"])
           for _ in range(rng.randint(1, 3))]
    return release + "-" + ".".join(ids)


class TestCompareStrong(unittest.TestCase):
    def test_numeric_prerelease_identifiers(self):
        self.assertEqual(compare("1.0.0-rc.2", "1.0.0-rc.10"), -1)
        self.assertEqual(compare("1.0.0-rc.10", "1.0.0-rc.2"), 1)

    def test_numeric_identifier_before_alphanumeric(self):
        self.assertEqual(compare("1.0.0-1", "1.0.0-alpha"), -1)
        self.assertEqual(compare("1.0.0-99", "1.0.0-a"), -1)
        self.assertEqual(compare("1.0.0-alpha", "1.0.0-alpha.1"), -1)

    def test_antisymmetry_and_reflexivity(self):
        rng = random.Random(7)
        for _ in range(200):
            a, b = random_version(rng), random_version(rng)
            self.assertEqual(compare(a, a), 0)
            self.assertEqual(compare(a, b), -compare(b, a), (a, b))

    def test_random_against_oracle(self):
        rng = random.Random(20251)
        for _ in range(500):
            a, b = random_version(rng), random_version(rng)
            self.assertEqual(compare(a, b), oracle(a, b), (a, b))


if __name__ == "__main__":
    unittest.main()
