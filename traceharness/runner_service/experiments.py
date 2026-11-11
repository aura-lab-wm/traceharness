"""Frozen, owner-bound paired native prompt experiments.

A schedule is persisted before paid work. Submission identities never change,
uncertain submissions never retry, and credentials exist only in process memory.
The local scheduler seed controls order, not native model sampling.
"""
from __future__ import annotations

import copy
from decimal import Decimal, InvalidOperation
import json
import math
import os
from pathlib import Path
import re
import secrets
import threading
import time

from .configuration import canonical, digest, has_secret
from .credentials import CredentialUnavailable
from .jobs import JobError, TERMINAL as JOB_TERMINAL
from .native_prompts import PINS

ID = re.compile(r'[a-f0-9]{48}\Z')
SHA = re.compile(r'[a-f0-9]{64}\Z')
KEY = re.compile(r'[A-Za-z0-9_-]{16,128}\Z')
ARM_ID = re.compile(r'[A-Za-z0-9_-]{1,64}\Z')
EXPERIMENT_STATES = {'ready','running','paused','cancelling','completed','cancelled','needs_attention'}
TRIAL_TERMINAL = {'succeeded','failed','cancelled','needs_attention','refused'}
TRIAL_ACTIVE = {'submitting','queued','running','cancel_requested'}
MAX_PLAN_BYTES = 768 * 1024
MAX_RECORD_BYTES = 1536 * 1024
MAX_JOB_BYTES = 8192
MAX_RECORDS = 128
MAX_STATE_BYTES = 64 * 1024 * 1024
ALGORITHM = 'sha256-cyclic-v1'


def _require(condition, message):
    if not condition:
        raise JobError(message)


def _label(value, maximum):
    return (isinstance(value,str) and 0 < len(value) <= maximum and value.strip() == value
            and not re.search(r'[\x00-\x1f\x7f]',value))


def _core_plan(value):
    """Validate authoring shape without consulting execution readiness."""
    _require(isinstance(value,dict) and set(value)=={'version','name','seed','repeats','arms'},'Invalid experiment plan fields.')
    _require(type(value['version']) is int and value['version']==1,'Unsupported experiment plan version.')
    _require(_label(value['name'],120),'Enter an experiment name of at most 120 characters.')
    _require(type(value['seed']) is int and 0 <= value['seed'] <= 2**32-1,'Use an integer schedule seed from 0 to 4294967295.')
    _require(type(value['repeats']) is int and 1 <= value['repeats'] <= 10,'Use 1 to 10 paired repetitions.')
    arms=value['arms']
    _require(isinstance(arms,list) and 2 <= len(arms) <= 8 and len(arms)*value['repeats'] <= 64,
             'An experiment requires 2 to 8 arms and at most 64 scheduled trials.')
    _require(not has_secret(value) and len(canonical(value)) <= 1024*1024,'Experiment plans cannot contain credentials or exceed one MiB.')
    ids=set();reference=pins=None
    for arm in arms:
        _require(isinstance(arm,dict) and set(arm)=={'id','label','configuration'},'Invalid experiment arm fields.')
        _require(isinstance(arm['id'],str) and ARM_ID.fullmatch(arm['id']) and arm['id'] not in ids,'Use unique experiment arm identities.')
        ids.add(arm['id']);_require(_label(arm['label'],80),'Use arm labels of at most 80 characters.')
        c=arm['configuration']
        _require(isinstance(c,dict) and type(c.get('version')) is int and c['version']==2
                 and c.get('runtime_id') in {'native-claude-code','native-codex'} and isinstance(c.get('native_prompt_profile'),dict),
                 'Each arm requires a native version-2 prompt configuration.')
        fixed={k:v for k,v in c.items() if k!='native_prompt_profile'}
        identity={k:c['native_prompt_profile'].get(k) for k in PINS}
        _require(all(isinstance(v,str) and v for v in identity.values()),'Each arm requires complete native prompt identity pins.')
        if reference is None:reference,pins=canonical(fixed),identity
        _require(canonical(fixed)==reference and identity==pins,
                 'Paired arms must share runtime, model, task, additional instructions, limits and native inventory pins.')
    return copy.deepcopy(value)


