// @vitest-environment jsdom
/* Analysis pages: no click lands on the page already open and none does nothing visible. A control with nothing to
   do is inert and says why; something that is not a control does not look like one. Fixtures: the `mini` dataset. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, screen, within } from '@testing-library/react'
import { renderRig, resetRig, rigFixture, MINI } from '../../../test/rig-testing'
import { tok3Data, unknownTokens, TOK } from '../../../test/token-fixture'
import { pagePath } from '../navTree'

afterEach(() => { resetRig(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

const M1 = 'acme/alpha-1'
const el = (c, id) => c.querySelector(`[data-el~="${id}"]`)
const inert = (b) => b.getAttribute('aria-disabled') === 'true' && b.hasAttribute('data-here')
function data() {
  const f = rigFixture()
  f['/models'] = { models: [{ id: M1, price_in: 0.1, price_out: 0.4 }], observed: {} }
  return f
}
/** IntersectionObserver that reports each observed element as in view or not, by `ratioOf(element)`. */
function observeWith(ratioOf) {
  vi.stubGlobal('IntersectionObserver', class {
    constructor(cb) { this.cb = cb; this.els = [] }
    observe(e) { this.els.push(e); this.cb(this.els.map((target) => { const r = ratioOf(target); return { target, intersectionRatio: r, isIntersecting: r > 0 } })) }
    unobserve() {}
    disconnect() {}
  })
}
/* a look-alike: an element that is not a control and whose own text is one glyph */
const GLYPH = /^[›»▸▾▼▶▲⌄⌃→↗⟩❯↓↑+−×]$/
const CONTROL = 'a[href],button,summary,select,input,textarea,label,[role=button],[role=link],[role=tab],[tabindex]:not([tabindex="-1"])'
const glyphLookalikes = (root) => [...root.querySelectorAll('*')].filter((e) => !e.closest(CONTROL)
  && GLYPH.test([...e.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim()))

describe('Run query on Trajectory features', () => {
  const PATTERNS = { [`/results/${MINI}/patterns?harness=baseline`]: {
    n_runs: 8, n_pass: 5, n_fail: 3, alphabet: [], sequences: [{ sequence: 'LRWS', n: 8, graded: 8, pass_rate: 0.5, ci95: [0.1, 0.9], mean_steps: 4, example: 'r-8' }], divergence: [] } }
  const q = (p) => `/results/${MINI}/query?pattern=${encodeURIComponent(p)}&harness=baseline`
  const res = (p, matched) => ({ pattern: p, matched, unmatched: 8 - matched, total: 8, pass_in: 0.5, pass_out: 0.75, ochiai: 0.4, risk_ratio: 2, examples: [], unittest: `PATTERN = r"${p}"\n` })
  const render = () => renderRig('#/rig/an:mini:features', { data: { ...data(), ...PATTERNS, [`/real/${MINI}/analysis`]: { error: 'none' },
    [q('[WE](?!.*T)')]: res('[WE](?!.*T)', 2), [q('S$')]: res('S$', 8) } })
  it('the query already shown leaves Run query inert, saying the results are already showing', () => {
    const { container } = render()
    const run = screen.getByRole('button', { name: 'Run query' })
    expect(inert(run)).toBe(true)
    expect(run.getAttribute('data-hint')).toMatch(/already showing/i)
    expect(el(container, 'query-state').textContent).toBe('already showing')
  })
  it('an edited pattern makes it live, says so, and running it shows the new result', () => {
    const { container } = render()
    act(() => { fireEvent.change(screen.getByRole('textbox', { name: 'Pattern over the action string' }), { target: { value: 'S$' } }) })
    const run = screen.getByRole('button', { name: 'Run query' })
    expect(run.getAttribute('aria-disabled')).toBeNull()
    expect(el(container, 'query-state').textContent).toBe('edited · not run yet')
    act(() => { fireEvent.click(run) })
    expect(el(container, 'query-result').textContent).toContain('matched8of 8 runs')
    expect(inert(screen.getByRole('button', { name: 'Run query' }))).toBe(true)
  })
})

describe('"N more →" in the Family matrix', () => {
  function table() {
    vi.stubGlobal('ResizeObserver', class { constructor(cb) { this.cb = cb } observe() { this.cb([{ contentRect: { width: 1100, height: 400 } }]) } disconnect() {} })
  }
  const scrolls = []
  const spyScroll = () => { scrolls.length = 0; Element.prototype.scrollBy = function (o) { scrolls.push(o.left) } }
  it('with a column hidden on the right it says it scrolls right and how many columns are left', () => {
    table(); spyScroll()
    observeWith((e) => (e.getAttribute('data-h') === 'terse' ? 0.4 : 1))
    const { container } = renderRig('#/rig/an:mini:family', { data: data() })
    const pages = el(container, 'family-pages')
    expect(pages.textContent).toBe('Showing 1 of 2 harnesses · scroll right · 1 more column →')
    act(() => { fireEvent.click(within(pages).getByRole('button', { name: 'scroll right · 1 more column →' })) })
    expect(scrolls).toHaveLength(1)
    expect(scrolls[0]).toBeGreaterThan(0)
  })
  it('at the right end it scrolls back to the hidden column on the left, and says so', () => {
    table(); spyScroll()
    observeWith((e) => (e.getAttribute('data-h') === 'baseline' ? 0 : 1))
    const { container } = renderRig('#/rig/an:mini:family', { data: data() })
    const pages = el(container, 'family-pages')
    expect(pages.textContent).toBe('Showing 1 of 2 harnesses · ← scroll left · 1 earlier column')
    expect(within(pages).queryByRole('button', { name: /more/ })).toBeNull()
    act(() => { fireEvent.click(within(pages).getByRole('button', { name: '← scroll left · 1 earlier column' })) })
    expect(scrolls).toHaveLength(1)
    expect(scrolls[0]).toBeLessThan(0)
  })
})

describe('the mark on an integrity flag card', () => {
  it('is a status mark named "flag", never a glyph that reads as a dismiss button', () => {
    const f = data()
    const integ = f[`/results/${MINI}/integrity?harness=baseline`]
    integ.self_report = [{ harness: 'baseline', overclaim: 0.1 }]
    f['/judge'] = { status: 'idle', report: null, history: [] }
    const { container } = renderRig('#/rig/an:mini:judge', { data: f })
    const flags = el(container, 'integrity-flags')
    const notes = flags.querySelectorAll('.rg-note')
    expect(notes.length).toBeGreaterThan(0)
    for (const n of notes) {
      const mark = within(n).getByRole('img', { name: 'flag' })
      expect(mark.closest('button,a[href],[role=button]')).toBeNull()
      expect(mark.hasAttribute('tabindex')).toBe(false)
    }
    expect(glyphLookalikes(flags)).toEqual([])
  })
})

describe('the line beside "Show me the runs"', () => {
  it('names the runs behind the answer without reading as a command; the button is the command', () => {
    const { container } = renderRig('#/rig/q:mini:outcomes')
    const line = container.querySelector('.rg-q-next p')
    expect(line.textContent).toMatch(/^The runs behind this answer: /)
    expect(line.textContent).not.toMatch(/^Show me/)
    expect(screen.getByRole('button', { name: /Show me the runs/ })).toBeTruthy()
  })
})

describe('Run setup task sets', () => {
  function suites() {
    const f = data()
    f['/overview'] = { ...f['/overview'], tasks: [{ id: 't1', title: 'first task', suite: 'core' }, { id: 't2', title: 'second task', suite: 'extended' }] }
    return f
  }
  it('the set the plan holds is selected and inert; another set is live and becomes the selected one', () => {
    const { container } = renderRig('#/rig/an:mini:setup', { data: suites() })
    const all = el(container, 'suite-full'), core = el(container, 'suite-core')
    expect(all.getAttribute('aria-pressed')).toBe('true')
    expect(inert(all)).toBe(true)
    expect(all.getAttribute('data-hint')).toMatch(/already selected/)
    expect(core.getAttribute('aria-pressed')).toBe('false')
    expect(core.getAttribute('aria-disabled')).toBeNull()
    act(() => { fireEvent.click(core) })
    expect(el(container, 'suite-core').getAttribute('aria-pressed')).toBe('true')
    expect(inert(el(container, 'suite-core'))).toBe(true)
    expect(el(container, 'suite-full').getAttribute('aria-pressed')).toBe('false')
  })
})

describe('the page title names the row that opened it', () => {
  it('names a page by its section and its row where both rows open it', () => {
    expect(pagePath('q', [MINI])).toEqual(['Analysis', 'Questions'])
    expect(pagePath('harnesses', ['view', 'experiments'])).toEqual(['Harnesses', 'Experiments'])
    expect(pagePath('harnesses', [])).toEqual(['Harnesses', 'One run'])
    expect(pagePath('sources', ['disk'])).toEqual(['Add data', 'Results on disk'])
    expect(pagePath('capture', [])).toEqual(['Add data', 'Session capture'])
    expect(pagePath('tasks', [MINI])).toBeNull()
  })
  it('the rail\'s Analysis opens the questions page under the title "Analysis › Questions"', () => {
    renderRig('#/rig/ds:mini')
    const nav = within(document.querySelector('.rg-rail'))
    act(() => { fireEvent.click(nav.getByRole('button', { name: 'Analysis' })) })
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Analysis › Questions')
  })
  it('each Harnesses view names itself under Harnesses', () => {
    renderRig('#/rig/harnesses:view:experiments')
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Harnesses › Experiments')
  })
  it('each Add data tab names itself under Add data', () => {
    renderRig('#/rig/sources:disk')
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Add data › Results on disk')
    resetRig()
    renderRig('#/rig/capture')
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Add data › Session capture')
  })
})

describe('"not recorded" on Tokens', () => {
  it('is plain text, not a focusable tooltip; the reason is printed in the tile', () => {
    const OLD = `/results/${MINI}/tokens?model=${encodeURIComponent(M1)}&harness=baseline`
    const { container } = renderRig(`#/rig/an:${MINI}:tokens`, { data: tok3Data({ [OLD]: unknownTokens(), [`/results/${MINI}/tokens/tasks?model=${encodeURIComponent(M1)}&harness=baseline`]: { tasks: [], median_spread: null } }) })
    const tile = el(container, 'tok-cached')
    const nr = tile.querySelector('.rg-tok-unk')
    expect(nr.textContent).toBe('not recorded')
    expect(nr.hasAttribute('tabindex')).toBe(false)
    expect(tile.querySelector('.rg-kpi-h').textContent).toContain('The source of this dataset does not record cache hits.')
    expect(TOK).toBeTruthy()
  })
})

describe('Model filter on a one-model dataset', () => {
  it('is inert and says there is only one model', () => {
    const { container } = renderRig('#/rig/an:mock_ctl:family')
    const sel = screen.getByRole('combobox', { name: 'Model filter' })
    expect(sel.disabled).toBe(true)
    expect(sel.textContent).toBe('All models')
    expect(el(container, 'family-matrix').textContent).toContain('only one model here')
  })
  it('stays a live filter where there are two models', () => {
    renderRig('#/rig/an:mini:family')
    expect(screen.getByRole('combobox', { name: 'Model filter' }).disabled).toBe(false)
  })
})

describe('buttons that bring a section into view', () => {
  const outcomes = () => renderRig('#/rig/an:mini:outcomes:beta-2:baseline', { data: data() })
  it('"Open the per-task strips" scrolls to the strips and moves the focus to them', () => {
    observeWith(() => 0)
    const into = vi.fn()
    Element.prototype.scrollIntoView = into
    const { container } = outcomes()
    const b = screen.getByRole('button', { name: 'Open the per-task strips' })
    expect(b.getAttribute('aria-disabled')).toBeNull()
    act(() => { fireEvent.click(b) })
    const sec = el(container, 'per-task-repeats')
    expect(into.mock.contexts).toContain(sec)
    expect(sec.contains(document.activeElement)).toBe(true)
  })
  it('with the strips already in view it is inert and says where they are', () => {
    observeWith((e) => (e.closest('[data-el~="per-task-repeats"]') ? 1 : 0))
    outcomes()
    const b = screen.getByRole('button', { name: 'Open the per-task strips' })
    expect(inert(b)).toBe(true)
    expect(b.getAttribute('data-hint')).toMatch(/in view/)
  })
  it('"See the integrity flags (no key needed)" does the same on Judge & integrity', () => {
    const f = data()
    f[`/results/${MINI}/oracle`] = { n_eligible: 0, n_excluded: 16, cells: {}, rate_a: null, rate_b: null, kappa: null }
    f['/judge'] = { status: 'idle', report: null, history: [] }
    observeWith(() => 0)
    const into = vi.fn()
    Element.prototype.scrollIntoView = into
    const { container } = renderRig('#/rig/an:mini:judge', { data: f })
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'See the integrity flags (no key needed)' })) })
    const sec = el(container, 'integrity-flags')
    expect(into.mock.contexts).toContain(sec)
    expect(sec.contains(document.activeElement)).toBe(true)
  })
})

