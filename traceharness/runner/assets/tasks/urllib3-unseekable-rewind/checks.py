import json
from pathlib import Path
import sys
import unittest

SOURCE = Path(sys.argv.pop(1)).resolve()
sys.path.insert(0, str(SOURCE / 'src'))
import io
import urllib3
from urllib3.util.request import rewind_body, set_file_position
from urllib3.exceptions import UnrewindableBodyError
if not Path(urllib3.__file__).resolve().is_relative_to(SOURCE / 'src' / 'urllib3'):
    raise RuntimeError('Candidate source was not imported')


class ReadTellOnly:
    def __init__(self, value=b'actual upload body'):
        self.stream = io.BytesIO(value)
    def read(self, amount=-1):
        return self.stream.read(amount)
    def tell(self):
        return self.stream.tell()


class RegressionChecks(unittest.TestCase):
    def test_recorded_positions_on_unseekable_bodies_raise_rewind_error(self):
        for consumed in (0, 3, 17):
            body = ReadTellOnly()
            body.read(consumed)
            position = set_file_position(body, None)
            self.assertIsInstance(position, int)
            self.assertEqual(position, consumed)
            with self.assertRaisesRegex(UnrewindableBodyError, 'seek'):
                set_file_position(body, position)
            self.assertEqual(body.tell(), consumed)

    def test_explicit_missing_or_none_seek_has_same_error(self):
        for body in (ReadTellOnly(), object()):
            for position in (0, 1, 9):
                with self.subTest(body=type(body).__name__, position=position):
                    with self.assertRaises(UnrewindableBodyError):
                        rewind_body(body, position)
        body = ReadTellOnly()
        body.seek = None
        with self.assertRaises(UnrewindableBodyError):
            rewind_body(body, 0)

    def test_seekable_streams_and_invalid_position_errors_preserved(self):
        for position in (0, 3, 16):
            body = io.BytesIO(b'0123456789abcdef')
            body.read()
            self.assertIsNone(rewind_body(body, position))
            self.assertEqual(body.tell(), position)
            self.assertEqual(body.read(), b'0123456789abcdef'[position:])
        for position in ('0', None, 1.5, object()):
            with self.subTest(position=type(position).__name__), self.assertRaises(ValueError):
                rewind_body(io.BytesIO(b'upload'), position)

    def test_failed_tell_and_seek_keep_existing_error_causes(self):
        class FailedTell(ReadTellOnly):
            def tell(self):
                raise OSError('tell unavailable')
        failed = FailedTell()
        recorded = set_file_position(failed, None)
        with self.assertRaisesRegex(UnrewindableBodyError, 'record file position'):
            rewind_body(failed, recorded)
        class FailedSeek(io.BytesIO):
            def seek(self, position):
                raise OSError('seek unavailable')
        with self.assertRaises(UnrewindableBodyError) as caught:
            rewind_body(FailedSeek(b'upload'), 0)
        self.assertIsInstance(caught.exception.__cause__, OSError)
        self.assertEqual(str(caught.exception.__cause__), 'seek unavailable')


if __name__ == '__main__':
    result = unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(RegressionChecks))
    print(json.dumps({'checks_run': result.testsRun, 'success': result.wasSuccessful()}), flush=True)
    raise SystemExit(0 if result.wasSuccessful() and result.testsRun == 4 else 1)
