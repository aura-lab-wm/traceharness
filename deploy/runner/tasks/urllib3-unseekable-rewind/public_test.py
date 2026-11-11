import json
from pathlib import Path
import sys
import unittest

SOURCE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SOURCE / 'src'))
import io
import urllib3
from urllib3.util.request import rewind_body, set_file_position
from urllib3.exceptions import UnrewindableBodyError
if not Path(urllib3.__file__).resolve().is_relative_to(SOURCE / 'src' / 'urllib3'):
    raise RuntimeError('Candidate source was not imported')


class PublicRegression(unittest.TestCase):
    def test_read_tell_upload_without_seek_reports_unrewindable(self):
        class Upload:
            def __init__(self):
                self.stream = io.BytesIO(b'upload payload')
            def read(self, amount=-1):
                return self.stream.read(amount)
            def tell(self):
                return self.stream.tell()
        body = Upload()
        position = set_file_position(body, None)
        body.read()
        with self.assertRaises(UnrewindableBodyError):
            set_file_position(body, position)
    def test_seekable_body_still_rewinds(self):
        body = io.BytesIO(b'upload payload')
        body.read()
        rewind_body(body, 0)
        self.assertEqual(body.read(), b'upload payload')


if __name__ == '__main__':
    unittest.main()
