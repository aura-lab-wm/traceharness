"""M3: redistributable only for exactly one known permissive identifier."""
import unittest

from traceharness.catalog import hf_fetch as F


class License(unittest.TestCase):
    def info(self, lic):
        return {"cardData": {"license": lic}}

    def test_one_known_permissive_identifier_is_redistributable(self):
        for lic in ("mit", "MIT", "apache-2.0", "cc0-1.0", "cc-by-4.0", "bsd-2-clause", "bsd-3-clause", ["mit"]):
            with self.subTest(lic=lic):
                self.assertTrue(F.is_redistributable(F._license(self.info(lic))), lic)

    def test_a_list_a_compound_or_an_unknown_value_is_not(self):
        for lic in (["bsd-3-clause", "cc-by-nc-4.0"], ["mit", "apache-2.0"], "bsd-3-clause,cc-by-nc-4.0", "mit,cc-by-nc-4.0",
                    "bsd-evil", "bsd-", "cc-by-nc-4.0", "other", "unknown", "mit or gpl-3.0", "mit AND proprietary", "", None, []):
            with self.subTest(lic=lic):
                self.assertFalse(F.is_redistributable(F._license(self.info(lic))), lic)

    def test_the_helper_alone_refuses_compound_strings(self):
        for lic in ("bsd-3-clause,cc-by-nc-4.0", "bsd-3-clause cc-by-nc-4.0", "bsd-3-clause;x", "bsd-3-clause/gpl"):
            self.assertFalse(F.is_redistributable(lic), lic)


if __name__ == "__main__":
    unittest.main()
