// @vitest-environment jsdom
/* Numbers that count what their words say (made-up values throughout). */
import { afterEach, describe, expect, it } from 'vitest'
import { renderRig, resetRig, rigFixture, MINI } from '../../../test/rig-testing'
import { QMAP, answerQuestion } from '../answers'
import { joinOutcomes, normRuns, normOverview } from '../data'
import { patchFiles } from '../patch-files'
import { AFTER_FIX_DEF, fixOf } from '../run-shape'
import { ledgerSteps } from './steps'

afterEach(resetRig)

/** the mini fixture with each run's model calls in /outcomes (an importer: fewer model calls than steps) */
function withModelCalls(calls = (i) => 2 + (i % 2)) {
  const data = rigFixture()
  const o = data[`/outcomes/${MINI}`]
  const ids = data[`/results/${MINI}/runs`].map((r) => r.run_id)
  data[`/outcomes/${MINI}`] = { ...o, runs: Object.fromEntries(ids.map((id, i) => [id, { ...o.runs[id], model_calls: calls(i) }])) }
  return data
}

describe('model calls are model calls', () => {
  const ask = (data) => {
    const outcomes = { ...data[`/outcomes/${MINI}`], byId: Object.fromEntries(data[`/outcomes/${MINI}`].modes.map((m) => [m.id, m])) }
    const runs = joinOutcomes(normRuns(data[`/results/${MINI}/runs`], MINI), outcomes)
    const row = normOverview(data['/overview']).results[0]
    return answerQuestion(QMAP.run, { dir: MINI, row, runs, outcomes, oracle: 'hidden', cond: { dir: MINI, model: 'acme/alpha-1', harness: 'baseline' } })
  }
  const text = (a) => a.sentence.map((p) => (typeof p === 'string' ? p : p.mark)).join('')

  it('the outcomes carry each run\'s model calls into the run rows', () => {
    const data = withModelCalls(() => 3)
    const runs = joinOutcomes(normRuns(data[`/results/${MINI}/runs`], MINI), data[`/outcomes/${MINI}`])
    expect(runs.every((r) => r.modelCalls === 3)).toBe(true)
  })
  it('"made N model calls" counts the ledger\'s model calls, not the index steps', () => {
    const r = ask(withModelCalls(() => 3))
    expect(text(r.answer)).toMatch(/\) made 3 model calls and/)
    expect(r.answer.num).toBe('3')
    expect(r.answer.numOf).toBe('model calls')
  })
  it('without a model-call count the tool calls are shown, and called tool calls', () => {
    const r = ask(rigFixture())
    expect(text(r.answer)).toMatch(/\) made 6 tool calls and/)
    expect(r.answer.numOf).toBe('tool calls')
    expect(r.answer.short).toContain('6 tool calls')
  })
  it('the run figure and the runs table show model calls', () => {
    const { container } = renderRig('#/rig/q:mini:run', { data: withModelCalls(() => 3) })
    const fig = container.querySelector('[data-el="question-figure"]').textContent
    expect(fig).toContain('model calls · tool calls · edits3 · 6 ·')
    resetRig()
    const { container: c2 } = renderRig('#/rig/q:mini:outcomes:runs', { data: withModelCalls(() => 3) })
    const head = [...c2.querySelectorAll('[data-el="question-runs"] thead th')].map((th) => th.textContent)
    expect(head).toContain('model calls')
    const row = c2.querySelector('[data-el="question-runs"] tbody tr')
    const cells = [...row.querySelectorAll('td')].map((td) => td.textContent)
    expect(cells[head.indexOf('model calls')]).toBe('3')
  })
})

describe('the recorded diff names the files in the patch', () => {
  const ID = '20260101-000000-a00002'
  const PATCH = 'diff --git a/check_fix.py b/check_fix.py\nnew file mode 100644\n--- /dev/null\n+++ b/check_fix.py\n@@ -0,0 +1 @@\n+print(1)\n'
    + 'diff --git a/src/a.py b/src/a.py\n--- a/src/a.py\n+++ b/src/a.py\n@@ -1 +1,2 @@\n-def a(): pass\n+def a():\n+    return 1\n'
  it('patchFiles reads each file and what the patch did to it', () => {
    expect(patchFiles(PATCH)).toEqual([{ path: 'check_fix.py', kind: 'created' }, { path: 'src/a.py', kind: 'changed' }])
    expect(patchFiles('--- a/x.py\n+++ b/x.py\n@@ -1 +1 @@\n--- not a header\n+++ nor this\n')).toEqual([{ path: 'x.py', kind: 'changed' }])
    expect(patchFiles('')).toEqual([])
  })
  it('the header lists the patch\'s files, not every file the run touched', () => {
    const data = rigFixture()
    const sum = { ...data[`/results/${MINI}/runs`].find((r) => r.run_id === ID), files_touched: ['src/a.py', 'scratch/probe.py', 'check_fix.py'], lines_added: 3, lines_removed: 1, patch_bytes: 200 }
    data[`/results/${MINI}/runs/${ID}`] = { summary: sum, spans: [], patch: PATCH, messages: [], issue: '' }
    const { container } = renderRig('#/rig/task:mini:alpha-1:baseline:t2:0:patch', { data })
    const h = container.querySelector('[data-el="patch-view"] h3').textContent
    expect(h).toContain('src/a.py')
    expect(h).toContain('check_fix.py (new)')
    expect(h).not.toContain('scratch/probe.py')
  })
})

