"""Independent offline URL-target checks; no sockets or proxy connection."""
import json
from pathlib import Path
import sys
import unittest

SOURCE = Path(sys.argv.pop(1)).resolve()
sys.path.insert(0, str(SOURCE / 'src'))
import requests
if not Path(requests.__file__).resolve().is_relative_to(SOURCE / 'src' / 'requests'):
    raise RuntimeError('Candidate source was not imported')


class RegressionChecks(unittest.TestCase):
    def target(self, url, proxies=None):
        prepared = requests.Request('GET', url).prepare()
        original = prepared.url
        result = requests.adapters.HTTPAdapter().request_url(prepared, proxies or {})
        self.assertEqual(prepared.url, original)
        return result

    def test_origin_form_normalizes_only_leading_slashes(self):
        for path, expected in [('//v:h', '/v:h'), ('////v:h?x=1//2', '/v:h?x=1//2'),
                               ('///', '/'), ('//a//b/%2F?q=//&v=x:y#discard', '/a//b/%2F?q=//&v=x:y')]:
            with self.subTest(path=path):
                self.assertEqual(self.target('http://example.invalid' + path), expected)

    def test_https_and_socks_keep_origin_form(self):
        cases = [
            ('https://example.invalid///a:b', {}),
            ('https://example.invalid///a:b', {'https': 'http://proxy.invalid:8080'}),
            ('http://example.invalid///a:b', {'http': 'socks5://proxy.invalid:1080'}),
            ('http://example.invalid///a:b', {'http': 'socks5h://proxy.invalid:1080'}),
            ('https://[::1]///a:b', {}),
        ]
        for url, proxies in cases:
            with self.subTest(url=url, proxies=proxies):
                self.assertEqual(self.target(url, proxies), '/a:b')

    def test_forward_http_proxy_preserves_absolute_form_and_strips_auth(self):
        proxies = {'http': 'http://proxy.invalid:8080'}
        for url, expected in [
            ('http://example.invalid//a:b?x=//', 'http://example.invalid//a:b?x=//'),
            ('http://user:pass@example.invalid///a:b#discard', 'http://example.invalid///a:b'),
        ]:
            self.assertEqual(self.target(url, proxies), expected)

    def test_normal_paths_queries_and_escapes_are_unchanged(self):
        for path, expected in [('', '/'), ('/', '/'), ('/a//b', '/a//b'),
                               ('/%2F/a?x=%2F%2F', '/%2F/a?x=%2F%2F'), ('/café', '/caf%C3%A9')]:
            self.assertEqual(self.target('https://example.invalid' + path), expected)


if __name__ == '__main__':
    result = unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(RegressionChecks))
    print(json.dumps({'checks_run': result.testsRun, 'success': result.wasSuccessful()}), flush=True)
    raise SystemExit(0 if result.wasSuccessful() and result.testsRun == 4 else 1)
