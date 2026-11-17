"""M1: the preview GET starts Hub requests, so a browser from another site must not be able to trigger it."""
import threading
import unittest
from unittest import mock

from tests_agentlab.test_hf_import_security import Sec, BASE
from traceharness.backend import hf_api
from traceharness.catalog import hf_fetch as F


class PreviewGuard(Sec):
    def setUp(self):
        super().setUp()
        getattr(hf_api, '_PREVIEW_CACHE', {}).clear()

    def get(self, **headers):
        return self.client.get("/api/hf/preview", params={"dataset": "acme/data"}, headers=headers)

    def test_same_origin_and_plain_clients_are_served(self):
        self.assertEqual(self.get(Origin=BASE, **{"Sec-Fetch-Site": "same-origin"}).status_code, 200)
        getattr(hf_api, '_PREVIEW_CACHE', {}).clear()
        self.assertEqual(self.get().status_code, 200)                  # the CLI / curl send neither header

    def test_hostile_origin_403_and_no_hub_request(self):
        self.assertEqual(self.get(Origin="https://evil.example").status_code, 403)
        self.assertEqual(self.hub.calls, [])

    def test_cross_site_and_same_site_fetch_403(self):
        for site in ("cross-site", "same-site"):
            with self.subTest(site=site):
                self.assertEqual(self.get(**{"Sec-Fetch-Site": site}).status_code, 403)
        self.assertEqual(self.hub.calls, [])

    def test_hostile_host_400(self):
        self.assertEqual(self.get(Host="evil.example").status_code, 400)
        self.assertEqual(self.hub.calls, [])

    def test_a_repeat_is_answered_from_a_short_cache(self):
        self.assertEqual(self.get().status_code, 200)
        n = len(self.hub.calls)
        self.assertEqual(self.get().status_code, 200)
        self.assertEqual(len(self.hub.calls), n)

    def test_only_one_preview_is_in_flight(self):
        inside, release = threading.Event(), threading.Event()

        def slow(dataset_id):
            inside.set()
            release.wait(5)
            return {"dataset": dataset_id}
        out = {}
        with mock.patch.object(F, "preview", slow):
            t = threading.Thread(target=lambda: out.update(first=self.get()))
            t.start()
            self.assertTrue(inside.wait(5))
            second = self.client.get("/api/hf/preview", params={"dataset": "acme/other"})
            release.set()
            t.join(5)
        self.assertEqual(second.status_code, 429)
        self.assertEqual(out["first"].status_code, 200)


if __name__ == "__main__":
    unittest.main()
