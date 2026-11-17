import json
from pathlib import Path
import sys
import unittest

SOURCE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SOURCE / 'src'))
import gzip
import io
import zlib
import urllib3
from urllib3.response import HTTPResponse
if not Path(urllib3.__file__).resolve().is_relative_to(SOURCE / 'src' / 'urllib3'):
    raise RuntimeError('Candidate source was not imported')


class PublicRegression(unittest.TestCase):
    def test_partial_then_remaining_read_retains_all_decoded_bytes(self):
        payload = b'upstream compressed response data\n' * 300
        stream = HTTPResponse(body=io.BytesIO(gzip.compress(payload, mtime=0)), headers={'content-encoding': 'gzip'}, preload_content=False, decode_content=True)
        self.assertEqual(stream.read(512) + stream.read(), payload)
    def test_plain_response_remains_identical(self):
        payload = bytes(range(256)) * 5
        stream = HTTPResponse(body=io.BytesIO(payload), preload_content=False)
        self.assertEqual(stream.read(37) + stream.read(), payload)


if __name__ == '__main__':
    unittest.main()
