"""The runner's stop rule and what it records about who answered.

Three things, each found by reading recorded runs and then confirmed with a controlled run:

* A reply that invokes no tool used to end the run, always. That is a harness decision, so it is a
  harness field now (`no_action_retries`); the default keeps the old behaviour and the old hashes.
* The same model identifier can be served by different upstream providers. The chat span and the
  run summary record the provider the endpoint names, so a serving change can be told from a model
  change.
* A harness shipped as "baseline with one thing changed" must really differ in one field.
"""
import json, os, sys, tempfile, unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from traceharness.core.grader import load_task
from traceharness.core.harness import HarnessConfig, NO_ACTION_PROMPT, content_hash, run_task
from traceharness.core.providers import ChatResponse, OpenAIProvider, Provider, ToolCall, make_provider

LAB = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Hashes written to data/runs/llma4se_live/index.jsonl before `no_action_retries` existed.
RECORDED_HASHES = {"baseline": "e2fb4042aa89", "no_test_tool": "ff4a83579647", "permissive": "0f3d4242e844",
                   "short_context": "102201ebfb0b", "terse_prompt": "439df6d11eb6", "tight_budget": "89927e6aab4b"}

# The field each shipped variant changes with respect to baseline. `short_context` is the one
# two-field variant: it predates this check, runs recorded under it exist, and its two halves are
# shipped separately as short_history and short_observations.
EXPECTED_DIFF = {
    "no_test_tool": {"tools"}, "permissive": {"policy"}, "terse_prompt": {"system_prompt"},
    "tight_budget": {"max_steps"}, "short_history": {"context_window"},
    "short_observations": {"observation_chars"}, "long_output": {"max_tokens_per_call"},
    "reprompt": {"no_action_retries"}, "short_context": {"context_window", "observation_chars"},
}


class Scripted(Provider):
    """Replays a fixed list of replies; each is (text, [(tool, args)...], finish_reason, served_by)."""
    name = "scripted"

    def __init__(self, replies):
        super().__init__("scripted-model", 0.0, (0.0, 0.0))
        self.replies, self.seen = list(replies), []

    def chat(self, messages, tools, max_tokens=2048):
        self.seen.append([dict(m) for m in messages])
        text, calls, finish, who = self.replies.pop(0)
        return ChatResponse(text=text, tool_calls=[ToolCall(f"c{len(self.seen)}_{i}", n, a) for i, (n, a) in enumerate(calls)],
                            input_tokens=10, output_tokens=5, finish_reason=finish, served_by=who,
                            response_model="scripted-model-2026-11-14")


def _spans(out, run_id):
    with open(os.path.join(out, run_id, "ledger.jsonl")) as f:
        return [json.loads(line) for line in f if line.strip()]


