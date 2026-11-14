import unittest
from versions import compare


class TestCompareHidden(unittest.TestCase):
    def test_release_order(self):
        self.assertEqual(compare("1.2.3", "1.2.4"), -1)
        self.assertEqual(compare("2.0.0", "1.9.9"), 1)

    def test_multi_digit_components(self):
        self.assertEqual(compare("1.10.0", "1.9.0"), 1)
        self.assertEqual(compare("1.9.0", "1.10.0"), -1)
        self.assertEqual(compare("10.0.0", "2.0.0"), 1)
        self.assertEqual(compare("1.2.100", "1.2.99"), 1)

    def test_leading_zeros_ignored(self):
        self.assertEqual(compare("1.02.0", "1.2.0"), 0)
        self.assertEqual(compare("1.010.0", "1.9.0"), 1)

    def test_missing_components_are_zero(self):
        self.assertEqual(compare("1.2", "1.2.0"), 0)
        self.assertEqual(compare("1.2", "1.2.1"), -1)
        self.assertEqual(compare("2", "1.99.99"), 1)

    def test_prerelease_is_lower(self):
        self.assertEqual(compare("1.2.0-rc1", "1.2.0"), -1)
        self.assertEqual(compare("1.2.0", "1.2.0-rc1"), 1)
        self.assertEqual(compare("1.2.0-rc1", "1.2.0-rc2"), -1)
        self.assertEqual(compare("1.2.0-rc1", "1.2.0-rc1"), 0)

    def test_prerelease_of_higher_release(self):
        self.assertEqual(compare("1.10.0-rc1", "1.9.0"), 1)

    def test_prerelease_prefix_is_lower(self):
        self.assertEqual(compare("1.0.0-rc", "1.0.0-rc.1"), -1)

    def test_whitespace_and_invalid(self):
        self.assertEqual(compare(" 1.0.0 ", "1.0.0"), 0)
        for bad in ("", "1..2", "1.x", "1.0-", "1.0-a..b"):
            with self.assertRaises(ValueError):
                compare(bad, "1.0.0")


if __name__ == "__main__":
    unittest.main()
