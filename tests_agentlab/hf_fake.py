"""A fake Hugging Face Hub for the offline tests of package H2: `FakeHub(...)` is a `fetch(url) -> dict`."""
import json
import urllib.parse

from traceharness.catalog import hf_fetch as F

SWE_FEATURES = [{"name": n, "type": {"dtype": d, "_type": "Value"}} for n, d in
                (("instance_id", "string"), ("model_name", "string"), ("target", "bool"), ("trajectory", "string"),
                 ("exit_status", "string"), ("generated_patch", "string"), ("eval_logs", "string"))]
MSG_FEATURES = [{"name": n, "type": {"dtype": d, "_type": "Value"}} for n, d in
                (("messages", "string"), ("instance_id", "string"), ("resolved", "bool"), ("model", "string"), ("patch", "string"))]


def swe_row(i, resolved=None):
    return {"instance_id": f"owner__repo-{i}", "model_name": "swe-agent-test", "target": bool(i % 2) if resolved is None else resolved,
            "trajectory": [{"role": "system", "text": "sys", "system_prompt": "x", "mask": False, "cutoff_date": ""},
                           {"role": "user", "text": "fix the bug"},
                           {"role": "ai", "text": "Look first.\n```\nopen a.py\n```"},
                           {"role": "user", "text": "(file)"},
                           {"role": "ai", "text": "Edit.\n```\nedit 1:1\nx=1\nend_of_edit\n```"},
                           {"role": "user", "text": "ok"},
                           {"role": "ai", "text": "Done.\n```\nsubmit\n```"}],
            "exit_status": "submitted", "generated_patch": "diff --git a/a.py b/a.py\n--- a/a.py\n+++ b/a.py\n@@ -1 +1 @@\n-x=0\n+x=1\n",
            "eval_logs": "log"}


def msg_row(i, as_string=True):
    msgs = [{"role": "system", "content": "sys"},
            {"role": "user", "content": [{"type": "text", "text": f"task {i}"}]},
            {"role": "assistant", "content": "I will run a command", "tool_calls": [{"id": "c1", "type": "function", "function": {"name": "bash", "arguments": json.dumps({"command": "ls"})}}]},
            {"role": "tool", "tool_call_id": "c1", "content": "a.py"},
            {"role": "assistant", "content": "done"}]
    return {"messages": json.dumps(msgs) if as_string else msgs, "instance_id": f"proj__lib-{i}", "resolved": bool(i % 2),
            "model": "model-x", "patch": ""}


class FakeHub:
    """Serves one dataset. `rows` is a list of row dicts; every request is recorded in `calls`."""

    def __init__(self, dataset="acme/data", rows=None, features=None, license="cc-by-4.0", gated=False, sha="a" * 40,
                 config="default", split="train", truncated=(), fail=None):
        self.dataset, self.rows, self.features = dataset, rows if rows is not None else [swe_row(i) for i in range(50)], features or SWE_FEATURES
        self.license, self.gated, self.sha, self.config, self.split = license, gated, sha, config, split
        self.truncated, self.fail, self.calls = set(truncated), fail, []

    def __call__(self, url):
        self.calls.append(url)
        if self.fail:
            err = self.fail(url, len(self.calls))
            if err:
                raise err
        u = urllib.parse.urlsplit(url)
        q = dict(urllib.parse.parse_qsl(u.query))
        if u.hostname == "huggingface.co":
            assert u.path == f"/api/datasets/{self.dataset}", u.path
            info = {"id": self.dataset, "sha": self.sha, "gated": self.gated, "private": False, "tags": []}
            if self.license:
                info["cardData"] = {"license": self.license}
            return info
        assert u.hostname == "datasets-server.huggingface.co", u.hostname
        assert q.get("dataset") == self.dataset
        n = len(self.rows)
        if u.path == "/size":
            return {"size": {"dataset": {"num_rows": n, "num_bytes_parquet_files": 1234},
                             "splits": [{"config": self.config, "split": self.split, "num_rows": n}]}}
        assert q["config"] == self.config and q["split"] == self.split
        if u.path == "/first-rows":
            return {"features": self.features, "rows": [{"row_idx": i, "row": r, "truncated_cells": []} for i, r in enumerate(self.rows[:100])]}
        if u.path == "/rows":
            off, length = int(q["offset"]), int(q["length"])
            assert 1 <= length <= F.MAX_PER_REQUEST, length
            return {"rows": [{"row_idx": i, "row": self.rows[i], "truncated_cells": ["trajectory"] if i in self.truncated else []}
                             for i in range(off, min(off + length, n))], "num_rows_total": n}
        raise AssertionError(u.path)

    def rows_calls(self):
        return [c for c in self.calls if "/rows?" in c]
