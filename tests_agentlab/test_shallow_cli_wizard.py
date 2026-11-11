"""CLI wizard, catalog, and the live-key refusal. The env copy adds no key."""
import json
import os
import subprocess
import sys
from pathlib import Path

from traceharness.shallow.jobs import KEY_SENTENCE

ROOT = Path(__file__).resolve().parents[1]


def test_cli_wizard_catalog_and_key_refusal():
    exe = ROOT / ".venv" / "bin" / "python"
    if not exe.exists():
        exe = Path(sys.executable)
    env = os.environ.copy()
    for name in ("OPENROUTER_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GOOGLE_API_KEY"):
        env.pop(name, None)
    env["PYTHONPATH"] = str(ROOT) + os.pathsep + env.get("PYTHONPATH", "")
    wizard = subprocess.run(
        [str(exe), "-m", "traceharness.shallow", "wizard"],
        cwd=ROOT, env=env, capture_output=True, text=True, check=False,
    )
    assert wizard.returncode == 0, wizard.stderr
    built = json.loads(wizard.stdout)
    assert built["harness"]["id"] == "min_099dc52e693e"
    catalog = subprocess.run(
        [str(exe), "-m", "traceharness.shallow", "catalog"],
        cwd=ROOT, env=env, capture_output=True, text=True, check=False,
    )
    assert catalog.returncode == 0, catalog.stderr
    rows = json.loads(catalog.stdout)
    assert len(rows) == 6
    refused = subprocess.run(
        [str(exe), "-m", "traceharness.shallow", "run", "--provider", "openrouter", "--agent", "claude", "--seed", "0"],
        cwd=ROOT, env=env, capture_output=True, text=True, check=False,
    )
    assert refused.returncode == 2
    assert refused.stderr.strip() == KEY_SENTENCE
