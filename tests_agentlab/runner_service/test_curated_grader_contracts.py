"""Static-policy fixtures only; no models, network, or candidate code execution."""
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location('curated_grader_under_test', ROOT / 'deploy/runner/tasks/grade.py')
grade = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(grade)

# Small structural unit fixtures, not registered upstream tasks or run evidence.
UNICODE = b'''def super_len(o):
    """Preserve this original function."""
    total_length = None
    current_position = 0
    if hasattr(o, "__len__"):
        total_length = len(o)
    return total_length
'''
SLASHES = b'''class HTTPAdapter:
    def request_url(self, request, proxies):
        url = request.path_url
        if is_proxied_http_request and not using_socks_proxy:
            url = urldefragauth(request.url)
        return url
'''
NETRC = b'''def get_netrc_auth(url, raise_errors=False):
    try:
        _netrc = netrc(netrc_path).authenticators(host)
        if _netrc:
            login_i = 0 if _netrc[0] else 1
            return (_netrc[login_i], _netrc[2])
    except OSError:
        return None
'''
JSON_ERROR = b'''class JSONDecodeError(InvalidJSONError, CompatJSONDecodeError):
    def __init__(self, *args, **kwargs):
        CompatJSONDecodeError.__init__(self, *args)
        InvalidJSONError.__init__(self, *self.args, **kwargs)
'''
CASES = {
    'requests-jsondecode-reduce-v1': ('src/requests/exceptions.py', JSON_ERROR, grade.validate_json_reduce),
    'requests-unicode-length-v1': ('src/requests/utils.py', UNICODE, grade.validate_unicode_length),
    'requests-leading-slashes-v1': ('src/requests/adapters.py', SLASHES, grade.validate_leading_slashes),
    'requests-empty-netrc-v1': ('src/requests/utils.py', NETRC, grade.validate_empty_netrc),
}


def contract(kind):
    name, raw, _ = CASES[kind]
    return {'kind': kind, 'path': name, 'baseline_sha256': hashlib.sha256(raw).hexdigest()}


def unicode_change(expression='o.encode("utf-8")', condition='isinstance(o, str)'):
    return UNICODE.replace(b'    current_position = 0\n',
                           ('    current_position = 0\n    if ' + condition + ':\n        o = ' + expression + '\n').encode())


def slash_change(expression='"/" + url.lstrip("/")', condition='url.startswith("//")'):
    return SLASHES.replace(b'        url = request.path_url\n',
                           ('        url = request.path_url\n        if ' + condition + ':\n            url = ' + expression + '\n').encode())


def netrc_change(expression='_netrc and any(_netrc)'):
    return NETRC.replace(b'if _netrc:', ('if ' + expression + ':').encode())


