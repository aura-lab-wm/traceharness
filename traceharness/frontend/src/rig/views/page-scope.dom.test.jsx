// @vitest-environment jsdom
/* The question, task, compare and run pages: scope, names, counts and accessibility (made-up data). */
import { afterEach, describe, expect, it } from 'vitest'
import { renderRig, resetRig, rigFixture, miniRuns, MINI } from '../../../test/rig-testing'
import { QMAP, answerQuestion } from '../answers'
import { normOverview } from '../data'
import { failureSummary } from '../ui'

afterEach(resetRig)
const ID = (n) => `20260101-000000-a0000${n}`
const el = (c, name) => c.querySelector(`[data-el~="${name}"]`)
const nameOf = (e) => e.getAttribute('aria-label') || e.textContent

describe('questions say the scope they answer from', () => {
  it('a pooled answer: the Asking line says every model and harness, pooled', () => {
    const { container } = renderRig('#/rig/q:mini:grader')
    const asking = el(container, 'asking-sentence').textContent
    expect(asking).toContain('about all 2 models × 2 harnesses, pooled')
    expect(asking).not.toContain('alpha-1 under baseline')
    expect(el(container, 'asking-sentence').querySelector('button')).toBeTruthy()      // the Change menu stays
  })
  it('a one-cell answer keeps the model and harness', () => {
    const { container } = renderRig('#/rig/q:mini:run')
    expect(el(container, 'asking-sentence').textContent).toContain('alpha-1 under baseline')
  })
  it('"what moves success" leads with the harness, the model beside it, and says comparisons', () => {
    const data = rigFixture()
    const a = answerQuestion(QMAP.variable, { experiment: data[`/results/${MINI}/experiment`], row: normOverview(data['/overview']).results[0], runs: null }).answer
    expect(a.num).toBe('5%')
    expect(a.numLabel).toContain('the model: 20%')
    expect(a.note).toContain('comparisons')
    expect(a.note).not.toContain('contrast')
    const { container } = renderRig('#/rig/q:mini:variable')
    expect(el(container, 'question-figure').textContent).toContain('Comparisons that separate from zero')
  })
})

describe('failures without a recorded mode, in plain words', () => {
  const run = (mode) => ({ hid: false, mode })
  it('says how they failed is not recorded', () => {
    expect(failureSummary([run(null), run(null)])).toBe('2 failed; how they failed: not recorded')
    expect(failureSummary([run('cutoff_no_patch'), run(null)])).toBe('2 failed: 1 cut off; how 1 failed: not recorded')
    expect(failureSummary([run(null), run(null)])).not.toContain('mode')
  })
})

describe('Compare names its runs', () => {
  it('the A and B cards and the run line say Run N; the ids stay in the hover', () => {
    const { container } = renderRig(`#/rig/cmp:${ID(3)}:${ID(2)}`)
    const ids = el(container, 'cmp-ids')
    expect(ids.textContent).toBe('Run 2 ↔ Run 1')
    expect(ids.getAttribute('data-hint')).toBe(`${ID(3)} ↔ ${ID(2)}`)
    const heads = [...el(container, 'pair-headers').querySelectorAll('.rg-pnl-h a, .rg-pnl-h button')]
    expect(heads.map((h) => h.querySelector('b').textContent)).toEqual(['Run 2', 'Run 1'])
    expect(heads.map((h) => h.getAttribute('data-hint'))).toEqual([ID(3), ID(2)])
  })
  it('the pair class is explained in a hover card', () => {
    const { container } = renderRig(`#/rig/cmp:${ID(3)}:${ID(2)}`)
    const info = el(container, 'pair-class-info')
    expect(info.textContent).toContain('seed-paired')
    expect(info.textContent).toContain('same condition')
    expect(info.textContent).toContain('cross-harness')
  })
})

