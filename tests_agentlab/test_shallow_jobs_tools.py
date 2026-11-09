"""Tool names stay on the allow-list, and a negative step count is refused."""
import pytest

from harnesslab.shallow.jobs import ShallowJobError, run_shallow_job
from harnesslab.shallow.store import MemoryStore

FIXTURE_KEY = "fixture-key"


def test_fixed_catalog_tools_still_run():
    job = run_shallow_job(MemoryStore(), "local", {
        "harness_id": "claude",
        "provider": "mock",
        "seed": 0,
    })
    assert job["passed"] is True
    assert job["steps"] == 6
    assert "bash" in job["tools"]


def test_unknown_tool_mcp_name_and_negative_steps():
    store = MemoryStore()
    minimal = {
        "harness_id": "min_x",
        "lane": "minimal",
        "provider": "mock",
        "prompt": "verify and modify the tests",
        "policy": "strict",
        "max_steps": 12,
        "cap_bytes": 1000,
        "mcp": "none",
    }
    with pytest.raises(ShallowJobError, match="Unknown tool") as unknown:
        run_shallow_job(store, "local", {**minimal, "tools": ["bad_tool"]})
    assert unknown.value.status == 400
    assert unknown.value.message == "Unknown tool."
    with pytest.raises(ShallowJobError) as mounted:
        run_shallow_job(store, "local", {**minimal, "tools": ["mcp_browser"]})
    assert mounted.value.status == 400
    assert mounted.value.message == "MCP tools are not mounted"
    with pytest.raises(ShallowJobError, match="not usable") as negative:
        run_shallow_job(store, "local", {
            "harness_id": "claude",
            "provider": "openrouter",
            "seed": 0,
            "api_key": FIXTURE_KEY,
        }, caller=lambda *_args: {"passed": True, "steps": -1})
    assert negative.value.status == 502
    assert FIXTURE_KEY not in negative.value.message