def _schedule(base):
    order=sorted([a['id'] for a in base['arms']],key=lambda arm:(digest({'seed':base['seed'],'arm_id':arm}),arm))
    identity=digest(base);arms={a['id']:a for a in base['arms']};schedule=[]
    for repeat in range(base['repeats']):
        shift=repeat%len(order)
        for arm in order[shift:]+order[:shift]:
            schedule.append({'id':digest({'plan':identity,'repeat':repeat+1,'arm_id':arm})[:48],
                             'index':len(schedule),'repeat':repeat+1,'arm_id':arm,'manifest_sha256':arms[arm]['manifest_sha256']})
    return schedule


def review_plan(value, review):
    """Pure: resolve all exact manifests, then freeze one reproducible schedule."""
    failure=lambda message:{'ok':False,'issues':[message],'plan':None,'plan_sha256':None,'maximum_cost_usd':None,'trial_count':0}
    try:
        draft=_core_plan(value);arms=[]
        for arm in draft['arms']:
            result,_=review(arm['configuration'])
            _require(isinstance(result,dict) and result.get('ok') is True,'An experiment arm did not pass current runner review.')
            _require(isinstance(result.get('manifest'),dict) and digest(result['manifest'])==result.get('manifest_sha256'),
                     'An experiment arm manifest could not be verified.')
            arms.append({**arm,'manifest':result['manifest'],'manifest_sha256':result['manifest_sha256']})
        total=sum((Decimal(str(a['configuration']['limits']['max_cost_usd'])) for a in arms),Decimal('0'))*draft['repeats']
        _require(total.is_finite() and Decimal('0') < total <= Decimal('100'),'The maximum aggregate experiment budget must be at most $100.')
        plan={**draft,'reference_arm_id':arms[0]['id'],'order_algorithm':ALGORITHM,'arms':arms,
              'maximum_cost_usd':float(total),'trial_count':len(arms)*draft['repeats']}
        plan['schedule']=_schedule(plan)
        _require(len(canonical(plan))<=MAX_PLAN_BYTES,'The frozen experiment plan exceeds its retention limit. Use fewer or smaller arms.')
        return {'ok':True,'issues':[],'plan':plan,'plan_sha256':digest(plan),'maximum_cost_usd':float(total),'trial_count':plan['trial_count']}
    except JobError as error:return failure(str(error))
    except (ValueError,TypeError,KeyError,UnicodeError,RecursionError,OverflowError,InvalidOperation):return failure('The experiment plan is incomplete or invalid.')


def _validated_plan(plan, expected):
    _require(isinstance(plan,dict) and set(plan)=={'version','name','seed','repeats','reference_arm_id','order_algorithm','arms','schedule','maximum_cost_usd','trial_count'},'Invalid frozen experiment plan.')
    _require(isinstance(expected,str) and SHA.fullmatch(expected) and digest(plan)==expected,'Experiment plan integrity changed.')
    draft={k:copy.deepcopy(plan[k]) for k in ('version','name','seed','repeats')}
    draft['arms']=[]
    for arm in plan['arms']:
        _require(isinstance(arm,dict) and set(arm)=={'id','label','configuration','manifest','manifest_sha256'},'Invalid frozen experiment arm.')
        _require(isinstance(arm['manifest'],dict) and digest(arm['manifest'])==arm['manifest_sha256'],'Frozen arm integrity changed.')
        draft['arms'].append({k:arm[k] for k in ('id','label','configuration')})
    _core_plan(draft)
    base={k:v for k,v in plan.items() if k!='schedule'}
    _require(plan['reference_arm_id']==plan['arms'][0]['id'] and plan['order_algorithm']==ALGORITHM
             and plan['schedule']==_schedule(base) and plan['trial_count']==len(plan['schedule']), 'Frozen experiment schedule changed.')
    total=sum((Decimal(str(a['configuration']['limits']['max_cost_usd'])) for a in plan['arms']),Decimal('0'))*plan['repeats']
    _require(total==Decimal(str(plan['maximum_cost_usd'])) and 0 < total <= 100 and len(canonical(plan))<=MAX_PLAN_BYTES,'Invalid frozen experiment budget or size.')
    return plan


