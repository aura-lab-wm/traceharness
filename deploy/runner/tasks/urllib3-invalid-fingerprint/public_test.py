import json
from pathlib import Path
import sys
import unittest

SOURCE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SOURCE / 'src'))
import binascii
import hashlib
import urllib3
from urllib3.util.ssl_ import assert_fingerprint
from urllib3.exceptions import SSLError
if not Path(urllib3.__file__).resolve().is_relative_to(SOURCE / 'src' / 'urllib3'):
    raise RuntimeError('Candidate source was not imported')


class PublicRegression(unittest.TestCase):
    def test_malformed_supported_length_fingerprint_raises_sslerror(self):
        with self.assertRaises(SSLError) as caught:
            assert_fingerprint(b'offline certificate bytes', 'z' * 64)
        self.assertIsInstance(caught.exception.__cause__, binascii.Error)
    def test_valid_sha256_fingerprint_still_matches(self):
        cert = b'offline certificate bytes'
        self.assertIsNone(assert_fingerprint(cert, hashlib.sha256(cert).hexdigest()))


if __name__ == '__main__':
    unittest.main()
