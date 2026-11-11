"""Execution plumbing regressions. Explicit local fixtures are not runtime receipts."""
from contextlib import nullcontext
import hashlib
import json
import os
from pathlib import Path
import stat
import subprocess
import tempfile
import threading
from types import SimpleNamespace
import unittest
from unittest.mock import patch, Mock

from traceharness.core.blocks import compile_blocks
from traceharness.core.providers import ChatResponse, ToolCall
from traceharness.runner_service.container_entrypoint import execute, one_model_attempt, native_patch
from traceharness.runner_service.execution import DockerExecutor, ExecutionError, ARTIFACT_LIMIT, pinned_image_matches
from traceharness.runner_service.registry import tree_hash
from traceharness.runner_service.settings import Settings


class ExecutionRuntimeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.directory = self.root / 'job'
        self.directory.mkdir()
        for name in ('workspace', 'output', 'grading'):
            (self.directory / name).mkdir()
        self.package = self.root / 'package'
        (self.package / 'repo').mkdir(parents=True)
        (self.package / 'repo/module.py').write_text('value = 1\n')
        (self.package / 'issue.md').write_text('Explicit plumbing fixture; never a registered live task.')
        (self.package / 'task.json').write_text(json.dumps({'visible_test_command': 'python3 -c "from module import value; assert value == 2"'}))
        self.settings = Settings(shared_secret='explicit-test-shared-secret-32-characters', state_dir=self.root / 'state')
        self.registry = SimpleNamespace(tasks={'fixture-task': {'path': str(self.package)}})
        self.executor = DockerExecutor(self.settings, self.registry)
        compiled = compile_blocks([{'type': 'prompt', 'text': 'Explicit fixture'},
                                   {'type': 'tools', 'names': ['write_file', 'run_tests', 'submit']},
                                   {'type': 'stop', 'max_steps': 3}])
        self.assertTrue(compiled['ok'])
        self.manifest = {'task_id': 'fixture-task', 'runtime_id': 'traceharness', 'runtime_version': '0.3.0',
                         'image_digest': 'fixture@sha256:' + 'a'*64, 'grader_image_digest': 'fixture@sha256:'+'b'*64,
                         'task_content_sha256': tree_hash(self.package), 'model_id': 'fixture/model',
                         'prompt': 'Explicit fixture', 'harness': {'id': compiled['harness']['id'], 'configuration': compiled['harness']},
                         'limits': {'wall_time_seconds': 30}}

    def test_traceharness_executes_visible_tests_and_preserves_real_ledger_patch_and_messages(self):
        inputs = self.directory / 'input'; inputs.mkdir()
        for filename in ('issue.md', 'task.json'):
            (inputs / filename).write_bytes((self.package / filename).read_bytes())
        calls = iter([ToolCall('one', 'write_file', {'path': 'module.py', 'content': 'value = 2\n'}),
                      ToolCall('two', 'run_tests', {}), ToolCall('three', 'submit', {})])
        provider = SimpleNamespace(name='explicit-unit-fixture', model='fixture/model', cost=lambda *_: 0,
                                   chat=lambda *_, **__: ChatResponse('', [next(calls)], 0, 0))
        with patch('traceharness.core.providers.make_provider', return_value=provider), patch('importlib.metadata.version', return_value='0.3.0'):
            code = execute(self.manifest, 'http://127.0.0.1:1', workspace=self.directory/'workspace',
                           taskrepo=self.package/'repo', inputs=inputs, output=self.directory/'output', home=self.root/'home')
        self.assertEqual(code, 0)
        self.assertEqual((self.package/'repo/module.py').read_text(), 'value = 1\n')
        self.assertEqual((self.directory/'workspace/module.py').read_text(), 'value = 2\n')
        self.assertFalse(any(p.name.startswith('.traceharness-run-') for p in (self.directory/'workspace').iterdir()))
        trace=[json.loads(line) for line in (self.directory/'output/trace.jsonl').read_text().splitlines()]
        self.assertTrue(any(row.get('tests_passed') is True for row in trace))
        self.assertIn('+value = 2', (self.directory/'output/patch.diff').read_text())
        self.assertTrue(json.loads((self.directory/'output/messages.json').read_text()))
        self.assertEqual(json.loads((self.directory/'output/summary.json').read_text())['exit_reason'], 'submitted')

    def test_job_provider_disables_retries_and_restores_lab_default(self):
        from traceharness.core import providers
        original=Mock(return_value={'fixture': True})
        with patch.object(providers, '_post_json', original):
            with one_model_attempt():
                providers._post_json('http://fixture', {}, {}, retries=4)
            self.assertIs(providers._post_json, original)
        self.assertEqual(original.call_args.kwargs['retries'], 1)

    def test_bounded_artifacts_redact_secrets_and_hash_the_published_content(self):
        raw='trace sk-or-v1-'+'x'*32+' Bearer '+ 'a'*16+'.'+'b'*16+'.'+'c'*16
        (self.directory/'output/trace.jsonl').write_text(raw)
        (self.directory/'output/patch.diff').write_text('--- a/module.py\n+++ b/module.py\n')
        artifacts, issues=self.executor.persist_artifacts(self.directory, self.manifest, grade='passed')
        self.assertEqual(issues, [])
        self.assertEqual({a['name'] for a in artifacts}, {'manifest.json','grade.json','trace.jsonl','patch.diff'})
        published=(self.directory/'trace.jsonl').read_text()
        self.assertNotIn('sk-or-v1-', published);self.assertIn('[redacted]', published)
        for item in artifacts:
            data=(self.directory/item['name']).read_bytes()
            self.assertEqual(item['bytes'],len(data));self.assertEqual(item['sha256'],hashlib.sha256(data).hexdigest())
            self.assertEqual(stat.S_IMODE((self.directory/item['name']).stat().st_mode),0o600)

    def test_host_never_follows_symlinks_or_blocks_on_special_artifacts(self):
        private=self.root/'private.txt';private.write_text('private-fixture-content')
        (self.directory/'output/patch.diff').symlink_to(private)
        os.mkfifo(self.directory/'output/trace.jsonl')
        (self.directory/'output/messages.json').write_bytes(b'x'*(ARTIFACT_LIMIT+1))
        (self.directory/'output/summary.json').write_bytes(b'\xff')
        artifacts,issues=self.executor.persist_artifacts(self.directory,self.manifest)
        self.assertEqual([a['name'] for a in artifacts],['manifest.json']);self.assertEqual(len(issues),4)
        self.assertFalse((self.directory/'patch.diff').exists())

    def test_grader_uid_capabilities_are_distinct_from_agent(self):
        agent=self.executor.container_args('agent','fixture',[],entrypoint='python')
        grader=self.executor.container_args('grade','fixture',[],entrypoint='/opt/traceharness-grade',grader=True)
        self.assertEqual(agent[agent.index('--user')+1],'10001:10001')
        self.assertNotIn('--cap-add',agent)
        self.assertEqual(grader[grader.index('--user')+1],'0:0')
        self.assertEqual([grader[i+1] for i,x in enumerate(grader) if x=='--cap-add'],['SETUID','SETGID'])
        for args in (agent,grader):
            self.assertEqual(args[args.index('--network')+1],'none')
            self.assertIn('--read-only',args);self.assertIn('no-new-privileges=true',args)

    def test_grading_output_tmpfs_is_root_only(self):
        commands=[]
        executor=DockerExecutor(self.settings,self.registry,command=lambda argv,**_:commands.append(argv) or subprocess.CompletedProcess(argv,0,b'',b''))
        job=self.root/'mount-test';job.mkdir()
        with executor.bounded_storage(job):pass
        mounts=[c for c in commands if c[0]=='/bin/mount']
        grade=next(c for c in mounts if c[-1].endswith('/grading'))
        self.assertIn('mode=0700,uid=0,gid=0',grade[4])

    def run_bounded_fixture(self, grade):
        calls=[]
        def fake_run(args,name,cancel,deadline):
            calls.append(args)
            if name.endswith('-grade'):
                (self.directory/'grading/grade.json').write_bytes(grade)
        with patch.object(self.executor,'_run',side_effect=fake_run), patch('traceharness.runner_service.execution.UnixModelProxy',return_value=nullcontext()):
            result=self.executor._execute_bounded('a'*48,self.manifest,self.directory,threading.Event(),lambda *_:None)
        return result,calls

    def test_input_permissions_work_with_private_service_umask(self):
        before=os.umask(0o077)
        try:result,calls=self.run_bounded_fixture(b'{"outcome":"passed"}')
        finally:os.umask(before)
        self.assertEqual(result['grade'],'passed')
        self.assertEqual(stat.S_IMODE((self.directory/'input').stat().st_mode),0o755)
        self.assertEqual(stat.S_IMODE((self.directory/'gateway').stat().st_mode),0o755)
        for item in (self.directory/'input').iterdir():self.assertEqual(stat.S_IMODE(item.stat().st_mode),0o444)
        self.assertEqual(json.loads((self.directory/'input/task.json').read_text())['visible_test_command'],json.loads((self.package/'task.json').read_text())['visible_test_command'])
        self.assertIn('0:0',calls[-1])

    def test_invalid_grader_result_is_known_execution_failure(self):
        with self.assertRaisesRegex(ExecutionError,'invalid result'):
            self.run_bounded_fixture(b'{bad json')

    def test_failed_runtime_preserves_sanitized_trace(self):
        (self.directory/'output/trace.jsonl').write_text('{"fixture":"failed runtime trace"}\n')
        with patch.object(self.executor,'bounded_storage',return_value=nullcontext()), patch.object(self.executor,'_execute_bounded',side_effect=ExecutionError('Runtime process did not complete successfully.')):
            with self.assertRaises(ExecutionError) as caught:self.executor.execute('a'*48,self.manifest,self.directory,threading.Event(),lambda *_:None)
        self.assertIn('trace.jsonl',[a['name'] for a in caught.exception.artifacts])

    def test_native_patch_compares_pristine_repository_without_external_diff(self):
        (self.directory/'workspace/module.py').write_text('value = 2\n')
        native_patch(self.package/'repo',self.directory/'workspace',self.directory/'output')
        patch_text=(self.directory/'output/patch.diff').read_text()
        self.assertIn('-value = 1',patch_text);self.assertIn('+value = 2',patch_text)

    def test_image_pin_matches_real_inspected_identity_only(self):
        actual='sha256:'+'a'*64
        reference='registry.invalid/runtime@sha256:'+'b'*64
        inspected={'Id':actual,'RepoDigests':[reference]}
        self.assertTrue(pinned_image_matches(actual,inspected))
        self.assertTrue(pinned_image_matches(reference,inspected))
        self.assertFalse(pinned_image_matches('sha256:'+'b'*64,inspected))
        self.assertFalse(pinned_image_matches('registry.invalid/runtime:latest',inspected))


if __name__=='__main__':unittest.main()
