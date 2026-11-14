import random
import unittest
from wrapper import wrap


def brute(text, width):
    """Greedy wrap written token by token with explicit forced breaks."""
    tokens = []  # (piece, forced_break_before, forced_break_after)
    for word in text.split():
        if len(word) <= width:
            tokens.append((word, False, False))
            continue
        chunks = [word[i:i + width] for i in range(0, len(word), width)]
        for n, chunk in enumerate(chunks):
            last = n == len(chunks) - 1
            tokens.append((chunk, n == 0, not last))
    out, line = [], None
    for piece, brk_before, brk_after in tokens:
        if line is not None and (brk_before or len(line) + 1 + len(piece) > width):
            out.append(line)
            line = None
        line = piece if line is None else line + " " + piece
        if brk_after:
            out.append(line)
            line = None
    if line is not None:
        out.append(line)
    return out


def random_text(rng):
    words = []
    for _ in range(rng.randint(0, 12)):
        words.append("".join(rng.choice("abcdefg") for _ in range(rng.randint(1, 11))))
    seps = [rng.choice([" ", "  ", "\t", "\n"]) for _ in words]
    return rng.choice(["", " "]) + "".join(w + s for w, s in zip(words, seps))


class TestWrapStrong(unittest.TestCase):
    def test_long_word_tail_can_be_joined(self):
        self.assertEqual(wrap("abcdefghij a", 4), ["abcd", "efgh", "ij a"])
        self.assertEqual(wrap("abcdefghij kl mn", 4), ["abcd", "efgh", "ij", "kl", "mn"])

    def test_random_against_brute(self):
        rng = random.Random(424242)
        for _ in range(400):
            text = random_text(rng)
            width = rng.randint(1, 12)
            self.assertEqual(wrap(text, width), brute(text, width), (text, width))

    def test_random_properties(self):
        rng = random.Random(99)
        for _ in range(300):
            text = random_text(rng)
            width = rng.randint(1, 12)
            lines = wrap(text, width)
            for line in lines:
                self.assertTrue(0 < len(line) <= width, (text, width, line))
                self.assertEqual(line, line.strip())
            self.assertEqual("".join("".join(lines).split()), "".join(text.split()))

    def test_width_one(self):
        self.assertEqual(wrap("ab c", 1), ["a", "b", "c"])


if __name__ == "__main__":
    unittest.main()
