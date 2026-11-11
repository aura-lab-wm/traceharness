"""Pure operator-verification guards; no live job, receipt or provider request."""
import copy
import importlib.util
import io
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

from traceharness.core.blocks import compile_blocks

spec=importlib.util.spec_from_file_location('operator_verify',Path(__file__).resolve().parents[2]/'deploy/runner/verify_runtime.py')
verify=importlib.util.module_from_spec(spec);spec.loader.exec_module(verify)


class OperatorVerificationTests(unittest.TestCase):
    def test_default_configuration_is_bounded_and_native_has_no_lab_blocks(self):
        custom=verify.configuration('traceharness','provider/model','task')
        self.assertTrue(compile_blocks(custom['harness']['blocks'])['ok'])
        self.assertEqual(custom['limits'],{'max_steps':20,'wall_time_seconds':240,'max_cost_usd':1})
        native=verify.configuration('native-codex','provider/model','task')
        self.assertEqual(native['harness'],{})
        self.assertEqual(native['prompt_mode'],'append')
        self.assertEqual(native['limits'],custom['limits'])
        claude=verify.configuration('native-claude-code','provider/model','task')
        self.assertEqual(claude['limits'],{'max_steps':32,'wall_time_seconds':240,'max_cost_usd':2})

    def test_trace_observation_default_is_unchanged_and_explicit_boundaries_compile(self):
        default=verify.configuration('traceharness','provider/model','task')
        compiled=compile_blocks(default['harness']['blocks'])
        self.assertEqual(compiled['harness']['observation_chars'],20000)
        self.assertEqual(default,verify.configuration('traceharness','provider/model','task',observation_chars=20000))
        for value in (200,50000):
            selected=verify.configuration('traceharness','provider/model','task',observation_chars=value)
            compiled=compile_blocks(selected['harness']['blocks'])
            self.assertTrue(compiled['ok'])
            self.assertEqual(compiled['harness']['observation_chars'],value)
            self.assertEqual(selected['limits'],default['limits'])

    def test_observation_override_reaches_the_actual_reviewed_manifest(self):
        runtime={'id':'traceharness','kind':'traceharness','version':'0.3.0','prompt_mode':'replace',
                 'image_digest':'sha256:'+'a'*64,'model_ids':[]}
        task={'id':'task','runtime_ids':['traceharness'],'revision':'b'*40,'content_sha256':'c'*64,
              'environment_digest':'sha256:'+'a'*64,'grader_image_digest':'sha256:'+'d'*64}
        registry=SimpleNamespace(runtimes={'traceharness':runtime},models={'provider/model':{}},tasks={'task':task})
        executor=SimpleNamespace(health=Mock(return_value={'available':True,'runtimes':{'traceharness':True},'tasks':{'task':True}}))
        review=verify.review_operator_run(registry,executor,'traceharness','provider/model','task',observation_chars=50000)
        self.assertTrue(review['ok'])
        self.assertEqual(review['manifest']['harness']['configuration']['observation_chars'],50000)
        self.assertEqual(runtime['model_ids'],[])

    def test_invalid_observation_overrides_and_all_native_overrides_refuse_before_readiness(self):
        for runtime,values in [('traceharness',[True,False,200.0,50000.0,199,50001,-1,'50000',float('nan'),float('inf')]),
                               ('native-codex',[200,20000,50000]),('native-claude-code',[200,20000,50000])]:
            registry=SimpleNamespace(runtimes={runtime:{'model_ids':[]}},models={'provider/model':{}},tasks={'task':{'runtime_ids':[runtime]}})
            for value in values:
                with self.subTest(runtime=runtime,value=value):
                    executor=SimpleNamespace(health=Mock())
                    with self.assertRaises(verify.VerificationRefused):
                        verify.review_operator_run(registry,executor,runtime,'provider/model','task',observation_chars=value)
                    executor.health.assert_not_called()

    def test_main_passes_observation_option_to_review_before_any_provider_use(self):
        registry=SimpleNamespace(tasks={'task':{'runtime_ids':['traceharness']}})
        with tempfile.TemporaryDirectory() as temporary:
            path=Path(temporary)/'registry.json';path.write_text('{}')
            with patch.object(verify.sys,'platform','linux'),patch.object(verify.os,'geteuid',return_value=0), \
                    patch.object(verify,'Registry',return_value=registry),patch.object(verify,'DockerExecutor') as executor, \
                    patch.object(verify,'ObservedProvider') as provider, \
                    patch.object(verify,'review_operator_run',side_effect=verify.VerificationRefused('Review stop.')) as review:
                with self.assertRaisesRegex(verify.VerificationRefused,'Review stop'):
                    verify.main(['--runtime','traceharness','--model','provider/model','--task','task',
                                 '--registry',str(path),'--observation-chars','50000'])
                self.assertEqual(review.call_args.kwargs['observation_chars'],50000)
                executor.assert_called_once()
                provider.assert_not_called()

    def test_noninteger_observation_cli_arguments_refuse_before_executor_construction(self):
        for value in ('true','50000.0','private-input'):
            with self.subTest(value=value),patch.object(verify,'DockerExecutor') as executor:
                with self.assertRaises(verify.VerificationRefused) as error:
                    verify.main(['--runtime','traceharness','--model','provider/model','--observation-chars',value])
                executor.assert_not_called()
                self.assertNotIn(value,str(error.exception))

    def test_operator_overrides_are_explicit_bounded_and_match_compiler_stop(self):
        custom=verify.configuration('traceharness','provider/model','task',max_steps=32,max_cost_usd=2,wall_time_seconds=300)
        self.assertEqual(custom['limits'],{'max_steps':32,'wall_time_seconds':300,'max_cost_usd':2})
        self.assertEqual(next(block['max_steps'] for block in custom['harness']['blocks'] if block['type']=='stop'),32)
        for name,values in [('max_steps',[0,65,True,2.5,'32']),('wall_time_seconds',[29,601,False,30.5]),
                           ('max_cost_usd',[0,5.01,True,float('nan'),float('inf')])]:
            for value in values:
                with self.subTest(name=name,value=value):
                    with self.assertRaises(verify.VerificationRefused):
                        verify.configuration('traceharness','provider/model','task',**{name:value})

    def test_invalid_operator_limits_refuse_before_executor_readiness(self):
        registry=SimpleNamespace(runtimes={'traceharness':{'model_ids':[]}},models={'provider/model':{}},tasks={'task':{'runtime_ids':['traceharness']}})
        executor=SimpleNamespace(health=Mock())
        with self.assertRaises(verify.VerificationRefused):
            verify.review_operator_run(registry,executor,'traceharness','provider/model','task',max_cost_usd=float('inf'))
        executor.health.assert_not_called()

    def test_secret_is_only_accepted_from_bounded_noninteractive_stdin(self):
        class Input:
            def __init__(self,raw,tty=False):self.buffer=io.BytesIO(raw);self.tty=tty
            def isatty(self):return self.tty
        secret='sk-or-v1-'+'x'*32
        self.assertEqual(verify.read_key(Input((secret+'\n').encode())),secret)
        for stream in (Input(secret.encode(),True),Input(b'x'*4097),Input(b'not-a-key'),Input(b'\xff')):
            with self.assertRaises(verify.VerificationRefused) as error:verify.read_key(stream)
            self.assertNotIn(secret,str(error.exception))

    def test_bad_arguments_do_not_echo_accidental_secret(self):
        parser=verify.SafeParser()
        with self.assertRaises(verify.VerificationRefused) as error:parser.parse_args(['--api-key','private-input'])
        self.assertNotIn('private-input',str(error.exception))

    def test_operator_bootstrap_still_requires_actual_executor_health(self):
        registry=SimpleNamespace(runtimes={'traceharness':{'model_ids':[]}},models={'provider/model':{}},tasks={'task':{'runtime_ids':['traceharness']}})
        executor=SimpleNamespace(health=Mock(return_value={'available':False,'runtimes':{},'tasks':{}}))
        with self.assertRaisesRegex(verify.VerificationRefused,'Actual host'):
            verify.review_operator_run(registry,executor,'traceharness','provider/model','task')
        executor.health.assert_called_once()

    def test_unregistered_model_cannot_enter_bootstrap_readiness(self):
        registry=SimpleNamespace(runtimes={'traceharness':{'model_ids':[]}},models={},tasks={'task':{'runtime_ids':['traceharness']}})
        executor=SimpleNamespace(health=Mock())
        with self.assertRaises(verify.VerificationRefused):verify.review_operator_run(registry,executor,'traceharness','unknown/model','task')
        executor.health.assert_not_called()

    def test_receipt_refused_for_no_successful_model_response_or_failed_grade(self):
        job={'status':'succeeded','grade':'passed','cancellation_requested':False,'usage':{'requests':1}}
        for delta,responses in [({},0),({'status':'failed'},1),({'grade':'failed'},1),({'cancellation_requested':True},1),({'usage':{'requests':0}},1),({'usage':{'requests':True}},1)]:
            with self.subTest(delta=delta,responses=responses):
                with self.assertRaises(verify.VerificationRefused):verify.receipt_for({**job,**delta},{},responses)

    def test_safe_job_report_omits_manifest_and_redacts_authored_issue_defensively(self):
        job={'id':'a'*48,'status':'failed','manifest':{'prompt':'Never print this'},'issues':['Unexpected fixture sk-or-v1-'+'x'*32]}
        report=verify.safe_job(job)
        self.assertNotIn('manifest',report)
        self.assertNotIn('sk-or-v1-',str(report))
        self.assertNotIn('Never print this',str(report))


if __name__=='__main__':unittest.main()
