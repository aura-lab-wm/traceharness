#!/usr/bin/env python3
"""Pointer: the builder moved into the package as traceharness.runner.package_task (it ships in the wheel)."""
import runpy
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.exit(runpy.run_module("traceharness.runner.package_task", run_name="__main__") and 0)
