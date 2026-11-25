// @vitest-environment jsdom
/* Every figure names which runs it is of, in words next to it: "this cell: alpha-1 under baseline" for one model
   under one harness, "pooled: all 2 models × 2 harnesses" for the whole dataset. Where a cell figure and the pooled
   one sit side by side (the Overview's two pass@1), one sentence says why they differ. The fixture's values are
   invented (2 models × 2 harnesses, 16 runs; 4 in alpha-1 under baseline). */
import { afterEach, describe, expect, it } from 'vitest'
import { renderRig, resetRig, rigFixture } from '../../test/rig-testing'
import { QUESTIONS, answerQuestion } from './answers'
import { normRuns } from './data'

afterEach(() => resetRig())
const el = (root, name) => root.querySelector(`[data-el~="${name}"]`)
const scopeOf = (root, name) => { const x = el(root, name); return x && x.querySelector('[data-el~="figure-scope"]') ? x.querySelector('[data-el~="figure-scope"]').textContent : null }
const CELL = 'this cell: alpha-1 under baseline'
const POOLED = 'pooled: all 2 models × 2 harnesses'

describe('Overview', () => {
  it('each figure names its scope; the pooled pass@1 says pooled', () => {
    const { container } = renderRig('#/rig/ds:mini:alpha-1:baseline', { data: rigFixture() })
    expect(scopeOf(container, 'success-rate')).toBe(CELL)
    expect(scopeOf(container, 'dataset-pass1')).toBe(POOLED)
    for (const name of ['mixed-outcomes-count', 'mean-tokens', 'visible-hidden-disagreements']) expect(scopeOf(container, name), name).toBe('this cell')
  })
  it('one sentence says why the two pass@1 differ', () => {
    const { container } = renderRig('#/rig/ds:mini:alpha-1:baseline', { data: rigFixture() })
    const s = el(container, 'scope-differs')
    expect(s.textContent).toMatch(/^They differ because pooled adds the other model and harness: \d+ runs, not this cell’s \d+\.$/)
  })
  it('a dataset of one condition has one pass@1 and no sentence', () => {
    const { container } = renderRig('#/rig/ds:mock_ctl', { data: rigFixture() })
    expect(el(container, 'dataset-pass1')).toBeNull()
    expect(el(container, 'scope-differs')).toBeNull()
  })
  it('each finding row says what its number is of and which runs it counts', async () => {
    const { container, findAllByText } = renderRig('#/rig/ds:mini:alpha-1:baseline', { data: rigFixture() })
    await findAllByText(/of \d+ failures/)
    const rows = [...container.querySelectorAll('[data-el="findings"] a.rg-ds-find')]
    expect(rows.length).toBeGreaterThan(0)
    for (const r of rows) expect(r.querySelector('[data-el~="finding-scope"]').textContent, r.textContent).toMatch(/^(this cell|pooled|one harness|one cell|the Sentinel)/)
  })
})

describe('the answers carry their scope', () => {
  it('pooled answers say pooled; the cell answers say this cell', () => {
    const f = rigFixture()
    const row = f['/overview'].results.find((r) => r.name === 'mini')
    const input = { dir: 'mini', row, cond: { model: 'acme/alpha-1', harness: 'baseline' }, oracle: 'hidden', runs: normRuns(f['/results/mini/runs'], 'mini'), metrics: f['/results/mini/metrics'],
      experiment: f['/results/mini/experiment'], oracleData: f['/results/mini/oracle'], integrity: f['/results/mini/integrity?harness=baseline'], sentinel: null, report: f['/results/mini/report?harness=baseline'],
      outcomes: { counts: { pass: 10, wrong_patch: 4, no_patch: 2 }, modes: [], byId: {} } }
    const res = QUESTIONS.map((q) => [q.id, answerQuestion(q, input)])
    const got = Object.fromEntries(res.filter(([, r]) => r.state === 'answered').map(([id, r]) => [id, r.answer.scope]))
    expect(res.filter(([, r]) => r.state !== 'answered').map(([id]) => id)).toEqual(['sentinel'])   // no sentinel in the input
    expect(got.grader).toBe(POOLED)
    expect(got.outcomes).toBe(POOLED)
    expect(got.repeats).toBe(CELL)
    expect(got.run).toBe(`${CELL} · one run`)
    if (got.leak) expect(got.leak).toBe('one harness: baseline, all 2 models pooled')
    if (got.variable) expect(got.variable).toBe(POOLED)
    if (got.next) expect(got.next).toBe(POOLED)
    for (const [id, s] of Object.entries(got)) expect(s, id).toBeTruthy()
  })
})

describe('Questions and Outcomes', () => {
  it('each answered question card names its scope beside its number', () => {
    const { container } = renderRig('#/rig/q:mini', { data: rigFixture() })
    const cards = [...container.querySelectorAll('.rg-q-card')].filter((c) => c.querySelector('.qv b'))
    expect(cards.length).toBeGreaterThan(0)
    for (const c of cards) expect(c.querySelector('.qv [data-el~="answer-scope"]').textContent, c.textContent).toBeTruthy()
  })
  it('Outcomes: the strengthened change names its cell, so it is never read as the pooled one', () => {
    const { container } = renderRig('#/rig/an:mini:outcomes:alpha-1:baseline', { data: rigFixture() })
    expect(scopeOf(container, 'outcomes-headline')).toBe(CELL)
    expect(scopeOf(container, 'strengthened-delta')).toBe(CELL)
    expect(scopeOf(container, 'pass-k')).toBe('this cell')
    expect(scopeOf(container, 'flip-rate')).toBe('this cell')
  })
  it('Family matrix tiles say they are across the conditions', () => {
    const { container } = renderRig('#/rig/an:mini:family', { data: rigFixture() })
    expect(scopeOf(container, 'family-spread')).toMatch(/^across: all \d conditions$/)
    expect(scopeOf(container, 'family-median')).toMatch(/^across: all \d conditions$/)
    expect(scopeOf(container, 'family-measured')).toBe(POOLED)
  })
})
