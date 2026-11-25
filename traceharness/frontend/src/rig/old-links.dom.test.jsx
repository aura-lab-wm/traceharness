// @vitest-environment jsdom
/* Old links keep working: every registered route kind, and
   every legacy address App.jsx rewrites, opens a real page, and the left list marks that page's home. */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import App, { legacyToRig } from '../App'
import { renderRig, resetRig } from '../../test/rig-testing'
import { listViews } from './registry'
import { homeOf, NAV_BY_ID } from './navTree'
import { parseSpec } from './route'

afterEach(resetRig)

/** One address per registered kind, plus the other views a kind has (an analysis view, a Harnesses view). */
const SAMPLES = {
  home: ['home'], ds: ['ds:mini', 'ds:mini:beta-2:terse'],
  start: ['start'],
  an: ['family', 'outcomes', 'tokens', 'delta', 'features', 'judge', 'fit', 'report', 'setup'].map((v) => `an:mini:${v}`),
  q: ['q:mini', 'q:mini:grader'], tasks: ['tasks:mini'], task: ['task:mini:alpha-1:baseline:t1', 'task:mini:alpha-1:baseline:t1:1'],
  lanes: ['lanes:mini:alpha-1:baseline:t1'],
  field: ['field:mini'], run: ['run:a00003'], span: ['span:a00003:1'], cmp: ['cmp:a00000:a00001', 'cmp'], fork: ['fork:a00000'], paused: ['paused'],
  harnesses: ['harnesses', 'harnesses:view:experiments', 'harnesses:view:versions', 'harnesses:view:file', 'harnesses:view:runs'],
  shallowWizard: ['shallowWizard'], shallowCards: ['shallowCards'], blocks: ['blocks', 'blocks:customize'], shallowApply: ['shallowApply'],
  sources: ['sources', 'sources:sample', 'sources:disk'], capture: ['capture'], recommend: ['recommend'],
  sentinel: ['sentinel'], canvas: ['canvas'], settings: ['settings'], guide: ['guide', 'guide:learn', 'guide:glossary'], package: ['package'],
}

/** The label of the row the left list marks for a page, or 'Help' / null for frame pages. */
function expectedMark(spec) {
  const { kind, args } = parseSpec(spec)
  const h = homeOf(kind, args)
  if (!h) return undefined
  if (h.frame) return h.frame.startsWith('Help') ? 'Help' : null
  const s = NAV_BY_ID[h.section]
  const c = h.child && s.children.find((x) => x.id === h.child)
  return c ? c.label : s.label
}
const marked = () => [...document.querySelectorAll('.rg-rail .rg-nav-it[aria-current], .rg-gcl [aria-current="page"]')].map((b) => b.getAttribute('aria-label'))

function expectOpens(container, spec) {
  const doc = container.querySelector('.rg-doc')
  expect(doc, spec).toBeTruthy()
  expect(container.querySelector('[data-el="pending-view"]'), spec).toBeFalsy()
  expect(container.textContent, spec).not.toMatch(/This view failed while drawing/)
  return doc
}

describe('every registered kind still opens at its address', () => {
  it('has a sample address for every registered kind (a new kind must be added here)', () => {
    expect(Object.keys(SAMPLES).sort()).toEqual(listViews().map((v) => v.kind).sort())
  })
  const all = Object.values(SAMPLES).flat()
  it.each(all)('%s opens and the left list marks its home', (spec) => {
    const { container } = renderRig('#/rig/' + spec, { storage: { 'rig.nav': 'open' } })
    const doc = expectOpens(container, spec)
    expect(doc.dataset.spec).toBe(spec)
    const want = expectedMark(spec)
    expect(want, spec).not.toBeUndefined()
    expect(marked(), spec).toEqual(want ? [want] : [])
  })
})

/* Every `case` label of legacyToRig, with one hash that reaches it. The list is checked against App.jsx. */
const LEGACY = [
  ['', 'home'], ['#/home', 'home'], ['#/studies', 'home'], ['#/new', 'home'],
  ['#/workspace?dataset=mini', 'ds:mini'], ['#/designs/x?dataset=mini', 'ds:mini'], ['#/workspace', 'home'],
  ['#/s/mini', 'ds:mini'], ['#/s/mini/family', 'an:mini:family'], ['#/s/mini/overview', 'ds:mini'], ['#/s/mini/run', 'an:mini:setup'],
  ['#/s/mini/new', 'an:mini:setup'], ['#/s/mini/measure', 'an:mini:outcomes'], ['#/s/mini/attribute', 'an:mini:delta'],
  ['#/s/mini/judge', 'an:mini:judge'], ['#/s/mini/experiment', 'an:mini:fit'], ['#/s/mini/close', 'an:mini:report'],
  ['#/field/mini', 'field:mini'], ['#/field/mini?run=a00003', 'run:a00003'],
  ['#/run/mini/a00003', 'run:a00003'], ['#/spans/mini/a00003', 'run:a00003'], ['#/span/mini/a00003/1', 'span:a00003:1'],
  ['#/compare/mini/a00000/a00001', 'cmp:a00000:a00001'], ['#/compare/mini', 'field:mini'], ['#/fork/mini/a00000', 'fork:a00000'],
  ['#/load', 'sources'], ['#/start', 'guide'], ['#/fixed', 'shallowCards'], ['#/minimal', 'shallowWizard'], ['#/customize', 'blocks:customize'],
  ['#/canvas', 'canvas'], ['#/sentinel', 'sentinel'], ['#/sources', 'sources'], ['#/capture', 'capture'], ['#/settings', 'settings'], ['#/package', 'package'],
  ['#/no-such-page', 'home'],
]

describe('every App.jsx rewrite still lands on a page', () => {
  it('names every case of legacyToRig', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/App.jsx'), 'utf8')   // vitest runs from the frontend folder
    const body = src.slice(src.indexOf('export function legacyToRig'), src.indexOf('function normalise'))
    const cases = [...body.matchAll(/case '([^']+)'/g)].map((m) => m[1])
    const steps = [...src.matchAll(/^\s+(\w+): (?:'[a-z]+'|null),?/gm)].map((m) => m[1])
    const covered = new Set(LEGACY.map(([h]) => h.replace(/^#\/?/, '').split(/[/?]/)[0]))
    for (const c of cases) expect(covered.has(c), `case '${c}'`).toBe(true)
    const stepCovered = new Set(LEGACY.filter(([h]) => h.startsWith('#/s/mini/')).map(([h]) => h.split('/')[3]))
    for (const s of ['family', 'overview', 'run', 'new', 'measure', 'attribute', 'judge', 'experiment', 'close']) expect(stepCovered.has(s), s).toBe(true)
    expect(steps.length).toBeGreaterThan(0)
  })
  it.each(LEGACY)('%s opens %s', (from, spec) => {
    expect(legacyToRig(from)).toBe('#/rig/' + spec)
    const { container } = renderRig(from || '#/', { Root: App, storage: { 'rig.nav': 'open' } })
    expect(location.hash).toBe('#/rig/' + spec)
    expectOpens(container, spec)
    const want = expectedMark(spec)
    expect(marked(), from).toEqual(want ? [want] : [])
  })
})
