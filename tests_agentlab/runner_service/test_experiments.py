"""Offline orchestration proofs; no native CLI, member session or paid requests."""
import copy
import json
from pathlib import Path
import tempfile
import threading
import time
import unittest

from traceharness.runner_service.configuration import digest
from traceharness.runner_service.credentials import CredentialUnavailable, CredentialVault
from traceharness.runner_service.experiments import Experiments, review_plan, summarize
from traceharness.runner_service.jobs import JobError
from traceharness.runner_service.settings import Settings

OWNER, OTHER = 'owner-fixture', 'other-fixture'
PINS = {'runtime_id': 'native-claude-code', 'runtime_version': 'fixture', 'image_digest': 'sha256:'+'a'*64,
        'binary_sha256':'b'*64,'inventory_sha256':'c'*64,'taxonomy_sha256':'d'*64,'materializer_sha256':'e'*64}

def configuration(action='keep'):
    return {'version':2,'runtime_id':'native-claude-code','model_id':'fixture/model','task_id':'fixture-task',
            'prompt':'','prompt_mode':'append','harness':{},'limits':{'max_steps':2,'wall_time_seconds':30,'max_cost_usd':.05},
            'native_prompt_profile':{'schema_version':1,**PINS,'default_action':action,'overrides':[]}}

def draft(repeats=2):
    return {'version':1,'name':'Explicit fixture study','seed':7,'repeats':repeats,
            'arms':[{'id':'control','label':'Keep fixture','configuration':configuration()},
                    {'id':'variant','label':'Disable fixture','configuration':configuration('disable')}]}

def review(c):
    manifest=copy.deepcopy(c)
    manifest['native_prompt_profile_sha256']=digest(c['native_prompt_profile'])
    return {'ok':True,'issues':[],'manifest':manifest,'manifest_sha256':digest(manifest)}, {'id':c['model_id'],'pricing':{'prompt':'0','completion':'0'}}

class FakeJobs:
    def __init__(self):
        self.lock=threading.RLock(); self.rows={}; self.idempotency={}; self.submissions=[]
        self.finish=True; self.drop_ack=False; self.capacity=False
    def reconcile(self,owner,key,sha):
        with self.lock:
            row=self.rows.get((owner,key))
            if row and row['manifest_sha256']!=sha:raise JobError('Mismatch',409)
            return copy.deepcopy(row)
    def submit(self,owner,manifest,credential,key,model):
        with self.lock:
            row=self.reconcile(owner,key,digest(manifest))
            if row:return row
            if self.capacity:raise JobError('Capacity',429)
            jid=f'{len(self.rows)+1:048x}'
            row={'id':jid,'status':'succeeded' if self.finish else 'running','grade':'passed',
                 'manifest_sha256':digest(manifest),'manifest':copy.deepcopy(manifest),'created_at':1,'updated_at':2,
                 'artifacts':[],'issues':[],'usage':{'requests':1,'cost_usd':.01},'cancellation_requested':False}
            self.rows[owner,key]=row;self.submissions.append(jid)
            if self.drop_ack:self.drop_ack=False;raise OSError('Ack lost')
            return copy.deepcopy(row)
    def get(self,owner,jid):
        with self.lock:
            for (owned,_),row in self.rows.items():
                if owned==owner and row['id']==jid:return copy.deepcopy(row)
            raise JobError('Missing',404)
    def cancel(self,owner,jid):
        with self.lock:
            for (owned,_),row in self.rows.items():
                if owned==owner and row['id']==jid:row.update(status='cancelled',grade='ungraded');return copy.deepcopy(row)
            raise JobError('Missing',404)

class ExperimentsTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.settings=Settings(shared_secret='fixture-secret-that-is-at-least-32bytes',state_dir=Path(self.temp.name)/'jobs')
        self.vault=CredentialVault();self.cid=self.vault.put(OWNER,'fixture-not-a-provider-key')['credential_id']
        self.jobs=FakeJobs();self.engine=Experiments(self.settings,self.jobs,self.vault,review,poll_interval=.01)
        self.addCleanup(self.engine.close)
    def create(self,value=None,key='fixture-create-identity'):
        value=value or draft();checked=review_plan(value,review);self.assertTrue(checked['ok'],checked)
        return self.engine.create(OWNER,checked['plan'],checked['plan_sha256'],key)
    def until(self,eid,status,seconds=3):
        end=time.monotonic()+seconds
        while time.monotonic()<end:
            result=self.engine.get(OWNER,eid)
            if result['status'] in status:return result
            time.sleep(.01)
        self.fail(f'Experiment did not reach {status}: '+str(result['status']))
    def test_schedule_freezes_balanced_pairs_and_cost_before_execution(self):
        a=review_plan(draft(),review);b=review_plan(draft(),review)
        self.assertEqual(a,b);self.assertEqual(a['trial_count'],4);self.assertEqual(a['maximum_cost_usd'],.2)
        schedule=a['plan']['schedule']
        self.assertEqual({s['arm_id'] for s in schedule[:2]},{'control','variant'})
        self.assertEqual([s['arm_id'] for s in schedule[:2]],[s['arm_id'] for s in schedule[2:]][::-1])
        row=self.create();self.assertEqual(row['status'],'ready');self.assertFalse(self.jobs.submissions)
        self.assertNotIn('credential_id',json.dumps(row));self.assertNotIn('owner',row)
    def test_invalid_cross_cohort_duplicate_and_oversized_plans_refuse(self):
        mutations=[lambda x:x.update(seed=True),lambda x:x.update(repeats=0),lambda x:x.update(extra=1),
                   lambda x:x['arms'][1]['configuration'].update(model_id='other/model'),
                   lambda x:x['arms'][1]['configuration']['native_prompt_profile'].update(binary_sha256='f'*64),
                   lambda x:x['arms'][1].update(id='control'),lambda x:x['arms'][0]['configuration'].update(version=1),
                   lambda x:x.update(name='bad\x00name')]
        for mutate in mutations:
            value=draft();mutate(value);self.assertFalse(review_plan(value,review)['ok'])
        value=draft(10)
        for row in value['arms']:row['configuration']['limits']['max_cost_usd']=100
        self.assertFalse(review_plan(value,review)['ok'])
    def test_owner_isolation_create_replay_and_changed_payload(self):
        first=self.create();self.assertEqual(self.create()['id'],first['id'])
        value=draft();value['name']='Changed'
        with self.assertRaises(JobError):self.create(value)
        self.assertEqual(self.engine.list(OTHER),[])
        for action in [lambda:self.engine.get(OTHER,first['id']),lambda:self.engine.cancel(OTHER,first['id']),
                       lambda:self.engine.start(OTHER,first['id'],self.cid,first['plan_sha256'])]:
            with self.assertRaises(JobError) as error:action()
            self.assertEqual(error.exception.status,404)
    def test_all_trials_execute_once_and_terminal_results_survive_job_purge(self):
        row=self.create();self.engine.start(OWNER,row['id'],self.cid,row['plan_sha256'])
        result=self.until(row['id'],{'completed'})
        self.assertEqual(len(self.jobs.submissions),4);self.assertEqual(result['summary']['finalized_trials'],4)
        self.assertEqual(result['summary']['comparisons'][0]['both_pass'],2)
        self.jobs.rows.clear();self.engine.close()
        loaded=Experiments(self.settings,self.jobs,self.vault,review,poll_interval=.01);self.addCleanup(loaded.close)
        self.assertEqual(loaded.get(OWNER,row['id'])['summary'],result['summary'])
        self.assertNotIn('credential_id',''.join(p.read_text() for p in loaded.root.glob('*.json')))
    def test_lost_submit_ack_adopts_job_without_second_paid_submission(self):
        self.jobs.drop_ack=True;row=self.create(draft(1));self.engine.start(OWNER,row['id'],self.cid,row['plan_sha256'])
        result=self.until(row['id'],{'completed'})
        self.assertEqual(len(self.jobs.submissions),2);self.assertEqual(result['summary']['finalized_trials'],2)
    def test_duplicate_start_cannot_fork_scheduler_and_cancel_keeps_unissued_trials(self):
        self.jobs.finish=False;row=self.create();self.engine.start(OWNER,row['id'],self.cid,row['plan_sha256'])
        self.until(row['id'],{'running'})
        deadline=time.monotonic()+2
        while not self.jobs.submissions and time.monotonic()<deadline:time.sleep(.01)
        self.engine.start(OWNER,row['id'],self.cid,row['plan_sha256'])
        self.engine.cancel(OWNER,row['id']);result=self.until(row['id'],{'cancelled'})
        self.assertEqual(len(self.jobs.submissions),1);self.assertEqual(len(result['trials']),4)
        self.assertTrue(all(t['status']=='cancelled' for t in result['trials']))
        with self.assertRaises(JobError):self.engine.start(OWNER,row['id'],self.cid,row['plan_sha256'])
    def test_expired_credentials_and_capacity_pause_without_issuing_job(self):
        row=self.create();self.vault.revoke(OWNER,self.cid)
        with self.assertRaises(CredentialUnavailable):self.engine.start(OWNER,row['id'],self.cid,row['plan_sha256'])
        self.assertFalse(self.jobs.submissions)
        self.cid=self.vault.put(OWNER,'fixture-key')['credential_id'];self.jobs.capacity=True
        self.engine.start(OWNER,row['id'],self.cid,row['plan_sha256']);self.until(row['id'],{'paused'})
        self.assertFalse(self.jobs.submissions);self.jobs.capacity=False
        self.engine.start(OWNER,row['id'],self.cid,row['plan_sha256']);self.until(row['id'],{'completed'})
    def test_restart_does_not_resume_or_retry_uncertain_trial(self):
        row=self.create();internal=self.engine.rows[row['id']]
        internal['experiment']['status']='running';internal['experiment']['trials'][0]['status']='submitting';self.engine._save(internal)
        self.engine.close();loaded=Experiments(self.settings,self.jobs,self.vault,review,poll_interval=.01);self.addCleanup(loaded.close)
        result=loaded.get(OWNER,row['id']);self.assertEqual(result['status'],'needs_attention');self.assertFalse(self.jobs.submissions)
        with self.assertRaises(JobError):loaded.start(OWNER,row['id'],self.cid,row['plan_sha256'])
    def test_corrupt_and_symlinked_state_block_new_execution(self):
        self.engine.close();(self.engine.root/'unexpected').write_text('bad')
        loaded=Experiments(self.settings,self.jobs,self.vault,review,poll_interval=.01);self.addCleanup(loaded.close)
        self.assertTrue(loaded.blocked_reason)
        with self.assertRaises(JobError):loaded.create(OWNER,review_plan(draft(),review)['plan'],review_plan(draft(),review)['plan_sha256'],'different-fixture-key')
    def test_incomplete_and_ungraded_results_are_never_folded_into_failure_or_zero_cost(self):
        rows=[{'arm_id':'control','repeat':1,'status':'succeeded','job_id':'a','job':{'status':'succeeded','grade':'passed','usage':{'cost_usd':.02}}},
              {'arm_id':'variant','repeat':1,'status':'failed','job_id':'b','job':{'status':'failed','grade':'ungraded','usage':{}}}]
        result=summarize({'plan':{'reference_arm_id':'control','arms':[{'id':'control'},{'id':'variant'}],'repeats':1},'trials':rows})
        pair=result['comparisons'][0];self.assertEqual(pair['graded_pairs'],0);self.assertEqual(pair['incomplete_pairs'],1)
        self.assertEqual(result['confirmed_cost_usd'],.02);self.assertEqual(result['cost_unknown_trials'],1)

    def test_restart_active_job_can_be_cancelled_without_restarting_paid_work(self):
        self.jobs.finish=False;row=self.create();self.engine.start(OWNER,row['id'],self.cid,row['plan_sha256'])
        deadline=time.monotonic()+2
        while not self.jobs.submissions and time.monotonic()<deadline:time.sleep(.01)
        self.engine.close()
        loaded=Experiments(self.settings,self.jobs,self.vault,review,poll_interval=.01);self.addCleanup(loaded.close)
        self.assertEqual(loaded.get(OWNER,row['id'])['status'],'paused')
        original_reconcile=self.jobs.reconcile
        requested=[False]
        def request_cancel(owner,jid):
            result=self.jobs.get(owner,jid);requested[0]=True;result['status']='cancel_requested';return result
        def eventual_reconcile(*args):
            if requested[0]:
                for job in self.jobs.rows.values():job['status']='cancelled'
            return original_reconcile(*args)
        self.jobs.cancel=request_cancel;self.jobs.reconcile=eventual_reconcile
        loaded.cancel(OWNER,row['id'])
        deadline=time.monotonic()+2
        while loaded.get(OWNER,row['id'])['status']!='cancelled' and time.monotonic()<deadline:time.sleep(.01)
        self.assertEqual(loaded.get(OWNER,row['id'])['status'],'cancelled')
        self.assertEqual(len(self.jobs.submissions),1)

    def test_needs_attention_job_blocks_later_arms_instead_of_becoming_completed(self):
        original=self.jobs.submit
        def unsafe(*args):
            job=original(*args)
            for row in self.jobs.rows.values():row.update(status='needs_attention',grade='ungraded')
            job.update(status='needs_attention',grade='ungraded');return job
        self.jobs.submit=unsafe;row=self.create();self.engine.start(OWNER,row['id'],self.cid,row['plan_sha256'])
        result=self.until(row['id'],{'needs_attention'})
        self.assertEqual(len(self.jobs.submissions),1)
        self.assertEqual(result['summary']['pending_trials'],3)

    def test_frozen_review_drift_and_uncertain_missing_ack_pause_without_retry(self):
        row=self.create();self.engine.review=lambda c:({'ok':False},None)
        self.engine.start(OWNER,row['id'],self.cid,row['plan_sha256']);self.until(row['id'],{'paused'})
        self.assertFalse(self.jobs.submissions)
        self.engine.review=review
        self.jobs.submit=lambda *args:(_ for _ in ()).throw(OSError('uncertain fixture'))
        self.engine.start(OWNER,row['id'],self.cid,row['plan_sha256'])
        result=self.until(row['id'],{'needs_attention'})
        self.assertEqual(result['trials'][0]['status'],'needs_attention')
        self.assertEqual(result['summary']['cost_unknown_trials'],1)
        with self.assertRaises(JobError):self.engine.start(OWNER,row['id'],self.cid,row['plan_sha256'])

    def test_oversized_resolved_plan_is_rejected_without_silent_arm_truncation(self):
        value=draft()
        for arm in value['arms']:arm['configuration']['prompt']='x'*210000
        result=review_plan(value,review)
        self.assertFalse(result['ok']);self.assertIsNone(result['plan'])
        self.assertIn('retention limit',result['issues'][0])

    def test_tampered_final_state_cannot_hide_pending_or_cross_manifest_trials(self):
        row=self.create();self.engine.close()
        path=self.engine.root/(row['id']+'.json');original=json.loads(path.read_text())
        for mutation in ('completed-with-pending','cross-manifest-job'):
            changed=copy.deepcopy(original)
            if mutation=='completed-with-pending':changed['experiment']['status']='completed'
            else:
                trial=changed['experiment']['trials'][0];trial.update(status='succeeded',job_id='a'*48,
                    job={'id':'a'*48,'status':'succeeded','manifest_sha256':'0'*64,'grade':'passed'})
            path.write_text(json.dumps(changed))
            loaded=Experiments(self.settings,self.jobs,self.vault,review,poll_interval=.01);self.addCleanup(loaded.close)
            self.assertTrue(loaded.blocked_reason,mutation);self.assertEqual(loaded.list(OWNER),[])
        path.write_text(json.dumps(original))

    def test_paused_worker_must_finish_cleanup_before_resume_and_cannot_clear_successor(self):
        row=self.create(draft(1));eid=row['id']
        self.jobs.capacity=True
        paused_exit=threading.Event();release_old=threading.Event()
        original_lock=self.engine.lock;engine=self.engine
        class PauseExitGate:
            held=False
            def __enter__(self):original_lock.acquire();return self
            def __exit__(self,*error):
                hold=(not self.held and threading.current_thread() is engine.threads.get(eid)
                      and engine.rows[eid]['experiment']['status']=='paused')
                if hold:self.held=True
                original_lock.release()
                if hold:
                    paused_exit.set()
                    if not release_old.wait(3):raise AssertionError('Test did not release paused worker')
        self.engine.lock=PauseExitGate()
        self.engine.start(OWNER,eid,self.cid,row['plan_sha256'])
        self.assertTrue(paused_exit.wait(3),'Worker did not reach paused cleanup boundary')
        old_worker=self.engine.threads[eid]
        new_id=self.vault.put(OWNER,'replacement-fixture-key')['credential_id']
        try:
            with self.assertRaises(JobError) as error:
                self.engine.start(OWNER,eid,new_id,row['plan_sha256'])
            self.assertEqual(error.exception.status,409)
            self.assertIs(self.engine.threads[eid],old_worker)
            self.assertEqual(self.engine.credentials[eid],self.cid)
            # Defend cleanup ownership independently of admission: a stale worker
            # cannot clear a successor handle even if its mapping is replaced.
            successor=threading.Thread(target=lambda:None)
            with self.engine.lock:
                self.engine.threads[eid]=successor
                self.engine.credentials[eid]=new_id
        finally:
            release_old.set();old_worker.join(3)
            self.assertFalse(old_worker.is_alive())
        self.assertEqual(self.engine.credentials[eid],new_id)
        self.engine.threads[eid]=old_worker
        self.jobs.capacity=False
        self.engine.start(OWNER,eid,new_id,row['plan_sha256'])
        self.until(eid,{'completed'})
        self.assertEqual(len(self.jobs.submissions),2)

