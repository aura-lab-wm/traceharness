import json
from pathlib import Path
import sys
import unittest

SOURCE = Path(sys.argv.pop(1)).resolve()
sys.path.insert(0, str(SOURCE / 'src'))
import binascii
import hashlib
import urllib3
from urllib3.util.ssl_ import assert_fingerprint
from urllib3.exceptions import SSLError
if not Path(urllib3.__file__).resolve().is_relative_to(SOURCE / 'src' / 'urllib3'):
    raise RuntimeError('Candidate source was not imported')


CERTIFICATE_BYTES = b'Offline certificate fingerprint input\x00\xff' * 9


class RegressionChecks(unittest.TestCase):
    def test_malformed_hex_uses_sslerror_and_preserves_original_cause(self):
        for size in (32, 40, 64):
            for fingerprint in ('z' * size, '0' * (size - 1) + 'g', '!' + 'a' * (size - 1)):
                with self.subTest(size=size, fingerprint=fingerprint[:3]):
                    with self.assertRaises(SSLError) as caught:
                        assert_fingerprint(CERTIFICATE_BYTES, fingerprint)
                    self.assertIsInstance(caught.exception.__cause__, binascii.Error)
                    self.assertEqual(str(caught.exception), str(caught.exception.__cause__))

    def test_actual_hashes_case_and_colon_formatting_still_match(self):
        for name in ('md5', 'sha1', 'sha256'):
            digest = hashlib.new(name, CERTIFICATE_BYTES).hexdigest()
            for fingerprint in (digest, digest.upper(), ':'.join(digest[i:i+2] for i in range(0, len(digest), 2))):
                with self.subTest(hash=name, fingerprint=fingerprint[:3]):
                    self.assertIsNone(assert_fingerprint(CERTIFICATE_BYTES, fingerprint))

    def test_mismatch_and_unsupported_lengths_remain_ssl_failures(self):
        for size in (32, 40, 64):
            with self.assertRaisesRegex(SSLError, 'did not match'):
                assert_fingerprint(CERTIFICATE_BYTES, '0' * size)
        for value in ('', '0', '00', 'a' * 31, 'a' * 33, 'a' * 128):
            with self.subTest(length=len(value)), self.assertRaisesRegex(SSLError, 'invalid length'):
                assert_fingerprint(CERTIFICATE_BYTES, value)

    def test_missing_certificate_and_colon_normalization_preserved(self):
        with self.assertRaisesRegex(SSLError, 'No certificate'):
            assert_fingerprint(None, 'not-even-hex')
        for size in (32, 40, 64):
            malformed = ':'.join(['zz'] * (size // 2))
            with self.assertRaises(SSLError) as caught:
                assert_fingerprint(CERTIFICATE_BYTES, malformed)
            self.assertIsInstance(caught.exception.__cause__, binascii.Error)


if __name__ == '__main__':
    result = unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(RegressionChecks))
    print(json.dumps({'checks_run': result.testsRun, 'success': result.wasSuccessful()}), flush=True)
    raise SystemExit(0 if result.wasSuccessful() and result.testsRun == 4 else 1)
