"""Independent netrc/auth checks against temporary files, never host credentials."""
import base64
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

SOURCE = Path(sys.argv.pop(1)).resolve()
sys.path.insert(0, str(SOURCE / 'src'))
import requests
if not Path(requests.__file__).resolve().is_relative_to(SOURCE / 'src' / 'requests'):
    raise RuntimeError('Candidate source was not imported')


class RegressionChecks(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.netrc = Path(self.directory.name) / 'case.netrc'
        self.environment = patch.dict(os.environ, {'NETRC': str(self.netrc)})
        self.environment.start()
        self.addCleanup(self.environment.stop)

    def prepare(self, **kwargs):
        return requests.Session().prepare_request(requests.Request('GET', 'https://example.invalid/', **kwargs))

    def test_empty_default_and_named_entries_do_not_inject_auth(self):
        for content in ('default\n', 'machine example.invalid\n', 'default login "" password ""\n'):
            with self.subTest(content=content):
                self.netrc.write_text(content)
                self.assertIsNone(requests.utils.get_netrc_auth('https://example.invalid/'))
                self.assertNotIn('Authorization', self.prepare().headers)
                self.assertEqual(self.prepare(headers={'Authorization': 'Bearer public-fixture'}).headers['Authorization'], 'Bearer public-fixture')

    def test_populated_and_partial_credentials_remain_supported(self):
        cases = [
            ('machine example.invalid login alice password secret\n', ('alice', 'secret')),
            ('default login bob password value\n', ('bob', 'value')),
            ('machine example.invalid account account-name password value\n', ('account-name', 'value')),
            ('machine example.invalid login alice\n', ('alice', '')),
            ('machine example.invalid password secret\n', ('', 'secret')),
        ]
        for content, expected in cases:
            with self.subTest(content=content):
                self.netrc.write_text(content)
                self.assertEqual(requests.utils.get_netrc_auth('https://example.invalid/'), expected)
                token = base64.b64encode((':'.join(expected)).encode('latin-1')).decode('ascii')
                self.assertEqual(self.prepare().headers['Authorization'], 'Basic ' + token)

    def test_empty_named_entry_does_not_override_explicit_auth(self):
        self.netrc.write_text('machine example.invalid\n')
        self.assertEqual(self.prepare(auth=('', '')).headers['Authorization'], 'Basic Og==')
        self.assertEqual(self.prepare(auth=('explicit', 'value')).headers['Authorization'], 'Basic ZXhwbGljaXQ6dmFsdWU=')
        session = requests.Session()
        session.trust_env = False
        self.netrc.write_text('default login unwanted password value\n')
        self.assertNotIn('Authorization', session.prepare_request(requests.Request('GET', 'https://example.invalid/')).headers)

    def test_missing_and_nonmatching_entries_remain_ignored(self):
        self.assertIsNone(requests.utils.get_netrc_auth('https://example.invalid/'))
        self.netrc.write_text('machine other.invalid login other password value\n')
        self.assertIsNone(requests.utils.get_netrc_auth('https://example.invalid/'))
        self.assertNotIn('Authorization', self.prepare().headers)
        self.netrc.write_text('machine example.invalid login alice password secret\ndefault\n')
        self.assertEqual(requests.utils.get_netrc_auth('https://example.invalid/'), ('alice', 'secret'))
        self.assertIsNone(requests.utils.get_netrc_auth('https://unlisted.invalid/'))


if __name__ == '__main__':
    result = unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(RegressionChecks))
    print(json.dumps({'checks_run': result.testsRun, 'success': result.wasSuccessful()}), flush=True)
    raise SystemExit(0 if result.wasSuccessful() and result.testsRun == 4 else 1)
