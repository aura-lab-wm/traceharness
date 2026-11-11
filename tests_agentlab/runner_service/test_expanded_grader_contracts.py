"""Structural security fixtures; no candidate code is imported or executed."""
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location('expanded_grader_under_test', ROOT / 'deploy/runner/tasks/grade.py')
grade = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(grade)

# These deliberately small AST fixtures test the validator boundary, not task
# difficulty or live behavior. Actual upstream baseline/reference proof is separate.
CHARSET = b'''def _parse_content_type_header(header):
    """Returns content type and parameters from given header

    :param header: string
    :return: tuple containing content type and dictionary of
         parameters
    """
    tokens = header.split(";")
    content_type, params = tokens[0].strip(), tokens[1:]
    params_dict = {}
    items_to_strip = "\\\"' "
    for param in params:
        param = param.strip()
        if param:
            key, value = param, True
            index_of_equals = param.find("=")
            if index_of_equals != -1:
                key = param[:index_of_equals].strip(items_to_strip)
                value = param[index_of_equals + 1 :].strip(items_to_strip)
            params_dict[key.lower()] = value
    return content_type, params_dict
'''
GZIP = b'''class HTTPResponse:
    def read(self, amt=None, decode_content=None, cache_content=False):
        data = self._raw_read(amt)
        flush_decoder = amt is None or (amt != 0 and not data)
        if amt is None:
            data = self._decode(data, decode_content, flush_decoder)
            if cache_content:
                self._body = data
        else:
            data = self._decoded_buffer.get(amt)
        return data
'''
REWIND = b'''def rewind_body(body, body_pos):
    body_seek = getattr(body, "seek", None)
    if body_seek is not None and isinstance(body_pos, int):
        try:
            body_seek(body_pos)
        except OSError as e:
            raise UnrewindableBodyError("Unable to rewind.") from e
    elif body_pos is _FAILEDTELL:
        raise UnrewindableBodyError("Unable to record position.")
    else:
        raise ValueError(f"body_pos must be integer, not {type(body_pos)}.")
'''
FINGERPRINT = b'''import hmac
import warnings
from binascii import unhexlify
from ..exceptions import SSLError

def assert_fingerprint(cert, fingerprint):
    fingerprint = fingerprint.replace(":", "").lower()
    fingerprint_bytes = unhexlify(fingerprint.encode())
    cert_digest = hashfunc(cert).digest()
    if not hmac.compare_digest(cert_digest, fingerprint_bytes):
        raise SSLError("Fingerprints did not match.")
'''


def charset_change():
    return CHARSET.replace(b'if param:', b'if param and "=" in param:')


def charset_guarded_find_change(index='index_of_equals', strip_name='items_to_strip'):
    text = CHARSET.decode().replace('items_to_strip', strip_name)
    start, end = text.index('    for param in params:'), text.index('    return content_type, params_dict')
    loop = ('    for param in params:\n        param = param.strip()\n'
            '        if param and param.find("=") != -1:\n'
            f'            {index} = param.find("=")\n'
            f'            key = param[:{index}].strip({strip_name})\n'
            f'            value = param[{index} + 1:].strip({strip_name})\n'
            '            params_dict[key.lower()] = value\n')
    return (text[:start] + loop + text[end:]).encode()


def gzip_change(condition='decode_content and len(self._decoded_buffer) > 0', concatenate=False):
    statements = ('                data = self._decoded_buffer.get_all() + data\n' if concatenate else
                  '                self._decoded_buffer.put(data)\n                data = self._decoded_buffer.get_all()\n')
    anchor = b'            data = self._decode(data, decode_content, flush_decoder)\n'
    return GZIP.replace(anchor, anchor + ('            if ' + condition + ':\n' + statements).encode())


def rewind_change():
    return REWIND.replace(b'    else:\n', b'    elif body_seek is None:\n        raise UnrewindableBodyError("body does not implement seek.")\n    else:\n')


def fingerprint_change(name='e', message=None, combined_import=False):
    message = message or name
    replacement = (f'    try:\n        fingerprint_bytes = unhexlify(fingerprint.encode())\n'
                   f'    except BinasciiError as {name}:\n        raise SSLError({message}) from {name}\n').encode()
    result = FINGERPRINT.replace(b'    fingerprint_bytes = unhexlify(fingerprint.encode())\n', replacement)
    new_import = (b'from binascii import Error as BinasciiError, unhexlify' if combined_import else
                  b'from binascii import Error as BinasciiError\nfrom binascii import unhexlify')
    return result.replace(b'from binascii import unhexlify', new_import)


