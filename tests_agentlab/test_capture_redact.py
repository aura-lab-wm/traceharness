"""Redaction rules for anything that leaves this machine (capture export)."""
import json
import os
import sys
import unittest

LAB = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, LAB)

from traceharness.capture import redact          # noqa: E402


class TestRedact(unittest.TestCase):
    CASES = [
        ("anthropic", "sk-ant-api03-" + "a" * 24, "sk-ant-short"),
        ("openrouter", "sk-or-v1-" + "a1" * 16, "sk-or-v1-abc"),
        ("openai", "sk-proj-" + "Ab1_" * 6, "sk-short1234"),
        ("github", "ghp_" + "a1B2" * 9, "ghp_" + "a" * 35),
        ("github", "github_pat_" + "a1_" * 14, "github_pat_" + "a" * 39),
        ("aws", "AKIA" + "A1B2C3D4E5F6G7H8", "AKIA" + "A1B2C3D4E5F6G7H"),
        ("supabase", "sbp_" + "a" * 40, "sbp_" + "a" * 39),
        ("supabase", "sb_secret_" + "a-_" * 8, "sb_secret_short"),
        ("google", "AIza" + "a" * 35, "AIza" + "a" * 34),
        ("slack", "xoxb-1234567890-abc", "xoxb-123"),
        ("traceharness", "thc_" + "a" * 20, "thc_" + "a" * 19),
        ("jwt", "eyJ" + "a" * 12 + "." + "b" * 12 + "." + "c" * 12, "eyJ" + "a" * 12 + "." + "b" * 12),
    ]

    def test_every_pattern_positive_and_near_miss(self):
        for kind, hit, miss in self.CASES:
            with self.subTest(kind=kind, sample=hit[:12]):
                out = redact.redact_text(f"before {hit} after")
                self.assertEqual(out, f"before [redacted:{kind}] after")
                self.assertEqual(redact.redact_text(f"before {miss} after"), f"before {miss} after")

    def test_specific_prefix_wins_over_openai(self):
        self.assertEqual(redact.redact_text("sk-ant-" + "a" * 30), "[redacted:anthropic]")
        self.assertEqual(redact.redact_text("sk-or-v1-" + "a" * 40), "[redacted:openrouter]")

    def test_pem_block_whole_and_truncated(self):
        pem = "-----BEGIN RSA PRIVATE KEY-----\nMIIEow\nabc\n-----END RSA PRIVATE KEY-----"
        self.assertEqual(redact.redact_text(f"k:\n{pem}\nok"), "k:\n[redacted:private-key]\nok")
        self.assertEqual(redact.redact_text("-----BEGIN PRIVATE KEY-----\nMIIE"), "[redacted:private-key]")
        pub = "-----BEGIN PUBLIC KEY-----\nMIIE\n-----END PUBLIC KEY-----"
        self.assertEqual(redact.redact_text(pub), pub)

    def test_key_value_forms_keep_the_key(self):
        cases = {
            "password = hunter2hunter2": "password = [redacted:secret]",
            "DB_PASSWORD=hunter2hunter2 next": "DB_PASSWORD=[redacted:secret] next",
            '{"api_key": "abcdefgh12345"}': '{"api_key": "[redacted:secret]"}',
            "export OPENAI_API_KEY='abcdefgh12345'": "export OPENAI_API_KEY='[redacted:secret]'",
            "access-token: abcdefgh": "access-token: [redacted:secret]",
            "authToken=abcdefgh": "authToken=[redacted:secret]",
            "secret: 12345678": "secret: [redacted:secret]",
        }
        for src, want in cases.items():
            with self.subTest(src=src):
                self.assertEqual(redact.redact_text(src), want)

    def test_key_value_near_misses(self):
        for s in ("password=short", "password: 1234567", "the password is hidden", "apikey",
                  "secret=[redacted:openai]"):
            with self.subTest(s=s):
                self.assertEqual(redact.redact_text(s), s)

    def test_forbidden_dict_keys_and_nesting(self):
        doc = {"a": [{"Authorization": "Bearer xyz", "n": 3}], "token": {"x": 1}, "ok": "fine",
               "msg": "sk-ant-" + "a" * 30, 5: "int key"}
        out = redact.redact(doc)
        self.assertEqual(out["a"][0]["Authorization"], "[redacted:forbidden-key]")
        self.assertEqual(out["a"][0]["n"], 3)
        self.assertEqual(out["token"], "[redacted:forbidden-key]")
        self.assertEqual(out["msg"], "[redacted:anthropic]")
        self.assertEqual(out["ok"], "fine")
        self.assertEqual(out["5"], "int key")
        self.assertIn("a", doc)                                   # the input is not mutated
        self.assertEqual(doc["token"], {"x": 1})

    def test_secret_mapping_keys_redact_without_losing_colliding_values(self):
        first, second = "thc_" + "A" * 43, "thc_" + "B" * 43
        doc = {"nested": [({first: 1, second: 2, "[redacted:traceharness]": 3,
                              "run_id": "unchanged"},)]}
        result = redact.redact(doc)
        encoded = json.dumps(result)
        self.assertNotIn(first, encoded)
        self.assertNotIn(second, encoded)
        mapping = result["nested"][0][0]
        self.assertEqual(len(mapping), 4)
        self.assertEqual(mapping["run_id"], "unchanged")
        self.assertEqual(mapping["[redacted:traceharness]"], 3)
        self.assertEqual(sorted(value for value in mapping.values() if isinstance(value, int)), [1, 2, 3])
        self.assertIn(first, doc["nested"][0][0])

    def test_long_trigger_run_is_linear(self):
        import time
        t = time.monotonic()
        redact.redact_text("password" * 50000)
        redact.redact_text("secret-" * 50000 + "=")
        self.assertLess(time.monotonic() - t, 5.0)

    def test_more_credential_shapes(self):
        cases = {
            'curl -H "Authorization: Bearer 8f3a9c2d1234567890abcdef"': 'curl -H "Authorization: [redacted:bearer]"',
            "git remote add o https://alice:ghs8Kd92jsLq0Pz3@github.com/o/r.git":
                "git remote add o https://[redacted:url-credentials]@github.com/o/r.git",
            "postgres://app:S3cretPassw0rd@db:5432/prod": "postgres://[redacted:url-credentials]@db:5432/prod",
            "sk_live_" + "a1" * 8: "[redacted:stripe]",
            "hf_" + "a" * 30: "[redacted:huggingface]",
            "npm_" + "b" * 30: "[redacted:npm]",
            "refresh_token: 1//0gabcdefgh": "refresh_token: [redacted:secret]",
            'password: "my long pass phrase"': 'password: "[redacted:secret]"',
            "see http://host:8080/x or me@example.org": "see http://host:8080/x or me@example.org",
        }
        for src, want in cases.items():
            with self.subTest(src=src[:30]):
                self.assertEqual(redact.redact_text(src), want)

    def test_sensitive_dict_keys_beyond_the_exact_set(self):
        out = redact.redact({"DB_PASSWORD": "hunter2hunter2", "client_secret": "x", "refresh_token": "r",
                             "X-Api-Key": "k", "max_tokens": 4096, "usage": {"tokens": {"in": 3}},
                             "note": "fine"})
        for k in ("DB_PASSWORD", "client_secret", "refresh_token", "X-Api-Key"):
            self.assertEqual(out[k], "[redacted:secret-key]", k)
        self.assertEqual(out["max_tokens"], 4096)
        self.assertEqual(out["usage"], {"tokens": {"in": 3}})
        self.assertEqual(out["note"], "fine")

    def test_forbidden_keys_are_the_documented_set(self):
        self.assertEqual(redact.FORBIDDEN_KEYS, frozenset({
            "api_key", "apikey", "key", "authorization", "token", "password", "secret", "access_token"}))


if __name__ == "__main__":
    unittest.main()
