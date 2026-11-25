// @vitest-environment jsdom
// Laptop widths (1024-1512 px): no text cut by an ellipsis, no word broken, no inner sideways scrollbar, nothing past
// its row or off the edge, headers aligned, one baseline per row of words.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect, afterEach } from 'vitest'
import { renderRig, resetRig, rigFixture } from '../../test/rig-testing'

afterEach(() => resetRig())
const read = (f) => readFileSync(join(__dirname, f), 'utf8')
/** Every declaration block whose selector list names `sel` exactly (base rules and those inside @container/@media). */
export function rulesFor(css, sel) {
  const out = []
  for (const m of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (m[1].split(',').map((s) => s.trim()).includes(sel)) out.push(m[2])
  }
  return out.join(';')
}
const CUT = /text-overflow:ellipsis|white-space:nowrap|overflow:hidden|-webkit-line-clamp/
/** The same, for the rules outside any @container / @media block (what a full laptop window uses). */
export const baseRulesFor = (css, sel) => rulesFor(css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@(container|media)[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, ''), sel)

describe('the Datasets list on a laptop', () => {
  const css = read('views/home.css')
  it('wraps a dataset name, its folder, its cells and the pooled words instead of cutting them', () => {
    for (const sel of ['.rig .rg-home-dn', '.rig .rg-home-dn b', '.rg-home-folder', '.rg-home-tbl tbody td', '.rg-home-scope', '.rg-home-models', '.rg-home-nl', '.rg-home-nl>.rg-hc']) {
      expect(rulesFor(css, sel), sel).not.toMatch(CUT)
    }
  })
  it('gives the kind, the counts and the date columns room for what they hold, the name what is left', () => {
    // a fixed table splits percentages of a laptop pane: 6% was 36 px of text for "3,240", 9% cut "Recorded"
    for (const c of ['kind', 'runs', 'tasks', 'updated']) expect(baseRulesFor(css, `.rg-home-c-${c}`), c).toMatch(/^width:\d+px$/)
    expect(rulesFor(css, '.rg-home-c-name')).toBe('')
  })
  it('keeps the filter field wide enough for its own placeholder', () => {
    expect(rulesFor(css, '.rg-home-bar>.rg-search')).toMatch(/flex:0 1 19rem;min-width:min\(19rem,100%\)/)
  })
  it('names models and harnesses whole: the first two in the row, the rest behind "+N more" that names them on hover and focus', () => {
    const data = rigFixture()
    data['/overview'].results[0].harnesses = ['baseline', 'terse', 'long_output', 'short_observations']
    const { container } = renderRig('#/rig/home', { data })
    const row = [...container.querySelectorAll('[data-el="dataset-list"] tbody tr')].find((r) => r.querySelector('b').textContent === 'mini')
    expect(row.querySelector('[data-el="dataset-models"]').textContent).toBe('alpha-1, beta-2')
    const names = row.querySelector('[data-el="dataset-harness-names"]')
    expect(names.textContent).toBe('baseline, terse +2 more')
    const more = names.querySelector('[data-el="dataset-more"]')
    expect(more.getAttribute('tabindex')).toBe('0')
    expect(more.getAttribute('data-hint')).toBe('long_output\nshort_observations')
  })
  it('lets a long folder or harness name break after an underscore, never inside a word', () => {
    const data = rigFixture()
    data['/overview'].results[0].harnesses = ['short_observations', 'baseline']
    data['/overview'].results[0].description = 'Mini'
    const { container } = renderRig('#/rig/home', { data })
    const row = [...container.querySelectorAll('[data-el="dataset-list"] tbody tr')].find((r) => r.querySelector('b').textContent === 'mini' || r.dataset.row === 'mini')
    const h = row.querySelector('[data-el="dataset-harness-names"]')
    expect(h.innerHTML).toMatch(/short_(<\/span>)?<wbr>observations/)   // the colour mark holds to the name's first part
    const mock = [...container.querySelectorAll('[data-el="dataset-list"] tbody tr')].find((r) => r.dataset.row === 'mock_ctl')
    expect(mock.querySelector('[data-el="dataset-harness-names"]').textContent).toBe('baseline')
  })
})

