"""Concurrent private API readiness readers share one bounded fresh check.

The lock observer only establishes interleaving; payloads flow through the real
ASGI authentication, refresh, registry compatibility and catalog code.
"""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import tempfile
import threading
import time
import unittest

from fastapi.testclient import TestClient

from traceharness.runner_service.auth import sign
from traceharness.runner_service.configuration import canonical
from traceharness.runner_service.service import create_app
from traceharness.runner_service.settings import Settings
from tests_agentlab.runner_service.test_runner import fixture_registry, FixtureExecutor, FixtureProvider, SECRET, OWNER


def closure_cell(function, name):
    return dict(zip(function.__code__.co_freevars, function.__closure__))[name]


class ReadinessSingleFlightTests(unittest.TestCase):
    def wave(self, *, fails=False, expired_passing_cache=False):
        temp=tempfile.TemporaryDirectory();self.addCleanup(temp.cleanup)
        root=Path(temp.name);registry,_=fixture_registry(root)
        began,release,second_attempt=threading.Event(),threading.Event(),threading.Event()
        checking=[False];calls=[0];model_calls=[0]
        executor=FixtureExecutor();provider=FixtureProvider();original_health=executor.health;original_models=provider.models
        def gated_health():
            calls[0]+=1
            if checking[0]:
                began.set()
                if not release.wait(4):raise AssertionError('Readiness proof gate was not released')
                if fails:raise RuntimeError('Explicit fixture readiness failure')
            return original_health()
        def counted_models(allowed):model_calls[0]+=1;return original_models(allowed)
        executor.health=gated_health;provider.models=counted_models
        now=[1770000000]
        app=create_app(Settings(shared_secret=SECRET,state_dir=root/'jobs'),registry=registry,provider=provider,executor=executor,clock=lambda:now[0])
        client=TestClient(app);client.__enter__();self.addCleanup(lambda:client.__exit__(None,None,None))
        nonce=[0];nonce_lock=threading.Lock()
        def request(path='/api/runner/catalog'):
            with nonce_lock:nonce[0]+=1;token=f'{nonce[0]:032x}'
            timestamp=str(now[0]);headers={'x-traceharness-user':OWNER,'x-traceharness-timestamp':timestamp,'x-traceharness-nonce':token,
                'x-traceharness-signature':sign(SECRET,'GET',path,OWNER,timestamp,token,b'')}
            return client.get(path,headers=headers)
        if expired_passing_cache:
            warm=request();self.assertTrue(warm.json()['runner']['available']);now[0]+=31
            calls[0]=0;model_calls[0]=0
        catalog=next(route.endpoint for route in app.routes if route.path=='/api/runner/catalog')
        health=closure_cell(catalog,'health').cell_contents
        refresh=closure_cell(health,'refresh').cell_contents
        cell=closure_cell(refresh,'readiness_lock');original_lock=cell.cell_contents
        class ObservedLock:
            attempts=0
            def acquire(self,*args,**kwargs):
                self.attempts+=1
                second=self.attempts==2
                if kwargs.get('blocking',True) is False:
                    # Before the fix this is deterministically a failed try-lock;
                    # signal only AFTER that result, while the first check is held.
                    result=original_lock.acquire(*args,**kwargs)
                    if second:second_attempt.set()
                    return result
                # After the fix the second waiter has entered its bounded wait.
                if second:second_attempt.set()
                return original_lock.acquire(*args,**kwargs)
            def release(self):return original_lock.release()
        cell.cell_contents=ObservedLock();checking[0]=True
        with ThreadPoolExecutor(max_workers=2) as pool:
            first=pool.submit(request)
            try:
                self.assertTrue(began.wait(2),'First fresh health check did not start')
                second=pool.submit(request)
                self.assertTrue(second_attempt.wait(2),'Concurrent health reader did not reach its lock')
                # A waiting refresh must not block the ASGI event loop or anon gate.
                anonymous=client.get('/api/runner/catalog')
                self.assertEqual(anonymous.status_code,401)
                self.assertNotIn('access-control-allow-origin',anonymous.headers)
            finally:release.set()
            responses=[first.result(timeout=4),second.result(timeout=4)]
        for response in responses:
            self.assertEqual(response.status_code,200,response.text)
            self.assertEqual(response.json()['runner']['available'],not fails)
        self.assertEqual(calls[0],1,'Readers should share one fresh health check')
        self.assertEqual(model_calls[0],0 if fails else 1)
        return app,request,calls,model_calls

    def test_concurrent_cold_readers_share_fresh_success_without_false_unavailable(self):
        app,request,calls,model_calls=self.wave()
        self.assertTrue(request().json()['runner']['available'])
        self.assertEqual(calls[0],1);self.assertEqual(model_calls[0],1)

    def test_concurrent_expired_readers_share_failure_instead_of_stale_passing_cache(self):
        app,request,calls,model_calls=self.wave(fails=True,expired_passing_cache=True)
        self.assertFalse(request().json()['runner']['available'])
        self.assertEqual(calls[0],1);self.assertEqual(model_calls[0],0)

    def test_wait_timeout_refuses_expired_passing_cache_and_can_refresh_after_release(self):
        app,request,calls,model_calls=self.wave()
        now=closure_cell(request,'now').cell_contents;now[0]+=31
        catalog=next(route.endpoint for route in app.routes if route.path=='/api/runner/catalog')
        health=closure_cell(catalog,'health').cell_contents
        refresh=closure_cell(health,'refresh').cell_contents
        lock=closure_cell(refresh,'readiness_lock').cell_contents
        self.assertTrue(lock.acquire())
        try:
            started=time.monotonic()
            response=request()
            elapsed=time.monotonic()-started
            self.assertEqual(response.status_code,200,response.text)
            self.assertFalse(response.json()['runner']['available'])
            self.assertGreaterEqual(elapsed,6.5)
            self.assertLess(elapsed,9.5,'Readiness wait exceeded its ASGI response deadline')
            self.assertEqual(calls[0],1,'A timed-out waiter must not start a second checker')
            self.assertEqual(model_calls[0],1)
        finally:lock.release()
        # Timeout itself must not stamp an unavailable cache entry over the
        # expired result: a later free reader performs its own new check.
        self.assertTrue(request().json()['runner']['available'])
        self.assertEqual(calls[0],2);self.assertEqual(model_calls[0],2)
