"""The shell-command phase classifier (traceharness/core/phases.py) and the patterns letters built on it."""
from __future__ import annotations

import unittest

from traceharness.core.phases import action_letter, classify, is_scratch, package_of, span_phases, split_segments, tool_phase

CASES = [
    ("cd /testbed && ls -la", "explore"),
    ("cd /testbed && grep -rn 'urlopen' requests/ | head -20", "explore"),
    ("sed -n '100,140p' /testbed/django/db/models/query.py", "explore"),
    ("cd /testbed && git log --oneline -5", "explore"),
    ("cd /testbed && git diff", "explore"),
    ("cd /testbed && git diff > /testbed/patch.txt", "explore"),
    ("grep -n foo x.py > /tmp/out.txt", "explore"),
    ("sed -i 's/repr(text)/str(text)/' /testbed/django/template/defaultfilters.py", "edit"),
    ("cat > /testbed/django/utils/x.py << 'EOF'\nprint(1)\nEOF", "edit"),
    ("cat > /tmp/repro.py << 'EOF'\nimport django\nprint(django.VERSION)\nEOF\npython /tmp/repro.py", "reproduce"),
    ("cat > /tmp/fix.py << 'EOF'\np='/testbed/django/a.py'\ns=open(p).read()\nopen(p,'w').write(s)\nEOF\n"
     "python /tmp/fix.py", "edit"),
    ("python - << 'EOF'\nimport re\np = '/testbed/sympy/core/expr.py'\nt = open(p).read()\n"
     "with open(p, 'w') as f:\n    f.write(t.replace('a', 'b'))\nEOF", "edit"),
    ("python -c \"from sympy import *; print(sqrt(8))\"", "reproduce"),
    ("cd /testbed && python reproduce_issue.py", "reproduce"),
    ("cd /testbed && python -m pytest tests/test_x.py -x -q 2>&1 | tail -20", "test"),
    ("cd /testbed/tests && python runtests.py template_tests.filter_tests -v 2", "test"),
    ("cd /testbed && bin/test sympy/core/tests/test_expr.py", "test"),
    ("timeout 60 python -m py_compile /testbed/django/a.py", "test"),
    ("curl -s https://api.github.com/repos/django/django/pulls/15863", "lookup"),
    ("cd /tmp && pip download django==4.1 --no-deps", "lookup"),
    ("git clone https://github.com/sympy/sympy /tmp/sympy", "lookup"),
    ("python -c \"import urllib.request; print(urllib.request.urlopen('https://pypi.org/simple/x').read()[:100])\"", "lookup"),
    ("pip install -e .", "env"),
    ("pip list | grep -i django", "env"),
    ("python --version", "env"),
    ("python -c \"import django; print(django.__version__)\"", "env"),
    ("python -c \"import inspect, django.db.models.query as q; print(inspect.getsource(q.QuerySet.only))\"",
     "explore"),
    ("echo COMPLETE_TASK_AND_SUBMIT_FINAL_OUTPUT && cat patch.txt", "submit"),
    ("rm -f /testbed/reproduce.py", "other"),
    ("cd /testbed && git stash && python repro.py; git stash pop", "reproduce"),
    ("cd /testbed && git checkout -- django/a.py", "edit"),
    ("for f in a b; do grep -n x $f; done", "explore"),
    ("cd /testbed && git apply /tmp/fix.diff", "edit"),
    ("timeout 120 python -W ignore -m pytest -q", "test"),
    ("timeout 30 python << 'EOF' 2>&1 | head -40\nimport urllib.request\n"
     "print(urllib.request.urlopen('https://api.github.com/repos/x/y').read())\nEOF", "lookup"),
    ("curl -s http://127.0.0.1:8000/admin/", "reproduce"),
    ("cd /testbed && python -m pytest -q 2>&1 | tail -5", "test"),
    ("python /tmp/r.py &> /tmp/log.txt; cat /tmp/log.txt", "reproduce"),
    ("echo x >&2 && ls", "explore"),
    ("cd /testbed && python - << 'EOF'\nwith open('django/contrib/admin/checks.py') as f:\n    c = f.read()\n"
     "with open('django/contrib/admin/checks.py', 'w') as f:\n    f.write(c)\nEOF", "edit"),
    ("cd /testbed && sed -i '2173s/a/b/' sklearn/linear_model/logistic.py && sed -n '2168,2180p' "
     "sklearn/linear_model/logistic.py", "edit"),
    ("cd /tmp/p && python -c \"open('logging_6.py', 'w').write('x')\"", "reproduce"),
    ("cat >> /testbed/docs/ref/checks.txt << 'EOF'\nmore\nEOF", "edit"),
    ("cd /testbed && cat > test_settings.py << 'EOF'\nSECRET_KEY = 'x'\nEOF", "reproduce"),
    ("cd /testbed && nohup bash -c 'python -m pytest testing/ -q > /tmp/o.txt 2>&1' &", "test"),
    ("cd /testbed && git reset -q && cp /tmp/patch.txt /testbed/patch.txt", "other"),
    ("cp /tmp/fixed.py /testbed/django/utils/html.py", "edit"),
    ("cd /testbed && git apply --check /tmp/pr.diff && echo ok", "explore"),
    ("cd /testbed && python -c \"import ast; ast.parse(open('django/a.py').read()); print('ok')\"", "test"),
    ("(setsid bash -c 'python -m pytest tests/ -q > /tmp/l.txt 2>&1' &); echo launched", "test"),
    ("cd /tmp/x && env -u HOME python -c \"import pylint; print(1)\"", "reproduce"),
    ("for d in /testbed/a/*; do [ -d \"$d/en\" ] && echo $d; done", "explore"),
    ("python -c \"import requests; requests.get('http://.example.com')\"", "reproduce"),
]
PKG_CASES = [
    ("pip install -q --target /tmp/dj \"Django==3.2.25\"", "django", "lookup"),
    ("pip install -e .", "django", "env"),
    ("python -m pip install numpy==1.24", "django", "env"),
]


