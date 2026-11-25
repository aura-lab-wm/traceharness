// @vitest-environment jsdom
/* The page tours: every page type has its own, at most six steps and 120 words. A step that asks for a click
   says "After the tour", none falls back to the page title, and each step's FIRST choice is drawn on a fixture page. */
import { afterEach, describe, expect, it } from 'vitest'
import { act, fireEvent, screen, within } from '@testing-library/react'
import { renderRig, resetRig, rigFixture } from '../../test/rig-testing'
import { tok3Data, taskTokensFixture, rid, TOK } from '../../test/token-fixture'
import { analysisData, sentinelData, blocksData, captureData, recommendData } from '../../test/tour-fixtures'
import { PAGE_TOURS, TOUR_STEPS, pageTourKey, isShown, pageQuery } from './Tour'

// a tour renders the page at every step: on a machine running other suites it can pass 5 s
const SLOW = { timeout: 30000 }
afterEach(resetRig)

/* ------------------------------------------------------------------ fixtures */
const T = 'proj__proj-101'
const R = [rid(T, 0), rid(T, 1), rid(T, 2)]
const PH = { ls: 'explore', cat: 'explore', curl: 'lookup', sed: 'edit', pytest: 'test', submit: 'submit' }
function ledger(id, cmds, { tokens = true } = {}) {
  const b = { run_id: id, task_id: T }
  return [{ ...b, seq: 0, span: 'invoke_agent', status: 'start', harness: { id: 'agentic' } },
    ...cmds.flatMap((c, i) => {
      const p = PH[c.split(' ')[0]]
      const use = tokens ? { 'gen_ai.usage.input_tokens': 1000, 'gen_ai.usage.output_tokens': 10 } : {}
      return [{ ...b, seq: 2 * i + 1, span: 'chat', phase: p, call_index: i + 1, ...use, text: `reply ${i + 1}`, tool_calls: [{ name: 'bash', arguments: { command: c } }] },
        { ...b, seq: 2 * i + 2, span: 'execute_tool', 'gen_ai.tool.name': 'bash', phase: p, args: { command: c }, status: 'ok', result_preview: `out of ${c}` }]
    })]
}
const CMDS = [['ls', 'cat a.py', 'sed -i x a.py', 'pytest', 'submit'], ['ls', 'cat a.py', 'curl https://pypi.org', 'sed -i x a.py', 'pytest', 'submit'], ['ls', 'cat b.py', 'sed -i y b.py', 'pytest', 'submit']]
const AF = [
  { fix_step: 3, fix_seq: 6, fix_call: 3, path: 'a.py', calls_after: 1, calls: 4, share_after: 0.25, tokens_after: 10, tokens: 40, submit_only: 1 },
  { fix_step: 4, fix_seq: 8, fix_call: 4, path: 'a.py', calls_after: 1, calls: 5, share_after: 0.2, tokens_after: 10, tokens: 50, submit_only: 1 },
  { fix_step: 3, fix_seq: 6, fix_call: 3, path: 'b.py', calls_after: 1, calls: 4, share_after: 0.25, tokens_after: 10, tokens: 40, submit_only: 1 },
]
const LOOK = [{ step: null, seq: null, rule: 'r' }, { step: 3, seq: 6, rule: 'r' }, { step: null, seq: null, rule: 'r' }]
const detail = (i, o = {}) => ({ summary: {}, spans: ledger(R[i], CMDS[i], o), patch: '', messages: [], issue: '', replay: [], after_fix: AF[i], first_lookup: LOOK[i], ...o.detail })
const AXIS = (i) => ({ calls: 5, steps: 5, phases: [['explore', 2], ['edit', 1], ['test', 1], ['submit', 1]], fix_at: 3, lookup_at: i === 1 ? 3 : null, first_step: [1, 2, 3, 4, 5] })
const taskView = (marks) => { const f = taskTokensFixture(); return { ...f, runs: f.runs.map((r, i) => ({ ...r, ...(marks ? { after_fix: AF[i], axis: AXIS(i) } : { after_fix: { reason: 'not recorded' }, axis: { ...AXIS(i), fix_at: null, lookup_at: null } }) })) } }
/** tok3 with every run of proj-101 recorded step by step. */
const recorded = () => tok3Data({ ...Object.fromEntries(R.map((id, i) => [`/results/${TOK}/runs/${id}`, detail(i)])), [`/results/${TOK}/tokens/task/${T}`]: taskView(true) })
/** The same runs with nothing after the fix and no tokens recorded (an imported trajectory without usage). */
const unrecorded = () => tok3Data({ ...Object.fromEntries(R.map((id, i) => [`/results/${TOK}/runs/${id}`, detail(i, { tokens: false, detail: { after_fix: { reason: 'not recorded' }, first_lookup: { step: null, seq: null, rule: 'r' } } })])),
  [`/results/${TOK}/tokens/task/${T}`]: taskView(false) })
