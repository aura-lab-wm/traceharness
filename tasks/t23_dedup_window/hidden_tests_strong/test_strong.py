import random
import unittest
from events import Deduper


class Oracle:
    def __init__(self, window):
        self.window = window
        self.accepted = {}

    def seen(self, key, now):
        if key in self.accepted and now - self.accepted[key] < self.window:
            return True
        self.accepted[key] = now
        return False

    def open_keys(self, now):
        return sum(1 for t in self.accepted.values() if now - t < self.window)


class TestDeduperStrong(unittest.TestCase):
    def test_random_stream_against_oracle(self):
        rng = random.Random(23)
        for window in (1, 3, 10, 2.5):
            d, o = Deduper(window), Oracle(window)
            now = 0
            for _ in range(500):
                now += rng.choice([0, 0, 1, 1, 2, window, window, window + 1])
                key = rng.choice("abcdefgh")
                self.assertEqual(d.seen(key, now), o.seen(key, now), (window, now, key))
                self.assertEqual(len(d), o.open_keys(now), (window, now))

    def test_expired_keys_are_forgotten(self):
        d = Deduper(10)
        for i in range(1000):
            d.seen(("user", i), i)
            self.assertLessEqual(len(d), 10)
        self.assertEqual(len(d), 10)
        d.seen("late", 5000)
        self.assertEqual(len(d), 1)

    def test_table_holds_only_open_windows(self):
        d = Deduper(4)
        d.seen("a", 0)
        d.seen("b", 3)
        self.assertEqual(len(d), 2)
        d.seen("c", 4)
        self.assertEqual(len(d), 2)
        d.seen("d", 7)
        self.assertEqual(len(d), 2)


if __name__ == "__main__":
    unittest.main()
