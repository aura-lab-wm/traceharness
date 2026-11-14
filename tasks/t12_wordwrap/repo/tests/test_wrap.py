import unittest
from wrapper import wrap


class TestWrap(unittest.TestCase):
    def test_simple(self):
        self.assertEqual(wrap("the quick brown fox", 10), ["the quick", "brown fox"])

    def test_line_exactly_fills_width(self):
        self.assertEqual(wrap("aaa bbb", 7), ["aaa bbb"])
        self.assertEqual(wrap("aaa bbb ccc", 7), ["aaa bbb", "ccc"])

    def test_long_word_is_split(self):
        self.assertEqual(wrap("abcdefghij", 4), ["abcd", "efgh", "ij"])


if __name__ == "__main__":
    unittest.main()
