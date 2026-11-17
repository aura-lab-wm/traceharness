import json
from pathlib import Path
import sys
import unittest

SOURCE = Path(sys.argv.pop(1)).resolve()
sys.path.insert(0, str(SOURCE / 'src'))
import requests
from requests.utils import _parse_content_type_header, get_encoding_from_headers
if not Path(requests.__file__).resolve().is_relative_to(SOURCE / 'src' / 'requests'):
    raise RuntimeError('Candidate source was not imported')


class RegressionChecks(unittest.TestCase):
    def test_malformed_flags_are_not_boolean_parameters(self):
        for header in ('text/plain; charset', 'text/plain; CHARSET ', 'text/plain; bogus; charset; ;'):
            with self.subTest(header=header):
                self.assertEqual(_parse_content_type_header(header), ('text/plain', {}))
                self.assertEqual(get_encoding_from_headers({'content-type': header}), 'ISO-8859-1')

    def test_valid_parameters_survive_mixed_malformed_flags(self):
        cases = [
            ('text/plain; charset=UTF-8; bogus', {'charset': 'UTF-8'}),
            ('text/plain; flag; Charset = "utf-8"; boundary=alpha=beta', {'charset': 'utf-8', 'boundary': 'alpha=beta'}),
            ("text/plain; charset='latin-1'; charset; empty=", {'charset': 'latin-1', 'empty': ''}),
            ('text/plain; charset=ascii; ignored; CHARSET=utf-8', {'charset': 'utf-8'}),
        ]
        for header, expected in cases:
            with self.subTest(header=header):
                self.assertEqual(_parse_content_type_header(header), ('text/plain', expected))
                self.assertEqual(get_encoding_from_headers({'content-type': header}), expected['charset'])

    def test_encoding_fallbacks_and_empty_headers_preserved(self):
        for header, expected in [('application/json; charset', 'utf-8'), ('application/octet-stream; charset', None), ('text/html; ignored', 'ISO-8859-1'), ('application/json; charset=', ''), ('text/html; charset=windows-1252', 'windows-1252')]:
            with self.subTest(header=header):
                self.assertEqual(get_encoding_from_headers({'content-type': header}), expected)
        for headers in ({}, {'content-type': ''}):
            self.assertIsNone(get_encoding_from_headers(headers))

    def test_response_decoding_uses_the_preserved_explicit_charset(self):
        for text, encoding in [('caf\u00e9', 'utf-8'), ('caf\u00e9', 'latin-1'), ('\u6771\u4eac', 'utf-8')]:
            response = requests.Response()
            response.headers['content-type'] = f'text/plain; flag; charset="{encoding}"; charset'
            response.encoding = get_encoding_from_headers(response.headers)
            response._content = text.encode(encoding)
            self.assertEqual(response.encoding, encoding)
            self.assertEqual(response.text, text)


if __name__ == '__main__':
    result = unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(RegressionChecks))
    print(json.dumps({'checks_run': result.testsRun, 'success': result.wasSuccessful()}), flush=True)
    raise SystemExit(0 if result.wasSuccessful() and result.testsRun == 4 else 1)