class TestNoActionRetries(unittest.TestCase):
    def setUp(self):
        self.task = load_task(os.path.join(LAB, "tasks", "t02_intervals"))
        self.out = tempfile.mkdtemp(prefix="stoprule_")

    def test_default_ends_the_run_on_a_reply_without_a_tool_call(self):
        p = Scripted([("thinking out loud", [], "length", "Upstream A"), ("never reached", [("submit", {})], "tool_calls", "Upstream A")])
        s = run_task(self.task, HarnessConfig(), p, self.out)
        self.assertEqual(s.exit_reason, "no_action")
        self.assertEqual(s.steps, 1)
        self.assertEqual(s.reprompts, 0)
        self.assertFalse([sp for sp in _spans(self.out, s.run_id) if sp["span"] == "reprompt"])

    def test_a_retry_lets_the_run_continue_and_is_recorded(self):
        p = Scripted([("thinking out loud", [], "length", "Upstream A"),
                      ("ok", [("list_files", {})], "tool_calls", "Upstream A"),
                      ("done", [("submit", {})], "tool_calls", "Upstream A")])
        s = run_task(self.task, HarnessConfig(no_action_retries=2), p, self.out)
        self.assertEqual(s.exit_reason, "submitted")
        self.assertEqual((s.steps, s.reprompts), (3, 1))
        re = [sp for sp in _spans(self.out, s.run_id) if sp["span"] == "reprompt"]
        self.assertEqual(len(re), 1)
        self.assertEqual((re[0]["attempt"], re[0]["finish_reason"], re[0]["step"]), (1, "length", 0))
        # the model was told why nothing happened, as the last message of its second call
        self.assertEqual(p.seen[1][-1], {"role": "user", "content": NO_ACTION_PROMPT})

    def test_retries_are_bounded_and_spend_steps(self):
        silent = ("still nothing", [], "stop", "Upstream A")
        p = Scripted([silent] * 5)
        s = run_task(self.task, HarnessConfig(no_action_retries=2), p, self.out)
        self.assertEqual(s.exit_reason, "no_action")
        self.assertEqual((s.steps, s.reprompts), (3, 2))       # two re-prompts, then the third silent reply ends it
        p = Scripted([silent] * 5)
        s = run_task(self.task, HarnessConfig(no_action_retries=9, max_steps=3), p, self.out)
        self.assertEqual(s.exit_reason, "max_steps")           # a re-prompt is a step like any other

    def test_the_field_does_not_move_hashes_already_recorded(self):
        for hid, want in RECORDED_HASHES.items():
            with self.subTest(harness=hid):
                self.assertEqual(content_hash(HarnessConfig.load(os.path.join(LAB, "harnesses", hid + ".json"))), want)
        base = HarnessConfig()
        self.assertEqual(content_hash(base), content_hash(HarnessConfig(no_action_retries=0)))
        self.assertNotEqual(content_hash(base), content_hash(HarnessConfig(no_action_retries=1)))


class TestServedBy(unittest.TestCase):
    def setUp(self):
        self.task = load_task(os.path.join(LAB, "tasks", "t02_intervals"))
        self.out = tempfile.mkdtemp(prefix="servedby_")

    def test_every_chat_span_and_the_summary_name_the_provider(self):
        p = Scripted([("a", [("list_files", {})], "tool_calls", "Upstream A"),
                      ("b", [("list_files", {})], "tool_calls", "Upstream B"),
                      ("c", [("submit", {})], "tool_calls", "Upstream A")])
        s = run_task(self.task, HarnessConfig(), p, self.out)
        chats = [sp for sp in _spans(self.out, s.run_id) if sp["span"] == "chat"]
        self.assertEqual([c["served_by"] for c in chats], ["Upstream A", "Upstream B", "Upstream A"])
        self.assertTrue(all(c["gen_ai.response.model"] == "scripted-model-2026-11-14" for c in chats))
        self.assertEqual(s.served_by, ["Upstream A", "Upstream B"])           # distinct, in order of first use
        with open(os.path.join(self.out, s.run_id, "summary.json")) as f:
            self.assertEqual(json.load(f)["served_by"], ["Upstream A", "Upstream B"])

    def test_a_provider_that_reports_nothing_leaves_it_empty(self):
        s = run_task(self.task, HarnessConfig(), make_provider("mock", "mock", seed=3), self.out, seed=3)
        self.assertEqual(s.served_by, [])
        chats = [sp for sp in _spans(self.out, s.run_id) if sp["span"] == "chat"]
        self.assertTrue(chats and all(c["served_by"] is None for c in chats))

    def test_route_is_sent_to_openrouter_only(self):
        sent = {}
        import traceharness.core.providers as P
        real = P._post_json

        def fake(url, headers, payload, timeout=120, retries=4):
            sent["payload"] = payload
            return {"provider": "Together", "model": "vendor/model-20261101",
                    "choices": [{"finish_reason": "stop", "message": {"content": "hi"}}],
                    "usage": {"prompt_tokens": 3, "completion_tokens": 1, "cost": 0.0001}}
        P._post_json = fake
        try:
            prov = make_provider("openrouter", "vendor/model", api_key="k", route=["Together"])
            r = prov.chat([{"role": "user", "content": "x"}], [])
            self.assertEqual(sent["payload"]["provider"], {"order": ["Together"], "allow_fallbacks": False})
            self.assertEqual((r.served_by, r.response_model), ("Together", "vendor/model-20261101"))
            make_provider("openrouter", "vendor/model", api_key="k").chat([{"role": "user", "content": "x"}], [])
            self.assertNotIn("provider", sent["payload"])                      # nothing pinned, nothing sent
        finally:
            P._post_json = real
        with self.assertRaises(ValueError):
            make_provider("openai", "gpt-x", api_key="k", route=["Together"])
        with self.assertRaises(ValueError):
            OpenAIProvider("gpt-x", api_key="k", base_url="https://api.openai.com/v1", route=["Together"])


