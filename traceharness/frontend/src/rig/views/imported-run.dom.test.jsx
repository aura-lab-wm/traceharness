// @vitest-environment jsdom
/* An imported shell-agent run (mini_swe_jsonl): the numbers and words its run and task pages show.
   Run a0000a of the mini fixture (beta-2 · baseline · t2 · rep 0, hidden ×, visible ✓, wrong patch)
   gets an imported ledger here: four chat spans for three model calls (the first reply made two
   tool calls), tests run through bash, an edit the importer could not name, a patch, and the
   source's own facts on the start span. Every value is made up. */
import { afterEach, describe, expect, it } from 'vitest'
import { renderRig, resetRig, rigFixture, miniRuns, MINI } from '../../../test/rig-testing'
import { failureStory, spanDesc } from './trajectory'
import { isTestRun, modelCallsOf } from './steps'

afterEach(resetRig)

const ID = '20260101-000000-a0000a'
const b = { run_id: ID, task_id: 't2', harness_id: 'baseline', 'gen_ai.request.model': 'acme/beta-2' }
const HARNESS = { id: 'baseline', tools: ['bash', 'edit_file', 'write_file'], policy: 'unknown', max_steps: 0, max_tokens_per_call: 0, temperature: 0.0,
  fingerprint: { temperature: null, declared_max_steps: 0, observed_max_steps: 4 }, notes: 'imported from mini_swe_jsonl' }
const EXTRA = { run: 1, slot: 4, wall_seconds: 61.5, model_calls: 3, analysed_in_paper: true, server_record: { all_requests_ok: true, continuity_breaks: 0 } }
const chat = (seq, ci, cmd) => ({ ...b, seq, span: 'chat', call_index: ci, step: seq, 'gen_ai.usage.input_tokens': 100, 'gen_ai.usage.output_tokens': 10,
  'gen_ai.response.finish_reasons': ['tool_calls'], text: '', tool_calls: [{ name: 'bash', arguments: { command: cmd } }] })
const tool = (seq, cmd, phase, extra = {}) => ({ ...b, seq, span: 'execute_tool', 'gen_ai.tool.name': 'bash', args: { command: cmd }, status: 'ok', phase, result_preview: '', ...extra })
const spansWith = (extra) => [
  { ...b, seq: 0, span: 'invoke_agent', status: 'start', harness: HARNESS, seed: null, repeat_index: 0, import_source: 'mini_swe_jsonl', ...(extra ? { import_extra: extra } : {}) },
  chat(1, 1, 'ls'), tool(2, 'ls', 'explore'),
  chat(3, 1, 'python -m pytest -q tests/test_a.py'), tool(4, 'python -m pytest -q tests/test_a.py', 'test', { tests_passed: false }),
  chat(5, 2, 'python - <<EOF'), tool(6, 'python - <<EOF', 'edit'),
  chat(7, 3, 'python -m pytest -q tests/test_a.py'), tool(8, 'python -m pytest -q tests/test_a.py', 'test', { tests_passed: true }),
  { ...b, seq: 9, span: 'grade', visible: true, hidden: false, strong: null, tests_modified: false, source: "the export's grade" },
  { ...b, seq: 10, span: 'invoke_agent', status: 'end', exit_reason: 'submitted', hidden_pass: false, total_tokens: 440 },
]
const PATCH = 'diff --git a/src/a.py b/src/a.py\n--- a/src/a.py\n+++ b/src/a.py\n@@ -1 +1 @@\n-x = 1\n+x = 2\n'
const row = (r) => (r.run_id === ID ? { ...r, provider: 'import:mini_swe_jsonl', steps: 4, tool_calls: 4, edits: 0, wall_ms: 61500 } : r)
function data(extra = EXTRA, patch = PATCH) {
  const summary = { ...row(miniRuns().find((r) => r.run_id === ID)), files_touched: ['src/a.py'], lines_added: 1, lines_removed: 1, patch_bytes: PATCH.length }
  return {
    ...rigFixture(),
    [`/results/${MINI}/runs`]: miniRuns().map(row),
    [`/results/${MINI}/runs/${ID}`]: { summary, spans: spansWith(extra), patch, messages: [], issue: '' },
  }
}
const q = (c, el) => c.querySelector(`[data-el~="${el}"]`)
const facts = (c) => q(c, 'run-facts').textContent
const run = { id: ID, hid: false, vis: true, str: null, mode: 'wrong_patch', exit: 'submitted', steps: 4, provider: 'import:mini_swe_jsonl' }

describe('ledger helpers for imported runs (pure)', () => {
  it('counts model calls by call_index, and one per reply where the ledger does not number them', () => {
    expect(modelCallsOf(spansWith(EXTRA))).toBe(3)
    expect(modelCallsOf([{ span: 'chat' }, { span: 'execute_tool' }, { span: 'chat' }])).toBe(2)
    expect(modelCallsOf([])).toBeNull()
  })
  it('a test run is the run_tests tool or a shell call the importer put in the test phase', () => {
    expect(isTestRun({ span: 'execute_tool', 'gen_ai.tool.name': 'run_tests' })).toBe(true)
    expect(isTestRun({ span: 'execute_tool', 'gen_ai.tool.name': 'bash', phase: 'test' })).toBe(true)
    expect(isTestRun({ span: 'execute_tool', 'gen_ai.tool.name': 'bash', phase: 'edit' })).toBe(false)
  })
})