describe('Failure mode filter on Tasks', () => {
  it('with no failure recorded it is inert and says so', () => {
    const { container } = renderRig('#/rig/tasks:mini:alpha-1:terse')
    const sel = screen.getByRole('combobox', { name: 'Failure mode filter' })
    expect(sel.disabled).toBe(true)
    expect(sel.textContent).toBe('any outcome')
    expect(el(container, 'failure-filter-none').textContent).toBe('No run here failed, so the failure mode filter has nothing to pick.')
  })
  it('a mode every task shows says it matches every task, so the unchanged list is explained', () => {
    const { container } = renderRig('#/rig/tasks:mock_ctl:mock:baseline')
    act(() => { fireEvent.change(screen.getByRole('combobox', { name: 'Failure mode filter' }), { target: { value: 'wrong_patch' } }) })
    expect(el(container, 'failure-filter-all').textContent).toBe('Every task here has a run that failed this way.')
  })
  it('a mode only some tasks show narrows the list and says nothing more', () => {
    const { container } = renderRig('#/rig/tasks:mini:beta-2:baseline')
    act(() => { fireEvent.change(screen.getByRole('combobox', { name: 'Failure mode filter' }), { target: { value: 'wrong_patch' } }) })
    expect(container.querySelectorAll('.rg-an-trow:not(.th)')).toHaveLength(1)
    expect(el(container, 'failure-filter-all')).toBeNull()
  })
})

