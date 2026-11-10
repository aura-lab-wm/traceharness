"""Offline reproduction of Requests issue #6928, using only a temporary netrc."""
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import requests


class PublicRegression(unittest.TestCase):
    def test_empty_default_does_not_inject_authorization(self):
        with tempfile.TemporaryDirectory() as directory:
            netrc = Path(directory) / 'test.netrc'
            netrc.write_text('default\n')
            with patch.dict(os.environ, {'NETRC': str(netrc)}):
                self.assertIsNone(requests.utils.get_netrc_auth('https://example.invalid/'))
                prepared = requests.Session().prepare_request(requests.Request('GET', 'https://example.invalid/'))
                self.assertNotIn('Authorization', prepared.headers)

    def test_explicit_empty_auth_remains_supported(self):
        prepared = requests.Request('GET', 'https://example.invalid/', auth=('', '')).prepare()
        self.assertEqual(prepared.headers['Authorization'], 'Basic Og==')


if __name__ == '__main__':
    unittest.main()