def summarize(experiment):
    trials=experiment['trials'];plan=experiment['plan'];final=[t for t in trials if t['status'] in TRIAL_TERMINAL]
    issued=[t for t in trials if t.get('job_id') or t['status'] in {'submitting','needs_attention'}]
    def reported(t):
        value=(t.get('job') or {}).get('usage',{}).get('cost_usd')
        return value if type(value) in (float,int) and math.isfinite(value) and value >= 0 else None
    known=[Decimal(str(reported(t))) for t in issued if reported(t) is not None]
    out={'finalized_trials':len(final),'pending_trials':sum(t['status']=='pending' for t in trials),
         'active_trials':sum(t['status'] in TRIAL_ACTIVE for t in trials),'confirmed_cost_usd':float(sum(known,Decimal('0'))),
         'cost_unknown_trials':sum(reported(t) is None for t in issued),'comparisons':[]}
    by_pair={(t['arm_id'],t['repeat']):t for t in trials}
    for arm in plan['arms']:
        if arm['id']==plan['reference_arm_id']:continue
        row={k:0 for k in ('graded_pairs','control_only_pass','variant_only_pass','both_pass','both_fail','incomplete_pairs','known_cost_pairs')}
        row.update(arm_id=arm['id'],planned_pairs=plan['repeats'])
        for repeat in range(1,plan['repeats']+1):
            a=by_pair.get((plan['reference_arm_id'],repeat),{});b=by_pair.get((arm['id'],repeat),{})
            def grade(t):
                job=t.get('job') or {}
                return job.get('grade') if t.get('status')=='succeeded' and job.get('status')=='succeeded' and job.get('grade') in {'passed','failed'} else None
            ga,gb=grade(a),grade(b)
            if ga is not None and gb is not None:
                row['graded_pairs']+=1
                row['both_pass' if ga==gb=='passed' else 'both_fail' if ga==gb=='failed' else 'control_only_pass' if ga=='passed' else 'variant_only_pass']+=1
            else:row['incomplete_pairs']+=1
            if reported(a) is not None and reported(b) is not None:row['known_cost_pairs']+=1
        out['comparisons'].append(row)
    return out