/** mini with the model prices Run setup reads. */
const setupData = () => ({ ...rigFixture(), '/models': { models: [{ id: 'acme/alpha-1', price_in: 0.1, price_out: 0.4 }], observed: { 'acme/alpha-1': { cost_per_run: 0.01, runs: 8 } } } })
const MINI_A = '20260101-000000-a00003', MINI_B = '20260101-000000-a00002'
const miniLedgers = () => {
  const f = rigFixture()
  for (const id of [MINI_A, MINI_B]) {
    const b = { run_id: id, task_id: 't2' }
    f[`/results/mini/runs/${id}`] = { summary: {}, patch: '', messages: [], issue: '', replay: [], spans: [{ ...b, seq: 0, span: 'invoke_agent', status: 'start' },
      { ...b, seq: 1, span: 'chat', phase: 'explore', call_index: 1, text: 'r', tool_calls: [{ name: 'bash', arguments: { command: id === MINI_A ? 'ls' : 'cat a.py' } }] },
      { ...b, seq: 2, span: 'execute_tool', 'gen_ai.tool.name': 'bash', phase: 'explore', args: { command: id === MINI_A ? 'ls' : 'cat a.py' }, status: 'ok', result_preview: 'x' }] }
  }
  return f
}

/** Every page with a tour of its own, on a fixture page that draws all of its steps. */
const PAGES = [
  ['home', '#/rig/home', rigFixture],
  ['ds', '#/rig/ds:mini', rigFixture],
  ['task', `#/rig/task:${TOK}:coder-9b:agentic:${T}`, recorded],
  ['task', `#/rig/task:${TOK}:coder-9b:agentic:${T}`, unrecorded],
  ['run', `#/rig/run:${R[1]}`, recorded],
  ['run', `#/rig/run:${R[1]}`, unrecorded],
  ['tokens', `#/rig/an:${TOK}:tokens`, recorded],
  ['setup', '#/rig/an:mini:setup', setupData],
  ['harnesses', '#/rig/harnesses', rigFixture],
  ['lanes', `#/rig/lanes:${TOK}:coder-9b:agentic:${T}`, recorded],
  ['questions', '#/rig/q:mini', rigFixture],
  ['question', '#/rig/q:mini:repeats', rigFixture],
  ['cmp', `#/rig/cmp:${MINI_A}:${MINI_B}`, miniLedgers],
  ['family', '#/rig/an:mini:family?sel=cell:acme%2Falpha-1:baseline', rigFixture],
  ['outcomes', '#/rig/an:mini:outcomes', rigFixture],
  ['tasks', '#/rig/tasks:mini', rigFixture],
  ['field', '#/rig/field:mini', rigFixture],
  // the rest of the page types
  ['start', '#/rig/start', rigFixture],                            // every part of Home is drawn, opened pages or not
  ['canvas', '#/rig/canvas', rigFixture],
  ['settings', '#/rig/settings', rigFixture],
  ['span', `#/rig/span:${R[1]}:3`, recorded],
  ['fork', `#/rig/fork:${R[1]}`, recorded],
  ['paused', '#/rig/paused', rigFixture],
  ['cmpPick', '#/rig/cmp', rigFixture],
  ['answerRuns', '#/rig/q:mini:repeats:runs', rigFixture],
  ['delta', '#/rig/an:mini:delta', analysisData],
  ['fit', '#/rig/an:mini:fit', rigFixture, ['answer', 'hold']],   // too few cells for a two-factor fit: no sentence, nothing to hold
  ['judge', '#/rig/an:mini:judge', rigFixture],
  ['features', '#/rig/an:mini:features', analysisData],
  ['report', '#/rig/an:mini:report', analysisData],
  ['sentinel', '#/rig/sentinel', sentinelData],
  ['sentinel', '#/rig/sentinel', rigFixture, ['threshold', 'features', 'test']],   // no trained model: its parts are not drawn
  ['hExperiments', '#/rig/harnesses:view:experiments', rigFixture],
  ['hRuns', '#/rig/harnesses:view:runs', rigFixture],
  ['hFile', '#/rig/harnesses:view:file', rigFixture],
  ['hVersions', '#/rig/harnesses:view:versions', rigFixture],
  ['customize', '#/rig/blocks:customize', rigFixture],
  ['minimal', '#/rig/shallowWizard', rigFixture],
  ['fixed', '#/rig/shallowCards', rigFixture],
  ['build', '#/rig/blocks', blocksData],
  ['six', '#/rig/shallowApply', rigFixture],
  ['import', '#/rig/sources', rigFixture],
  ['sample', '#/rig/sources:sample', rigFixture],
  ['capture', '#/rig/capture', captureData],
  ['disk', '#/rig/sources:disk', rigFixture],
  ['recommend', '#/rig/recommend', recommendData],
  ['learn', '#/rig/guide:learn', rigFixture],
  ['readingGuide', '#/rig/guide', rigFixture],
  ['article', '#/rig/guide:reading-a-trajectory', rigFixture],
  ['glossary', '#/rig/guide:glossary', rigFixture],
  ['package', '#/rig/package', rigFixture],
]

