import unittest, random
from roman import to_int

VALUES = {"I": 1, "V": 5, "X": 10, "L": 50, "C": 100, "D": 500, "M": 1000}
TABLE = [(1000, "M"), (900, "CM"), (500, "D"), (400, "CD"), (100, "C"), (90, "XC"),
         (50, "L"), (40, "XL"), (10, "X"), (9, "IX"), (5, "V"), (4, "IV"), (1, "I")]


def encode(n):
    out = []
    for value, letters in TABLE:
        while n >= value:
            out.append(letters)
            n -= value
    return "".join(out)


def oracle(text):
    # scan from the right: a letter smaller than its right neighbour is subtracted
    total, nxt = 0, 0
    for ch in reversed(text):
        v = VALUES[ch]
        total += -v if v < nxt else v
        nxt = v
    return total


class TestRomanStrong(unittest.TestCase):
    def test_round_trip_all(self):
        for n in range(1, 4000):
            self.assertEqual(to_int(encode(n)), n, encode(n))

    def test_large_pairs(self):
        self.assertEqual(to_int("CD"), 400)
        self.assertEqual(to_int("CM"), 900)
        self.assertEqual(to_int("MCMXCIV"), 1994)

    def test_random_against_oracle(self):
        rng = random.Random(13)
        for _ in range(400):
            s = "".join(rng.choice("IVXLCDM") for _ in range(rng.randint(1, 8)))
            self.assertEqual(to_int(s), oracle(s), s)
            self.assertEqual(to_int(s.lower()), oracle(s), s)

    def test_invalid_is_value_error(self):
        for bad in ["Q", "MMQ", "1994", "I-V"]:
            with self.assertRaises(ValueError):
                to_int(bad)


if __name__ == "__main__":
    unittest.main()