class Experiments:
    def __init__(self, settings, jobs, vault, review, clock=time.time, poll_interval=.2):
        self.jobs,self.vault,self.review,self.clock=jobs,vault,review,clock
        self.root=Path(settings.state_dir).with_name(Path(settings.state_dir).name+'-experiments')
        if self.root.is_symlink():raise ValueError('Experiment state cannot be a symlink')
        self.root.mkdir(mode=0o700,parents=True,exist_ok=True);self.root.chmod(0o700)
        self.lock=threading.RLock();self.rows={};self.idempotency={};self.threads={};self.credentials={}
        self.stop=threading.Event();self.poll_interval=max(.01,float(poll_interval));self.blocked_reason=None
        paths=list(self.root.iterdir())
        if len(paths)>MAX_RECORDS:self.blocked_reason='Experiment state exceeds its retention limit.'
        for path in paths[:MAX_RECORDS]:
            try:
                _require(not path.is_symlink() and path.is_file() and re.fullmatch(r'[a-f0-9]{48}\.json',path.name)
                         and path.stat().st_size<=MAX_RECORD_BYTES,'Invalid experiment state file.')
                row=json.loads(path.read_bytes());self._validate_row(row,path.stem)
                exp=row['experiment']
                for trial in exp['trials']:
                    if trial['status'] in TRIAL_ACTIVE:
                        self._reconcile_trial(row,trial)
                if any(t['status']=='needs_attention' for t in exp['trials']):
                    exp['status']='needs_attention';exp['issues']=['A prior trial requires operator reconciliation. No automatic retry was made.']
                elif all(t['status'] in TRIAL_TERMINAL for t in exp['trials']):
                    exp['status']='cancelled' if exp['cancellation_requested'] else 'completed'
                elif exp['status'] in {'running','cancelling'}:
                    exp['status']='paused';exp['issues']=['Runner restarted. Reconnect credentials before resuming unsubmitted trials.']
                self.rows[path.stem]=row
                identity=(row['owner'],row['idempotency_key'])
                _require(identity not in self.idempotency,'Duplicate experiment replay identity.')
                self.idempotency[identity]=path.stem;self._save(row)
            except (ValueError,TypeError,KeyError,OSError,JobError,UnicodeError,RecursionError,OverflowError,InvalidOperation):self.blocked_reason='Unreadable experiment state requires operator reconciliation.'
        if sum(len(canonical(row)) for row in self.rows.values())>MAX_STATE_BYTES:self.blocked_reason='Experiment state exceeds its retention limit.'

    def _validate_row(self,row,eid):
        _require(isinstance(row,dict) and set(row)=={'owner','idempotency_key','experiment'},'Invalid experiment state.')
        _require(_label(row['owner'],100) and isinstance(row['idempotency_key'],str) and KEY.fullmatch(row['idempotency_key']),'Invalid owner or replay identity.')
        exp=row['experiment']
        _require(isinstance(exp,dict) and set(exp)=={'id','status','created_at','updated_at','plan_sha256','plan','trial_count','maximum_cost_usd','cancellation_requested','issues','trials'},'Invalid experiment fields.')
        _require(exp['id']==eid and ID.fullmatch(eid) and exp['status'] in EXPERIMENT_STATES,'Invalid experiment identity or status.')
        _validated_plan(exp['plan'],exp['plan_sha256'])
        issues_ok=lambda values:isinstance(values,list) and len(values)<=100 and all(isinstance(v,str) and len(v)<=2000 for v in values)
        _require(exp['trial_count']==exp['plan']['trial_count'] and exp['maximum_cost_usd']==exp['plan']['maximum_cost_usd']
                 and isinstance(exp['cancellation_requested'],bool) and issues_ok(exp['issues'])
                 and isinstance(exp['trials'],list) and len(exp['trials'])==exp['trial_count']
                 and all(type(exp[k]) is int and exp[k]>=0 for k in ('created_at','updated_at')),'Invalid experiment dimensions.')
        for trial,scheduled in zip(exp['trials'],exp['plan']['schedule']):
            _require(set(trial)=={'id','index','repeat','arm_id','status','job_id','manifest_sha256','job','issues'}
                     and all(trial[k]==v for k,v in scheduled.items()) and trial['status'] in TRIAL_TERMINAL|TRIAL_ACTIVE|{'pending'},'Invalid experiment trial.')
            _require(trial['job_id'] is None or isinstance(trial['job_id'],str) and ID.fullmatch(trial['job_id']),'Invalid trial job identity.')
            _require(issues_ok(trial['issues']),'Invalid trial issues.')
            job=trial['job']
            if job is not None:
                _require(isinstance(job,dict) and job.get('id')==trial['job_id'] and job.get('manifest_sha256')==trial['manifest_sha256']
                         and job.get('status') in JOB_TERMINAL|{'queued','running','cancel_requested'} and 'manifest' not in job
                         and len(canonical(job))<=MAX_JOB_BYTES,'Invalid retained trial outcome.')
            if trial['status'] in {'pending','submitting'}:
                _require(trial['job_id'] is None and job is None,'Unsubmitted trial contains a job outcome.')
            elif trial['status'] in {'queued','running','cancel_requested','succeeded','failed'}:
                _require(job is not None and job.get('status')==trial['status'],'Trial and retained outcome disagree.')
        if exp['status'] in {'completed','cancelled'}:
            _require(all(t['status'] in TRIAL_TERMINAL-{'needs_attention'} for t in exp['trials'])
                     and exp['cancellation_requested']==(exp['status']=='cancelled'),'Final experiment has unfinished or uncertain trials.')
        if exp['status']=='ready':
            _require(all(t['status']=='pending' for t in exp['trials']) and not exp['cancellation_requested'],'Ready experiment has submitted trials.')
        _require(not has_secret(row),'Experiment state contains credential-shaped data.')

    def _save(self,row):
        raw=canonical(row)
        _require(len(raw)<=MAX_RECORD_BYTES,'Experiment retention limit reached.')
        total=sum(len(canonical(existing)) for key,existing in self.rows.items() if key!=row['experiment']['id'])+len(raw)
        _require(total<=MAX_STATE_BYTES,'Experiment state exceeds its retention limit.')
        path=self.root/(row['experiment']['id']+'.json');temp=self.root/(row['experiment']['id']+'.tmp')
        _require(not path.is_symlink() and not temp.exists(),'Unsafe experiment state requires operator reconciliation.')
        with temp.open('xb') as output:
            os.fchmod(output.fileno(),0o600)
            output.write(raw);output.flush();os.fsync(output.fileno())
        temp.replace(path)
        directory_fd=os.open(self.root,os.O_RDONLY)
        try:os.fsync(directory_fd)
        finally:os.close(directory_fd)

    def _public(self,row,summary_only=False):
        exp=copy.deepcopy(row['experiment']);exp['summary']=summarize(exp)
        if summary_only:exp.pop('plan');exp.pop('trials')
        return exp

    def _owned(self,owner,eid):
        row=self.rows.get(eid)
        if row is None or row['owner']!=owner:raise JobError('Experiment not found.',404)
        return row

    def _safe(self):
        if self.blocked_reason or self.stop.is_set():raise JobError('Experiment execution requires operator reconciliation.',503)

    def create(self,owner,plan,plan_sha256,idempotency_key):
        _validated_plan(plan,plan_sha256)
        _require(_label(owner,100) and isinstance(idempotency_key,str) and KEY.fullmatch(idempotency_key),'Supply a valid experiment replay identity.')
        with self.lock:
            self._safe();existing=self.idempotency.get((owner,idempotency_key))
            if existing:
                row=self.rows[existing]
                if row['experiment']['plan_sha256']!=plan_sha256:raise JobError('Experiment identity belongs to a different frozen plan.',409)
                return self._public(row)
            if len(self.rows)>=MAX_RECORDS or sum(r['owner']==owner for r in self.rows.values())>=32:raise JobError('Experiment retention capacity is full.',429)
            eid=secrets.token_hex(24);now=int(self.clock())
            exp={'id':eid,'status':'ready','created_at':now,'updated_at':now,'plan_sha256':plan_sha256,'plan':copy.deepcopy(plan),
                 'trial_count':plan['trial_count'],'maximum_cost_usd':plan['maximum_cost_usd'],'cancellation_requested':False,
                 'issues':[],'trials':[{**s,'status':'pending','job_id':None,'job':None,'issues':[]} for s in plan['schedule']]}
            row={'owner':owner,'idempotency_key':idempotency_key,'experiment':exp}
            if sum(len(canonical(r)) for r in self.rows.values())+len(canonical(row))>MAX_STATE_BYTES:raise JobError('Experiment retention capacity is full.',429)
            self._save(row);self.rows[eid]=row;self.idempotency[owner,idempotency_key]=eid
            return self._public(row)

    def get(self,owner,eid):
        with self.lock:return self._public(self._owned(owner,eid))

    def list(self,owner):
        with self.lock:return [self._public(row,True) for row in sorted(self.rows.values(),key=lambda r:r['experiment']['created_at'],reverse=True) if row['owner']==owner]

    @staticmethod
    def _trial_key(eid,trial):return 'experiment_'+eid+'_'+trial['id']

    def _copy_job(self,trial,job):
        _require(job['manifest_sha256']==trial['manifest_sha256'],'A trial resolved to a different reviewed manifest.')
        summary={k:copy.deepcopy(v) for k,v in job.items() if k!='manifest'}
        _require(len(canonical(summary))<=MAX_JOB_BYTES,'Trial outcome details exceed experiment retention. Inspect the owner-bound job before continuing.')
        trial.update(job_id=job['id'],status=job['status'],job=summary)

    def _reconcile_trial(self,row,trial):
        exp=row['experiment'];owner=row['owner']
        job=self.jobs.reconcile(owner,self._trial_key(exp['id'],trial),trial['manifest_sha256'])
        if job:
            self._copy_job(trial,job)
        elif trial['status']=='submitting' or trial['job_id']:
            trial.update(status='needs_attention',issues=['The prior submission outcome is uncertain. It was not retried.'])

    def start(self,owner,eid,credential_id,plan_sha256):
        with self.lock:
            row=self._owned(owner,eid);exp=row['experiment']
            if exp['plan_sha256']!=plan_sha256:raise JobError('The frozen experiment plan changed.',409)
            self._safe()
            previous=self.threads.get(eid)
            if previous is not None and previous.is_alive():
                if exp['status']=='running':return self._public(row)
                raise JobError('The previous scheduler is finishing. Refresh before resuming.',409)
            if exp['status'] not in {'ready','paused'} or exp['cancellation_requested']:raise JobError('This experiment cannot be started or resumed.',409)
            if any(r['owner']==owner and r['experiment']['status'] in {'running','cancelling'} for r in self.rows.values()):raise JobError('Another experiment for this member is active.',429)
            if sum(t.is_alive() for t in self.threads.values())>=4:raise JobError('Experiment scheduling capacity is full.',429)
            self.vault.resolve(owner,credential_id)
            exp.update(status='running',issues=[],updated_at=int(self.clock()));self.credentials[eid]=credential_id;self._save(row)
            worker=threading.Thread(target=self._run,args=(eid,),name='paired-experiment',daemon=True);self.threads[eid]=worker;worker.start()
            return self._public(row)

    def cancel(self,owner,eid):
        with self.lock:
            row=self._owned(owner,eid);exp=row['experiment']
            if exp['status'] in {'completed','cancelled'}:return self._public(row)
            exp['cancellation_requested']=True
            for trial in exp['trials']:
                if trial['status']=='pending':trial.update(status='cancelled',issues=['Cancelled before submission.'])
            exp.update(status='cancelling',updated_at=int(self.clock()));self._save(row)
            for trial in exp['trials']:
                if trial['job_id'] and trial['status'] not in TRIAL_TERMINAL:self._copy_job(trial,self.jobs.cancel(owner,trial['job_id']))
            if any(t['status']=='needs_attention' for t in exp['trials']):
                exp['status']='needs_attention'
            elif all(t['status'] in TRIAL_TERMINAL for t in exp['trials']):
                exp['status']='cancelled'
            elif not self.threads.get(eid) or not self.threads[eid].is_alive():
                # Recovered/paused work still needs a monitor to confirm actual
                # cancellation. Monitoring cannot issue new paid trials.
                worker=threading.Thread(target=self._run,args=(eid,),name='paired-experiment-cancel',daemon=True)
                self.threads[eid]=worker;worker.start()
            self._save(row);return self._public(row)

    def _pause(self,row,message,status='paused'):
        row['experiment'].update(status=status,issues=[message],updated_at=int(self.clock()));self._save(row)

    def _run(self,eid):
        try:
            while not self.stop.is_set():
                with self.lock:
                    row=self.rows[eid];exp=row['experiment'];owner=row['owner']
                    if self.blocked_reason:
                        self._pause(row,'Experiment persistence requires operator reconciliation.','needs_attention');return
                    if any(t['status']=='needs_attention' for t in exp['trials']):
                        self._pause(row,'A trial requires operator reconciliation. No later arm was submitted.','needs_attention');return
                    trial=next((t for t in exp['trials'] if t['status'] not in TRIAL_TERMINAL),None)
                    if not trial:
                        exp.update(status='cancelled' if exp['cancellation_requested'] else 'completed',updated_at=int(self.clock()));self._save(row);return
                    if trial['status'] in TRIAL_ACTIVE:
                        self._reconcile_trial(row,trial)
                        if trial['status']=='needs_attention':self._pause(row,'A trial requires operator reconciliation. No retry was made.','needs_attention');return
                        if exp['cancellation_requested'] and trial['job_id'] and trial['status'] not in TRIAL_TERMINAL:
                            self._copy_job(trial,self.jobs.cancel(owner,trial['job_id']))
                        self._save(row)
                        if trial['status'] in TRIAL_TERMINAL:continue
                    elif exp['cancellation_requested']:
                        trial.update(status='cancelled',issues=['Cancelled before submission.']);self._save(row);continue
                    else:
                        arm=next(a for a in exp['plan']['arms'] if a['id']==trial['arm_id'])
                        result,model=self.review(arm['configuration'])
                        if not result.get('ok') or result.get('manifest_sha256')!=trial['manifest_sha256']:
                            self._pause(row,'The frozen runtime/model/task/profile is no longer available. No new trial was submitted.');return
                        if self.stop.is_set():return
                        credential=self.credentials[eid]
                        try:self.vault.resolve(owner,credential)
                        except CredentialUnavailable:self._pause(row,'Credentials expired or were revoked. Reconnect before resuming unsubmitted trials.');return
                        # Check a durable existing identity before a new handle is used.
                        existing=self.jobs.reconcile(owner,self._trial_key(eid,trial),trial['manifest_sha256'])
                        if existing:self._copy_job(trial,existing);self._save(row);continue
                        trial['status']='submitting';self._save(row)
                        try:job=self.jobs.submit(owner,arm['manifest'],credential,self._trial_key(eid,trial),model)
                        except (JobError,CredentialUnavailable) as error:
                            existing=self.jobs.reconcile(owner,self._trial_key(eid,trial),trial['manifest_sha256'])
                            if existing:self._copy_job(trial,existing);self._save(row);continue
                            if isinstance(error,CredentialUnavailable) or error.status==429:
                                trial['status']='pending';self._pause(row,'Scheduling paused before submission. Reconnect credentials or wait for runner capacity.');return
                            trial.update(status='refused',issues=['Runner refused this scheduled trial before submission.'])
                            self._pause(row,'A scheduled trial was refused. Inspect the outcome before resuming.');return
                        except Exception:
                            existing=self.jobs.reconcile(owner,self._trial_key(eid,trial),trial['manifest_sha256'])
                            if existing:self._copy_job(trial,existing);self._save(row);continue
                            trial.update(status='needs_attention',issues=['Submission acknowledgement was lost. This trial was not retried.'])
                            self._pause(row,'A submission outcome is uncertain. Operator reconciliation is required.','needs_attention');return
                        self._copy_job(trial,job);self._save(row)
                self.stop.wait(self.poll_interval)
        except Exception:
            with self.lock:
                row=self.rows[eid]
                try:self._pause(row,'Experiment scheduling did not finish safely. Inspect submitted jobs before continuing.','needs_attention')
                except Exception:self.blocked_reason='Experiment persistence requires operator reconciliation.'
        finally:
            with self.lock:
                # Cleanup belongs to this worker, never a successor that may
                # have acquired the same experiment identity after it stopped.
                if self.threads.get(eid) is threading.current_thread():
                    self.credentials.pop(eid,None)
                    if self.stop.is_set() and self.rows[eid]['experiment']['status']=='running':
                        self._pause(self.rows[eid],'Runner is stopping. Reconcile submitted jobs before resuming.','paused')

    def close(self):
        self.stop.set()
        with self.lock:workers=list(self.threads.values())
        for worker in workers:worker.join()
        with self.lock:self.credentials.clear()
