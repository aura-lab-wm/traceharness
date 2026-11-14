import unittest
from flags import parse_flag, parse_flags


class TestFlagsHidden(unittest.TestCase):
    def test_words(self):
        for word in ["1", "true", "YES", "on", "enabled"]:
            self.assertTrue(parse_flag(word), word)
        for word in ["0", "False", "NO", "off"]:
            self.assertFalse(parse_flag(word), word)

    def test_trailing_space(self):
        self.assertFalse(parse_flag("off "))
        self.assertFalse(parse_flag("No  "))
        self.assertTrue(parse_flag("on "))

    def test_blank_is_error(self):
        for bad in ["", "   "]:
            with self.assertRaises(ValueError):
                parse_flag(bad)

    def test_list(self):
        self.assertEqual(parse_flags("on, off ,yes"), [True, False, True])
        self.assertEqual(parse_flags("OFF ,0, true"), [False, False, True])

    def test_list_skips_blank_items(self):
        self.assertEqual(parse_flags(""), [])
        self.assertEqual(parse_flags(" , "), [])
        self.assertEqual(parse_flags("on,,off"), [True, False])


if __name__ == "__main__":
    unittest.main()
