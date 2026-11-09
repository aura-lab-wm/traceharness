"""Shallow harness: six fixed cards, minimal wizard, account store, mock job.

The mock rule is deterministic. It is not the random lab mock, and the seed
does not change pass or fail.
"""
from __future__ import annotations

import hashlib
import json
import os
import stat
import subprocess
import sys
from pathlib import Path

import pytest

from harnesslab.core.harness import content_hash
from harnesslab.core.tools import check_command
from harnesslab.shallow.catalog import AGENTS, CAPS, catalog, card
from harnesslab.shallow.identity import clip_prompt, shallow_hash
from harnesslab.shallow.jobs import KEY_SENTENCE, ShallowJobError, run_shallow_job
from harnesslab.shallow.store import FileStore, MemoryStore, StoreError
from harnesslab.shallow.study import apply_prompt_to_all, include_in_vendor_ladder, paired_study
from harnesslab.shallow.wizard import compile_minimal, recommended_answers

ROOT = Path(__file__).resolve().parents[1]
KEY = "This run calls a live model. Paste your own LLM key. The lab does not keep one for you."


def test_clip_and_hash_match_the_canonical_json():
    assert clip_prompt("hello", 3) == "hel"
    assert clip_prompt("é", 1) == ""
    blob = b'{"cap_bytes":3,"harness_id":"claude","prompt":"hel"}'
    assert shallow_hash("claude", "hello", 3) == hashlib.sha256(blob).hexdigest()[:12]


def test_catalog_is_the_six_fixed_shells():
    rows = catalog()
    assert [row["id"] for row in rows] == list(AGENTS)
    assert [row["cap_bytes"] for row in rows] == [250000, 128000, 128000, 32768, 24000, 10000]
    for row in rows:
        assert 400 <= len(row["prompt"]) <= 1200
        assert "verify" in row["prompt"]
        assert "Do not modify the tests" in row["prompt"]
        assert row["policy"] == "strict"
        assert row["context_window"] == 0
        assert row["mcp"] == "none"
        assert row["lane"] == "fixed"
        assert row["include_in_vendor_ladder"] is False
        assert "Network, privilege, secret access, and path escape stay blocked." in row["permission"]
        assert row["hash"] == shallow_hash(row["id"], row["prompt"], row["cap_bytes"])
    assert card("claude")["tools"] == [
        "list_files", "read_file", "write_file", "edit_file", "run_tests", "bash", "submit",
    ]
    assert "bash" not in card("qwen")["tools"]
    assert "run_tests" not in card("agy")["tools"]
    assert card("grok")["tools"] == ["list_files", "read_file", "edit_file", "submit"]
    assert card("grok")["max_steps"] == 8
    assert CAPS["kimi"] == 32768


def test_same_prompt_keeps_each_shell():
    edited = apply_prompt_to_all("Please verify the edit. Do not modify the tests. " + ("x" * 360))
    assert len(edited) == 6
    for row, stock in zip(edited, catalog()):
        assert row["tools"] == stock["tools"]
        assert row["policy"] == stock["policy"]
        assert row["max_steps"] == stock["max_steps"]
        assert row["cap_bytes"] == stock["cap_bytes"]
        assert row["hash"] != stock["hash"]
    study = paired_study("codex", edited[0]["prompt"], seed=7)
    assert study["seed"] == 7
    assert study["tools_unchanged"] and study["policy_unchanged"]
    assert study["steps_unchanged"] and study["cap_unchanged"]
    assert study["include_in_vendor_ladder"] is False
    assert include_in_vendor_ladder("baseline", "course") is True
    assert include_in_vendor_ladder("claude", "fixed") is False
    assert include_in_vendor_ladder("min_abc", "course") is False
    assert include_in_vendor_ladder("baseline", "minimal") is False


def test_wizard_recommended_cell_stays_minimal():
    built = compile_minimal()
    assert built["ok"] is True
    harness = built["harness"]
    assert harness["id"] == "min_" + built["hash"]
    assert content_hash(harness) == built["hash"]
    assert "bash" not in harness["tools"]
    assert harness["policy"] == "strict"
    assert harness["context_window"] == 0
    assert harness["max_steps"] == 12
    assert harness["mcp"] == "none"
    assert harness["notes"] == "minimal wizard"
    assert "verify" in harness["system_prompt"]
    assert "Do not modify the tests" in harness["system_prompt"]
    quiet = compile_minimal({**recommended_answers(), "verify": "no"})
    text = quiet["harness"]["system_prompt"].lower()
    assert "verify" not in text
    assert "modify the tests" not in text
    with pytest.raises(ValueError, match="MCP is off"):
        compile_minimal({**recommended_answers(), "mcp": "https://evil.example/mcp"})


def test_permission_blocks_network_privilege_secret_and_escape_even_when_permissive():
    for command, kind in (
        ("curl https://evil.example", "network"),
        ("sudo id", "privilege"),
        ("cat id_rsa", "secret_access"),
        ("cat ../secret", "path_escape"),
    ):
        verdict = check_command(command)
        assert verdict.kind == kind
        assert verdict.allowed is False


