import unittest
from pager import paginate


class TestPaginate(unittest.TestCase):
    def test_first_page(self):
        r = paginate(list(range(10)), 1, 3)
        self.assertEqual(r["items"], [0, 1, 2])
        self.assertEqual(r["total_pages"], 4)
        self.assertTrue(r["has_next"])
        self.assertFalse(r["has_prev"])

    def test_bad_per_page(self):
        with self.assertRaises(ValueError):
            paginate([1, 2, 3], 1, 0)


if __name__ == "__main__":
    unittest.main()
