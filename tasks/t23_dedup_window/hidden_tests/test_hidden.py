import unittest
from events import Deduper


class TestDeduperHidden(unittest.TestCase):
    def test_boundary_is_new(self):
        d = Deduper(10)
        self.assertFalse(d.seen("a", 100))
        self.assertTrue(d.seen("a", 109))
        self.assertFalse(d.seen("a", 110))

    def test_just_inside_and_outside(self):
        d = Deduper(5)
        d.seen("k", 0)
        self.assertTrue(d.seen("k", 4.999))
        d2 = Deduper(5)
        d2.seen("k", 0)
        self.assertFalse(d2.seen("k", 5.001))

    def test_duplicates_do_not_extend_window(self):
        d = Deduper(10)
        self.assertFalse(d.seen("a", 0))
        self.assertTrue(d.seen("a", 6))
        self.assertFalse(d.seen("a", 12))

    def test_new_sighting_starts_fresh_window(self):
        d = Deduper(10)
        d.seen("a", 0)
        self.assertFalse(d.seen("a", 10))
        self.assertTrue(d.seen("a", 19))
        self.assertFalse(d.seen("a", 20))

    def test_keys_are_independent(self):
        d = Deduper(10)
        self.assertFalse(d.seen("a", 0))
        self.assertFalse(d.seen("b", 1))
        self.assertTrue(d.seen("a", 2))
        self.assertFalse(d.seen(("x", 1), 2))
        self.assertTrue(d.seen(("x", 1), 3))

    def test_invalid_window(self):
        for bad in (0, -3):
            with self.assertRaises(ValueError):
                Deduper(bad)


if __name__ == "__main__":
    unittest.main()
