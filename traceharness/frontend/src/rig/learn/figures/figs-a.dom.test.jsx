// @vitest-environment jsdom
/* The figures of articles 02, 03, 05 and 06 as a reader uses them: each article opens with its "In short" and two
   drawn figures; a node of the flow follows its runs, a harness row compares with baseline, a way in shows its path,
   a field row says what each source kept, the call slider compares two runs, a dot names its group, the mark and
   width switches redraw the bands, and a control that would do nothing is inert and says so. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, within } from '@testing-library/react'
import { renderRig, resetRig } from '../../../../test/rig-testing'
import { articleById } from '../articles'

afterEach(() => { resetRig() })
const figure = (kind) => document.querySelector(`[data-el="learn-figure"][data-kind="${kind}"]`)
const readout = (f) => f.querySelector('[data-el="fig-readout"]').textContent
const IDS = ['outcome-labels', 'where-runs-come-from', 'run-cost-steps-vs-tokens', 'phases-and-wasted-work']

describe('the four articles', () => {
  it('each opens with three "In short" sentences, a claim in bold in each, and shows two drawn figures with a Table view', () => {
    for (const id of IDS) {
      renderRig(`#/rig/guide:${id}`)
      const box = document.querySelector('[data-el="learn-in-short"]')
      const items = box.querySelectorAll('[data-el="learn-short"] > li')
      expect(items, id).toHaveLength(3)
      for (const li of items) expect(li.querySelector('b'), id).toBeTruthy()
      for (const s of articleById(id).in_short) expect(s.split(/\s+/).length, `${id}: ${s}`).toBeLessThanOrEqual(30)
      const figs = [...document.querySelectorAll('[data-el="learn-figure"]')]
      expect(figs, id).toHaveLength(2)
      for (const f of figs) {
        expect(f.querySelector('[data-el="fig-chart"] svg[role="img"], [data-el="fig-chart"] svg[role="group"][aria-label], [data-el="fig-chart"] [role="img"], [data-el="fig-chart"] ol[aria-label]'), `${id}: a drawing`).toBeTruthy()
        expect(within(f.querySelector('[data-el="fig-view"]')).getByRole('button', { name: 'Table' }), id).toBeTruthy()
      }
      resetRig()
    }
  })
  it('the Learn index draws a small figure on each of their cards', () => {
    renderRig('#/rig/guide:learn')
    for (const id of IDS) {
      const prev = document.querySelector(`[data-el="learn-index"] a[data-spec="guide:${id}"] svg.rg-learn-prev`)
      expect(prev.querySelector('.rg-prev-blank'), id).toBeNull()
      expect(prev.querySelectorAll('rect, path, circle, polyline').length, id).toBeGreaterThanOrEqual(2)
    }
  })
})

describe('for a screen reader and a keyboard', () => {
  it('no drawing that holds buttons is an image (an image hides its buttons); each names itself', () => {
    for (const id of IDS) {
      renderRig(`#/rig/guide:${id}`)
      for (const svg of document.querySelectorAll('[data-el="learn-figure"] svg')) {
        if (!svg.querySelector('[role="button"]')) continue
        expect(svg.getAttribute('role'), id).toBe('group')
        expect(svg.getAttribute('aria-label'), id).toMatch(/\S/)
      }
      resetRig()
    }
  })
  it('a way in or a run that is shown is inert and says so in its hint', () => {
    renderRig('#/rig/guide:where-runs-come-from')
    const way = document.querySelector('[data-el="fig-way"][data-way="sample"]')
    expect(way.getAttribute('aria-disabled')).toBe('true')
    expect(way.getAttribute('data-hint')).toBe('Public sample · shown')
    expect(document.querySelector('[data-el="fig-way"][data-way="runner"]').getAttribute('data-hint')).toBe('Follow the runner')
    resetRig()
    renderRig('#/rig/guide:phases-and-wasted-work')
    expect(document.querySelector('[data-el="fig-band-run"][data-run="2"]').getAttribute('data-hint')).toBe('Run 2 · shown')
    expect(document.querySelector('[data-el="fig-band-run"][data-run="5"]').getAttribute('data-hint')).toBe('Read Run 5')
  })
  it('the arrow keys name the scatter\'s groups one by one, largest token spread first; Escape lets go', () => {
    renderRig('#/rig/guide:run-cost-steps-vs-tokens')
    const f = figure('spread_pairs')
    const svg = f.querySelector('svg.rg-pair-svg')
    expect(svg.getAttribute('tabindex')).toBe('0')
    fireEvent.keyDown(svg, { key: 'ArrowRight' })
    const first = readout(f)
    expect(first).toMatch(/^\S+ · .+ · \S+: steps \d+ to \d+ \(.+x\), tokens .+ \((\d+\.?\d*)x\)\.$/)
    fireEvent.keyDown(svg, { key: 'ArrowRight' })
    const second = readout(f)
    const spread = (t) => Number(t.match(/\(([\d.]+)x\)\.$/)[1])
    expect(spread(second)).toBeLessThanOrEqual(spread(first))
    fireEvent.keyDown(svg, { key: 'ArrowLeft' })
    expect(readout(f)).toBe(first)
    fireEvent.keyDown(svg, { key: 'Escape' })
    expect(readout(f)).toMatch(/^All 3 models: 278 of 350 groups/)
  })
})

describe('article 02', () => {
  it('a node of the flow follows its runs; pressed again, it lets go', () => {
    renderRig('#/rig/guide:outcome-labels')
    const f = figure('label_flow')
    const node = f.querySelector('[data-el="fig-flow-node"][data-key="0:no_action"]')
    fireEvent.click(node)
    expect(node.getAttribute('aria-pressed')).toBe('true')
    expect(readout(f)).toBe('no_action: 29 runs. 4 left a patch: 4 wrong patch. 25 left none: 15 cut off, no patch, 10 no patch.')
    // the bands that do not pass through it dim
    expect(f.querySelectorAll('.rg-flow-band.on')).toHaveLength(3)
    expect(f.querySelectorAll('.rg-flow-band.off')).toHaveLength(3)
    fireEvent.keyDown(node, { key: 'Enter' })
    expect(node.getAttribute('aria-pressed')).toBe('false')
    expect(readout(f)).toMatch(/^study_v04: 120 runs\. 89 submitted/)
    expect(f.querySelectorAll('.rg-flow-band.off')).toHaveLength(0)
  })
  it('the SWE-rebench tab and the Table view keep every count', () => {
    renderRig('#/rig/guide:outcome-labels')
    const f = figure('label_flow')
    fireEvent.click(within(f.querySelector('[data-el="fig-tabs"]')).getByRole('button', { name: /SWE-rebench/ }))
    fireEvent.click(f.querySelector('[data-el="fig-flow-node"][data-key="0:max_steps"]'))
    expect(readout(f)).toBe('max_steps: 161 runs. 161 left a patch: 34 passed, 127 wrong patch.')
    fireEvent.click(within(f.querySelector('[data-el="fig-tabs"]')).getByRole('button', { name: /study_v04/ }))
    fireEvent.click(within(f.querySelector('[data-el="fig-view"]')).getByRole('button', { name: 'Table' }))
    expect([...f.querySelectorAll('[data-el="fig-table"] tbody tr')].map((r) => r.textContent)).toEqual(['submitted75140089', 'no_action04151029', 'max_steps02002', 'total75201510120'])
  })
  it('a harness row compares with baseline; the row shown is inert and says so', () => {
    renderRig('#/rig/guide:outcome-labels')
    const f = figure('label_mix')
    expect(readout(f)).toContain('under reprompt, against baseline: passed 75 → 98, wrong patch 20 → 22, cut off, no patch 15 → 0')
    const row = (h) => [...f.querySelectorAll('[data-el="fig-mix-row"]')].find((b) => b.textContent.startsWith(h))
    fireEvent.click(row('long_output'))
    expect(readout(f)).toContain('cut off, no patch 15 → 11')
    expect(row('long_output').getAttribute('aria-disabled')).toBe('true')
    expect(row('long_output').getAttribute('data-hint')).toBe('long_output · shown')
    fireEvent.click(row('long_output'))
    expect(readout(f)).toContain('under long_output')
    fireEvent.click(row('baseline'))
    expect(readout(f)).toMatch(/^gemini-2\.5-flash-lite under baseline: 75 passed, 20 wrong patch, 15 cut off, no patch, 10 no patch, of 120 runs\./)
  })
})

describe('article 03', () => {
  it('a way in shows its path: the runner skips the adapter and has no provenance record', () => {
    renderRig('#/rig/guide:where-runs-come-from')
    const f = figure('import_pipeline')
    const steps = () => f.querySelector('[data-el="fig-pipe-steps"]').textContent
    expect(steps()).toContain('67,074 runs of 6,306 tasks')
    const way = (id) => f.querySelector(`[data-el="fig-way"][data-way="${id}"]`)
    expect(way('sample').getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(way('runner'))
    expect(way('runner').getAttribute('aria-pressed')).toBe('true')
    expect(steps()).toContain('3 models x 9 harnesses x 24 tasks x 5 runs: 3,240 runs.')
    expect(steps()).toContain('No adapter')
    expect(readout(f)).toMatch(/^The runner: 3,240 runs/)
    // its own line and the shared ones flow; the imports' lines into the adapter do not
    const on = [...f.querySelectorAll('.rg-pipe-link.on')].length, off = [...f.querySelectorAll('.rg-pipe-link.off')].length
    expect([on, off]).toEqual([2, 4])
    fireEvent.keyDown(way('files'), { key: ' ' })
    expect(steps()).toContain('Inspect shows what it found before anything is written.')
  })
  it('a field row says what each source did with it', () => {
    renderRig('#/rig/guide:where-runs-come-from')
    const f = figure('keep_matrix')
    expect(readout(f)).toContain('SWE-rebench (an import): recorded for 0 of 2,174 runs: marked unknown')
    fireEvent.click(f.querySelector('[data-el="fig-keep-row"][data-field="prompt"]'))
    expect(readout(f)).toBe('System prompt. study_v04 (the runner): kept for 3,240 of 3,240 runs. SWE-rebench (an import): kept only as a fingerprint, a hash and a length, for 2,174 of 2,174 runs. Predictions file (a SWE-bench format): not in the format.')
    const row = f.querySelector('[data-el="fig-keep-row"][data-field="prompt"]')
    expect(row.getAttribute('aria-disabled')).toBe('true')
    expect(row.querySelectorAll('.rg-keep-cell.k-fingerprint')).toHaveLength(1)
  })
})

describe('article 05', () => {
  it('the call slider compares the two runs: 1.04x when the short run ends, 2.6x at the end', () => {
    renderRig('#/rig/guide:run-cost-steps-vs-tokens')
    const f = figure('cum_tokens')
    const slider = f.querySelector('[data-el="fig-call"] input')
    expect(readout(f)).toBe('Call 8: Run 1 sends 4,630 prompt tokens, Run 3 4,060.')
    fireEvent.click(within(f.querySelector('[data-el="fig-tabs"]')).getByRole('button', { name: 'All tokens so far' }))
    expect(readout(f)).toContain('1.04x as many')
    fireEvent.change(slider, { target: { value: '13' } })
    expect(readout(f)).toContain('59,489 tokens (55,956 read, 3,533 generated)')
    expect(readout(f)).toContain('2.6x as many')
    expect(f.querySelector('[data-el="fig-call"] output').textContent).toBe('call 13 of 13')
    expect(f.querySelectorAll('.rg-cum-line.gen')).toHaveLength(2)
  })
  it('pointing at a dot names its group; a tab keeps one model', () => {
    renderRig('#/rig/guide:run-cost-steps-vs-tokens')
    const f = figure('spread_pairs')
    const svg = f.querySelector('svg.rg-pair-svg')
    const [W, H] = svg.getAttribute('viewBox').split(' ').slice(2).map(Number)
    svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: W, height: H, right: W, bottom: H })
    const ring = f.querySelector('.rg-pair-ex circle')
    fireEvent.mouseMove(svg, { clientX: Number(ring.getAttribute('cx')), clientY: Number(ring.getAttribute('cy')) })
    expect(readout(f)).toBe('t09_paginate · gemini-2.5-flash-lite · baseline: steps 8 to 13 (1.63x), tokens 23,159 to 59,489 (2.57x).')
    fireEvent.mouseLeave(svg)
    expect(readout(f)).toMatch(/^All 3 models: 278 of 350 groups/)
    fireEvent.click(within(f.querySelector('[data-el="fig-tabs"]')).getByRole('button', { name: 'gpt-5.6-luna' }))
    const n = f.querySelectorAll('.rg-pair-dot').length
    expect(readout(f)).toMatch(new RegExp(`^gpt-5\\.6-luna: \\d+ of ${n} groups`))
    expect(n).toBeLessThan(350)
  })
})

describe('article 06', () => {
  it('the mark switch moves the dashed line and the hatch; the width switch redraws the blocks by tokens', () => {
    renderRig('#/rig/guide:phases-and-wasted-work')
    const f = figure('phase_band')
    const run = (k) => f.querySelector(`[data-el="fig-band-run"][data-run="${k}"]`)
    expect(run(2).querySelectorAll('.rg-band-after')).toHaveLength(2)
    expect(readout(f)).toContain('the fix is its second edit, at model call 4 of 7')
    const mark = f.querySelector('[data-el="fig-mark"]')
    fireEvent.click(within(mark).getByRole('button', { name: 'first passing test' }))
    expect(run(2).querySelectorAll('.rg-band-after')).toHaveLength(3)
    expect(run(5).querySelectorAll('.rg-band-after')).toHaveLength(0)
    expect(readout(f)).toContain('3 more tool calls (ETB) came before submit')
    // the switch shown is inert
    expect(within(mark).getByRole('button', { name: 'first passing test' }).getAttribute('aria-disabled')).toBe('true')
    const widths = () => [...run(2).querySelectorAll('.seg .fill')].map((r) => Number(r.getAttribute('width')))
    expect(new Set(widths().map((x) => Math.round(x))).size).toBe(1)
    fireEvent.click(within(f.querySelector('[data-el="fig-width"]')).getByRole('button', { name: 'by tokens' }))
    const w = widths()
    expect(w[0]).toBeLessThan(w[1] / 2)   // the first call read 540 tokens, the second 1,856
    fireEvent.click(run(5))
    expect(readout(f)).toBe('Run 5 (RRRETS, 6,258 tokens): its tests first passed at model call 3 of 4, and the next call was submit.')
  })
  it('the work after each mark, for both models', () => {
    renderRig('#/rig/guide:phases-and-wasted-work')
    const f = figure('after_hist')
    expect(readout(f)).toBe('After the first passing test: gemini-2.5-flash-lite, 0 of 86: the next call was always submit; gpt-5.6-luna, 26 of 119 runs with one made more tool calls (31 in all).')
    fireEvent.click(within(f.querySelector('[data-el="fig-mark"]')).getByRole('button', { name: 'the fix' }))
    expect(readout(f)).toBe('After the fix, every passing run made at least one model call: gemini-2.5-flash-lite, exactly 1 in all 75; gpt-5.6-luna, exactly 1 in 99 of 118.')
    expect([...f.querySelectorAll('.rg-ahist-bar.m1 .rg-lfig-val')].map((t) => t.textContent)).toEqual(['0', '99', '17', '1', '1'])
  })
})

describe('on a phone', () => {
  /** Every measured box reports `width` px, as a 390 px screen gives a figure card. */
  function phone(width) {
    vi.stubGlobal('ResizeObserver', class { constructor(cb) { this.cb = cb } observe(el) { this.cb([{ target: el, contentRect: { width } }]) } disconnect() {} })
  }
  afterEach(() => { vi.unstubAllGlobals() })
  it('the flow runs top to bottom and names its columns under the drawing', () => {
    phone(334)
    renderRig('#/rig/guide:outcome-labels')
    const f = figure('label_flow')
    const svg = f.querySelector('svg.rg-flow-svg')
    expect(svg.classList.contains('vertical')).toBe(true)
    expect(svg.getAttribute('viewBox')).toBe('0 0 334 400')
    expect(f.querySelector('.rg-lfig-axisname').textContent).toMatch(/^How it ended ↓ Patch left\? ↓ Outcome label · /)
    // the exit reasons sit along the top, the labels along the bottom
    const node = (key) => f.querySelector(`[data-key="${key}"] .node`)
    expect(Number(node('0:submitted').getAttribute('y'))).toBeLessThan(Number(node('1:true').getAttribute('y')))
    expect(Number(node('1:true').getAttribute('y'))).toBeLessThan(Number(node('2:passed').getAttribute('y')))
  })
  it('the pipeline stacks the ways on the left and the stages on the right; the band puts its note under the bar', () => {
    phone(334)
    renderRig('#/rig/guide:where-runs-come-from')
    const frames = [...figure('import_pipeline').querySelectorAll('.rg-pipe-box .frame')].map((r) => ({ x: Number(r.getAttribute('x')), y: Number(r.getAttribute('y')) }))
    expect(new Set(frames.slice(0, 4).map((b) => b.x))).toEqual(new Set([0]))
    // adapter, ledger and folder share one column on the right, one under the other
    const [adapter, ledger, folder] = frames.slice(4)
    expect(new Set([adapter.x, ledger.x, folder.x]).size).toBe(1)
    expect(adapter.x).toBeGreaterThan(150)
    expect(adapter.y < ledger.y && ledger.y < folder.y).toBe(true)
    resetRig()
    phone(334)
    renderRig('#/rig/guide:phases-and-wasted-work')
    const run = figure('phase_band').querySelector('[data-el="fig-band-run"][data-run="2"]')
    const note = run.querySelector('.note'), bar = run.querySelector('.seg .fill')
    expect(Number(note.getAttribute('y'))).toBeGreaterThan(Number(bar.getAttribute('y')) + Number(bar.getAttribute('height')))
    expect(note.textContent).toBe('2 of 6 calls after · 494 generated')
  })
})
