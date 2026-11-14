import unittest
from events import Deduper


class TestDeduper(unittest.TestCase):
    def test_first_sighting_is_new(self):
        self.assertFalse(Deduper(10).seen("a", 0))

    def test_repeat_inside_window(self):
        d = Deduper(10)
        d.seen("a", 0)
        self.assertTrue(d.seen("a", 4))

    def test_exactly_one_window_later_is_new(self):
        d = Deduper(10)
        d.seen("a", 0)
        self.assertFalse(d.seen("a", 10))


if __name__ == "__main__":
    unittest.main()
