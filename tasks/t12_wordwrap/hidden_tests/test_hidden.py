import unittest
from wrapper import wrap


class TestWrapHidden(unittest.TestCase):
    def test_simple(self):
        self.assertEqual(wrap("the quick brown fox", 10), ["the quick", "brown fox"])

    def test_line_exactly_fills_width(self):
        self.assertEqual(wrap("aaa bbb", 7), ["aaa bbb"])
        self.assertEqual(wrap("aaa bbb ccc", 7), ["aaa bbb", "ccc"])

    def test_one_char_over_wraps(self):
        self.assertEqual(wrap("aaa bbb", 6), ["aaa", "bbb"])

    def test_word_exactly_width(self):
        self.assertEqual(wrap("abcd", 4), ["abcd"])
        self.assertEqual(wrap("ab abcd ef", 4), ["ab", "abcd", "ef"])

    def test_long_word_is_split(self):
        self.assertEqual(wrap("abcdefghij", 4), ["abcd", "efgh", "ij"])
        self.assertEqual(wrap("abcdefgh", 4), ["abcd", "efgh"])

    def test_long_word_starts_new_line(self):
        self.assertEqual(wrap("hi abcdefghij", 4), ["hi", "abcd", "efgh", "ij"])

    def test_whitespace_runs_collapse(self):
        self.assertEqual(wrap("  a \t b\n\nc  ", 5), ["a b c"])

    def test_empty_and_invalid(self):
        self.assertEqual(wrap("", 5), [])
        self.assertEqual(wrap("   \n ", 5), [])
        with self.assertRaises(ValueError):
            wrap("abc", 0)


if __name__ == "__main__":
    unittest.main()
