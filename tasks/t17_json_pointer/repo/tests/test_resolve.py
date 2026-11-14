import unittest
from pointer import resolve


DOC = {"users": [{"name": "ann", "tags": ["x", "y"]}, {"name": "bob"}], "count": 2}


class TestResolve(unittest.TestCase):
    def test_whole_document(self):
        self.assertIs(resolve(DOC, ""), DOC)

    def test_nested_dict_and_list(self):
        self.assertEqual(resolve(DOC, "/users/0/name"), "ann")
        self.assertEqual(resolve(DOC, "/users/0/tags/1"), "y")

    def test_missing_and_malformed(self):
        with self.assertRaises(KeyError):
            resolve(DOC, "/users/5")
        with self.assertRaises(ValueError):
            resolve(DOC, "users")


if __name__ == "__main__":
    unittest.main()