class ExperimentAPITests(unittest.TestCase):
    """Signed private-boundary tests with explicit fixture runtimes/executors."""
    def setUp(self):
        from fastapi.testclient import TestClient
        from traceharness.runner_service.service import create_app
        from tests_agentlab.runner_service.test_native_prompt_protocol import NativePromptProtocolTests
        from tests_agentlab.runner_service.test_runner import FixtureExecutor, FixtureProvider, SECRET, OWNER as AUTH_OWNER
        self.fixture=NativePromptProtocolTests();self.fixture.setUp();self.addCleanup(self.fixture.doCleanups)
        self.executor=FixtureExecutor();self.executor.health=lambda:self.fixture.health
        self.secret,self.owner=SECRET,AUTH_OWNER;self.now=1770000000;self.nonce=0
        app=create_app(Settings(shared_secret=SECRET,state_dir=self.fixture.root/'api-jobs'),registry=self.fixture.registry(),provider=FixtureProvider(),executor=self.executor,clock=lambda:self.now)
        self.app=app;self.client=TestClient(app);self.client.__enter__();self.addCleanup(lambda:self.client.__exit__(None,None,None))
        self.plan=draft(1)
        self.plan['arms'][0]['configuration']=copy.deepcopy(self.fixture.config)
        self.plan['arms'][1]['configuration']=copy.deepcopy(self.fixture.config)
        self.plan['arms'][1]['configuration']['native_prompt_profile']['default_action']='disable'
    def request(self,method,path,body=None,owner=None):
        from traceharness.runner_service.auth import sign
        from traceharness.runner_service.configuration import canonical
        raw=canonical(body) if body is not None else b'';self.nonce+=1;nonce=f'{self.nonce:032x}';owner=owner or self.owner;timestamp=str(self.now)
        headers={'content-type':'application/json','x-traceharness-user':owner,'x-traceharness-timestamp':timestamp,'x-traceharness-nonce':nonce,
                 'x-traceharness-signature':sign(self.secret,method,path,owner,timestamp,nonce,raw)}
        return self.client.request(method,path,content=raw,headers=headers)
    def frozen(self):
        path='/api/runner/experiments'
        reviewed=self.request('POST',path+'/preflight',{'plan':self.plan});self.assertEqual(reviewed.status_code,200,reviewed.text)
        value=reviewed.json();self.assertTrue(value['ok'],value)
        response=self.request('POST',path,{'plan':self.plan,'plan_sha256':value['plan_sha256'],'idempotency_key':'api-fixture-create-key'})
        self.assertEqual(response.status_code,200,response.text);return response.json()['experiment']
    def test_exact_authentication_owner_and_frozen_hash_boundaries(self):
        from tests_agentlab.runner_service.test_runner import OTHER as AUTH_OTHER
        prefix='/api/runner/experiments';eid='a'*48
        for method,path,body in [('GET',prefix,None),('POST',prefix+'/preflight',{'plan':self.plan}),('POST',prefix,{}),
                                 ('GET',prefix+'/'+eid,None),('POST',prefix+'/'+eid+'/start',{}),('POST',prefix+'/'+eid+'/cancel',{})]:
            response=self.client.request(method,path,json=body,headers={'Origin':'https://hostile.invalid'})
            self.assertEqual(response.status_code,401);self.assertNotIn('access-control-allow-origin',response.headers)
        self.assertEqual(self.request('POST',prefix+'/preflight',{'plan':self.plan,'owner':AUTH_OTHER}).status_code,400)
        row=self.frozen();path=prefix+'/'+row['id']
        for method,route,body in [('GET',path,None),('POST',path+'/start',{'credential_id':'a'*48,'plan_sha256':row['plan_sha256']}),('POST',path+'/cancel',{})]:
            response=self.request(method,route,body,AUTH_OTHER);self.assertEqual(response.status_code,404,response.text)
        self.assertEqual(self.request('GET',prefix,owner=AUTH_OTHER).json(),{'experiments':[]})
        self.assertEqual(self.request('POST',prefix,{'plan':self.plan,'plan_sha256':'0'*64,'idempotency_key':'api-fixture-other-key'}).status_code,409)
        self.assertEqual(self.executor.count,0)
    def test_full_api_freeze_start_completion_and_outcome_retention(self):
        row=self.frozen();prefix='/api/runner/experiments/'+row['id']
        connection=self.app.state.vault.put(self.owner,'explicit-fixture-no-provider-key')
        body={'credential_id':connection['credential_id'],'plan_sha256':row['plan_sha256']}
        response=self.request('POST',prefix+'/start',body);self.assertEqual(response.status_code,200,response.text)
        end=time.monotonic()+3
        while time.monotonic()<end:
            response=self.request('GET',prefix);result=response.json()['experiment']
            if result['status']=='completed':break
            time.sleep(.02)
        self.assertEqual(result['status'],'completed',result['issues']);self.assertEqual(self.executor.count,2)
        self.assertEqual(len(result['trials']),2);self.assertTrue(all(t['job']['grade']=='failed' for t in result['trials']))
        self.assertEqual(result['summary']['comparisons'][0]['both_fail'],1)
        self.assertNotIn('credential_id',json.dumps(result));self.assertNotIn('owner',result)
        listing=self.request('GET','/api/runner/experiments').json()['experiments'][0]
        self.assertNotIn('plan',listing);self.assertNotIn('trials',listing)
        self.assertEqual(self.request('POST',prefix+'/cancel',{}).json()['experiment']['status'],'completed')
