import unittest
from inifile import parse


class TestParse(unittest.TestCase):
    def test_sections_and_keys(self):
        text = "[a]\nx = 1\ny = two\n[b]\nz = 3\n"
        self.assertEqual(parse(text), {"a": {"x": "1", "y": "two"}, "b": {"z": "3"}})

    def test_comments_and_blank_lines(self):
        text = "# top\n\n[a]\n; note\nx = 1\n\n   # indented\n"
        self.assertEqual(parse(text), {"a": {"x": "1"}})

    def test_errors(self):
        with self.assertRaises(ValueError):
            parse("x = 1\n")
        with self.assertRaises(ValueError):
            parse("[a]\njust words\n")


if __name__ == "__main__":
    unittest.main()
