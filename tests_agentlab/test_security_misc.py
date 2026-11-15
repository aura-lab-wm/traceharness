"""Hostile-input guards for the "misc" CodeQL slice: query regex bounds, generated-test quoting,
exported-HTML escaping and the boot-failure message in index.html."""
import ast
import os
import re
import time
import unittest

from traceharness.backend import static_export as SE
from traceharness.core import patterns as P

FRONTEND = os.path.join(os.path.dirname(__file__), "..", "traceharness", "frontend")


class QueryRegexBounds(unittest.TestCase):
    def test_nested_unbounded_repeat_is_refused_fast(self):
        t0 = time.time()
        for pat in ("(a+)+$", "(?:x*)*y", "((W|E)*)*T"):
            res = P.query([], pat)
            self.assertIn("error", res, pat)
        self.assertLess(time.time() - t0, 1.0)

    def test_overlong_pattern_is_refused(self):
        self.assertIn("error", P.query([], "W" * (P.MAX_QUERY_PATTERN + 1)))

    def test_ordinary_patterns_still_compile(self):
        for pat in ("[WE](?!.*T)", "E.*W", "W{2,}E", "^R+E"):
            self.assertIsNotNone(P.compile_query(pat))

    def test_generated_unittest_cannot_be_broken_out_of(self):
        hostile = 'x"\nimport os; os.system("echo pwned")\n#'
        src = P.as_unittest(hostile, "hostile")
        tree = ast.parse(src)  # still valid Python, and the hostile text is only a string literal
        assigned = [n for n in tree.body if isinstance(n, ast.Assign) and getattr(n.targets[0], "id", "") == "PATTERN"]
        self.assertEqual(ast.literal_eval(assigned[0].value), hostile)
        self.assertFalse([n for n in tree.body if isinstance(n, ast.Import) and n.names[0].name == "os"])


class ExportEscaping(unittest.TestCase):
    HOSTILE = "</script ><script>alert(1)</script></SCRIPT><!--<script><img src=x onerror=alert(1)>"

    def test_inline_data_cannot_close_the_script(self):
        for compress in (False, True):
            out = SE._data_banner({"/x": {"text": self.HOSTILE}}, compress)
            body = out.split(">", 1)[1].split("</script>", 1)[0]
            self.assertNotIn("<", body)

    def test_external_script_tag_regex_matches_spaced_close_tag(self):
        src = inspect_source()
        self.assertIn(r"></script\s*>", src)


def inspect_source():
    import inspect
    return inspect.getsource(SE.build)


class BootFailureMessage(unittest.TestCase):
    def test_failed_resource_url_is_escaped_before_innerhtml(self):
        for name in ("index.html", os.path.join("dist", "index.html")):
            html = open(os.path.join(FRONTEND, name), encoding="utf-8").read()
            self.assertNotRegex(html, r"'<p>'\s*\+\s*why\s*\+")
            self.assertRegex(html, r"esc\(why\)")


if __name__ == "__main__":
    unittest.main()