class CuratedGraderContractsTests(unittest.TestCase):
    def task(self, root, kind='requests-unicode-length-v1', expected=4):
        task, workspace = root / 'task', root / 'workspace'
        name, raw, _ = CASES[kind]
        for location in [task / 'repo', workspace]:
            (location / name).parent.mkdir(parents=True)
            (location / name).write_bytes(raw)
            (location / 'protected.txt').write_bytes(b'Original fixture file.\n')
        (task / 'grader').mkdir()
        (task / 'grader/checks.py').write_text('# Inert trusted unit fixture; Popen is mocked.\n')
        recipe = {'allowed_source_prefix': 'src/requests/', 'hidden_checks': 'checks.py',
                  'grading_timeout_seconds': 45, 'edit_contract': contract(kind)}
        if expected is not None:
            recipe['expected_checks'] = expected
        (task / 'grading.json').write_text(json.dumps(recipe))
        return task, workspace, recipe

    def test_known_dispatch_binds_exact_path_digest_and_accepts_unchanged_baselines(self):
        for kind, (_, raw, validator) in CASES.items():
            with self.subTest(kind=kind):
                self.assertIs(grade.contract_validator(contract(kind)), validator)
                self.assertEqual(validator(raw, raw), raw)

    def test_missing_unknown_or_malformed_contract_refused_before_reading_candidate(self):
        good = contract('requests-unicode-length-v1')
        invalid = [None, {}, [], False, {**good, 'kind': 'requests-unrestricted-v1'},
                   {**good, 'path': '../utils.py'}, {**good, 'path': 'src/requests/__init__.py'},
                   {**good, 'baseline_sha256': 'f' * 63}, {**good, 'allow_prefix': 'src/requests/'},
                   {**good, 'kind': []}, {**good, 'baseline_sha256': 1}]
        for value in invalid:
            with self.subTest(contract=value), patch.object(grade, 'files') as inspect:
                with self.assertRaises(ValueError):
                    grade.reconstruct(Path('/not-read'), Path('/not-read'), Path('/not-written'), 'src/requests/', value)
                inspect.assert_not_called()

    def test_safe_unicode_encoding_variants(self):
        for condition in ['isinstance(o, str)', 'isinstance(o, (str,))']:
            for expression in ['o.encode()', 'o.encode("utf8")', 'o.encode("UTF-8")',
                               'o.encode(encoding="utf-8")', 'o.encode("utf-8", "strict")',
                               'str.encode(o, "utf-8")', 'bytes(o, "utf-8")']:
                changed = unicode_change(expression, condition)
                with self.subTest(expression=expression, condition=condition):
                    self.assertEqual(grade.validate_unicode_length(UNICODE, changed), changed)

    def test_safe_slash_normalization_variants(self):
        for condition in ['url.startswith("//")', 'url.startswith(("//",))', 'url[:2] == "//"']:
            for expression in ['"/" + url.lstrip("/")', 'f"/{url.lstrip(\'/\')}"', '"/{}".format(url.lstrip("/"))']:
                changed = slash_change(expression, condition)
                with self.subTest(expression=expression, condition=condition):
                    self.assertEqual(grade.validate_leading_slashes(SLASHES, changed), changed)

    def test_safe_empty_netrc_predicates(self):
        for expression in ['_netrc and any(_netrc)', '_netrc is not None and any(_netrc)',
                           'any(_netrc or ())', 'bool(_netrc) and any(_netrc)',
                           '_netrc and (_netrc[0] or _netrc[1] or _netrc[2])']:
            changed = netrc_change(expression)
            with self.subTest(expression=expression):
                self.assertEqual(grade.validate_empty_netrc(NETRC, changed), changed)

    def test_changed_imports_signatures_decorators_and_other_statements_are_not_repairs(self):
        cases = [(UNICODE, unicode_change(), grade.validate_unicode_length),
                 (SLASHES, slash_change(), grade.validate_leading_slashes),
                 (NETRC, netrc_change(), grade.validate_empty_netrc)]
        for original, changed, validator in cases:
            mutations = [b'import os\n' + changed, changed + b'\nprint("forged summary")\n',
                         changed.replace(b'def ', b'@dangerous()\ndef ', 1),
                         changed.replace(b'):', b', injected=side_effect()):', 1),
                         changed + b'\nclass JSONDecodeError: pass\n']
            for index, mutation in enumerate(mutations):
                with self.subTest(validator=validator.__name__, mutation=index), self.assertRaises(grade.EditContractError):
                    validator(original, mutation)

    def test_repair_expressions_cannot_execute_imports_exit_or_reflective_calls(self):
        variants = [
            (UNICODE, unicode_change('__import__("os")._exit(0)'), grade.validate_unicode_length),
            (UNICODE, unicode_change('o.encode("utf-8")', 'isinstance(o, str) or print("forged")'), grade.validate_unicode_length),
            (SLASHES, slash_change('eval("forged")'), grade.validate_leading_slashes),
            (SLASHES, slash_change('"/" + getattr(url, "lstrip")("/")'), grade.validate_leading_slashes),
            (NETRC, netrc_change('_netrc or __import__("os")._exit(0)'), grade.validate_empty_netrc),
            (NETRC, netrc_change('any(eval("_netrc") or ())'), grade.validate_empty_netrc),
        ]
        for original, changed, validator in variants:
            with self.subTest(validator=validator.__name__), self.assertRaises(grade.EditContractError):
                validator(original, changed)

    def test_wrong_insertion_location_or_extra_guard_body_is_rejected(self):
        extra = unicode_change().replace(b'o = o.encode("utf-8")', b'o = o.encode("utf-8")\n        print("forged")')
        moved = unicode_change().replace(b'    current_position = 0\n', b'').replace(b'    return total_length', b'    current_position = 0\n    return total_length')
        for raw in [extra, moved]:
            with self.assertRaises(grade.EditContractError):
                grade.validate_unicode_length(UNICODE, raw)

    def test_utf7_hidden_newline_is_refused_for_every_contract(self):
        for kind, (_, raw, validator) in CASES.items():
            with self.subTest(kind=kind), self.assertRaises(grade.EditContractError):
                validator(raw, b'# coding: utf-7\n#+AAo-import os; os._exit(0)\n' + raw)

    def test_reconstruction_ignores_extra_sources_and_keeps_all_other_baseline_bytes(self):
        for kind in ['requests-unicode-length-v1', 'requests-leading-slashes-v1', 'requests-empty-netrc-v1']:
            with self.subTest(kind=kind), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                task, workspace, recipe = self.task(root, kind)
                (workspace / 'sitecustomize.py').write_text('raise SystemExit(0)\n')
                (workspace / 'src/requests/injected.py').write_text('raise SystemExit(0)\n')
                target = root / 'target'
                grade.reconstruct(task, workspace, target, 'src/requests/', recipe['edit_contract'])
                self.assertFalse((target / 'sitecustomize.py').exists())
                self.assertFalse((target / 'src/requests/injected.py').exists())
                self.assertEqual((target / 'protected.txt').read_bytes(), b'Original fixture file.\n')
                (workspace / 'protected.txt').write_text('changed')
                with self.assertRaisesRegex(grade.EditContractError, 'Protected'):
                    grade.reconstruct(task, workspace, root / 'rejected', 'src/requests/', recipe['edit_contract'])

    def test_expected_check_count_is_required_for_new_tasks_and_original_json_keeps_four(self):
        self.assertEqual(grade.expected_check_count({'edit_contract': contract('requests-jsondecode-reduce-v1')}), 4)
        for kind in ['requests-unicode-length-v1', 'requests-leading-slashes-v1', 'requests-empty-netrc-v1']:
            for count in [None, True, False, 0, -1, 1001, 4.0, '4']:
                recipe = {'edit_contract': contract(kind)}
                if count is not None:
                    recipe['expected_checks'] = count
                with self.subTest(kind=kind, count=count), self.assertRaises(ValueError):
                    grade.expected_check_count(recipe)
            self.assertEqual(grade.expected_check_count({'edit_contract': contract(kind), 'expected_checks': 7}), 7)

    def test_unknown_contract_cannot_start_candidate_subprocess(self):
        with tempfile.TemporaryDirectory() as temporary:
            task, workspace, recipe = self.task(Path(temporary))
            recipe['edit_contract']['kind'] = 'unregistered'
            (task / 'grading.json').write_text(json.dumps(recipe))
            with patch.object(grade.subprocess, 'Popen') as launch, self.assertRaises(ValueError):
                grade.run_grade(task, workspace, local_validation=True)
            launch.assert_not_called()

    def test_exact_declared_integer_check_count_is_required_for_success(self):
        for summary, expected in [({'checks_run': 7, 'success': True}, 'passed'),
                                  ({'checks_run': 4, 'success': True}, 'failed'),
                                  ({'checks_run': 7.0, 'success': True}, 'failed'),
                                  ({'checks_run': 7, 'success': 1}, 'failed')]:
            with self.subTest(summary=summary), tempfile.TemporaryDirectory() as temporary:
                task, workspace, _ = self.task(Path(temporary), expected=7)
                def launched(*_, **kwargs):
                    kwargs['stdout'].write((json.dumps(summary) + '\n').encode())
                    return SimpleNamespace(pid=123, wait=lambda **_: 0)
                with patch.object(grade.subprocess, 'Popen', side_effect=launched), patch.object(grade, 'kill_candidate_group'):
                    result = grade.run_grade(task, workspace, local_validation=True)
                self.assertEqual(result['outcome'], expected)


if __name__ == '__main__':
    unittest.main()
