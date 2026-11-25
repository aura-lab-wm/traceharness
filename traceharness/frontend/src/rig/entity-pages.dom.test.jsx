// @vitest-environment jsdom
/* One colour per model and one per harness, on every page that names them (entityColor.js). */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { renderRig, resetRig, rigFixture } from '../../test/rig-testing'
import { buildEntityTones, toneOf, hashSlot, HARNESS_TONES } from './entityColor'
import { normOverview } from './data'

afterEach(resetRig)

const M1 = 'acme/alpha-1'
/** The tone of every mark beside a name on the page: { 'model:alpha-1': Set(['em-3']), … } */
function marks(container) {
  const out = {}
  for (const i of container.querySelectorAll('.rg-ent[data-tone]')) {
    const kind = i.classList.contains('h') ? 'harness' : 'model'
    const name = i.getAttribute('data-name').split('/').pop()
    ;(out[`${kind}:${name}`] ||= new Set()).add(i.getAttribute('data-tone'))
  }
  return out
}
const PAGES = [
  ['Datasets', '#/rig/home'],
  ['Overview', '#/rig/ds:mini:alpha-1:baseline'],
  ['Tasks', '#/rig/tasks:mini:alpha-1:baseline'],
  ['Runs', '#/rig/field:mini:acme%2Falpha-1:baseline'],
  ['Family matrix', '#/rig/an:mini:family:alpha-1:baseline'],
  ['Comparison', '#/rig/an:mini:delta:alpha-1:baseline'],
  ['a run', '#/rig/run:20260101-000000-a00000'],
  ['Experiment', '#/rig/an:mini:fit:alpha-1:baseline'],
  ['Map', '#/rig/canvas'],
]

