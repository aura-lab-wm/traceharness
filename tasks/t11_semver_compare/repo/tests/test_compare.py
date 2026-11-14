import unittest
from versions import compare


class TestCompare(unittest.TestCase):
    def test_release_order(self):
        self.assertEqual(compare("1.2.3", "1.2.4"), -1)
        self.assertEqual(compare("2.0.0", "1.9.9"), 1)

    def test_equal(self):
        self.assertEqual(compare("1.2.3", "1.2.3"), 0)

    def test_prerelease_is_lower(self):
        self.assertEqual(compare("1.2.0-rc1", "1.2.0"), -1)
        self.assertEqual(compare("1.2.0", "1.2.0-rc1"), 1)
        self.assertEqual(compare("1.2.0-alpha", "1.2.0-beta"), -1)


if __name__ == "__main__":
    unittest.main()
