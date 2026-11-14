import unittest
from pager import paginate, page_count


class TestPaginateHidden(unittest.TestCase):
    def test_first_page(self):
        r = paginate(list(range(10)), 1, 3)
        self.assertEqual(r["items"], [0, 1, 2])
        self.assertEqual(r["total_pages"], 4)
        self.assertFalse(r["has_prev"])

    def test_exact_multiple_total_pages(self):
        self.assertEqual(page_count(9, 3), 3)
        self.assertEqual(paginate(list(range(9)), 1, 3)["total_pages"], 3)

    def test_exact_multiple_last_page(self):
        r = paginate(list(range(9)), 3, 3)
        self.assertEqual(r["items"], [6, 7, 8])
        self.assertFalse(r["has_next"])
        self.assertTrue(r["has_prev"])

    def test_exact_multiple_page_past_end(self):
        with self.assertRaises(ValueError):
            paginate(list(range(9)), 4, 3)

    def test_partial_last_page(self):
        r = paginate(list(range(10)), 4, 3)
        self.assertEqual(r["items"], [9])
        self.assertFalse(r["has_next"])

    def test_middle_page(self):
        r = paginate(list("abcdefgh"), 2, 3)
        self.assertEqual(r["items"], ["d", "e", "f"])
        self.assertTrue(r["has_next"])
        self.assertTrue(r["has_prev"])

    def test_single_item_per_page(self):
        self.assertEqual(page_count(5, 1), 5)

    def test_invalid_pages(self):
        for page in (0, -1):
            with self.assertRaises(ValueError):
                paginate([1, 2, 3], page, 2)


if __name__ == "__main__":
    unittest.main()
