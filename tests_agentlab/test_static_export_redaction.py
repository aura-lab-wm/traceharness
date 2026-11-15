"""A static export is handed to other people. Nothing in it may identify the machine that made it.

`/api/settings` is in the export URL list, and it answers with `key_hint` -- the first seven and last
four characters of the operator's OpenRouter key -- plus four absolute paths that embed the username.
Baked into a shareable single-file deliverable, that is a credential fragment and a filesystem map
travelling to a participant or a reviewer.
"""
import os
import sys
import unittest

LAB = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, LAB)

from traceharness.backend import static_export as SE      # noqa: E402

SECRETY = ("key_hint", "lab_root", "results_root", "harness_dir", "task_dir")


class TestExportRedaction(unittest.TestCase):
    def test_the_settings_payload_keeps_nothing_that_identifies_the_machine(self):
        raw = {"key_present": True, "key_hint": "sk-or-v…9f2a",
               "base_url": "https://openrouter.ai/api/v1",
               "lab_root": "/Users/someone/Projects/traceharness",
               "results_root": "/Users/someone/Projects/traceharness/data/runs",
               "harness_dir": "/Users/someone/h", "task_dir": "/Users/someone/t",
               "results": ["demo_mock"], "harnesses": ["baseline"], "sentinel": {"trained": True}}
        out = SE.redact("/settings", raw)
        for k in SECRETY:
            self.assertNotIn(k, out, f"{k} survived redaction")
        self.assertNotIn("someone", str(out), "a username reached the export")
        self.assertNotIn("sk-or", str(out), "a key fragment reached the export")
        # what a reader legitimately needs offline survives
        self.assertEqual(out["key_present"], True)
        self.assertEqual(out["results"], ["demo_mock"])
        self.assertEqual(out["harnesses"], ["baseline"])

    def test_the_import_status_keeps_no_absolute_path(self):
        """`/api/import/status` is in the export URL list, and an import fills it with the path
        that was imported -- expanded, so /Users/<name>/.claude/projects reaches a reviewer as a
        map of the operator's machine and the location of their session store. The nested copy
        inside `result` counts too: the export freezes the whole payload."""
        raw = {"status": "done", "progress": [3, 3], "error": None,
               "path": "/Users/someone/.claude/projects", "results_dir": "captured",
               "source": "claude_code", "started_at": 1.0, "finished_at": 2.0,
               "result": {"source": "claude_code", "results_dir": "captured",
                          "path": "/Users/someone/.claude/projects", "imported": 3, "skipped": 0,
                          "errors": [], "n_tasks": 2},
               "history": [{"source": "claude_code", "results_dir": "captured", "imported": 3}]}
        out = SE.redact("/import/status", raw)
        self.assertNotIn("someone", str(out), "a username reached the export")
        self.assertNotIn("/Users/", str(out), "an absolute path reached the export")
        # what a reader legitimately needs offline survives
        self.assertEqual(out["status"], "done")
        self.assertEqual(out["results_dir"], "captured")
        self.assertEqual(out["result"]["imported"], 3)
        self.assertEqual(out["source"], "claude_code")

    def test_an_unlisted_payload_is_passed_through_untouched(self):
        payload = {"anything": [1, 2, 3]}
        self.assertEqual(SE.redact("/overview", payload), payload)

    def test_every_redacted_key_is_actually_returned_by_the_route(self):
        """A rule naming a key the route no longer returns is a rule that has stopped protecting
        anything, and it reads as though it still does. Checked for every path in the table, not
        just the first one that had one."""
        from fastapi.testclient import TestClient
        from traceharness.backend.app import app
        client = TestClient(app)
        for path, names in [*SE.REDACT.items(), *SE.RELATIVE.items()]:
            live = client.get("/api" + path).json()
            self.assertIsInstance(live, dict, path)
            for name in names:
                outer = name.split(".", 1)[0]
                self.assertIn(outer, live,
                              f"redaction of {path} names {name}, which the route no longer returns")

    def test_folder_names_a_page_prints_are_kept_relative_to_the_lab(self):
        """The plugin panel prints /sentinel/plugins `dir` and the import panel /import/sources
        `runs_root`. Exported as they are, both carried the build machine's absolute path: from a
        checkout /Users/<name>/..., from the /app publisher its temporary worktree."""
        from traceharness.backend.paths import LAB_ROOT
        plugins = SE.redact("/sentinel/plugins", {"dir": os.path.join(LAB_ROOT, "traceharness", "plugins"),
                                                  "n_builtin": 6, "detectors": []})
        self.assertEqual(plugins["dir"], "traceharness/plugins")
        self.assertEqual(plugins["n_builtin"], 6)
        sources = SE.redact("/import/sources", {"runs_root": os.path.join(LAB_ROOT, "data", "runs"), "sources": []})
        self.assertEqual(sources["runs_root"], "data/runs")
        outside = SE.redact("/import/sources", {"runs_root": "/Users/someone/elsewhere/runs", "sources": []})
        self.assertNotIn("runs_root", outside, "a folder outside the lab is dropped, not exported")
        self.assertEqual(outside["sources"], [])

    def test_no_global_payload_names_the_lab_root(self):
        """Every payload the export embeds once per file, fetched from the real app and filtered as
        build() files it: none may carry the absolute lab root, which names the machine."""
        from fastapi.testclient import TestClient
        from traceharness.backend.app import app
        from traceharness.backend.paths import LAB_ROOT
        client = TestClient(app)
        sink, failed = {}, []
        for url in SE._GLOBAL_URLS:
            SE._fetch(client, url, sink, failed)
        self.assertIn("/sentinel/plugins", sink)
        self.assertIn("/import/sources", sink)
        import json
        for key, payload in sink.items():
            text = json.dumps(payload)
            for root in {LAB_ROOT, os.path.realpath(LAB_ROOT)}:
                self.assertNotIn(root, text, f"{key} embeds the lab root")


if __name__ == "__main__":
    unittest.main()