/** Every page type the app has, with the tour it gets. */
const QS = ['variable', 'grader', 'repeats', 'outcomes', 'leak', 'run', 'sentinel', 'report', 'next']
const ALL_PAGES = [
  ['start', 'start'], ['home', 'home'], ['canvas', 'canvas'], ['ds', 'ds:mini'], ['tasks', 'tasks:mini'], ['field', 'field:mini'],
  ['task', `task:${TOK}:coder-9b:agentic:${T}`], ['lanes', `lanes:${TOK}:coder-9b:agentic:${T}`], ['run', `run:${R[1]}`], ['run', `run:${R[1]}:s5`],
  ['span', `span:${R[1]}:3`], ['cmp', `cmp:${MINI_A}:${MINI_B}`], ['cmpPick', 'cmp'], ['fork', `fork:${R[1]}`], ['paused', 'paused'],
  ['questions', 'q:mini'], ...QS.map((x) => ['question', `q:mini:${x}`]), ['answerRuns', 'q:mini:repeats:runs'],
  ['family', 'an:mini'], ...['family', 'delta', 'fit', 'outcomes', 'judge', 'tokens', 'features', 'report', 'setup'].map((v) => [v, `an:mini:${v}`]), ['sentinel', 'sentinel'],
  ['harnesses', 'harnesses'], ['hExperiments', 'harnesses:view:experiments'], ['hRuns', 'harnesses:view:runs'], ['hFile', 'harnesses:view:file'], ['hVersions', 'harnesses:view:versions'],
  ['minimal', 'shallowWizard'], ['fixed', 'shallowCards'], ['build', 'blocks'], ['customize', 'blocks:customize'], ['six', 'shallowApply'],
  ['import', 'sources'], ['sample', 'sources:sample'], ['capture', 'capture'], ['capture', 'sources:capture'], ['disk', 'sources:disk'], ['recommend', 'recommend'],
  ['learn', 'guide:learn'], ['readingGuide', 'guide'], ['article', 'guide:reading-a-trajectory'], ['glossary', 'guide:glossary'], ['package', 'package'], ['settings', 'settings'],
]