describe('the dataset in focus, at the head of the open page list', () => {
  const css = read('rig.css')
  it('wraps its name and folder over two lines instead of cutting "Lab runs, three more models"', () => {
    for (const sel of ['.rg-dsw-t b', '.rg-dsw-t small']) expect(rulesFor(css, sel), sel).not.toMatch(CUT)
  })
})

describe('names that a reader must read are never cut, at any laptop width', () => {
  // each [file, selector]: a rule whose text was cut at 1024-1512 px
  const NAMES = [
    ['views/analysis.css', '.rg-an-trep .rg-an-tname'],   // Outcomes, per task: "Azure__azure-functions-pyt…"
    ['views/analysis.css', '.rg-an-mname'],               // Family matrix: "Qwen3-Coder-480B-A35B-Inst…"
    ['views/dataset.css', '.rg-ds-find .k'],              // Overview findings: the question
    ['views/dataset.css', '.rg-ds-find .t'],              // Overview findings: "6.5 points lost, 0.0 gained; net −6.…"
    ['views/tokens.css', '.rg-tok-rl .rg-hash'],          // a task's runs by tokens: "real-0319-bihealth_biomedsh…"
    ['rig.css', '.rg-pal-it .t'],                         // ⌘K: a long dataset name and its folder, cut
    ['rig.css', '.rig .rg-kstat-k'],                      // Sentinel: "failures invisible to visible te…"
    ['rig.css', '.rg-hb .nm'],                            // a question's bars: "Qwen3-Coder-480B-A35B-Inst…"
    ['views/analysis.css', '.rg-an-seq'],                 // Trajectory features: a step-letter sequence over the next columns
    ['rig.css', '.rg-pnl-h .meta'],                       // Run setup, Models: "1 selected · price per 1M toke…"
  ]
  for (const [file, sel] of NAMES) it(`${sel} wraps`, () => expect(rulesFor(read(file), sel), sel).not.toMatch(CUT))
  it('the per-task rows of Outcomes share their columns, so every count and chip lines up down the list', () => {
    expect(rulesFor(read('views/analysis.css'), '.rg-an-trep')).not.toMatch(/fit-content/)
  })
  it('a task title on Tasks, a task in a question figure and a model in Run setup carry no ellipsis class', () => {
    const src = read('views/analysis.jsx') + read('views/questions.jsx')
    expect(src).not.toMatch(/className="rg-tiny rg-mute rg-ell" data-el="task-title"/)
    expect(src).not.toMatch(/className="rg-mono rg-small rg-ell">\{s\.task\}/)
    expect(src).not.toMatch(/className="rg-mono rg-grow rg-ell" data-hint=\{m\}/)
  })
})