class TestProviderEdges(unittest.TestCase):
    """Edges found in review: a route through the openai kind, and endpoints that reject `seed`."""

    def test_route_is_accepted_for_the_openai_kind_pointing_at_openrouter(self):
        prov = make_provider("openai", "vendor/model", api_key="k", base_url="https://openrouter.ai/api/v1",
                             route=["Together"])
        self.assertEqual(prov.route, ["Together"])

    def test_a_rejected_seed_is_dropped_once_and_recorded_as_not_sent(self):
        import traceharness.core.providers as P
        real, calls = P._post_json, []

        def fake(url, headers, payload, timeout=120, retries=4):
            calls.append(dict(payload))
            if payload.get("messages", [{}])[0].get("content") == "boom":
                raise RuntimeError('HTTP 400: {"error": "bad request: messages"}')
            if "seed" in payload:
                raise RuntimeError('HTTP 400: {"error": "Unrecognized request argument supplied: seed"}')
            return {"choices": [{"finish_reason": "stop", "message": {"content": "hi"}}],
                    "usage": {"prompt_tokens": 1, "completion_tokens": 1}}
        P._post_json = fake
        try:
            prov = OpenAIProvider("local-model", api_key="k", base_url="http://127.0.0.1:9/v1")
            prov.reseed(7)
            r = prov.chat([{"role": "user", "content": "x"}], [])
            self.assertIsNone(r.sent_seed)
            self.assertEqual(len(calls), 2)                    # one rejected call, one retry without seed
            prov.chat([{"role": "user", "content": "x"}], [])
            self.assertEqual(len(calls), 3)
            self.assertNotIn("seed", calls[-1])                # not sent again
            with self.assertRaises(RuntimeError):              # other 400s are not swallowed
                prov.chat([{"role": "user", "content": "boom"}], [])
        finally:
            P._post_json = real

    def test_a_422_naming_seed_is_handled_like_a_400(self):
        import traceharness.core.providers as P
        real, calls = P._post_json, []

        def fake(url, headers, payload, timeout=120, retries=4):
            calls.append(dict(payload))
            if "seed" in payload:
                raise RuntimeError('HTTP 422: {"detail": [{"loc": ["body", "seed"], "msg": "extra fields not permitted"}]}')
            return {"choices": [{"finish_reason": "stop", "message": {"content": "hi"}}],
                    "usage": {"prompt_tokens": 1, "completion_tokens": 1}}
        P._post_json = fake
        try:
            prov = OpenAIProvider("local-model", api_key="k", base_url="http://127.0.0.1:9/v1")
            prov.reseed(7)
            self.assertIsNone(prov.chat([{"role": "user", "content": "x"}], []).sent_seed)
            self.assertEqual(len(calls), 2)
        finally:
            P._post_json = real


