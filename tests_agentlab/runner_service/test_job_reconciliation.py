"""Read-only adoption of a previously admitted paired-job identity."""
import unittest

from traceharness.runner_service.jobs import JobError
from tests_agentlab.runner_service import test_broker as fixtures


class ReconciliationTests(unittest.TestCase):
    setUp = fixtures.BrokerTests.setUp
    tearDown = fixtures.BrokerTests.tearDown
    submit = fixtures.BrokerTests.submit

    def test_reconcile_existing_manifest_without_resubmitting_or_changing_credential_identity(self):
        self.behavior = lambda forward: {}
        job = self.submit()
        new_cid = self.vault.put(fixtures.OWNER, 'another-explicit-fixture-not-a-key')['credential_id']
        adopted = self.jobs.reconcile(fixtures.OWNER, 'fixture-broker-idempotency', job['manifest_sha256'])
        self.assertEqual(adopted, job)
        with self.assertRaises(JobError) as caught:
            self.jobs.submit(fixtures.OWNER, job['manifest'], new_cid, 'fixture-broker-idempotency', fixtures.MODEL)
        self.assertEqual(caught.exception.status, 409)
        self.assertEqual(len(self.jobs.rows), 1)
        self.assertEqual(self.calls, [])

    def test_mismatch_and_other_owner_cannot_adopt_a_job(self):
        self.behavior = lambda forward: {}
        job = self.submit()
        self.assertIsNone(self.jobs.reconcile('22222222-2222-4222-8222-222222222222',
                                              'fixture-broker-idempotency', job['manifest_sha256']))
        with self.assertRaises(JobError) as caught:
            self.jobs.reconcile(fixtures.OWNER, 'fixture-broker-idempotency', '0' * 64)
        self.assertEqual(caught.exception.status, 409)
        self.assertEqual(len(self.jobs.rows), 1)

    def test_reconciliation_does_not_purge_an_expired_terminal_job_before_adoption(self):
        self.behavior = lambda forward: {}
        job = self.submit()
        self.jobs.clock = lambda: job['updated_at'] + self.jobs.settings.job_ttl + 1
        adopted = self.jobs.reconcile(fixtures.OWNER, 'fixture-broker-idempotency', job['manifest_sha256'])
        self.assertEqual(adopted['id'], job['id'])
        self.assertTrue((self.jobs.root / job['id'] / 'job.json').is_file())

    def test_bad_identity_values_are_refused_without_mutation(self):
        for identity, digest in [(None, '0' * 64), ([], '0' * 64), ('short', '0' * 64),
                                 ('fixture-valid-idempotency', None), ('fixture-valid-idempotency', 'bad')]:
            with self.subTest(identity=identity, digest=digest), self.assertRaises(JobError):
                self.jobs.reconcile(fixtures.OWNER, identity, digest)
        self.assertEqual(self.jobs.rows, {})


if __name__ == '__main__':
    unittest.main()
