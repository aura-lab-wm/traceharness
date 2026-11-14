import random
import unittest
from pager import paginate, page_count


def brute_pages(n, per_page):
    """Count pages by actually walking the items."""
    pages, seen = 1, 0
    while seen + per_page < n:
        seen += per_page
        pages += 1
    return pages


class TestPaginateStrong(unittest.TestCase):
    def test_empty_collection_has_one_page(self):
        r = paginate([], 1, 5)
        self.assertEqual(r["items"], [])
        self.assertEqual(r["total_pages"], 1)
        self.assertFalse(r["has_next"])
        self.assertFalse(r["has_prev"])
        self.assertEqual(page_count(0, 5), 1)

    def test_input_not_mutated_and_result_is_new_list(self):
        data = [3, 1, 2, 5]
        r = paginate(data, 1, 10)
        self.assertEqual(data, [3, 1, 2, 5])
        self.assertIsNot(r["items"], data)
        r["items"].append(99)
        self.assertEqual(data, [3, 1, 2, 5])

    def test_random_against_brute(self):
        rng = random.Random(1234)
        for _ in range(300):
            n = rng.randint(0, 40)
            per_page = rng.randint(1, 9)
            data = [rng.randint(0, 99) for _ in range(n)]
            pages = brute_pages(n, per_page)
            self.assertEqual(page_count(n, per_page), pages, (n, per_page))
            rebuilt = []
            for page in range(1, pages + 1):
                r = paginate(data, page, per_page)
                self.assertEqual(r["total_pages"], pages)
                self.assertEqual(r["total_items"], n)
                self.assertEqual(r["page"], page)
                self.assertEqual(r["per_page"], per_page)
                self.assertEqual(r["has_next"], page < pages)
                self.assertEqual(r["has_prev"], page > 1)
                self.assertLessEqual(len(r["items"]), per_page)
                rebuilt.extend(r["items"])
            self.assertEqual(rebuilt, data)
            with self.assertRaises(ValueError):
                paginate(data, pages + 1, per_page)

    def test_bad_arguments(self):
        for args in (([1], 1, 0), ([1], 1, -3), ([], 2, 5), ([], 0, 5)):
            with self.assertRaises(ValueError, msg=args):
                paginate(*args)


if __name__ == "__main__":
    unittest.main()