class ClassifyTest(unittest.TestCase):
    def test_cases(self):
        bad = [(c, want, classify(c)) for c, want in CASES if classify(c) != want]
        self.assertFalse(bad, "\n".join(f"{w!r:10} got {g!r:10} {c[:90]!r}" for c, w, g in bad))

    def test_package_cases(self):
        bad = [(c, w, classify(c, package=p)) for c, p, w in PKG_CASES if classify(c, package=p) != w]
        self.assertFalse(bad, bad)

    def test_scratch(self):
        self.assertTrue(is_scratch("/tmp/x.py") and is_scratch("/testbed/reproduce.py") and is_scratch("test_fix.py"))
        self.assertFalse(is_scratch("/testbed/django/db/models/query.py") or is_scratch("/testbed/setup.py"))
        self.assertFalse(is_scratch("/testbed/tests/model_fields/test_x.py"))
        self.assertFalse(is_scratch("django/contrib/admin/checks.py") or is_scratch("lib/matplotlib/patches.py"))
        self.assertTrue(is_scratch("logging_6.py", cwd="/tmp/p") and is_scratch("/testbed/patch.txt"))

    def test_heredoc_split(self):
        segs = split_segments("cat > /tmp/a.py << 'EOF'\nx = 1 && 2\nEOF\npython /tmp/a.py")
        self.assertEqual([s.text.split()[0] for s in segs], ["cat", "python"])
        self.assertEqual((segs[0].heredocs, segs[0].redirects), (["x = 1 && 2"], ["/tmp/a.py"]))

    def test_a_script_written_earlier_in_the_run_is_judged_by_its_body(self):
        scripts: dict = {}
        self.assertEqual(classify("cat > /tmp/f.py << 'EOF'\nopen('/testbed/django/a.py', 'w').write('x')\nEOF",
                                  scripts), "reproduce")
        self.assertEqual(classify("python /tmp/f.py", scripts), "edit")
        self.assertEqual(classify("python /tmp/f.py"), "reproduce")          # a fresh run does not know it


