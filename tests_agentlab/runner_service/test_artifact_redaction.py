"""Artifact integrity/secret-shape regressions; no model or production activity."""
import base64
import hashlib
import json
from pathlib import Path
import tempfile
import unittest

from harnesslab.runner_service.execution import DockerExecutor, _redacted


def encoded(value):
    return base64.urlsafe_b64encode(json.dumps(value, separators=(",", ":")).encode()).rstrip(b"=").decode()


def shaped_jwt(header=None, payload=None, signature=b"x" * 32):
    # Synthetic structure only. This is not a signed or usable session.
    return ".".join([encoded({"alg": "HS256", "typ": "JWT"} if header is None else header),
                     encoded({"sub": "explicit-fixture"} if payload is None else payload),
                     base64.urlsafe_b64encode(signature).rstrip(b"=").decode()])


class ArtifactRedactionTests(unittest.TestCase):
    def test_dotted_python_source_and_manifest_are_preserved_exactly(self):
        patch = b"+    return requests.exceptions.JSONDecodeError(message, document, position)\n"
        source = patch + "requests.exceptions.JSONDecodeError — π 🧪\n".encode()
        self.assertEqual(_redacted(source), source)
        manifest = json.dumps({"prompt": "Use requests.exceptions.JSONDecodeError.", "harness": {"notes": "abcdefgh.ijklmnop.qrstuvwx"}}).encode()
        self.assertEqual(_redacted(manifest), manifest)

    def test_structural_jwt_is_redacted_without_claiming_signature_authenticity(self):
        for value in [shaped_jwt(), shaped_jwt(payload={}), shaped_jwt({"alg": "RS256"}, {"note": "π"})]:
            with self.subTest(length=len(value)):
                self.assertEqual(_redacted(("token=" + value + ".").encode()), b"token=[redacted].")

    def test_invalid_json_or_non_object_claims_and_short_signatures_are_not_jwts(self):
        values = [shaped_jwt(header=[]), shaped_jwt(header={"alg": 1}), shaped_jwt(header={"typ": "JWT"}),
                  shaped_jwt(payload=[]), shaped_jwt(payload="source text"), shaped_jwt(signature=b"short"),
                  "abcdefgh.ijklmnop." + "A" * 43]
        for value in values:
            with self.subTest(value=value):
                self.assertEqual(_redacted(value.encode()), value.encode())

    def test_provider_keys_and_bearer_values_remain_redacted(self):
        value = b"sk-or-v1-" + b"x" * 32 + b" Bearer opaque-fixture-authorization-value"
        self.assertEqual(_redacted(value), b"[redacted] Bearer [redacted]")

    def test_persisted_download_hashes_describe_intact_source_and_manifest_bytes(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "output").mkdir()
            patch = b"+    return requests.exceptions.JSONDecodeError(message, document, position)\n"
            (root / "output" / "patch.diff").write_bytes(patch)
            manifest = {"prompt": "Inspect requests.exceptions.JSONDecodeError", "version": 1}
            executor = DockerExecutor(None, None)
            artifacts, issues = executor.persist_artifacts(root, manifest, grade="passed")
            self.assertEqual(issues, [])
            self.assertEqual((root / "patch.diff").read_bytes(), patch)
            self.assertEqual(json.loads((root / "manifest.json").read_bytes()), manifest)
            for item in artifacts:
                raw = (root / item["name"]).read_bytes()
                self.assertEqual(item["bytes"], len(raw))
                self.assertEqual(item["sha256"], hashlib.sha256(raw).hexdigest())


if __name__ == "__main__":
    unittest.main()
