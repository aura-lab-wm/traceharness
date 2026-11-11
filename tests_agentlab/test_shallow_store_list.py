"""List account copies and skip a corrupt file. Never touch data/runs."""
import json

import pytest

from traceharness.shallow.store import FileStore, MemoryStore, StoreError


def test_memory_list_is_sorted_copied_and_scoped():
    store = MemoryStore()
    store.save_harness("a@wm.edu", {"id": "b", "lane": "fixed", "prompt": "one"})
    store.save_harness("a@wm.edu", {"id": "a", "lane": "fixed", "prompt": "two"})
    store.save_harness("b@wm.edu", {"id": "z", "lane": "minimal", "prompt": "other"})
    rows = store.list_harnesses("a@wm.edu")
    assert [row["id"] for row in rows] == ["a", "b"]
    rows[0]["prompt"] = "changed"
    assert store.get_harness("a@wm.edu", "a")["prompt"] == "two"
    assert store.list_harnesses("nobody@wm.edu") == []
    store.save_job("a@wm.edu", {"id": "job_b", "lane": "fixed", "passed": True, "steps": 1})
    store.save_job("a@wm.edu", {"id": "job_a", "lane": "minimal", "passed": False, "steps": 2})
    assert [row["id"] for row in store.list_jobs("a@wm.edu")] == ["job_a", "job_b"]


def test_file_list_skips_corrupt_and_foreign_rows(tmp_path):
    with pytest.raises(StoreError):
        FileStore(tmp_path / "data" / "runs")
    store = FileStore(tmp_path / "account")
    assert store.list_harnesses("member@wm.edu") == []
    store.save_harness("member@wm.edu", {"id": "claude", "lane": "fixed", "prompt": "kept"})
    folder = tmp_path / "account" / "harnesses"
    (folder / "member@wm.edu__broken.json").write_text("{", encoding="utf-8")
    (folder / "member@wm.edu__wrong.json").write_text(
        json.dumps({"id": "other", "lane": "fixed"}),
        encoding="utf-8",
    )
    (folder / "member@wm.edu__bad id.json").write_text(
        json.dumps({"id": "bad id", "lane": "fixed"}),
        encoding="utf-8",
    )
    (folder / "other@wm.edu__qwen.json").write_text(
        json.dumps({"id": "qwen", "lane": "fixed", "prompt": "foreign"}),
        encoding="utf-8",
    )
    rows = store.list_harnesses("member@wm.edu")
    assert [row["id"] for row in rows] == ["claude"]
    assert rows[0]["prompt"] == "kept"