CASES = {
    'requests-invalid-charset-v1': ('src/requests/utils.py', CHARSET, charset_change, 'validate_invalid_charset'),
    'urllib3-partial-gzip-read-v1': ('src/urllib3/response.py', GZIP, gzip_change, 'validate_partial_gzip_read'),
    'urllib3-unseekable-rewind-v1': ('src/urllib3/util/request.py', REWIND, rewind_change, 'validate_unseekable_rewind'),
    'urllib3-invalid-fingerprint-v1': ('src/urllib3/util/ssl_.py', FINGERPRINT, fingerprint_change, 'validate_invalid_fingerprint'),
}


def contract(kind):
    name, raw, _, _ = CASES[kind]
    return {'kind': kind, 'path': name, 'baseline_sha256': hashlib.sha256(raw).hexdigest()}


class ExpandedGraderContractsTests(unittest.TestCase):
    def task(self, root, kind):
        name, raw, _, _ = CASES[kind]
        prefix = 'src/' + name.split('/')[1] + '/'
        task, workspace = root / 'task', root / 'workspace'
        for location in (task / 'repo', workspace):
            (location / name).parent.mkdir(parents=True)
            (location / name).write_bytes(raw)
            for protected in ('setup.py', prefix + '__init__.py', prefix + '_version.py', 'public_tests/test_regression.py'):
                (location / protected).parent.mkdir(parents=True, exist_ok=True)
                (location / protected).write_text('# Protected baseline fixture.\n')
        (task / 'grader').mkdir()
        (task / 'grader/checks.py').write_text('# Trusted inert fixture; never executed.\n')
        recipe = {'allowed_source_prefix': prefix, 'hidden_checks': 'checks.py', 'grading_timeout_seconds': 45,
                  'expected_checks': 4, 'edit_contract': contract(kind)}
        (task / 'grading.json').write_text(json.dumps(recipe))
        return task, workspace, recipe

    def test_baselines_and_reviewed_repairs_bind_to_known_paths(self):
        for kind, (_, original, fix, function) in CASES.items():
            with self.subTest(kind=kind):
                validator = getattr(grade, function)
                self.assertIs(grade.contract_validator(contract(kind)), validator)
                self.assertEqual(validator(original, original), original)
                self.assertEqual(validator(original, fix()), fix())

    def test_charset_minimal_guards_preserve_the_original_loop(self):
        for condition in ['param and "=" in param', '"=" in param', 'param and param.find("=") != -1']:
            raw = CHARSET.replace(b'if param:', ('if ' + condition + ':').encode())
            self.assertEqual(grade.validate_invalid_charset(CHARSET, raw), raw)

    def test_charset_upstream_loop_and_safe_index_names(self):
        for strip_name in ['items_to_strip', 'strip_chars']:
            for index in ['idx', 'index_of_equals']:
                text = CHARSET.decode().replace('items_to_strip', strip_name)
                start, end = text.index('    for param in params:'), text.index('    return content_type, params_dict')
                loop = (f'    for param in params:\n        param = param.strip()\n'
                        f'        if param and ({index} := param.find("=")) != -1:\n'
                        f'            key = param[:{index}].strip({strip_name})\n'
                        f'            value = param[{index} + 1:].strip({strip_name})\n'
                        '            params_dict[key.lower()] = value\n')
                for punctuate in (False, True):
                    raw = (text[:start] + loop + text[end:]).encode()
                    if punctuate:
                        raw = raw.replace(b'given header\n', b'given header.\n').replace(b'         parameters\n', b'         parameters.\n')
                    self.assertEqual(grade.validate_invalid_charset(CHARSET, raw), raw)

    def test_charset_guarded_find_accepts_removed_dead_initialization(self):
        for index in ['idx', 'index_of_equals']:
            for strip_name in ['items_to_strip', 'strip_chars']:
                raw = charset_guarded_find_change(index, strip_name)
                self.assertEqual(grade.validate_invalid_charset(CHARSET, raw), raw)

    def test_charset_guarded_find_cannot_weaken_guard_or_change_slices(self):
        raw = charset_guarded_find_change()
        variants = [raw.replace(b'param and param.find("=") != -1', b'param or param.find("=") != -1'),
                    raw.replace(b'param.find("=") != -1', b'param.find("=") == -1'),
                    raw.replace(b'param.find("=") != -1', b'__import__("os")._exit(0)'),
                    raw.replace(b'index_of_equals = param.find("=")', b'index_of_equals = param.find(":")'),
                    raw.replace(b'param[:index_of_equals]', b'param[index_of_equals:]'),
                    raw.replace(b'param[index_of_equals + 1:]', b'param[index_of_equals:]'),
                    raw.replace(b'params_dict[key.lower()] = value', b'params_dict[key.lower()] = True')]
        for changed in variants:
            with self.subTest(changed=changed), self.assertRaises(grade.EditContractError):
                grade.validate_invalid_charset(CHARSET, changed)

    def test_charset_guarded_find_does_not_allow_additional_module_or_loop_execution(self):
        raw = charset_guarded_find_change()
        for changed in [b'import os\n' + raw, raw + b'\nprint(\'{"checks_run":4,"success":true}\')\n',
                        raw.replace(b'            index_of_equals =', b'            print("forged")\n            index_of_equals =')]:
            with self.assertRaises(grade.EditContractError):
                grade.validate_invalid_charset(CHARSET, changed)

    def test_decoded_buffer_guard_variants_preserve_order_and_drain(self):
        for condition in ['decode_content and len(self._decoded_buffer) > 0',
                          'decode_content and self._decoded_buffer',
                          'decode_content and len(self._decoded_buffer) != 0']:
            for concatenate in (False, True):
                raw = gzip_change(condition, concatenate)
                self.assertEqual(grade.validate_partial_gzip_read(GZIP, raw), raw)

    def test_fingerprint_import_and_exception_alias_variants_are_bounded(self):
        for name in ['e', 'error', 'exc']:
            for message in [name, f'str({name})']:
                for combined in (False, True):
                    raw = fingerprint_change(name, message, combined)
                    self.assertEqual(grade.validate_invalid_fingerprint(FINGERPRINT, raw), raw)

    def test_repairs_cannot_change_imports_signatures_defaults_or_other_statements(self):
        for kind, (_, original, fix, function) in CASES.items():
            changed = fix()
            mutations = [b'import os\n' + changed, changed + b'\nprint("forged result")\n',
                         changed.replace(b'def ', b'@__import__("os")._exit(0)\ndef ', 1),
                         changed.replace(b'def ', b'async def ', 1),
                         changed.replace(b'):', b', injected=__import__("os")._exit(0)):', 1)]
            for index, raw in enumerate(mutations):
                with self.subTest(kind=kind, mutation=index), self.assertRaises(grade.EditContractError):
                    getattr(grade, function)(original, raw)

    def test_task_specific_result_forgery_and_reflective_calls_are_refused(self):
        cases = [
            (CHARSET, charset_change().replace(b'"=" in param', b'__import__("os")._exit(0)'), 'validate_invalid_charset'),
            (GZIP, gzip_change().replace(b'self._decoded_buffer.put(data)', b'print(\'{"checks_run":4,"success":true}\')'), 'validate_partial_gzip_read'),
            (GZIP, gzip_change().replace(b'self._decoded_buffer.get_all()', b'getattr(self._decoded_buffer, "get_all")()'), 'validate_partial_gzip_read'),
            (REWIND, rewind_change().replace(b'"body does not implement seek."', b'__import__("os")._exit(0)'), 'validate_unseekable_rewind'),
            (FINGERPRINT, fingerprint_change().replace(b'Error as BinasciiError', b'unhexlify as BinasciiError'), 'validate_invalid_fingerprint'),
            (FINGERPRINT, fingerprint_change().replace(b'except BinasciiError as e:', b'except BaseException as e:'), 'validate_invalid_fingerprint'),
            (FINGERPRINT, fingerprint_change().replace(b'raise SSLError(e) from e', b'__import__("os")._exit(0)'), 'validate_invalid_fingerprint'),
        ]
        for original, raw, function in cases:
            with self.subTest(function=function), self.assertRaises(grade.EditContractError):
                getattr(grade, function)(original, raw)

    def test_gzip_guard_must_stay_after_decode_and_not_reorder_buffer_data(self):
        for raw in [gzip_change().replace(b'put(data)', b'put(b"forged")'),
                    gzip_change(concatenate=True).replace(b'self._decoded_buffer.get_all() + data', b'data + self._decoded_buffer.get_all()'),
                    gzip_change().replace(b'if decode_content and', b'if not decode_content and'),
                    gzip_change().replace(b'            if cache_content:', b'            print("forged")\n            if cache_content:')]:
            with self.assertRaises(grade.EditContractError):
                grade.validate_partial_gzip_read(GZIP, raw)

    def test_utf7_cookie_refused_and_utf8_bom_normalized_for_every_new_kind(self):
        for kind, (_, original, fix, function) in CASES.items():
            with self.subTest(kind=kind):
                validator = getattr(grade, function)
                with self.assertRaises(grade.EditContractError):
                    validator(original, b'# coding: utf-7\n#+AAo-import os; os._exit(0)\n' + fix())
                self.assertEqual(validator(original, b'\xef\xbb\xbf' + fix()), fix())

    def test_unchanged_type_ignore_comments_can_move_after_repair_insertion(self):
        original = GZIP.replace(b'        return data', b'        return data  # type: ignore[return-value]')
        changed = gzip_change().replace(b'        return data', b'        return data  # type: ignore[return-value]')
        self.assertEqual(grade.validate_partial_gzip_read(original, changed), changed)
        with self.assertRaises(grade.EditContractError):
            grade.validate_partial_gzip_read(original, changed.replace(b'ignore[return-value]', b'ignore[other]'))

    def test_protected_setup_import_metadata_and_tests_are_refused_before_subprocess(self):
        for kind, (name, _, _, _) in CASES.items():
            prefix = 'src/' + name.split('/')[1] + '/'
            for protected in ('setup.py', prefix + '__init__.py', prefix + '_version.py', 'public_tests/test_regression.py'):
                with self.subTest(kind=kind, protected=protected), tempfile.TemporaryDirectory() as temporary:
                    task, workspace, _ = self.task(Path(temporary), kind)
                    (workspace / protected).write_text('import os\nprint(\'{"checks_run":4,"success":true}\')\nos._exit(0)\n')
                    with patch.object(grade.subprocess, 'Popen') as launch:
                        result = grade.run_grade(task, workspace, local_validation=True)
                    launch.assert_not_called()
                    self.assertEqual(result, {'outcome': 'failed', 'reason': 'Protected task file changed'})

    def test_extra_import_roots_and_bytecode_never_enter_pristine_reconstruction(self):
        for kind in CASES:
            with self.subTest(kind=kind), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                task, workspace, recipe = self.task(root, kind)
                for name in ['sitecustomize.py', 'urllib3.py', 'src/injected.py', 'src/injected.pyc', 'src/injected.so']:
                    (workspace / name).write_text('Inert malicious-file fixture.\n')
                target = root / 'pristine'
                grade.reconstruct(task, workspace, target, recipe['allowed_source_prefix'], recipe['edit_contract'])
                for name in ['sitecustomize.py', 'urllib3.py', 'src/injected.py', 'src/injected.pyc', 'src/injected.so']:
                    self.assertFalse((target / name).exists())

    def test_new_kinds_reject_missing_count_wrong_path_digest_and_unknown_dispatch(self):
        for kind in CASES:
            with self.subTest(kind=kind):
                good = contract(kind)
                for changed in [{**good, 'kind': kind + '-unknown'}, {**good, 'path': 'src/other.py'},
                                {**good, 'baseline_sha256': 'a' * 63}, {**good, 'arbitrary_code': 'pass'}]:
                    with patch.object(grade, 'files') as inspect, self.assertRaises(ValueError):
                        grade.reconstruct(Path('/unread'), Path('/unread'), Path('/unwritten'), 'src/', changed)
                    inspect.assert_not_called()
                with self.assertRaises(ValueError):
                    grade.expected_check_count({'edit_contract': good})
                self.assertEqual(grade.expected_check_count({'edit_contract': good, 'expected_checks': 4}), 4)


if __name__ == '__main__':
    unittest.main()