describe('the Runs table has one meaning per column', () => {
  it('Model calls from the ledger, tool calls beside them', () => {
    const { container } = renderRig('#/rig/field:mini', { data: withModelCalls(() => 3) })
    const table = container.querySelector('[data-el="field-run-list"] table')
    const head = [...table.querySelectorAll('thead th')].map((th) => th.textContent)
    expect(head).toContain('Model calls')
    expect(head).toContain('Tool calls')
    expect(head).not.toContain('Steps')
    const cells = [...table.querySelector('tbody tr').querySelectorAll('td')].map((td) => td.textContent)
    expect(cells[head.indexOf('Model calls')]).toBe('3')
    expect(cells[head.indexOf('Tool calls')]).toBe('6')
  })
  it('a run whose model calls are unknown shows a dash, not its index steps', () => {
    const { container } = renderRig('#/rig/field:mini')
    const table = container.querySelector('[data-el="field-run-list"] table')
    const head = [...table.querySelectorAll('thead th')].map((th) => th.textContent)
    const cells = [...table.querySelector('tbody tr').querySelectorAll('td')].map((td) => td.textContent)
    expect(cells[head.indexOf('Model calls')]).toBe('—')
  })
})

describe('after the fix: the submission steps are not work, and the definition says so', () => {
  const step = (k, tool, args, phase) => [
    { seq: 2 * k - 1, span: 'chat', call_index: k, 'gen_ai.usage.input_tokens': 10, 'gen_ai.usage.output_tokens': 5 },
    { seq: 2 * k, span: 'execute_tool', 'gen_ai.tool.name': tool, args, phase, status: 'ok' }]
  const spans = [...step(1, 'edit_file', { path: 'pkg/core.py' }, 'edit'), ...step(2, 'bash', { command: 'python -m pytest -q' }, 'test'),
    ...step(3, 'bash', { command: 'git diff -- pkg/core.py > patch.txt' }, 'explore'), ...step(4, 'bash', { command: 'cat patch.txt' }, 'explore')]
  it('a call that only runs the submission steps is not hatched as work after the fix', () => {
    const fix = fixOf({ after_fix: { fix_seq: 2, fix_call: 1, calls_after: 1, calls: 2, submit_only: 2, path: 'pkg/core.py' } }, ledgerSteps(spans))
    expect([fix.from, fix.to]).toEqual([2, 2])
  })
  it('the definition names the submission steps and the files that count', () => {
    expect(AFTER_FIX_DEF).toContain('git diff > patch.txt')
    expect(AFTER_FIX_DEF).toContain('existed before the run')
    expect(AFTER_FIX_DEF).toContain('sed -i')
  })
})

describe('counts that say their scope', () => {
  it('a task with fewer runs than the legend\'s count states its own', () => {
    const data = rigFixture()
    const runs = data[`/results/${MINI}/runs`]
    const extra = { ...runs[0], run_id: '20260101-000000-a000ff', repeat_index: 2 }
    data[`/results/${MINI}/runs`] = [...runs, extra]
    const { container } = renderRig('#/rig/tasks:mini:alpha-1:baseline', { data })
    expect(container.querySelector('[data-el="spread-legend"]').textContent).toContain('first 3 runs')
    const t2 = [...container.querySelectorAll('.rg-an-trow')].find((r) => (r.querySelector('.t-name b') || {}).textContent === 't2')
    expect(t2.querySelector('.t-spread').textContent).toContain('at 2 runs')
  })
  it('tasks next to pass@1 say how many are graded', () => {
    const data = rigFixture()
    data[`/results/${MINI}/runs`] = data[`/results/${MINI}/runs`].map((r, i) => (i === 10 || i === 11 ? { ...r, hidden_pass: null } : r))
    const { container } = renderRig('#/rig/an:mini:outcomes:beta-2:baseline', { data })
    expect(container.querySelector('[data-el="outcomes-answer"]').textContent).toContain('2 recorded tasks (1 graded)')
  })
  it('pooled pass^k and flip rate say they are pooled over the models', () => {
    const data = rigFixture()
    const pooledCard = { cell: { model: 'acme/alpha-1', harness: { id: 'baseline' }, runs: 8, pooled_models: true, repeats: 2, tasks: ['t1', 't2'] },
      outcome: { pass1: 5 / 7, ci95: [0.4, 1], pass_at_k: { 2: 0.9 }, pass_pow_k: { 2: 0.5, 3: 0.4 }, flip_rate: 0.5, pass1_strong: 4 / 7 }, missing: [] }
    data[`/results/${MINI}/report?harness=baseline&model=${encodeURIComponent('acme/alpha-1')}`] = { markdown: '# card\n', card: pooledCard }
    const { container } = renderRig('#/rig/an:mini:report', { data })
    const lad = [...container.querySelectorAll('.rg-an-lad > div')].map((d) => d.textContent)
    expect(lad.find((t) => t.startsWith('pass^3'))).toContain('pooled over 2 models')
    expect(lad.find((t) => t.startsWith('flip rate'))).toContain('pooled over 2 models')
    expect(lad.find((t) => t.startsWith('pass@1'))).not.toContain('pooled over')
  })
  it('the report answer labels its pooled pass^3', () => {
    const data = rigFixture()
    const outcomes = { ...data[`/outcomes/${MINI}`], byId: Object.fromEntries(data[`/outcomes/${MINI}`].modes.map((m) => [m.id, m])) }
    const runs = joinOutcomes(normRuns(data[`/results/${MINI}/runs`], MINI), outcomes)
    const row = normOverview(data['/overview']).results[0]
    const a = answerQuestion(QMAP.report, { dir: MINI, row, runs, outcomes, oracle: 'hidden', report: data[`/results/${MINI}/report?harness=baseline`], cond: { dir: MINI, model: 'acme/alpha-1', harness: 'baseline' } })
    expect(a.answer.sentence.map((p) => (typeof p === 'string' ? p : p.mark)).join('')).toMatch(/pass\^3 [\d.]+% \(pooled over 2 models\)/)
  })
})