/* ------------------------------------------------------------------ helpers */
const card = () => within(document.querySelector('[data-el="tour"]')).getByRole('dialog')
const stepLine = () => document.querySelector('.rg-tour-n')?.textContent
const next = () => act(() => { fireEvent.click(within(card()).getByRole('button', { name: /^(Next|Finish)$/ })) })
const guide = () => {
  fireEvent.click(screen.getByRole('button', { name: 'Help' }))
  act(() => { fireEvent.click(screen.getByRole('menuitem', { name: /Guide me through this page/ })) })
}
const firstChoice = (st) => st.spots[0][0]
const shownCount = (sel) => [...document.querySelectorAll(sel)].filter(isShown).length
// the longest words the pages draw: a failed run's "Jump to the last edit"
const allQ = { has: () => true, exists: () => true, text: () => 'Jump to the last edit · step 3 used 2.0× the tokens after 1 of 4 calls — unknown not recorded' }
const noneQ = { has: () => false, exists: () => false, text: () => '' }
const bodyOf = (st, q) => (typeof st.body === 'function' ? st.body({ q }) : st.body)
const words = (s) => s.split(/\s+/).filter(Boolean).length

/* ------------------------------------------------------------------ which pages */
describe('which pages have a tour of their own', SLOW, () => {
  it('every page type of the app has a tour of its own, and none falls back to the general one', () => {
    for (const [key, spec] of ALL_PAGES) {
      expect(pageTourKey(spec), spec).toBe(key)
      expect(PAGE_TOURS[key], key).toBeTruthy()
    }
    expect(new Set(ALL_PAGES.map(([k]) => k)).size).toBe(Object.keys(PAGE_TOURS).length)   // no tour without a page
    expect(pageTourKey('nowhere:at:all')).toBeNull()                                         // an address no page answers
  })
  it('every tour has a fixture page below: no page type is left unchecked', () => {
    expect(new Set(PAGES.map(([k]) => k))).toEqual(new Set(Object.keys(PAGE_TOURS)))
  })
  it('the all-runs tour lights the first lane drawn, whatever its run number (many runs show three, e.g. 2, 9 and 20)', () => {
    const lane = PAGE_TOURS.lanes.find((s) => s.id === 'lane')
    expect(firstChoice(lane)).not.toMatch(/data-lane/)
  })
  it('on Experiments, Help › Guide me runs the Experiments tour, not One run\'s', () => {
    renderRig('#/rig/harnesses:view:experiments')
    guide()
    expect(card().getAttribute('data-step')).toBe(PAGE_TOURS.hExperiments[0].id)
    expect(within(card()).getByRole('heading', { name: 'Experiments' })).toBeTruthy()
  })
})

/* ------------------------------------------------------------------ size and words */
describe('every page tour is short and says what you can do', SLOW, () => {
  for (const [k, steps] of Object.entries(PAGE_TOURS)) {
    it(`${k}: at most 6 steps and 120 words, whatever the page shows`, () => {
      expect(steps.length).toBeLessThanOrEqual(6)
      for (const q of [allQ, noneQ]) {
        const n = steps.reduce((a, st) => a + words(st.title) + words(bodyOf(st, q)), 0)
        expect(n, `${k}: ${n} words`).toBeLessThanOrEqual(120)
      }
    })
  }
  it('the task and run tours keep within 120 words', () => {
    for (const k of ['task', 'run']) expect(PAGE_TOURS[k].reduce((a, st) => a + words(st.title) + words(bodyOf(st, allQ)), 0)).toBeLessThanOrEqual(120)
  })
  it('a step that asks for a click, a key, a hover or typing says "After the tour"', () => {
    const ASK = /(^|[.;:!?]\s+)(Click|Pick|Select|Open|Type|Hover|Tick|Search|Press|Choose|Drag)\b/
    for (const [k, steps] of Object.entries({ ...PAGE_TOURS, site: TOUR_STEPS })) {
      for (const st of steps) {
        const b = typeof st.body === 'function' ? st.body({ q: allQ, dir: 'mini', run: 'x' }) : st.body
        for (const sentence of b.split(/(?<=[.!?])\s+/)) if (ASK.test(sentence)) expect(sentence, `${k}/${st.id}`).toMatch(/^After the tour, /)
      }
    }
  })
  it('no step falls back to the page title: a spot that is not the header names no header as a stand-in', () => {
    const HEADER = /page-header|#rig-doc-main( h1)?$/
    for (const [k, steps] of Object.entries(PAGE_TOURS)) {
      for (const st of steps) for (const alts of st.spots) {
        if (HEADER.test(alts[0])) continue                       // the step is about the header itself
        expect(alts.some((s) => HEADER.test(s)), `${k}/${st.id}: ${alts.join(' | ')}`).toBe(false)
      }
    }
  })
})

