import unittest, random
from flags import parse_flag, parse_flags

FALSE = {"0", "false", "no", "off"}
WORDS = ["0", "false", "no", "off", "1", "true", "yes", "on", "maybe", "2", "nope"]


def expected(word):
    return word.lower() not in FALSE


def noisy(rng, word):
    word = "".join(rng.choice([c.lower(), c.upper()]) for c in word)
    return rng.choice(["", " ", "\t", "\n", "  "]) + word + rng.choice(["", " ", "\t", "\r\n", "  "])


class TestFlagsStrong(unittest.TestCase):
    def test_leading_and_other_whitespace(self):
        self.assertFalse(parse_flag(" off"))
        self.assertFalse(parse_flag("\toff\n"))
        self.assertFalse(parse_flag("\r\nNo\t"))
        self.assertTrue(parse_flag("\ton "))

    def test_random_words(self):
        rng = random.Random(16)
        for _ in range(400):
            word = rng.choice(WORDS)
            self.assertEqual(parse_flag(noisy(rng, word)), expected(word), word)

    def test_random_lists(self):
        rng = random.Random(17)
        for _ in range(200):
            words = [rng.choice(WORDS) for _ in range(rng.randint(0, 6))]
            text = ",".join(noisy(rng, w) for w in words)
            self.assertEqual(parse_flags(text), [expected(w) for w in words], text)

    def test_blank_whitespace_kinds(self):
        for bad in ["\t", "\n", " \t \n"]:
            with self.assertRaises(ValueError):
                parse_flag(bad)


if __name__ == "__main__":
    unittest.main()