describe('Outcomes task names, run marks and the ladder\'s Table', () => {
  it('each run mark is a real link to that run of its task, as the task name is to the task', () => {
    const { container } = renderRig('#/rig/an:mini:outcomes:alpha-1:baseline', { data: data() })
    const row = [...el(container, 'per-task-repeats').querySelectorAll('.rg-an-trep')].find((r) => r.textContent.includes('t2'))
    const marks = [...row.querySelectorAll('.rg-an-c')]
    expect(marks.map((m) => m.tagName)).toEqual(['A', 'A'])
    expect(marks.map((m) => m.getAttribute('href'))).toEqual(['#/rig/task:mini:alpha-1:baseline:t2:0', '#/rig/task:mini:alpha-1:baseline:t2:1'])
    expect(row.querySelector('.rg-an-tname').getAttribute('href')).toBe('#/rig/task:mini:alpha-1:baseline:t2')
    act(() => { fireEvent.click(marks[1]) })
    expect(location.hash).toContain('task:mini:alpha-1:baseline:t2:1')
  })
  it('the rows keep their real height: no row is laid out late at a guessed one, so nothing below them moves under a click', async () => {
    const { readFileSync } = await import('node:fs')
    const css = readFileSync(`${process.cwd()}/src/rig/views/analysis.css`, 'utf8')
    const rules = css.replace(/\/\*[\s\S]*?\*\//g, '').match(/[^{}]*\.rg-an-trep[^{}]*\{[^}]*\}/g) || []
    expect(rules.length).toBeGreaterThan(0)
    for (const r of rules) expect(r, r).not.toMatch(/content-visibility\s*:\s*auto/)
  })
})

describe('the Map\'s "Open 120 runs" lands on Tasks', () => {
  it('the Tasks page it opens says how many runs it holds, so the count on the button is on the page', () => {
    const { container } = renderRig('#/rig/tasks:mini:alpha-1:baseline')
    expect(el(container, 'tasks-answer').textContent).toMatch(/^4 runs over 2 tasks: 1 passed every run/)
  })
})

describe('the "+" and "−" in the Sentinel weights legend', () => {
  it('each sign sits in its words, so no lone glyph reads as an expand or collapse button', () => {
    const SENT = { active: 'mini_model', default_config: { threshold: 0.6 },
      model: { names: ['n_edits', 'no_test_yet'], w: [-0.4, 1.2], b: -1.1, meta: { trained: true, name: 'mini_model', n_runs: 16, operating_points: [{ threshold: 0.6, recall: 0.5, false_alarm: 0.1, mean_lead_steps: 1.5 }] } },
      models: [{ name: 'mini_model', active: true, meta: { n_runs: 16 } }] }
    const { container } = renderRig('#/rig/sentinel', { data: { ...rigFixture(), '/sentinel': SENT, '/sentinel/plugins': { dir: 'p', errors: [], detectors: [] }, '/../openapi.json': { paths: {} } } })
    const feats = el(container, 'sentinel-features')
    expect(feats.textContent).toContain('+ pushes toward a bad submit · − pulls away from one.')
    expect(glyphLookalikes(feats)).toEqual([])
  })
})
