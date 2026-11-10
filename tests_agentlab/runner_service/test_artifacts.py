"""Signed service artifact boundary fixtures; no real account, Docker or provider."""
import base64
import hashlib
import os
import unittest

from tests_agentlab.runner_service import test_runner as fixtures

OWNER, OTHER = fixtures.OWNER, fixtures.OTHER


class ArtifactTests(unittest.TestCase):
    setUp = fixtures.RunnerTests.setUp
    tearDown = fixtures.RunnerTests.tearDown
    request = fixtures.RunnerTests.request

    def fixture_artifact(self, raw=b"fixture patch\n", name="patch.diff"):
        jid = "d" * 48
        directory = self.app.state.jobs.root / jid
        directory.mkdir(exist_ok=True)
        path = directory / name
        path.write_bytes(raw)
        metadata = {"name": name, "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()}
        self.app.state.jobs.rows[jid] = {"owner": OWNER, "job": {"id": jid, "status": "succeeded", "artifacts": [metadata]}}
        return f"/api/runner/jobs/{jid}/artifacts/{name}", path, metadata

    def assert_denied(self, response, status):
        self.assertEqual(response.status_code, status, response.text)
        self.assertNotIn("access-control-allow-origin", response.headers)
        self.assertEqual(response.headers["cache-control"], "no-store")

    def test_signed_owner_receives_exact_unicode_and_binary_bytes(self):
        raw = "Fixture\nπ 日本語 🧪".encode() + b"\x00\xff"
        route, _, metadata = self.fixture_artifact(raw)
        response = self.request("GET", route)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.headers["cache-control"], "no-store")
        self.assertNotIn("access-control-allow-origin", response.headers)
        body = response.json()
        self.assertEqual({k: body[k] for k in metadata}, metadata)
        self.assertEqual(body["encoding"], "base64")
        self.assertEqual(base64.b64decode(body["content"], validate=True), raw)

    def test_anonymous_and_other_member_cannot_download_or_infer_artifact(self):
        route, _, _ = self.fixture_artifact()
        self.assert_denied(self.client.get(route, headers={"Origin": "https://hostile.invalid"}), 401)
        foreign = self.request("GET", route, owner=OTHER)
        absent = self.request("GET", route.replace("d" * 48, "e" * 48), owner=OTHER)
        self.assert_denied(foreign, 404)
        self.assertEqual(foreign.json(), absent.json())

    def test_unlisted_or_unknown_artifacts_are_not_exposed(self):
        route, path, _ = self.fixture_artifact()
        (path.parent / "summary.json").write_text('{"private":"not finalized"}')
        (path.parent / "secret.txt").write_text("fixture private data")
        for name in ["summary.json", "secret.txt", "job.json"]:
            with self.subTest(name=name):
                self.assert_denied(self.request("GET", route.replace("patch.diff", name)), 404)

    def test_post_finalization_content_or_size_change_fails_integrity(self):
        route, path, metadata = self.fixture_artifact()
        path.write_bytes(b"different but bounded")
        self.assert_denied(self.request("GET", route), 409)
        metadata["bytes"] = path.stat().st_size
        self.assert_denied(self.request("GET", route), 409)
        path.unlink()
        self.assert_denied(self.request("GET", route), 409)

    def test_symlink_directory_and_fifo_are_refused_without_blocking(self):
        route, path, _ = self.fixture_artifact()
        target = path.parent / "private.txt"
        target.write_text("fixture private contents")
        path.unlink()
        path.symlink_to(target)
        self.assert_denied(self.request("GET", route), 409)
        path.unlink()
        path.mkdir()
        self.assert_denied(self.request("GET", route), 409)
        path.rmdir()
        os.mkfifo(path)
        self.assert_denied(self.request("GET", route), 409)

    def test_exact_one_mib_is_allowed_and_one_byte_larger_is_refused(self):
        route, path, _ = self.fixture_artifact(b"x" * (1024 * 1024))
        response = self.request("GET", route)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(base64.b64decode(response.json()["content"])), 1024 * 1024)
        with path.open("ab") as stream:
            stream.write(b"x")
        self.assert_denied(self.request("GET", route), 409)

    def test_encoded_traversal_query_and_changed_signature_do_not_release_content(self):
        route, _, _ = self.fixture_artifact()
        for suffix in ["%2e%2e%2fjob.json", "patch.diff%2fextra"]:
            with self.subTest(suffix=suffix):
                response = self.request("GET", route.replace("patch.diff", suffix))
                self.assertIn(response.status_code, [401, 404])
                self.assertNotIn("content", response.json())
        self.assert_denied(self.request("GET", route + "?owner=" + OWNER), 404)
        self.assert_denied(self.request("GET", route, extra={"x-traceharness-signature": "0" * 64}), 401)


if __name__ == "__main__":
    unittest.main()