describe('the task page: counts that reconcile, names that differ (a11y)', () => {
  const ID2 = ID(2), ID3 = ID(3)
  const spans = (id) => [
    { run_id: id, seq: 1, span: 'chat', 'gen_ai.usage.input_tokens': 10, 'gen_ai.usage.output_tokens': 5 },
    { run_id: id, seq: 2, span: 'execute_tool', 'gen_ai.tool.name': 'read_file', args: { path: 'src/a.py' }, status: 'ok' },
    { run_id: id, seq: 3, span: 'chat', 'gen_ai.usage.input_tokens': 20, 'gen_ai.usage.output_tokens': 5 },
    { run_id: id, seq: 4, span: 'execute_tool', 'gen_ai.tool.name': 'write_file', args: { path: 'src/a.py' }, status: 'ok' }]
  const AXIS = { calls: 2, steps: 2, phases: [['explore', 1], ['edit', 1]], fix_at: null, lookup_at: null, first_step: [1, 2] }
  const data = () => {
    const d = rigFixture()
    d[`/results/${MINI}/tokens/task/t2?model=${encodeURIComponent('acme/alpha-1')}&harness=baseline`] = { task_id: 't2', spread: 1.2, diverge_call: null, gap_by_phase: {}, runs: [
      { run_id: ID2, repeat_index: 0, hidden_pass: true, calls: 2, prompt: 1700, generated: 210, cached: null, by_phase: null, cumulative: [[1, 890], [2, 1910]], axis: AXIS, after_fix: { reason: 'no patch' } },
      { run_id: ID3, repeat_index: 1, hidden_pass: false, calls: 2, prompt: 2335, generated: 2148, cached: null, by_phase: null, cumulative: [[1, 947], [2, 4483]], axis: AXIS, after_fix: { reason: 'no patch' } }] }
    d[`/results/${MINI}/runs/${ID3}`] = { summary: miniRuns().find((r) => r.run_id === ID3), spans: spans(ID3), patch: '', messages: [], issue: '' }
    return d
  }
  it('a run tile with more steps than model calls says both', () => {
    const { container } = renderRig('#/rig/task:mini:alpha-1:baseline:t2:1', { data: data() })
    const tiles = [...container.querySelectorAll('.rg-traj-att-t')].map((e) => e.textContent)
    // index steps are 6 and 4 in the fixture; the token view counts 2 model calls each
    expect(tiles[0]).toContain('2 model calls · 6 steps')
    expect(tiles[1]).toContain('2 model calls · 4 steps')
  })
  it('the step letters are named by step and tool', () => {
    const { container } = renderRig('#/rig/task:mini:alpha-1:baseline:t2:1', { data: data() })
    expect([...container.querySelectorAll('.rg-traj-pcode')].map(nameOf)).toEqual(['step 1, read_file', 'step 2, write_file'])
  })
  it('no two Run links share a name', () => {
    const { container } = renderRig('#/rig/task:mini:alpha-1:baseline:t2:1', { data: data() })
    const names = [...container.querySelectorAll('a,button')].map(nameOf).filter((n) => /^Run \d/.test(n))
    expect(names.length).toBeGreaterThan(2)
    expect(new Set(names).size).toBe(names.length)
  })
})

describe('the run page: the after-the-fix stat once, the risk explained, headings in order', () => {
  const RID = ID(3)
  const base = { run_id: RID, task_id: 't2', harness_id: 'baseline', 'gen_ai.request.model': 'acme/alpha-1' }
  const chat = (seq, k, name, phase) => ({ ...base, seq, span: 'chat', call_index: k, phase, 'gen_ai.usage.input_tokens': 100, 'gen_ai.usage.output_tokens': 10, 'gen_ai.response.finish_reasons': ['tool_calls'], tool_calls: [{ name, arguments: {} }] })
  const tool = (seq, name, args, phase) => ({ ...base, seq, span: 'execute_tool', 'gen_ai.tool.name': name, args, status: 'ok', phase, result_preview: '' })
  const spans = [
    { ...base, seq: 0, span: 'invoke_agent', status: 'start', harness: { sentinel: { enabled: true, threshold: 0.5 } } },
    chat(1, 1, 'read_file', 'explore'), tool(2, 'read_file', { path: 'src/a.py' }, 'explore'),
    chat(3, 2, 'edit_file', 'edit'), tool(4, 'edit_file', { path: 'src/a.py' }, 'edit'),
    chat(5, 3, 'run_tests', 'test'), tool(6, 'run_tests', {}, 'test'),
    chat(7, 4, 'submit', 'submit'), tool(8, 'submit', {}, 'submit'),
  ]
  const replay = [0.2, 0.4, 0.88, 0.7].map((risk, i) => ({ step: i, risk, patterns: [], explain: [], pending: [], recorded: null }))
  const data = () => ({
    ...rigFixture(),
    '/sentinel': { active: 'm', default_config: { threshold: 0.6 }, patterns: {}, models: [] },
    [`/results/${MINI}/runs/${RID}`]: { summary: miniRuns().find((x) => x.run_id === RID), spans, replay, patch: '--- a/src/a.py\n+++ b/src/a.py\n@@ -1 +1 @@\n-x\n+y\n', messages: [], issue: '',
      after_fix: { fix_step: 2, fix_seq: 4, fix_call: 2, path: 'src/a.py', calls_after: 1, calls: 3, share_after: 1 / 3, tokens_after: 10, tokens: 30, submit_only: 1 },
      first_lookup: { step: null, seq: null, rule: '' } },
  })
  it('says "after the fix" once in the header, and keeps the lookup on the band', () => {
    const { container } = renderRig(`#/rig/run:${RID}`, { data: data() })
    const head = el(container, 'run-heading').textContent
    expect(head.split('1 of 3 model calls').length - 1).toBe(1)
    expect(el(container, 'run-after-fix').textContent).toContain('1 of 3 model calls')
    expect(el(container, 'run-band-words').textContent).toBe('no lookup')
  })
  it('the risk readout is explained and announced politely', () => {
    const { container } = renderRig(`#/rig/run:${RID}`, { data: data() })
    const info = el(container, 'risk-info')
    expect(info.textContent).toContain('threshold')
    expect(info.textContent).toContain('0 = no sign of failure')
    expect(el(container, 'console-risk').getAttribute('aria-live')).toBe('polite')
  })
  it('no heading skips a level after the title', () => {
    const { container } = renderRig(`#/rig/run:${RID}`, { data: data() })
    const levels = [...container.querySelectorAll('h1,h2,h3,h4,h5,h6')].map((h) => +h.tagName[1])
    expect(levels[0]).toBe(1)
    levels.slice(1).forEach((l, i) => expect(l - levels[i]).toBeLessThanOrEqual(1))
  })
})
