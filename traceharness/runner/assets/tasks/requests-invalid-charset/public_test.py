import json
from pathlib import Path
import sys
import unittest

SOURCE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SOURCE / 'src'))
import requests
from requests.utils import _parse_content_type_header, get_encoding_from_headers
if not Path(requests.__file__).resolve().is_relative_to(SOURCE / 'src' / 'requests'):
    raise RuntimeError('Candidate source was not imported')


class PublicRegression(unittest.TestCase):
    def test_charset_flag_does_not_crash_encoding_selection(self):
        self.assertEqual(get_encoding_from_headers({'content-type': 'text/plain; charset'}), 'ISO-8859-1')
    def test_malformed_trailing_flag_does_not_overwrite_valid_charset(self):
        self.assertEqual(_parse_content_type_header('text/plain; charset="utf-8"; charset'), ('text/plain', {'charset': 'utf-8'}))


if __name__ == '__main__':
    unittest.main()