class LettersTest(unittest.TestCase):
    def test_explore_splits_into_list_read_and_search(self):
        for cmd, want in (("cd /testbed && ls -la", "L"), ("find . -name '*.py' | head", "L"), ("git status", "L"),
                          ("grep -rn foo django/ | head -20", "F"), ("git grep -n foo", "F"),
                          ("sed -n '1,40p' /testbed/django/a.py", "R"), ("cat django/a.py", "R"), ("git log -3", "R")):
            with self.subTest(cmd=cmd):
                self.assertEqual(action_letter(cmd, classify(cmd)), want)

    def test_edits_are_writes_or_in_place_changes_and_scratch_writes_are_not_edits(self):
        cases = (("cat > /testbed/django/utils/x.py << 'EOF'\nprint(1)\nEOF", "W"),
                 ("cp /tmp/fixed.py /testbed/django/utils/html.py", "W"),
                 ("sed -i 's/a/b/' /testbed/django/template/defaultfilters.py", "E"),
                 ("cd /testbed && git apply /tmp/fix.diff", "E"),
                 ("cat > /tmp/repro.py << 'EOF'\nprint(1)\nEOF", "B"),
                 ("cd /testbed && cat > reproduce_issue.py << 'EOF'\nprint(1)\nEOF", "B"))
        for cmd, want in cases:
            with self.subTest(cmd=cmd[:40]):
                self.assertEqual(action_letter(cmd, classify(cmd)), want)

    def test_test_submit_and_the_rest(self):
        self.assertEqual(action_letter("python -m pytest -q", "test"), "T")
        self.assertEqual(action_letter("echo COMPLETE_TASK_AND_SUBMIT_FINAL_OUTPUT", "submit"), "S")
        for phase in ("reproduce", "env", "lookup", "other"):
            self.assertEqual(action_letter("python x.py", phase), "B")


class LabToolsTest(unittest.TestCase):
    def test_a_lab_tool_has_the_phase_its_name_says(self):
        s: dict = {}
        self.assertEqual(tool_phase("read_file", {"path": "a.py"}, s), "explore")
        self.assertEqual(tool_phase("list_files", {"path": "."}, s), "explore")
        self.assertEqual(tool_phase("edit_file", {"path": "slugify.py"}, s), "edit")
        self.assertEqual(tool_phase("run_tests", {}, s), "test")
        self.assertEqual(tool_phase("submit", {}, s), "submit")
        self.assertEqual(tool_phase("bash", {"command": "python -m pytest -q"}, s), "test")
        self.assertEqual(tool_phase("bash", {"command": "ls"}, s, kind="run"), "test")
        self.assertEqual(tool_phase("mystery", {}, s), "other")

    def test_a_write_to_a_scratch_file_is_not_an_edit(self):
        s: dict = {}
        for path in ("/tmp/sanity_check.py", "check_issue.py", "verify_fix.py", "tmp_check.py", "notes.log"):
            self.assertEqual(tool_phase("write_file", {"path": path, "content": "print(1)"}, s), "reproduce", path)
            self.assertEqual(tool_phase("edit_file", {"path": path}, s), "reproduce", path)
        # a project file, at the root or in a package, is an edit
        for path in ("slugify.py", "lru/cache.py", "tests/test_cache.py", "CHANGELOG.md", "/workspace/pkg/a.py"):
            self.assertEqual(tool_phase("write_file", {"path": path}, s), "edit", path)
        self.assertEqual(tool_phase("edit_file", {}, s), "edit")

    def test_a_search_tool_explores(self):
        self.assertEqual(tool_phase("search", {"pattern": "def area"}, {}), "explore")

    def test_a_runs_phases_keep_a_recorded_one_and_read_the_task_package(self):
        start = {"span": "invoke_agent", "status": "start", "task_id": "acme__pkg-1"}
        tool = lambda cmd, **kw: {"span": "execute_tool", "gen_ai.tool.name": "bash", "args": {"command": cmd}, **kw}  # noqa: E731
        spans = [start, {"span": "chat"}, tool("ls", phase="test"), tool("pip install pkg"), tool("pip install numpy")]
        self.assertEqual(span_phases(spans), [None, None, "test", "lookup", "env"])

    def test_package_of_a_swe_bench_task(self):
        self.assertEqual(package_of("django__django-15268"), "django")
        self.assertEqual(package_of("scikit-learn__scikit-learn-12682"), "scikit-learn")
        self.assertEqual(package_of("psf__requests-2317"), "requests")
        self.assertEqual(package_of("t01_slugify"), "")


if __name__ == "__main__":
    unittest.main()
