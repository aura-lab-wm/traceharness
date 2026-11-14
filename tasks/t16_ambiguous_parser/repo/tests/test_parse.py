import unittest
from flags import parse_flag, parse_flags


class TestFlags(unittest.TestCase):
    def test_words(self):
        self.assertTrue(parse_flag("on"))
        self.assertTrue(parse_flag("YES"))
        self.assertFalse(parse_flag("off"))
        self.assertFalse(parse_flag("False"))

    def test_list(self):
        self.assertEqual(parse_flags("on,off,yes"), [True, False, True])

    def test_list_with_spaces(self):
        self.assertEqual(parse_flags("on, off ,yes"), [True, False, True])


if __name__ == "__main__":
    unittest.main()