class TestSentinelGroupingWithoutTaskIds(unittest.TestCase):
    def test_runs_without_a_task_id_do_not_break_task_grouped_folds(self):
        import traceharness.backend.sentinel as S
        ex = []
        for i in range(60):
            tid = None if i % 10 == 0 else f"t{i % 7:02d}"
            f = {n: float((i * 7 + k) % 5) for k, n in enumerate(S.FEATURE_NAMES)}
            f["step_frac"] = 1.0
            ex.append({"run_id": f"r{i:03d}", "task_id": tid, "harness_id": "baseline", "model": "m",
                       "step": 0, "step_frac": 1.0, "features": f, "label": i % 3 == 0, "total_steps": 1})
        real = S.build_training_examples
        S.build_training_examples = lambda dirs, harness_filter=None: ex
        try:
            _, report = S.train(["unused"], epochs=5, bootstrap=5)
        finally:
            S.build_training_examples = real
        self.assertEqual(report["cv_grouping"], "task")


class TestOneFieldVariants(unittest.TestCase):
    def test_each_shipped_variant_changes_what_it_says_it_changes(self):
        def read(name):
            with open(os.path.join(LAB, "harnesses", name)) as f:
                return json.load(f)
        base = read("baseline.json")
        seen = set()
        for fn in sorted(os.listdir(os.path.join(LAB, "harnesses"))):
            if not fn.endswith(".json") or fn == "baseline.json":
                continue
            h = read(fn)
            hid = h["id"]
            diff = {k for k in set(base) | set(h) if k not in ("id", "notes") and h.get(k, HarnessConfig().__dict__.get(k)) != base.get(k, HarnessConfig().__dict__.get(k))}
            with self.subTest(harness=hid):
                self.assertEqual(fn, hid + ".json")
                self.assertIn(hid, EXPECTED_DIFF, f"{fn} is a new harness: say in EXPECTED_DIFF which field it changes")
                self.assertEqual(diff, EXPECTED_DIFF[hid])
            seen.add(hid)
        self.assertEqual(seen, set(EXPECTED_DIFF))
        single = [h for h, d in EXPECTED_DIFF.items() if len(d) == 1]
        self.assertEqual(sorted(h for h in EXPECTED_DIFF if h not in single), ["short_context"])


class TestConsoleJobRoute(unittest.TestCase):
    """A console job carries the same host pin as `run --route`, validated before anything starts."""

    def test_route_is_validated_and_stored(self):
        from fastapi.testclient import TestClient
        import traceharness.backend.app as A

        real_run_job, real_base = A._run_job, A.SETTINGS["base_url"]
        A._run_job = lambda job: None        # keep the job from running; only the request is under test
        A.SETTINGS["base_url"] = "https://openrouter.ai/api/v1"
        try:
            c = TestClient(A.app)
            base = {"out": "route_probe", "models": ["mock"], "harnesses": ["baseline"], "tasks": ["t01_slugify"], "repeats": 1}
            self.assertEqual(c.post("/api/jobs", json={**base, "route": ["Nebius;drop"]}).status_code, 400)
            self.assertEqual(c.post("/api/jobs", json={**base, "route": [f"h{i}" for i in range(9)]}).status_code, 400)
            ok = c.post("/api/jobs", json={**base, "route": [" Nebius ", "Parasail", ""]})
            self.assertEqual(ok.status_code, 200, ok.text)
            self.assertEqual(ok.json()["route"], ["Nebius", "Parasail"])
            self.assertIsNone(c.post("/api/jobs", json=base).json()["route"])
            A.SETTINGS["base_url"] = "http://127.0.0.1:11434/v1"            # a local endpoint has no hosts to pin
            self.assertEqual(c.post("/api/jobs", json={**base, "route": ["Nebius"]}).status_code, 400)
        finally:
            A._run_job, A.SETTINGS["base_url"] = real_run_job, real_base
            for jid in [k for k, j in A.JOBS.items() if j.get("out") == "route_probe"]:
                A.JOBS.pop(jid, None)


if __name__ == "__main__":
    unittest.main()
