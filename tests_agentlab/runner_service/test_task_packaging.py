"""Archive and grading-boundary fixtures; these are not real execution receipts."""
import ast
import hashlib
import importlib.util
import io
import json
import os
import pickle
import signal
import subprocess
from pathlib import Path
import sys
import tarfile
import tempfile
import types
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]


def module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    value = importlib.util.module_from_spec(spec)
    sys.modules[name] = value
    spec.loader.exec_module(value)
    return value


package = module('task_package_script', ROOT / 'scripts/package_runner_task.py')
grade = module('offline_task_grader', ROOT / 'deploy/runner/tasks/grade.py')


def archive(name='source/file.py', content=b'x = 1\n', kind=None):
    stream = io.BytesIO()
    with tarfile.open(fileobj=stream, mode='w:gz') as output:
        item = tarfile.TarInfo(name)
        if kind is not None:
            item.type = kind
            item.linkname = '/etc/passwd'
        else:
            item.size = len(content)
        output.addfile(item, None if kind is not None else io.BytesIO(content))
    return stream.getvalue()


class TaskPackagingTests(unittest.TestCase):
    def test_safe_source_extract(self):
        with tempfile.TemporaryDirectory() as temporary:
            target = Path(temporary)
            package.extract_source(archive(), 'source', target)
            self.assertEqual((target / 'file.py').read_text(), 'x = 1\n')

    def test_source_refuses_symlink_hardlink_and_traversal(self):
        for raw in [archive(kind=tarfile.SYMTYPE), archive(kind=tarfile.LNKTYPE), archive('source/../../outside'), archive('/source/outside')]:
            with self.subTest(raw=raw[:12]), tempfile.TemporaryDirectory() as temporary:
                with self.assertRaises(ValueError):
                    package.extract_source(raw, 'source', Path(temporary))

    def test_source_digest_mismatch_fails_before_extract(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / 'archive'
            path.write_bytes(archive())
            with self.assertRaisesRegex(ValueError, 'digest'):
                package.read_source({'archive_sha256': '0' * 64}, path)

    def make_task(self, root):
        task, workspace = root / 'task', root / 'workspace'
        for location in [task / 'repo', workspace]:
            (location / 'src/requests').mkdir(parents=True)
            (location / 'src/requests/exceptions.py').write_text('original = True\n')
            (location / 'public_tests').mkdir()
            (location / 'public_tests/test_issue.py').write_text('assert True\n')
        return task, workspace

    def test_grader_copies_pristine_tests_and_only_source_overlay(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            task, workspace = self.make_task(root)
            (workspace / 'src/requests/exceptions.py').write_text('fixed = True\n')
            (workspace / 'sitecustomize.py').write_text('raise RuntimeError("agent startup hook")')
            (workspace / 'conftest.py').write_text('raise RuntimeError("agent pytest hook")')
            target = root / 'scratch'
            grade.reconstruct(task, workspace, target, 'src/requests/')
            self.assertEqual((target / 'src/requests/exceptions.py').read_text(), 'fixed = True\n')
            self.assertEqual((target / 'public_tests/test_issue.py').read_text(), 'assert True\n')
            self.assertFalse((target / 'sitecustomize.py').exists())
            self.assertFalse((target / 'conftest.py').exists())

    def test_grader_refuses_modified_tests(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            task, workspace = self.make_task(root)
            (workspace / 'public_tests/test_issue.py').write_text('tampered = True\n')
            with self.assertRaisesRegex(ValueError, 'Protected'):
                grade.reconstruct(task, workspace, root / 'scratch', 'src/requests/')

    def test_grader_refuses_symlinked_candidate(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            task, workspace = self.make_task(root)
            (workspace / 'sitecustomize.py').symlink_to('/etc/passwd')
            with self.assertRaisesRegex(ValueError, 'ordinary'):
                grade.reconstruct(task, workspace, root / 'scratch', 'src/requests/')

    def test_root_writer_signals_as_candidate_and_restores_uid_on_failure(self):
        # Guard the actual privilege boundary: CAP_KILL is deliberately absent.
        for error in (None, ProcessLookupError(), PermissionError()):
            events = []
            def signal_group(pid, sig):
                events.append(('signal', pid, sig))
                self.assertEqual(events[0], ('euid', 10002))
                if error:
                    raise error
            with self.subTest(error=type(error).__name__), patch.object(grade.os, 'geteuid', return_value=0), patch.object(grade.os, 'seteuid', side_effect=lambda uid: events.append(('euid', uid))), patch.object(grade.os, 'killpg', side_effect=signal_group):
                if isinstance(error, PermissionError):
                    with self.assertRaises(PermissionError):
                        grade.kill_candidate_group(123)
                else:
                    grade.kill_candidate_group(123)
                self.assertEqual(events[-1], ('euid', 0))
                self.assertEqual(events[1], ('signal', 123, signal.SIGKILL))

    @unittest.skipUnless(sys.platform == 'linux' and os.geteuid() == 0, 'Requires isolated Linux root writer with SETUID/SETGID')
    def test_actual_candidate_process_can_be_terminated_without_cap_kill(self):
        capabilities = int(next(line.split()[1] for line in Path('/proc/self/status').read_text().splitlines() if line.startswith('CapEff:')), 16)
        if capabilities & (1 << 5) or not capabilities & (1 << 6) or not capabilities & (1 << 7):
            self.skipTest('Run inside grader container with SETUID/SETGID and without CAP_KILL')
        child = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(60)'],
                                 preexec_fn=grade.restricted_child, start_new_session=True)
        try:
            grade.kill_candidate_group(child.pid)
            self.assertEqual(child.wait(timeout=5), -signal.SIGKILL)
            self.assertEqual(os.geteuid(), 0)
        finally:
            if child.poll() is None:
                grade.kill_candidate_group(child.pid)
                child.wait(timeout=5)

    def test_observed_wrong_patch_passes_self_comparison_but_fails_stdlib_oracle(self):
        observed = ROOT / 'tests_agentlab/runner_service/fixtures/requests-jsondecode-observed-invalid.patch'
        raw = observed.read_bytes()
        self.assertEqual(hashlib.sha256(raw).hexdigest(), 'e694f238b5f10f067b9ef1dec02ffde3a61efbc95655422e0c583a07ce09cec5')
        # Reconstruct the actual observed class from its reviewed patch hunk.
        # No Requests installation, external checkout or network is needed.
        hunk = raw.decode().split('@@', 2)[2].split('\n', 1)[1]
        added = '\n'.join(line[1:] for line in hunk.splitlines() if line.startswith((' ', '+')))
        source = added.split('class HTTPError', 1)[0]
        name = '_observed_requests_pickle_regression'
        candidate = types.ModuleType(name)
        candidate.InvalidJSONError = OSError
        candidate.CompatJSONDecodeError = json.JSONDecodeError
        sys.modules[name] = candidate
        try:
            exec(compile(source, str(observed), 'exec'), candidate.__dict__)
            original = candidate.JSONDecodeError('Extra data', '{}{}', 2)
            restored = pickle.loads(pickle.dumps(original))
            # This was the blind spot: every old self-comparison succeeds.
            for attribute in ('msg', 'doc', 'pos', 'lineno', 'colno', 'args'):
                self.assertEqual(getattr(restored, attribute), getattr(original, attribute))
            self.assertEqual(str(restored), str(original))
            self.assertEqual(repr(restored), repr(original))
            self.assertEqual(original.args, ('Extra data',))
            tree = ast.parse((ROOT / 'deploy/runner/tasks/requests-jsondecode-pickle/checks.py').read_text())
            checks = next(node for node in tree.body if isinstance(node, ast.ClassDef) and node.name == 'RegressionChecks')
            oracle_method = next(node for node in checks.body if isinstance(node, ast.FunctionDef) and node.name == 'assert_matches_oracle')
            namespace = {}
            exec(compile(ast.Module(body=[oracle_method], type_ignores=[]), 'grader_oracle', 'exec'), namespace)
            expected = json.JSONDecodeError('Extra data', '{}{}', 2)
            with self.assertRaisesRegex(AssertionError, 'args'):
                namespace['assert_matches_oracle'](self, original, expected)
            namespace['assert_matches_oracle'](self, expected, json.JSONDecodeError('Extra data', '{}{}', 2))
        finally:
            sys.modules.pop(name, None)

    def test_runtime_recipe_contains_no_execution_claim_or_embedded_solution(self):
        recipe = json.loads((ROOT / 'deploy/runner/tasks/requests-jsondecode-pickle/recipe.json').read_text())
        self.assertEqual(recipe['revision'], '96b22fa18c00831656ee4b286bf1c9062459b00a')
        self.assertEqual(recipe['issue_url'], 'https://github.com/psf/requests/issues/6628')
        self.assertNotIn('compatibility_receipts', recipe)
        self.assertNotIn('model_id', recipe)
        self.assertIn('public_tests', recipe['visible_test_command'])


class CuratedEditContractTests(unittest.TestCase):
    baseline = b'''from .compat import JSONDecodeError as CompatJSONDecodeError
class JSONDecodeError(InvalidJSONError, CompatJSONDecodeError):
    def __init__(self, *args, **kwargs):
        CompatJSONDecodeError.__init__(self, *args)
        InvalidJSONError.__init__(self, *self.args, **kwargs)
'''
    safe_method = '    def __reduce__(self):\n        return CompatJSONDecodeError.__reduce__(self)\n'

    def fixture(self):
        return json.loads((ROOT / 'tests_agentlab/runner_service/fixtures/requests-jsondecode-adversarial.json').read_text())

    def task(self, root):
        task, workspace = root / 'task', root / 'workspace'
        for directory in [task / 'repo', workspace]:
            (directory / 'src/requests').mkdir(parents=True)
            (directory / 'src/requests/exceptions.py').write_bytes(self.baseline)
            (directory / 'src/requests/__init__.py').write_text('from .exceptions import JSONDecodeError\n')
        contract = {'kind': 'requests-jsondecode-reduce-v1', 'path': 'src/requests/exceptions.py',
                    'baseline_sha256': hashlib.sha256(self.baseline).hexdigest()}
        (task / 'grading.json').write_text(json.dumps({'allowed_source_prefix': 'src/requests/',
            'hidden_checks': 'checks.py', 'grading_timeout_seconds': 45, 'edit_contract': contract}))
        return task, workspace, contract

    def test_baseline_and_reviewed_reductions_accepted(self):
        self.assertEqual(grade.validate_json_reduce(self.baseline, self.baseline), self.baseline)
        for expression in ['CompatJSONDecodeError.__reduce__(self)',
                           '(self.__class__, (self.msg, self.doc, self.pos))',
                           '(type(self), (self.msg, self.doc, self.pos))']:
            for doc in ['', '        """Preserve constructor state."""\n']:
                raw = self.baseline + ('    def __reduce__(self):\n' + doc + '        return ' + expression + '\n').encode()
                with self.subTest(expression=expression, doc=bool(doc)):
                    self.assertEqual(grade.validate_json_reduce(self.baseline, raw), raw)

    def test_unsafe_method_forms_rejected_without_execution(self):
        for name, method in self.fixture()['unsafe_methods'].items():
            with self.subTest(name=name):
                with self.assertRaises(grade.EditContractError):
                    grade.validate_json_reduce(self.baseline, self.baseline + method.encode())

    def test_import_constructor_duplicate_class_and_duplicate_method_rejected(self):
        safe = self.baseline + self.safe_method.encode()
        candidates = {
            'module_import': b'import os\nos._exit(0)\n' + safe,
            'constructor': safe.replace(b'*self.args, **kwargs', b'args[0], **kwargs'),
            'duplicate_class': safe + b'class JSONDecodeError: pass\n',
            'duplicate_method': safe + self.safe_method.encode(),
            'method_assignment': safe + b'    __reduce__ = __import__("os")._exit\n',
        }
        for name, candidate in candidates.items():
            with self.subTest(name=name), self.assertRaises(grade.EditContractError):
                grade.validate_json_reduce(self.baseline, candidate)

    def test_encoding_cookie_cannot_hide_executable_source(self):
        encoded_injection = b'# coding: utf-7\n#+AAo-import os; os._exit(0)\n'
        with self.assertRaisesRegex(grade.EditContractError, 'UTF-8'):
            grade.validate_json_reduce(self.baseline, encoded_injection + self.baseline + self.safe_method.encode())
        raw = self.baseline + self.safe_method.encode()
        self.assertEqual(grade.validate_json_reduce(self.baseline, b'\xef\xbb\xbf' + raw), raw)

    def test_stdout_exit_forgery_rejected_before_candidate_process(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            task, workspace, contract = self.task(root)
            (workspace / 'src/requests/exceptions.py').write_bytes(self.baseline + self.safe_method.encode())
            (workspace / 'src/requests/__init__.py').write_text(self.fixture()['forged_init'])
            with patch.object(grade.subprocess, 'Popen') as launch:
                result = grade.run_grade(task, workspace, local_validation=True)
            launch.assert_not_called()
            self.assertEqual(result['outcome'], 'failed')
            self.assertIn('Protected', result['reason'])

    def test_unsafe_exception_edits_fail_before_candidate_process(self):
        for name, method in self.fixture()['unsafe_methods'].items():
            with self.subTest(name=name), tempfile.TemporaryDirectory() as temporary:
                task, workspace, contract = self.task(Path(temporary))
                (workspace / 'src/requests/exceptions.py').write_bytes(self.baseline + method.encode())
                with patch.object(grade.subprocess, 'Popen') as launch:
                    result = grade.run_grade(task, workspace, local_validation=True)
                launch.assert_not_called()
                self.assertEqual(result['outcome'], 'failed')

    def test_added_source_bytecode_and_native_files_never_enter_reconstruction(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            task, workspace, contract = self.task(root)
            (workspace / 'src/requests/exceptions.py').write_bytes(b'\xef\xbb\xbf' + self.baseline + self.safe_method.encode())
            extras = ['src/requests/forgery.py', 'src/requests/forgery.pyc', 'src/requests/forgery.pyo',
                      'src/requests/forgery.so', 'sitecustomize.py']
            for name in extras:
                (workspace / name).write_text(self.fixture()['forged_init'])
            target = root / 'scratch'
            grade.reconstruct(task, workspace, target, 'src/requests/', contract)
            self.assertEqual((target / 'src/requests/exceptions.py').read_bytes(), self.baseline + self.safe_method.encode())
            for name in extras:
                self.assertFalse((target / name).exists(), name)

    def test_public_edit_policy_matches_curated_recipe(self):
        directory = ROOT / 'deploy/runner/tasks/requests-jsondecode-pickle'
        recipe = json.loads((directory / 'recipe.json').read_text())
        policy = json.loads((directory / 'public_policy.json').read_text())
        self.assertEqual(policy['editable_file'], recipe['edit_contract']['path'])
        self.assertEqual(len(policy['permitted_return_expressions']), 3)
        self.assertIn('before importing', (directory / 'issue.md').read_text())


if __name__ == '__main__':
    unittest.main()