describe('entity colours across pages', () => {
  it('a model and a harness keep one tone on every page that marks them', () => {
    const lib = normOverview(rigFixture()['/overview'])
    const tones = buildEntityTones(lib.results)
    const want = { model: `em-${toneOf(tones, 'model', M1)}`, harness: `eh-${toneOf(tones, 'harness', 'baseline')}` }
    const seen = { model: [], harness: [] }
    for (const [page, hash] of PAGES) {
      const { container } = renderRig(hash)
      const m = marks(container)
      const model = m['model:alpha-1'], harness = m['harness:baseline']
      expect(model, `${page}: a mark beside alpha-1`).toBeTruthy()
      expect([...model], page).toEqual([want.model])
      seen.model.push(page)
      if (harness) { expect([...harness], page).toEqual([want.harness]); seen.harness.push(page) }
      resetRig()
    }
    expect(seen.model.length).toBeGreaterThanOrEqual(5)
    expect(seen.harness.length).toBeGreaterThanOrEqual(5)
  })
  it('the Experiment grid marks its model rows and harness columns; the Map its model nodes', () => {
    const f = rigFixture()
    const X = f['/results/mini/experiment']
    f['/results/mini/experiment'] = { ...X, a_key: 'model', b_key: 'harness_id', a_levels: [M1, 'acme/beta-2'], b_levels: ['baseline', 'terse'],
      cells: [M1, 'acme/beta-2'].flatMap((a) => ['baseline', 'terse'].map((b) => ({ a, b, n: 4, pass1: 0.5, ci95: [0.2, 0.8] }))) }
    const fit = renderRig('#/rig/an:mini:fit:alpha-1:baseline', { data: f }).container.querySelector('[data-el="cell-grid-ci"]')
    expect(fit.querySelectorAll('thead .rg-ent.h')).toHaveLength(2)
    expect(fit.querySelectorAll('tbody .rg-ent.m')).toHaveLength(2)
    resetRig()
    const map = renderRig('#/rig/canvas').container.querySelector('[data-el="canvas"]')
    expect(map.querySelectorAll('.rg-ws-node .rg-ent.m').length).toBeGreaterThanOrEqual(1)
    // a condition node's head has no room for a mark at 1024 px: "condition · short_observations" would be cut
    expect(map.querySelectorAll('.rg-ws-node .nh .rg-ent').length).toBe(0)
  })
  it('a model row\'s mark hangs in the row head\'s padding, so the grid gets no wider', () => {
    const css = readFileSync(join(__dirname, 'views/analysis.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    // 16 px of padding less the 12 px a mark takes (8 px dot, 4 px to the name), and none in a narrow pane
    expect(css).toMatch(/\.rg-an-mx td\.rh:has\(\.rg-ent\)\{padding-left:4px\}/)
    expect(css).toMatch(/\.rg-an-mx:is\(\.rg-an-dmx,\.rg-an-gmx\) td\.rh:has\(\.rg-ent\)\{padding-left:0\}/)
  })
  it('the runs table marks each run\'s model and harness', () => {
    const { container } = renderRig('#/rig/field:mini')
    const rows = [...container.querySelectorAll('[data-el="field-run-list"] tbody tr')]
    expect(rows.length).toBe(16)
    for (const tr of rows) {
      const cell = tr.querySelector('td.rg-cq-hide-md')
      expect([...cell.querySelectorAll('.rg-ent')].map((i) => i.className), cell.textContent).toEqual(['rg-ent m', 'rg-ent h'])
    }
  })
  it('two harnesses whose names hash to one tone still get two tones on the page', () => {
    // invented names: the first pair under 100 that shares a hash slot
    let pair = null
    for (let i = 0; !pair && i < 100; i++) for (let j = i + 1; !pair && j < 100; j++) if (hashSlot(`h${i}`, HARNESS_TONES) === hashSlot(`h${j}`, HARNESS_TONES)) pair = [`h${i}`, `h${j}`]
    const f = rigFixture()
    f['/overview'].results[0].harnesses = pair
    const { container } = renderRig('#/rig/home', { data: f })
    const m = marks(container)
    expect([...m[`harness:${pair[0]}`]][0]).not.toBe([...m[`harness:${pair[1]}`]][0])
  })
  it('a mark holds to the first part of its name, and the rest still wraps (a laptop column never holds a long name whole)', () => {
    const f = rigFixture()
    f['/overview'].results[0].models = ['acme/Long-Model-480B-Instruct', 'acme/beta-2']
    const { container } = renderRig('#/rig/home', { data: f })
    const names = container.querySelector('tr[data-row="mini"] [data-el="dataset-models"]')
    expect(names.innerHTML).toMatch(/<span class="rg-ent-n"><i class="rg-ent m"[^>]*><\/i>Long-<\/span><wbr>Model-<wbr>480B-<wbr>Instruct/)
    expect(names.textContent).toBe('Long-Model-480B-Instruct, beta-2')
  })
  it('the two models of a dataset never share a tone, nor its two harnesses', () => {
    const { container } = renderRig('#/rig/an:mini:family:alpha-1:baseline')
    const m = marks(container)
    expect([...m['model:alpha-1']][0]).not.toBe([...m['model:beta-2']][0])
    expect([...m['harness:baseline']][0]).not.toBe([...m['harness:terse']][0])
  })
  it('a model is a filled dot and a harness a ring, decorative: the name beside it is read', () => {
    const { container } = renderRig('#/rig/ds:mini:alpha-1:baseline')
    const ask = container.querySelector('[data-el~="asking-sentence"]')
    const [dm, dh] = ask.querySelectorAll('.rg-ent')
    expect(dm.classList.contains('m')).toBe(true)
    expect(dh.classList.contains('h')).toBe(true)
    for (const d of [dm, dh]) { expect(d.getAttribute('aria-hidden')).toBe('true'); expect(d.textContent).toBe(''); expect(d.style.getPropertyValue('--rig-ent')).toMatch(/^var\(--rig-e[mh]-\d\)$/) }
    // the sentence reads as it did
    expect(ask.textContent).toMatch(/^Asking mini about alpha-1 under baseline, graded by the hidden oracle\./)
  })
})
