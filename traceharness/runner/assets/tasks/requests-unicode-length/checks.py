"""Independent offline body-length regression and preservation checks."""
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest

SOURCE = Path(sys.argv.pop(1)).resolve()
sys.path.insert(0, str(SOURCE / 'src'))
import requests
if not Path(requests.__file__).resolve().is_relative_to(SOURCE / 'src' / 'requests'):
    raise RuntimeError('Candidate source was not imported')


class RegressionChecks(unittest.TestCase):
    def test_unicode_length_uses_independent_utf8_oracle(self):
        for text in ('', 'ascii', 'café', 'e\u0301', '東京', '👍👎', '\x00α🙂', '🙂' * 65):
            with self.subTest(text=text):
                self.assertEqual(requests.utils.super_len(text), len(text.encode('utf-8')))

    def test_prepared_upload_length_preserves_entire_payload(self):
        for method in ('POST', 'PUT', 'PATCH'):
            for body in ('👍👎', '{"name":"café","city":"東京"}', 'line\nα\n🙂'):
                prepared = requests.Request(method, 'https://example.invalid/upload', data=body).prepare()
                wire = body.encode('utf-8')
                length = int(prepared.headers['Content-Length'])
                self.assertEqual(length, len(wire))
                self.assertEqual(wire[:length], wire)
                self.assertEqual(prepared.body, body)
                self.assertIs(type(prepared.body), str)

    def test_binary_and_file_lengths_and_positions_preserved(self):
        for body in (b'', b'\x00\xff\x80', bytearray(b'\x00\xff\x80')):
            self.assertEqual(requests.utils.super_len(body), len(body))
        for position in (0, 2, 6, 20):
            stream = io.BytesIO(b'abcdef')
            stream.seek(position)
            self.assertEqual(requests.utils.super_len(stream), max(0, 6 - position))
            self.assertEqual(stream.tell(), position)
        with tempfile.TemporaryFile('w+b') as stream:
            stream.write(b'0123456789')
            stream.seek(3)
            self.assertEqual(requests.utils.super_len(stream), 7)
            self.assertEqual(stream.tell(), 3)

    def test_unsized_and_ascii_inputs_retain_existing_behavior(self):
        class Sized:
            def __len__(self):
                return 17
        self.assertEqual(requests.utils.super_len(Sized()), 17)
        self.assertEqual(requests.utils.super_len(iter([b'one', b'two'])), 0)
        stream = io.StringIO('abcdef')
        stream.seek(2)
        self.assertEqual(requests.utils.super_len(stream), 4)
        self.assertEqual(stream.tell(), 2)
        for body in ('ASCII body', b'ASCII body'):
            prepared = requests.Request('POST', 'https://example.invalid/', data=body).prepare()
            self.assertEqual(int(prepared.headers['Content-Length']), len(body))


if __name__ == '__main__':
    result = unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(RegressionChecks))
    print(json.dumps({'checks_run': result.testsRun, 'success': result.wasSuccessful()}), flush=True)
    raise SystemExit(0 if result.wasSuccessful() and result.testsRun == 4 else 1)
