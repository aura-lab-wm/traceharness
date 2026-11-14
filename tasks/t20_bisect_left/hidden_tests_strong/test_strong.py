import random
import unittest
from collections.abc import Sequence
from search import first_index, count


class Counting(Sequence):
    """Read-only sequence that counts element accesses."""

    def __init__(self, data):
        self._data = list(data)
        self.reads = 0

    def __len__(self):
        return len(self._data)

    def __getitem__(self, i):
        self.reads += 1
        return self._data[i]


class TestLookupStrong(unittest.TestCase):
    def test_random_against_brute(self):
        rng = random.Random(20)
        for _ in range(400):
            data = sorted(rng.randint(0, 8) for _ in range(rng.randint(0, 25)))
            snapshot = list(data)
            for target in range(-1, 10):
                hits = [i for i, v in enumerate(data) if v == target]
                self.assertEqual(first_index(data, target), hits[0] if hits else -1, (data, target))
                self.assertEqual(count(data, target), len(hits), (data, target))
            self.assertEqual(data, snapshot)

    def test_logarithmic_reads(self):
        data = Counting([0] * 5000 + [1] * 5000 + [2] * 5000)
        for target, expected in [(0, 0), (1, 5000), (2, 10000), (3, -1), (-1, -1)]:
            data.reads = 0
            self.assertEqual(first_index(data, target), expected)
            self.assertLess(data.reads, 60, (target, data.reads))

    def test_works_on_tuples_and_ranges(self):
        self.assertEqual(first_index((1, 2, 2, 2, 2, 2, 2, 3), 2), 1)
        self.assertEqual(first_index(range(0, 100, 5), 35), 7)
        self.assertEqual(first_index(range(0, 100, 5), 36), -1)


if __name__ == "__main__":
    unittest.main()
