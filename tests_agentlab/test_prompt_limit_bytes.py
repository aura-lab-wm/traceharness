"""One prompt-limit rule (SPEC 4.6): a block prompt is capped at 20000 UTF-8 bytes, not characters.

The Worker's member compiler has always counted bytes (`new TextEncoder().encode(prompt).length`);
Python counted characters, so a prompt of 10,001 `é` (20,002 bytes) compiled here and was refused
there, and the parity battery had to tolerate exactly that difference. One rule, counted in bytes.
"""
import os
import sys
import unittest

LAB = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, LAB)

from traceharness.core import blocks as B          # noqa: E402
from traceharness.shared import contract           # noqa: E402


def _with_prompt(text: str) -> list[dict]:
    return [{"type": "prompt", "text": text},
            {"type": "tools", "names": ["list_files", "read_file", "edit_file", "run_tests", "submit"]},
            {"type": "policy", "mode": "strict"},
            {"type": "stop", "max_steps": 12, "max_total_tokens": 400000}]


class TestPromptLimitBytes(unittest.TestCase):
    def test_a_prompt_over_20000_utf8_bytes_is_refused(self):
        out = B.compile_blocks(_with_prompt("é" * 10_001))          # 10,001 characters, 20,002 bytes
        self.assertFalse(out["ok"], "a 20,002-byte prompt compiled")
        self.assertTrue(any("20000 UTF-8 bytes" in e for e in out["errors"]), out["errors"])

    def test_prompts_at_exactly_20000_bytes_compile(self):
        for text in ("é" * 10_000, "🙂" * 5_000, "a" * 20_000):
            with self.subTest(chars=len(text), bytes=len(text.encode("utf-8"))):
                out = B.compile_blocks(_with_prompt(text))
                self.assertTrue(out["ok"], out["errors"])

    def test_the_limit_is_the_contract_limit(self):
        self.assertEqual(B.PROMPT_MAX_BYTES, 20_000)
        self.assertEqual(B.PROMPT_MAX_BYTES, contract.PROMPT_MAX_BYTES)


if __name__ == "__main__":
    unittest.main()