/* ------------------------------------------------------------------ texts that depend on the data */
describe('a clause about a mark or a button is said only where the page draws it', SLOW, () => {
  const step = (k, id) => PAGE_TOURS[k].find((s) => s.id === id)
  it('the run band names the button by its own words, and says nothing of a fix the run does not have', () => {
    const q = { ...noneQ, has: (s) => /fix-marker|jump-to-fix/.test(s), text: (s) => (/jump-to-fix/.test(s) ? 'Jump to the last edit · step 4' : '') }
    expect(bodyOf(step('run', 'band'), q)).toContain('“Jump to the last edit” opens that step')
    expect(bodyOf(step('run', 'band'), q)).toContain('The dashed line marks the last edit')     // a failed run's marker is its last edit
    expect(bodyOf(step('run', 'band'), q)).not.toMatch(/Jump to the fix/)
    expect(bodyOf(step('run', 'band'), noneQ)).not.toMatch(/dashed|Jump|fix/)
  })
  it('the run numbers name the marks of an unrecorded value that the page shows', () => {
    const q = { ...noneQ, text: () => 'Model calls 75 Tokens — Cost not recorded Wall time unknown' }
    const b = bodyOf(step('run', 'numbers'), q)
    expect(b).toMatch(/^Steps or model calls/)
    for (const m of ['“—”', '“unknown”']) expect(b).toContain(m)            // "not recorded" says so itself
    expect(bodyOf(step('run', 'numbers'), noneQ)).not.toMatch(/not recorded|after the fix/)
  })
  it('the task axis says "first lookup" only when a run made one, and the token step names no (i) by cached', () => {
    expect(bodyOf(step('task', 'axis'), noneQ)).not.toMatch(/lookup|dashed/)
    expect(bodyOf(step('task', 'axis'), allQ)).toMatch(/first lookup/)
    expect(bodyOf(step('task', 'tokens'), allQ)).not.toMatch(/\(i\)|cached/)
    expect(bodyOf(step('task', 'tokens'), noneQ)).not.toMatch(/costliest/)
  })
  it('a page that cannot judge, compare, fit or warn says so, and only then (only one oracle, one harness, no trained Sentinel)', () => {
    const emptyQ = { ...noneQ, has: (sel) => /empty-state/.test(sel) }
    expect(bodyOf(step('judge', 'oracles'), emptyQ)).toMatch(/^Only one oracle graded these runs/)
    expect(bodyOf(step('judge', 'oracles'), noneQ)).not.toMatch(/Only one oracle/)
    expect(bodyOf(step('judge', 'llm'), emptyQ)).toMatch(/needs the lab’s server key/)
    expect(bodyOf(step('judge', 'llm'), noneQ)).not.toMatch(/server key/)
    expect(bodyOf(step('delta', 'matrix'), emptyQ)).toMatch(/^Why nothing can be compared here/)
    expect(bodyOf(step('delta', 'matrix'), noneQ)).not.toMatch(/nothing can be compared/)
    expect(bodyOf(step('fit', 'fit'), emptyQ)).toMatch(/^Why no two-factor fit/)
    expect(bodyOf(step('fit', 'fit'), noneQ)).not.toMatch(/no two-factor fit/)
    expect(bodyOf(step('sentinel', 'kpis'), noneQ)).toMatch(/No model is trained yet/)
    expect(bodyOf(step('sentinel', 'kpis'), allQ)).not.toMatch(/No model is trained/)
    expect(bodyOf(step('canvas', 'detail'), emptyQ)).toMatch(/^No condition is selected/)
    expect(bodyOf(step('cmpPick', 'pick'), noneQ)).toMatch(/^No run is pinned yet/)
    expect(bodyOf(step('cmpPick', 'pick'), allQ)).not.toMatch(/No run is pinned/)
    expect(bodyOf(step('paused', 'list'), noneQ)).toMatch(/^No run is waiting now/)
  })
  it('the task tokens step says tokens are not recorded where the page says so, and the axis names a failed run’s last edit', () => {
    const none = { ...noneQ, text: (sel) => (/task-tokens-line/.test(sel) ? 'Token totals are not recorded for enough of these runs to compare them.' : '') }
    expect(bodyOf(step('task', 'tokens'), none)).toMatch(/^Tokens are not recorded for these runs/)
    expect(bodyOf(step('task', 'tokens'), noneQ)).not.toMatch(/not recorded/)
    expect(bodyOf(step('task', 'axis'), allQ)).toMatch(/a failed run’s last edit/)
    expect(bodyOf(step('canvas', 'map'), noneQ)).not.toMatch(/paired change/)
    expect(bodyOf(step('canvas', 'map'), { ...noneQ, text: () => '+5.8pp −4.2pp' })).toMatch(/paired change/)
  })
  it('home names no chips it does not list; setup says what is missing; Harnesses names no "(Guide me)"', () => {
    expect(bodyOf(step('home', 'find'), allQ)).not.toMatch(/recorded or mock/)
    expect(bodyOf(step('setup', 'answer'), allQ)).toMatch(/or what is missing/)
    for (const st of PAGE_TOURS.harnesses) expect(bodyOf(st, allQ)).not.toMatch(/\(Guide me\)/)
    expect(bodyOf(step('setup', 'estimate'), noneQ)).not.toMatch(/Launch/)
  })
})

