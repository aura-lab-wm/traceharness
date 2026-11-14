import unittest
from inifile import parse


class TestParseHidden(unittest.TestCase):
    def test_value_with_equals(self):
        self.assertEqual(parse("[s]\nurl = http://h/?a=1&b=2\n"), {"s": {"url": "http://h/?a=1&b=2"}})
        self.assertEqual(parse("[s]\nx = a = b = c\n"), {"s": {"x": "a = b = c"}})

    def test_value_with_hash(self):
        self.assertEqual(parse("[s]\ncolor = #ff8800\n"), {"s": {"color": "#ff8800"}})
        self.assertEqual(parse("[s]\nnote = a # b\n"), {"s": {"note": "a # b"}})

    def test_value_with_semicolon(self):
        self.assertEqual(parse("[s]\npath = a;b;c\n"), {"s": {"path": "a;b;c"}})

    def test_empty_value(self):
        self.assertEqual(parse("[s]\nk =\nj = \n"), {"s": {"k": "", "j": ""}})

    def test_whitespace_trimmed(self):
        self.assertEqual(parse("[ s ]\n  k  =   v w   \n"), {"s": {"k": "v w"}})

    def test_repeated_key_and_section(self):
        text = "[a]\nx = 1\n[b]\ny = 2\n[a]\nx = 3\nz = 4\n"
        self.assertEqual(parse(text), {"a": {"x": "3", "z": "4"}, "b": {"y": "2"}})

    def test_comment_lines_only_at_line_start(self):
        text = "[s]\n# skip = me\n  ; and = me\nk = v\n"
        self.assertEqual(parse(text), {"s": {"k": "v"}})

    def test_errors(self):
        for bad in ("[s]\n= v\n", "[]\nk = v\n", "[s]\nnoequals\n", "k = v\n[s]\n"):
            with self.assertRaises(ValueError, msg=bad):
                parse(bad)


if __name__ == "__main__":
    unittest.main()