describe('the failure story of an imported run', () => {
  it('counts the tests it ran through bash', () => {
    const t = failureStory(run, { spans: spansWith(EXTRA), summary: { files_touched: ['src/a.py'], lines_added: 1, lines_removed: 1 } }, 'hidden', {}).text
    expect(t).not.toContain('never ran the tests')
    expect(t).toContain('Its last own test run passed.')
  })
  it('does not call the agent\'s own last test a visible oracle', () => {
    const t = failureStory(run, { spans: spansWith(EXTRA), summary: { files_touched: ['src/a.py'], lines_added: 1, lines_removed: 1 } }, 'hidden', {}).text
    expect(t).not.toContain('visible oracle')
  })
})

describe('run page of an imported run', () => {
  it('a limit the source never recorded reads not recorded', () => {
    const { container } = renderRig(`#/rig/run:a0000a?sel=facts`, { data: data() })
    expect(q(container, 'run-numbers').textContent).not.toContain('/ 0')
    for (const s of ['max stepsnot recorded', 'max tokens / callnot recorded', 'temperaturenot recorded']) expect(facts(container)).toContain(s)
    resetRig()
    const sp = renderRig(`#/rig/span:a0000a:1`, { data: data() })
    expect(q(sp.container, 'span-detail').textContent).toContain('max tokens / callnot recorded')
  })
  it('shows model calls apart from tool calls', () => {
    const { container } = renderRig(`#/rig/run:a0000a?sel=facts`, { data: data() })
    expect(q(container, 'run-numbers').textContent).toContain('Model calls3')
    expect(facts(container)).toContain('model calls · tool calls · edits3 · 4 · 0')
  })
  it('names the visible result as the agent\'s own last test run', () => {
    const { container } = renderRig(`#/rig/run:a0000a?sel=facts`, { data: data() })
    const orc = q(container, 'run-oracles').textContent
    expect(orc).toContain("agent's last test")
    expect(orc).not.toContain('visible')
  })
  it('puts the source\'s server record and slot under Serving, and an excluded run says why', () => {
    const { container } = renderRig(`#/rig/run:a0000a?sel=facts`, { data: data({ ...EXTRA, analysed_in_paper: false, excluded_reason: 'invented reason' }) })
    expect(facts(container)).toContain('slot4')
    // one row per entry of the record, in the source's own words
    for (const s of ['server recordfrom the source', 'all requests okyes', 'continuity breaks0']) expect(facts(container)).toContain(s)
    expect(facts(container)).toContain('excludedinvented reason')
  })
  it('a run with no import_extra shows none of those rows', () => {
    const { container } = renderRig(`#/rig/run:a0000a?sel=facts`, { data: data(null) })
    for (const s of ['slot', 'server record', 'excluded']) expect(facts(container)).not.toContain(s)
    resetRig()
    const n = renderRig(`#/rig/run:a00003?sel=facts`, { data: rigFixture() })
    for (const s of ['slot', 'server record', 'excluded']) expect(facts(n.container)).not.toContain(s)
    expect(q(n.container, 'run-numbers').textContent).toContain('Steps')
  })
})

describe('task page of an imported run', () => {
  it('an edit whose lines the importer never counted shows no +0 −0', async () => {
    const edit = { ...b, seq: 11, span: 'edit', path: 'src/a.py', lines_added: 0, lines_removed: 0, tool: 'edit_file', line_counts_known: false }
    expect(spanDesc(edit)).toBe('edit src/a.py')
    const d = data()
    const det = d[`/results/${MINI}/runs/${ID}`]
    d[`/results/${MINI}/runs/${ID}`] = { ...det, spans: [...det.spans.slice(0, 7), edit, ...det.spans.slice(7)] }
    const { container, findByText } = renderRig('#/rig/task:mini:beta-2:baseline:t2:0:findings', { data: d })
    await findByText(/It edited/)
    expect(q(container, 'findings').textContent).not.toContain('+0 −0')
  })
  it('Findings: its bash test runs count, and a patch with no named edit is not "no patch"', async () => {
    const { container, findByText } = renderRig('#/rig/task:mini:beta-2:baseline:t2:0:findings', { data: data() })
    await findByText(/Last test run by the agent/)
    const f = q(container, 'findings').textContent
    expect(f).not.toContain('never ran the tests')
    expect(f).not.toContain('No patch was recorded')
    expect(f).toContain('src/a.py')
    expect(q(container, 'run-summary').textContent).toContain('model calls3')
  })
  it('a run with no edit and no patch still says so', async () => {
    const { container, findByText } = renderRig('#/rig/task:mini:beta-2:baseline:t2:0:findings', { data: data(EXTRA, '') })
    await findByText(/never edited a file/)
    expect(q(container, 'findings').textContent).toContain('No patch was recorded.')
  })
})