describe('the bar over a page on a laptop', () => {
  const css = read('rig.css')
  it('keeps the places above the page whole; the page itself gives way first (its whole name is the title under the bar)', () => {
    expect(rulesFor(css, '.rg-crumb-i')).toMatch(/flex:0 1 auto/)
    expect(rulesFor(css, '.rg-crumb-i:last-child')).toMatch(/flex-shrink:1000/)
  })
  it('folds the places between the dataset and the page into "…" on a deep path in a narrow pane', () => {
    expect(css).toMatch(/@container rgpane \(max-width:960px\)\{\s*\.rg-crumb:has\(\.rg-crumb-mid~\.rg-crumb-mid~\.rg-crumb-mid\) \.rg-crumb-mid~\.rg-crumb-mid\{display:none\}/)
  })
  it('puts the evidence chain on its own row under the bar when the pane is too narrow for it, instead of a strip that scrolls', () => {
    const RO = globalThis.ResizeObserver
    globalThis.ResizeObserver = class { constructor(cb) { this.cb = cb } observe(el) { if (el.classList && el.classList.contains('rg-pane')) this.cb([{ contentRect: { width: 900, height: 700 } }]) } disconnect() {} unobserve() {} }
    try {
      renderRig('#/rig/q:mini:grader')
      const chain = document.querySelector('[data-el="evidence-chain"]')
      expect(chain).toBeTruthy()
      expect(chain.closest('.rg-chainrow')).toBeTruthy()
      expect(chain.closest('.rg-panehead')).toBeNull()
    } finally { globalThis.ResizeObserver = RO }
  })
  it('keeps the chain in the bar of a wide pane', () => {
    renderRig('#/rig/q:mini:grader')
    const chain = document.querySelector('[data-el="evidence-chain"]')
    expect(chain && chain.closest('.rg-panehead')).toBeTruthy()
  })
})

describe('the run page on a laptop window', () => {
  it('grows past the pane when its head and its columns need more room, so the columns never run under the next section', () => {
    const run = rulesFor(read('RunPage.css'), '.rig .rg-run')
    expect(run).not.toMatch(/(^|;)height:100%/)
    expect(run).toMatch(/min-height:max\(560px,100%\)/)
  })
  it('wraps the notes of the steps column head instead of cutting them', () => {
    expect(rulesFor(read('views/console.css'), '.rig .rg-cx-colh>.rg-cx-ct')).not.toMatch(CUT)
  })
})

describe('one baseline per row of words', () => {
  // each row held words of different sizes centred, so their baselines sat 2-10 px apart
  const ROWS = [
    ['RunPage.css', '.rig .rg-run-title'],         // the task name, its outcome and the run id
    ['DemoBanner.css', '.rig .rg-demo'],           // "Demo data" beside its two-line note
    ['views/analysis.css', '.rig .rg-an-chk'],     // Run setup: a model and its price
    ['rig.css', '.rig .rg-pal-it'],                // ⌘K: kind, name, what it is
    ['views/workspace.css', '.rig .rg-ws-step'],   // Guide: the step's number and its title
    ['views/console.css', '.rig .rg-cx-callh'],    // a tool call's head
    ['runaxis.css', '.rig .rg-traj-axis-h'],       // the runs on one axis: the heading and its key
    ['views/workspace.css', '.rig .rg-ws-node .nb>.rg-row'], // Map: a condition's figure, interval and n
  ]
  for (const [file, sel] of ROWS) it(`${sel} aligns on the baseline`, () => expect(rulesFor(read(file), sel)).toMatch(/align-items:baseline/))
})

describe('the Map on a laptop', () => {
  it('spaces its rows at least as tall as the nodes in them, so no node covers the next', async () => {
    const { canvasLayout } = await import('./views/workspace')
    const L = canvasLayout(1000, 0, { s: 13, m: 3, c: 9 })
    expect(L.pitch.s).toBeGreaterThanOrEqual(88)    // a dataset node with its kind tag: 87 px
    expect(L.pitch.m).toBeGreaterThanOrEqual(102)   // a model node whose meta wraps to a second line: 101 px
  })
})

describe('fields and chips hold their whole text at laptop widths', () => {
  it('the benchmark form keeps four fields a row, so "e.g. openai/gpt-5.6-luna" fits its field', () => {
    expect(read('views/recommend.css')).not.toMatch(/repeat\(8,minmax\(0,1fr\)\)/)
  })
  it('the Runs search keeps room for "Search run id, task, model, harness, exit"', () => {
    expect(rulesFor(read('primitives.css'), '.rg-toolbar-2up>.rg-search')).toMatch(/min-width:min\(22rem,100%\)/)
  })
  it('the Tasks probe column holds "test tampering temptation"', () => {
    expect(rulesFor(read('views/analysis.css'), '.rg-an-trow')).toMatch(/5\.75rem 11rem/)
  })
  it('a Map dataset node wraps its folder name', () => {
    expect(rulesFor(read('views/workspace.css'), '.rg-ws-node .nb b')).not.toMatch(CUT)
  })
})

describe('room between controls', () => {
  it('event chips in a wrapped sentence keep 4 px between their lines', () => {
    expect(rulesFor(read('views/trajectory.css'), '.rig .rg-traj-evl')).toMatch(/margin-block:2px/)
  })
})
