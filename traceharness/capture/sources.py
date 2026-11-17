"""The session sources the capture spine can read, by the name a captured run records.

One tuple, read by the export/import code and by traceharness.shared.generate (which publishes it to
the console as `capture_sources`).
"""
SOURCES = ("claude_code", "codex", "agy", "qwen_code", "cursor")