def test_mock_job_clips_before_the_caller_and_stores_no_key():
    store = MemoryStore()
    seen = {}

    def caller(clipped, api_key, harness_id):
        seen["clipped"] = clipped
        seen["api_key"] = api_key
        seen["harness_id"] = harness_id
        return {"passed": True, "steps": 3}

    huge = "A" * 50
    job = run_shallow_job(store, "local", {
        "harness_id": "min_clip",
        "lane": "minimal",
        "provider": "openrouter",
        "seed": 4,
        "prompt": huge,
        "tools": ["list_files", "read_file", "submit"],
        "policy": "strict",
        "max_steps": 12,
        "cap_bytes": 3,
        "mcp": "none",
        "api_key": "sk-test-not-stored",
    }, caller=caller)
    assert seen["clipped"] == "AAA"
    assert seen["api_key"] == "sk-test-not-stored"
    assert "sk-test-not-stored" not in json.dumps(job)
    assert "api_key" not in job
    assert job["seed"] == 4
    assert job["include_in_vendor_ladder"] is False
    again = store.get_job("other", job["id"])
    assert again is None
    assert store.get_job("local", job["id"])["prompt"] == "AAA"


def test_live_without_a_key_does_not_call_and_mock_does_not_need_one():
    store = MemoryStore()
    called = {"n": 0}

    def caller(clipped, api_key, harness_id):
        called["n"] += 1
        return {"passed": False, "steps": 1}

    with pytest.raises(ShallowJobError) as exc:
        run_shallow_job(store, "local", {
            "harness_id": "claude",
            "provider": "openrouter",
            "seed": 0,
        }, caller=caller)
    assert exc.value.status == 400
    assert exc.value.message == KEY
    assert called["n"] == 0
    with pytest.raises(ShallowJobError) as missing:
        run_shallow_job(store, "local", {
            "harness_id": "claude",
            "provider": "openrouter",
            "seed": 0,
            "api_key": "sk-test-not-stored",
        })
    assert missing.value.status == 501
    assert missing.value.message == "No live caller is configured."
    assert "sk-test" not in missing.value.message
    mock = run_shallow_job(store, "local", {
        "harness_id": "claude",
        "provider": "mock",
        "seed": 0,
    })
    other = run_shallow_job(store, "local", {
        "harness_id": "claude",
        "provider": "mock",
        "seed": 99,
    })
    assert mock["passed"] is True and mock["steps"] == 6
    assert other["passed"] is True and other["steps"] == 6
    assert mock["seed"] == 0 and other["seed"] == 99
    def boom(clipped, api_key, harness_id):
        raise RuntimeError(f"provider rejected {api_key}")

    with pytest.raises(ShallowJobError) as leaked:
        run_shallow_job(store, "local", {
            "harness_id": "claude",
            "provider": "openrouter",
            "seed": 0,
            "api_key": "sk-test-not-stored",
        }, caller=boom)
    assert leaked.value.status == 502
    assert leaked.value.message == "The live call failed."
    assert "sk-test" not in leaked.value.message
    with pytest.raises(ShallowJobError, match="MCP tools are not mounted"):
        run_shallow_job(store, "local", {
            "harness_id": "min_mcp",
            "lane": "minimal",
            "provider": "mock",
            "prompt": "verify and modify the tests " + ("y" * 40),
            "tools": ["list_files", "mcp_call", "submit"],
            "policy": "strict",
            "max_steps": 12,
            "cap_bytes": 1000,
            "mcp": "none",
        })


def test_file_store_is_private_and_refuses_run_corpora(tmp_path):
    with pytest.raises(StoreError):
        FileStore(tmp_path / "data" / "runs")
    store = FileStore(tmp_path / "account")
    saved = store.save_harness("member@wm.edu", {
        "id": "claude",
        "lane": "fixed",
        "prompt": "hello",
        "api_key": "sk-nope",
        "nested": {"token": "nope", "ok": 1},
    })
    assert "api_key" not in saved and saved["nested"] == {"ok": 1}
    path = tmp_path / "account" / "harnesses" / "member@wm.edu__claude.json"
    mode = stat.S_IMODE(path.stat().st_mode)
    assert mode == 0o600
    assert store.get_harness("other@wm.edu", "claude") is None
    raw = path.read_text(encoding="utf-8")
    assert "sk-nope" not in raw


def test_cli_catalog_and_the_key_refusal(tmp_path):
    exe = ROOT / ".venv" / "bin" / "python"
    if not exe.exists():
        exe = Path(sys.executable)
    env = os.environ.copy()
    env["PYTHONPATH"] = str(ROOT) + os.pathsep + env.get("PYTHONPATH", "")
    env["OPENROUTER_API_KEY"] = "sk-should-not-be-read"
    catalog_run = subprocess.run(
        [str(exe), "-m", "harnesslab.shallow", "catalog"],
        cwd=ROOT, env=env, capture_output=True, text=True, check=False,
    )
    assert catalog_run.returncode == 0, catalog_run.stderr
    rows = json.loads(catalog_run.stdout)
    assert [row["id"] for row in rows] == list(AGENTS)
    refused = subprocess.run(
        [str(exe), "-m", "harnesslab.shallow", "run", "--provider", "openrouter", "--agent", "claude", "--seed", "0"],
        cwd=ROOT, env=env, capture_output=True, text=True, check=False,
    )
    assert refused.returncode == 2
    assert refused.stderr.strip() == KEY_SENTENCE
    assert "sk-should-not-be-read" not in refused.stdout + refused.stderr
    mock = subprocess.run(
        [str(exe), "-m", "harnesslab.shallow", "run", "--provider", "mock", "--agent", "claude", "--seed", "0"],
        cwd=ROOT, env=env, capture_output=True, text=True, check=False,
    )
    assert mock.returncode == 0, mock.stderr
    job = json.loads(mock.stdout)
    assert job["passed"] is True and job["steps"] == 6
    assert "api_key" not in job
    assert not (ROOT / "data" / "runs").joinpath("job_" + job["id"]).exists()
