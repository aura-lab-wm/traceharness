import unittest, random, copy
from grid import spiral


def brute(m):
    # walk cell by cell, turning clockwise at the border or at a visited cell
    h = len(m)
    w = len(m[0]) if h else 0
    seen, out = set(), []
    r = c = 0
    dr, dc = 0, 1
    for _ in range(h * w):
        out.append(m[r][c])
        seen.add((r, c))
        nr, nc = r + dr, c + dc
        if not (0 <= nr < h and 0 <= nc < w) or (nr, nc) in seen:
            dr, dc = dc, -dr
            nr, nc = r + dr, c + dc
        r, c = nr, nc
    return out


class TestSpiralStrong(unittest.TestCase):
    def test_random_shapes(self):
        rng = random.Random(14)
        for _ in range(300):
            h, w = rng.randint(0, 7), rng.randint(0, 7)
            m = [[rng.randint(0, 3) for _ in range(w)] for _ in range(h)]
            self.assertEqual(spiral(m), brute(m), m)

    def test_every_cell_once(self):
        for h in range(1, 7):
            for w in range(1, 7):
                m = [[r * w + c for c in range(w)] for r in range(h)]
                self.assertEqual(sorted(spiral(m)), list(range(h * w)), (h, w))

    def test_input_not_modified(self):
        m = [[1, 2, 3], [4, 5, 6]]
        before = copy.deepcopy(m)
        spiral(m)
        self.assertEqual(m, before)

    def test_ragged_rows(self):
        with self.assertRaises(ValueError):
            spiral([[1, 2, 3], [4, 5]])

    def test_empty_rows(self):
        self.assertEqual(spiral([[], []]), [])


if __name__ == "__main__":
    unittest.main()
