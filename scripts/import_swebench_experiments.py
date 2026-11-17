#!/usr/bin/env python3
"""Import a SWE-bench `experiments` submission into a TraceHarness dataset.

Thin wrapper kept so the documented command keeps working; the importer lives in
traceharness/importers_swebench.py and is also `traceharness import-swebench`.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from traceharness.importers_swebench import main  # noqa: E402

if __name__ == "__main__":
    sys.exit(main())
