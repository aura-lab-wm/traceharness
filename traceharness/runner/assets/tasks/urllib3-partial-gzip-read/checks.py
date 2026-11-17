import json
from pathlib import Path
import sys
import unittest

SOURCE = Path(sys.argv.pop(1)).resolve()
sys.path.insert(0, str(SOURCE / 'src'))
import gzip
import io
import zlib
import urllib3
from urllib3.response import HTTPResponse
if not Path(urllib3.__file__).resolve().is_relative_to(SOURCE / 'src' / 'urllib3'):
    raise RuntimeError('Candidate source was not imported')


def response(payload, encoding='gzip', decode=True):
    encoded = gzip.compress(payload, mtime=0) if encoding == 'gzip' else zlib.compress(payload)
    return HTTPResponse(body=io.BytesIO(encoded), headers={'content-encoding': encoding}, preload_content=False, decode_content=decode)


class RegressionChecks(unittest.TestCase):
    def test_partial_then_unbounded_gzip_read_preserves_every_byte(self):
        for payload in (b'a' * 4096, bytes(range(256)) * 31, 'caf\u00e9 \u6771\u4eac\n'.encode() * 300):
            for amount in (1, 7, 127, 512):
                with self.subTest(length=len(payload), amount=amount):
                    stream = response(payload)
                    prefix = stream.read(amount)
                    rest = stream.read()
                    self.assertEqual(prefix, payload[:amount])
                    self.assertEqual(rest, payload[amount:])
                    self.assertEqual(prefix + rest, payload)
                    self.assertEqual(stream.read(), b'')

    def test_multiple_partial_reads_then_remainder_and_deflate(self):
        payload = (bytes(range(251)) + b'z' * 2048) * 3
        for encoding in ('gzip', 'deflate'):
            stream = response(payload, encoding)
            chunks = [stream.read(amount) for amount in (5, 17, 511)]
            self.assertEqual(b''.join(chunks), payload[:533])
            self.assertEqual(b''.join(chunks) + stream.read(), payload)
            self.assertEqual(stream.read(9), b'')

    def test_uncompressed_and_raw_compressed_reads_stay_unchanged(self):
        payload = b'plain bytes\x00\xff' * 300
        plain = HTTPResponse(body=io.BytesIO(payload), preload_content=False)
        self.assertEqual(plain.read(19) + plain.read(), payload)
        raw = gzip.compress(payload, mtime=0)
        stream = HTTPResponse(body=io.BytesIO(raw), headers={'content-encoding': 'gzip'}, preload_content=False, decode_content=False)
        self.assertEqual(stream.read(8) + stream.read(), raw)

    def test_unbounded_decode_cache_and_empty_payload_preserved(self):
        for payload in (b'', b'tiny', bytes(range(256)) * 5):
            stream = response(payload)
            self.assertEqual(stream.read(cache_content=True), payload)
            self.assertEqual(stream.data, payload)
            self.assertEqual(stream.data, payload)
            self.assertEqual(stream.read(), b'')


if __name__ == '__main__':
    result = unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(RegressionChecks))
    print(json.dumps({'checks_run': result.testsRun, 'success': result.wasSuccessful()}), flush=True)
    raise SystemExit(0 if result.wasSuccessful() and result.testsRun == 4 else 1)
