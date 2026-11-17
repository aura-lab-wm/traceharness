"""Immutable offline checks; only the candidate subprocess imports repository code."""
import concurrent.futures
import json
import multiprocessing
import pickle
from pathlib import Path
import sys
import unittest

# Python -I ignores inherited PYTHONPATH and user-site initialization. Only this
# audited bootstrap chooses the candidate source tree; pytest/config hooks never run.
SOURCE = Path(sys.argv.pop(1)).resolve()
sys.path.insert(0, str(SOURCE / 'src'))
import requests
if not Path(requests.__file__).resolve().is_relative_to(SOURCE / 'src' / 'requests'):
    raise RuntimeError('Candidate source was not imported')


def decode_in_worker(raw):
    response = requests.Response()
    response._content = raw
    return response.json()


class RegressionChecks(unittest.TestCase):
    def assert_matches_oracle(self, candidate, expected):
        # Compare against independently created stdlib behavior, not merely a
        # possibly regressed candidate before and after pickling.
        for name in ('msg', 'doc', 'pos', 'lineno', 'colno', 'args'):
            self.assertEqual(getattr(candidate, name), getattr(expected, name), name)
        self.assertEqual(str(candidate), str(expected))
        self.assertEqual(repr(candidate), repr(expected))

    def assert_roundtrip(self, original, protocol, expected):
        self.assert_matches_oracle(original, expected)
        restored = pickle.loads(pickle.dumps(original, protocol=protocol))
        self.assertIs(type(restored), requests.exceptions.JSONDecodeError)
        self.assertIsInstance(restored, requests.exceptions.RequestException)
        self.assertIsInstance(restored, requests.compat.JSONDecodeError)
        self.assert_matches_oracle(restored, expected)

    def test_all_pickle_protocols_preserve_exception_state(self):
        for protocol in range(pickle.HIGHEST_PROTOCOL + 1):
            for message, document, position in [('Extra data', '{"a":1}{"b":2}', 7), ('Invalid value', '\nα🙂\n?', 4), ('Empty', '', 0)]:
                with self.subTest(protocol=protocol, document=document):
                    expected = json.JSONDecodeError(message, document, position)
                    self.assert_roundtrip(requests.exceptions.JSONDecodeError(message, document, position), protocol, expected)
        # Constructor metadata behavior is part of Requests' existing contract.
        # The upstream fix does not preserve request/response through pickle, so
        # do not invent that stronger requirement for the restored exception.
        explicit_request = requests.Request('GET', 'https://example.invalid/explicit').prepare()
        response_request = requests.Request('GET', 'https://example.invalid/response').prepare()
        response = requests.Response()
        response.request = response_request
        for kwargs, wanted_request, wanted_response in [
            ({'request': explicit_request}, explicit_request, None),
            ({'response': response}, response_request, response),
            ({'request': explicit_request, 'response': response}, explicit_request, response),
        ]:
            with self.subTest(metadata=tuple(kwargs)):
                original = requests.exceptions.JSONDecodeError('Extra data', '{}{}', 2, **kwargs)
                self.assertIs(original.request, wanted_request)
                self.assertIs(original.response, wanted_response)
                self.assert_roundtrip(original, pickle.HIGHEST_PROTOCOL, json.JSONDecodeError('Extra data', '{}{}', 2))

    def test_response_json_errors_roundtrip(self):
        for encoding in (None, 'utf-8'):
            for raw in (b'{"a":1}{"b":2}', b'', b'not json', '{"unicode":"α"'.encode(), b'{\n  "broken":\n}'):
                with self.assertRaises(json.JSONDecodeError) as oracle:
                    json.loads(raw.decode('utf-8'))
                response = requests.Response()
                response.encoding = encoding
                response._content = raw
                with self.subTest(raw=raw, encoding=encoding):
                    with self.assertRaises(requests.exceptions.JSONDecodeError) as caught:
                        response.json()
                    self.assert_roundtrip(caught.exception, pickle.HIGHEST_PROTOCOL, oracle.exception)

    def test_process_pool_survives_invalid_json(self):
        # Fork avoids import-time paths or user multiprocessing startup hooks.
        # Linux is the deployment platform; this local check also runs on macOS.
        with concurrent.futures.ProcessPoolExecutor(max_workers=1, mp_context=multiprocessing.get_context('fork')) as pool:
            failed = pool.submit(decode_in_worker, b'{"broken":')
            with self.assertRaises(json.JSONDecodeError) as oracle:
                json.loads('{"broken":')
            with self.assertRaises(requests.exceptions.JSONDecodeError) as caught:
                failed.result(timeout=8)
            self.assert_matches_oracle(caught.exception, oracle.exception)
            self.assertEqual(pool.submit(decode_in_worker, b'{"after":42}').result(timeout=8), {'after': 42})

    def test_valid_json_and_other_request_errors(self):
        for raw, expected in [(b'{"ok":[1,true,null]}', {'ok': [1, True, None]}), (b'42', 42)]:
            self.assertEqual(decode_in_worker(raw), expected)
        error = requests.exceptions.ConnectionError('offline failure')
        self.assertIs(type(pickle.loads(pickle.dumps(error))), type(error))


if __name__ == '__main__':
    result = unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(RegressionChecks))
    # The trusted parent also checks this fixed count; early interpreter exit is not success.
    print(json.dumps({'checks_run': result.testsRun, 'success': result.wasSuccessful()}), flush=True)
    raise SystemExit(0 if result.wasSuccessful() and result.testsRun == 4 else 1)
