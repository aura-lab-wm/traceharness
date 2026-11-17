"""Offline reproduction of Requests issue #6586."""
import unittest
import requests


class PublicRegression(unittest.TestCase):
    def test_multibyte_body_content_length(self):
        for body in ('👍👎', '{"label":"café"}', '東京'):
            prepared = requests.Request('POST', 'https://example.invalid/upload', data=body).prepare()
            self.assertEqual(int(prepared.headers['Content-Length']), len(body.encode('utf-8')))
            self.assertEqual(prepared.body, body)

    def test_binary_and_ascii_lengths_unchanged(self):
        for body in ('plain text', b'\x00\xff\x01'):
            prepared = requests.Request('POST', 'https://example.invalid/upload', data=body).prepare()
            self.assertEqual(int(prepared.headers['Content-Length']), len(body))


if __name__ == '__main__':
    unittest.main()