/* ------------------------------------------------------------------ first choices on fixture pages */
describe('every step lights its own part, the first choice, on a fixture page', SLOW, () => {
  for (const [key, hash, data, absent = []] of PAGES) {
    it(`${key} (${data.name}): each step in turn, none skipped${absent.length ? ` but ${absent.join(', ')}` : ''}, none waiting`, async () => {
      const d = data()
      renderRig(hash, { data: d.fetchImpl ? d.data : d, fetchImpl: d.fetchImpl, storage: { 'rig.nav': 'open' } })
      await act(async () => { await new Promise((r) => setTimeout(r, 30)) })
      guide()
      const steps = PAGE_TOURS[key].filter((st) => !absent.includes(st.id))
      for (let i = 0; i < steps.length; i++) {
        await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
        expect(card().getAttribute('data-step'), `${key} step ${i + 1}`).toBe(steps[i].id)
        expect(stepLine()).toBe(`Step ${i + 1} of ${steps.length}`)
        expect(card().textContent).not.toContain('Loading…')
        expect(shownCount(firstChoice(steps[i])), `${key}/${steps[i].id}: ${firstChoice(steps[i])}`).toBeGreaterThan(0)
        const b = card().querySelector('.rg-tour-b').textContent
        expect(b).toBe(bodyOf(steps[i], pageQuery()))
        next()
      }
      expect(document.querySelector('[data-el="tour"]')).toBeNull()
    })
  }
  it('a question the dataset cannot answer: the tour lights why, and skips the figure, the runs and the note at once', async () => {
    let hash = null
    for (const q of ['sentinel', 'leak', 'next', 'run', 'report', 'grader', 'variable', 'outcomes', 'repeats']) {
      resetRig(); renderRig(`#/rig/q:${TOK}:${q}`, { data: tok3Data() })
      await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
      if (document.querySelector('[data-el~="question-unanswered"]')) { hash = q; break }
    }
    expect(hash, 'a question mini cannot answer').toBeTruthy()
    guide()
    expect(card().getAttribute('data-step')).toBe('ask')
    next()
    expect(card().getAttribute('data-step')).toBe('answer')
    expect(card().querySelector('.rg-tour-b').textContent).toMatch(/^Why this dataset cannot answer it/)
    expect(stepLine()).toBe('Step 2 of 2')                            // what the page lacks is left out of the count at once
    next()
    expect(document.querySelector('[data-el="tour"]')).toBeNull()      // figure, runs and note skipped: the tour ends
  })
  it('on a phone, One run’s pick step lights the folded summary of the three choices', async () => {
    window.matchMedia = (q) => ({ matches: /max-width:\s*767px/.test(q), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })
    try {
      renderRig('#/rig/harnesses', { storage: { 'rig.nav': 'open' } })
      await act(async () => { await new Promise((r) => setTimeout(r, 30)) })
      act(() => { fireEvent.click(screen.getByRole('button', { name: 'More actions' })) })
      act(() => { fireEvent.click(within(screen.getByRole('menu')).getAllByRole('menuitem')[0]) })
      const at = PAGE_TOURS.harnesses.findIndex((st) => st.id === 'pick')
      for (let i = 0; i < at; i++) next()
      expect(card().getAttribute('data-step')).toBe('pick')
      expect(card().textContent).not.toContain('Loading…')
      expect(shownCount(firstChoice(PAGE_TOURS.harnesses[at]))).toBeGreaterThan(0)
      expect(shownCount('.rg-composer-selectors')).toBe(0)
      expect(card().querySelector('.rg-tour-b').textContent).toMatch(/Edit selections opens their lists/)
    } finally { delete window.matchMedia }
  })
  it('with nothing recorded, the run tour claims no fix, no jump and no lookup', async () => {
    renderRig(`#/rig/run:${R[1]}`, { data: unrecorded() })
    await act(async () => { await new Promise((r) => setTimeout(r, 30)) })
    guide()
    const said = []
    for (let i = 0; i < PAGE_TOURS.run.length; i++) { said.push(card().querySelector('.rg-tour-b').textContent); next() }
    expect(said.join(' ')).not.toMatch(/dashed|Jump to|first lookup|after the fix/)
  })
})

