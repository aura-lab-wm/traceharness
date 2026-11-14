import unittest
from pointer import resolve, split


class TestResolveHidden(unittest.TestCase):
    def test_escaped_slash(self):
        self.assertEqual(resolve({"a/b": 1, "a": {"b": 2}}, "/a~1b"), 1)

    def test_escaped_tilde(self):
        self.assertEqual(resolve({"m~n": 8}, "/m~0n"), 8)

    def test_tilde_zero_one_is_literal(self):
        self.assertEqual(resolve({"~1": "t", "/": "s"}, "/~01"), "t")
        self.assertEqual(split("/~01"), ["~1"])

    def test_tilde_one_zero(self):
        self.assertEqual(resolve({"/0": 7, "~": 3}, "/~10"), 7)

    def test_both_escapes_in_one_token(self):
        self.assertEqual(split("/a~0~1b/~01~10"), ["a~/b", "~1/0"])

    def test_empty_key(self):
        self.assertEqual(resolve({"": 0, "a": 1}, "/"), 0)

    def test_list_index_rules(self):
        data = {"l": ["a", "b", "c"]}
        self.assertEqual(resolve(data, "/l/2"), "c")
        for bad in ("/l/01", "/l/3", "/l/-", "/l/x"):
            with self.assertRaises(KeyError):
                resolve(data, bad)

    def test_descend_into_scalar(self):
        with self.assertRaises(KeyError):
            resolve({"a": 1}, "/a/b")


if __name__ == "__main__":
    unittest.main()
