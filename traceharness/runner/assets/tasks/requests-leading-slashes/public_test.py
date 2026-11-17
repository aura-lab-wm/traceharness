"""Offline reproduction of Requests issue #6643 at the HTTP adapter boundary."""
import unittest
import requests


class PublicRegression(unittest.TestCase):
    def test_origin_form_trims_excess_leading_slashes(self):
        prepared = requests.Request('GET', 'http://example.invalid//v:h?x=1').prepare()
        self.assertEqual(requests.adapters.HTTPAdapter().request_url(prepared, {}), '/v:h?x=1')

    def test_forward_proxy_still_gets_absolute_url(self):
        prepared = requests.Request('GET', 'http://example.invalid//v:h?x=1').prepare()
        target = requests.adapters.HTTPAdapter().request_url(prepared, {'http': 'http://proxy.invalid:8080'})
        self.assertEqual(target, 'http://example.invalid//v:h?x=1')


if __name__ == '__main__':
    unittest.main()
