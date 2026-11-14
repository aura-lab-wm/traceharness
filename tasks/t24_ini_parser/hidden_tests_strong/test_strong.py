import random
import unittest
from inifile import parse

NAME_CHARS = "abcxyz09 =._-"
KEY_CHARS = "abcxyz09_.-"
VALUE_CHARS = "abcxyz09 =#;[]/?&:.,-_"


def rand_text(rng, chars, lo, hi):
    while True:
        s = "".join(rng.choice(chars) for _ in range(rng.randint(lo, hi))).strip()
        if s:
            return s


class TestParseStrong(unittest.TestCase):
    def test_roundtrip_random_documents(self):
        rng = random.Random(24)
        for _ in range(300):
            expected, lines = {}, []
            for _ in range(rng.randint(1, 4)):
                name = rand_text(rng, NAME_CHARS, 1, 6)
                lines.append("[" + " " * rng.randint(0, 2) + name + " " * rng.randint(0, 2) + "]")
                body = expected.setdefault(name, {})
                for _ in range(rng.randint(0, 5)):
                    key = rand_text(rng, KEY_CHARS, 1, 5)
                    value = "" if rng.random() < 0.1 else rand_text(rng, VALUE_CHARS, 1, 12)
                    body[key] = value
                    lines.append(" " * rng.randint(0, 2) + key + " " * rng.randint(0, 2) + "=" + " " * rng.randint(0, 2) + value + " " * rng.randint(0, 2))
                    if rng.random() < 0.3:
                        lines.append(rng.choice(["", "# c = d", "  ; [x]", "#"]))
            eol = rng.choice(["\n", "\r\n"])
            text = eol.join(lines) + rng.choice(["", eol])
            self.assertEqual(parse(text), expected, text)

    def test_section_name_may_contain_equals(self):
        self.assertEqual(parse("[a=b]\nk = v\n"), {"a=b": {"k": "v"}})
        self.assertEqual(parse("[x = y]\n"), {"x = y": {}})

    def test_value_may_look_like_a_section(self):
        self.assertEqual(parse("[s]\nk = [not a section]\n"), {"s": {"k": "[not a section]"}})

    def test_empty_and_comment_only_documents(self):
        self.assertEqual(parse(""), {})
        self.assertEqual(parse("# nothing\n; here\n\n"), {})


if __name__ == "__main__":
    unittest.main()
