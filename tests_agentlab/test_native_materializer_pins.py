"""The native prompt materializers are frozen to the byte (plan rule R1).

materializer_sha256() hashes the exact bytes of native_prompts.py, native_prompts_elf.py and
native_prompts_codex.py, and every deployed inventory and mechanism receipt pins that digest:
a comment edit would make the runner refuse every inventory at its next release.
native_observations.py is not hashed, but it runs only in the deployed runner and is frozen
with them. A change to any of these files must be a deliberate runner release that re-prepares
every inventory, and then these pins change in the same commit.
"""
import hashlib
from pathlib import Path
import unittest

from traceharness.runner_service import native_prompts as N
from traceharness.runner_service import native_prompts_codex as C

RUNNER_SERVICE = Path(N.__file__).resolve().parent
FILE_SHA256 = {
    "native_prompts.py": "9dadeb9927f6181ba14eb2ed67595630ae6725bceb8ff4defa6f5592df2db937",
    "native_prompts_elf.py": "d1765e409fc6f8b22cdabf7b0b235c28c1a483a09cbf0964dff3eba682c17eff",
    "native_prompts_codex.py": "8920b978ac15efa739f4f902a439dcc62bb7d086f17a496a3994b2be04ae61d8",
    "native_observations.py": "6778e087351d9486461c5aeeeb402f6a80240be17e4ce173a0d1ee7d7024826c",
}
CLAUDE_MATERIALIZER = "ba6245da8b07901b6793898e70e2e974a1e641a2c3be0d357ba53d15101f4081"
CODEX_MATERIALIZER = "8a1ee9f8fba86a80c057f7712d4aeddb02096ec17f3c22451ecaf5ded9c1c185"
TAXONOMY = "6064ebcb6693a1dd7b3e50fbfbcc94ff959f7957ac184188fd91744900a429a3"


class FrozenNativeMaterializers(unittest.TestCase):
    def test_frozen_files_are_byte_identical(self):
        for name, expected in FILE_SHA256.items():
            with self.subTest(file=name):
                self.assertEqual(hashlib.sha256((RUNNER_SERVICE / name).read_bytes()).hexdigest(), expected,
                                 f"{name} changed; deployed inventories and receipts pin these bytes (rule R1)")

    def test_deployed_identities_are_unchanged(self):
        self.assertEqual(N.materializer_sha256(), CLAUDE_MATERIALIZER)
        self.assertEqual(C.materializer_sha256(), CODEX_MATERIALIZER)
        self.assertEqual(N.taxonomy_sha256(), TAXONOMY)

    def test_the_offline_tools_do_not_import_the_service_or_the_web_server(self):
        source = (RUNNER_SERVICE / "native_prompt_tools.py").read_text(encoding="utf-8")
        imports = [line.strip() for line in source.splitlines() if line.lstrip().startswith(("import ", "from "))]
        for line in imports:
            self.assertNotRegex(line, r"execution|service|configuration|experiments|fastapi|uvicorn|socket|urllib|http|requests", line)
        cli = (RUNNER_SERVICE / "native_prompt_cli.py").read_text(encoding="utf-8")
        for line in (line.strip() for line in cli.splitlines() if line.lstrip().startswith(("import ", "from "))):
            self.assertNotRegex(line, r"execution|service|configuration|experiments|fastapi|uvicorn|socket|urllib|http|requests", line)


if __name__ == "__main__":
    unittest.main()
