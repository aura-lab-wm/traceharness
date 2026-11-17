"""Public reproduction of Requests issue #6628, without a network dependency."""
import json
import pickle
import unittest
import requests


class PickleRegression(unittest.TestCase):
    def test_json_exception_round_trip(self):
        original = requests.exceptions.JSONDecodeError('Extra data', '{"first": 1}{"second": 2}', 12)
        expected = json.JSONDecodeError('Extra data', '{"first": 1}{"second": 2}', 12)
        self.assertEqual(original.args, expected.args)
        self.assertEqual(str(original), str(expected))
        restored = pickle.loads(pickle.dumps(original))
        self.assertEqual(type(restored), type(original))
        self.assertEqual((restored.msg, restored.doc, restored.pos), (original.msg, original.doc, original.pos))
        self.assertEqual(restored.args, expected.args)
        self.assertEqual(str(restored), str(expected))

    def test_decoded_error_keeps_formatted_message(self):
        document = '{\n  "broken":\n}'
        with self.assertRaises(json.JSONDecodeError) as oracle:
            json.loads(document)
        response = requests.Response()
        response.encoding = 'utf-8'
        response._content = document.encode()
        with self.assertRaises(requests.exceptions.JSONDecodeError) as caught:
            response.json()
        self.assertEqual(caught.exception.args, oracle.exception.args)
        self.assertEqual(str(caught.exception), str(oracle.exception))
        for name in ('msg', 'doc', 'pos', 'lineno', 'colno'):
            self.assertEqual(getattr(caught.exception, name), getattr(oracle.exception, name))

    def test_valid_response_json_unchanged(self):
        response = requests.Response()
        response._content = b'{"result": 42}'
        self.assertEqual(response.json(), {'result': 42})


if __name__ == '__main__':
    unittest.main()