describe('isShown: a part the reader cannot see is not shown', SLOW, () => {
  it('reads checkVisibility() where the browser has it, not the box', () => {
    const el = document.createElement('div')
    document.body.append(el)
    el.checkVisibility = () => false
    el.getBoundingClientRect = () => ({ width: 300, height: 40, left: 0, top: 0, right: 300, bottom: 40 })
    expect(isShown(el)).toBe(false)
    el.checkVisibility = () => true
    expect(isShown(el)).toBe(true)
    el.remove()
  })
  it('without layout: inside a closed <details> (its summary aside), an unselected tab panel, display:none', () => {
    document.body.innerHTML = '<details id="d"><summary><span id="s">Change the plan</span></summary><div id="in">x</div></details>'
      + '<div role="tabpanel" hidden><p id="tab">spread</p></div><div style="display:none"><p id="none">n</p></div><p id="ok">ok</p>'
    const $ = (id) => document.getElementById(id)
    expect(isShown($('in'))).toBe(false)
    expect(isShown($('s'))).toBe(true)
    expect(isShown($('d'))).toBe(true)
    expect(isShown($('tab'))).toBe(false)
    expect(isShown($('none'))).toBe(false)
    expect(isShown($('ok'))).toBe(true)
    $('d').open = true
    expect(isShown($('in'))).toBe(true)
    document.body.innerHTML = ''
  })
})
