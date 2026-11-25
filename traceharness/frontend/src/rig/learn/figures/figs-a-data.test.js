/* The figures of articles 02, 03, 05 and 06: each keeps every number of the figure it replaced (the old figures' data
   is written out below), what the page recomputes agrees with what scripts/learn_figures.py
   precomputed, and the layouts keep their parts apart at a desktop and a phone width. */
import { describe, it, expect } from 'vitest'
import { FIGURE_DATA } from './index'
import { flowColumns, flowLayout, flowSay, flowTable, verticalLayout, wrapWords } from './kinds/label-flow'
import { mixSay } from './kinds/label-mix'
import { pipeLayout, pipeLinks, waySteps, waySub, WAYS } from './kinds/import-pipeline'
import { keepCell, keepSay, FIELDS } from './kinds/keep-matrix'
import { cumSay, cumSeries, seriesName } from './kinds/cum-tokens'
import { spacedTicks, spreadPoints, spreadStats } from './kinds/spread-pairs'
import { afterMark, bandSay, pathOf } from './kinds/phase-band'
import { afterSay, afterStats } from './kinds/after-hist'
import { fmtRatio } from './kinds/figs-a-parts'

const D = (id) => FIGURE_DATA[id]
const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

describe('article 02: from how a run ended to its label', () => {
  it('its Table view is the old figure\'s table, number for number', () => {
    const t = flowTable(D('a02-flow').sets[0])
    expect(t.cols).toEqual(['Exit reason', 'passed', 'wrong patch', 'cut off, no patch', 'no patch', 'total'])
    expect(t.rows).toEqual([['submitted', '75', '14', '0', '0', '89'], ['no_action', '0', '4', '15', '10', '29'], ['max_steps', '0', '2', '0', '0', '2'], ['total', '75', '20', '15', '10', '120']])
  })
  it('every column of the flow holds every run, and a node is as tall as the bands through it', () => {
    for (const set of D('a02-flow').sets) {
      for (const col of flowColumns(set.paths)) expect(col.reduce((s, x) => s + x.n, 0)).toBe(set.runs)
      for (const w of [640, 334]) {
        const { nodes, bands } = flowLayout(set.paths, { w })
        nodes.forEach((col, c) => col.forEach((nd) => {
          const through = bands.filter((b) => [b.path[0], String(b.path[1]), b.path[2]][c] === nd.k).reduce((s, b) => s + b.t, 0)
          expect(nd.h).toBeCloseTo(through, 6)
        }))
        // the label slots of one column never overlap
        for (const col of nodes) for (let i = 1; i < col.length; i++) expect(col[i].slotY).toBeGreaterThanOrEqual(col[i - 1].slotY + col[i - 1].slotH)
      }
    }
  })
  it('following a node says where its runs went', () => {
    const set = D('a02-flow').sets[0]
    expect(flowSay(set, { c: 0, k: 'no_action' })).toBe('no_action: 29 runs. 4 left a patch: 4 wrong patch. 25 left none: 15 cut off, no patch, 10 no patch.')
    expect(flowSay(set, { c: 2, k: 'wrong_patch' })).toBe('wrong patch: 20 runs, all left a patch. They ended 14 submitted, 4 no_action, 2 max_steps.')
    expect(flowSay(D('a02-flow').sets[1], { c: 0, k: 'max_steps' })).toBe('max_steps: 161 runs. 161 left a patch: 34 passed, 127 wrong patch.')
  })
  it('top to bottom on a phone, every label slot fits the width, down to a 300 px drawing', () => {
    for (const set of D('a02-flow').sets) {
      for (const w of [300, 308, 334, 400]) {
        const { nodes } = verticalLayout(set.paths, w)
        for (const col of nodes) {
          expect(col[0].slotY, `${w}`).toBeGreaterThanOrEqual(0)
          const last = col[col.length - 1]
          expect(last.slotY + last.slotH, `${w}: ${last.k}`).toBeLessThanOrEqual(w + 0.5)
        }
      }
    }
  })
  it('a label breaks between words, at most ten characters a line', () => {
    expect(wrapWords('cut off, no patch')).toEqual(['cut off,', 'no patch'])
    expect(wrapWords('passed')).toEqual(['passed'])
  })
  it('each harness holds 120 runs, and the readout compares one with baseline', () => {
    for (const m of D('a02-mix').models) for (const h of m.harnesses) expect(Object.values(h.labels).reduce((s, n) => s + n, 0)).toBe(120)
    const m = D('a02-mix').models[0]
    expect(mixSay(m, 'reprompt')).toBe('gemini-2.5-flash-lite under reprompt, against baseline: passed 75 → 98, wrong patch 20 → 22, cut off, no patch 15 → 0, no patch 10 → 0, of 120 runs each.')
    expect(mixSay(m, 'long_output')).toContain('cut off, no patch 15 → 11')
  })
})

describe('article 03: where runs come from', () => {
  it('the import\'s counts add up, and every run has one grade span', () => {
    const { import: imp, runner } = D('a03-pipeline')
    expect(imp.written + imp.skipped).toBe(imp.selected)
    expect(imp.written).toBe(imp.runs)
    expect(imp.spans.grade).toBe(imp.runs)
    expect(runner.spans.grade).toBe(runner.runs)
    expect(runner.models * runner.harnesses * runner.tasks * runner.repeats).toBe(runner.runs)
    expect(waySteps('runner', D('a03-pipeline'))[3][1]).toMatch(/No provenance\.json/)
  })
  it('no two boxes overlap and every box fits, at a desktop and a phone width', () => {
    for (const w of [640, 600, 520, 334, 308]) {
      const lay = pipeLayout(w)
      const boxes = [...lay.ways, lay.adapter, lay.ledger, lay.folder]
      for (const b of boxes) { expect(b.x).toBeGreaterThanOrEqual(0); expect(b.x + b.w).toBeLessThanOrEqual(w + 0.5); expect(b.y + b.h).toBeLessThanOrEqual(lay.h) }
      // a stage box leaves room for its longest line after its tick: execute_tool (12 mono characters at 12 px) in the
      // ledger, run/ledger.jsonl (16) in the folder
      expect(lay.ledger.w, `${w}: ledger`).toBeGreaterThanOrEqual(16 + 12 * 7.2 + 4)
      expect(lay.folder.w, `${w}: folder`).toBeGreaterThanOrEqual(16 + 16 * 7.2 + 4)
      for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) expect(overlap(boxes[i], boxes[j]), `${w}: ${boxes[i].id} / ${boxes[j].id}`).toBe(false)
      // the runner skips the adapter; the three imports go through it
      const links = pipeLinks(lay)
      expect(links.filter((l) => l.to === lay.adapter).map((l) => l.from.id).sort()).toEqual(['capture', 'files', 'sample'])
      expect(links.find((l) => l.from.id === 'runner').to).toBe(lay.ledger)
    }
  })
  it('a way\'s subtitle fits its box, down to a 262 px drawing (a 320 px phone)', () => {
    for (const w of [262, 308, 334, 640]) {
      const lay = pipeLayout(w)
      lay.ways.forEach((b, i) => expect(waySub(WAYS[i], b).length * 6.4 + 20, `${w}: ${WAYS[i].id}`).toBeLessThanOrEqual(b.w))
    }
    expect(waySub(WAYS[1], { w: 300 })).toBe('a Hugging Face dataset')
  })
  it('each cell counts its runs, and the import keeps the prompt only as a fingerprint', () => {
    const d = D('a03-keeps')
    for (const s of Object.values(d.sets)) for (const n of Object.values(s.counts)) expect(n).toBeLessThanOrEqual(s.runs)
    const f = (id) => FIELDS.find((x) => x.id === id)
    expect(keepCell(d, 'swe_rebench_openhands_qwen3coder', f('tokens'))).toEqual({ kind: 'unknown', n: 0, of: 2174 })
    expect(keepCell(d, 'swe_rebench_openhands_qwen3coder', f('prompt')).kind).toBe('fingerprint')
    expect(keepCell(d, 'swe_rebench_openhands_qwen3coder', f('exit_reason')).kind).toBe('mapped')
    expect(keepCell(d, 'study_v04', f('exit_reason')).kind).toBe('kept')
    expect(FIELDS.filter((x) => keepCell(d, 'predictions', x).kind === 'kept').map((x) => x.id)).toEqual(['task', 'model', 'patch'])
    expect(keepSay(d, 'tokens')).toContain('recorded for 0 of 2,174 runs: marked unknown')
  })
})

describe('article 05: run cost', () => {
  it('keeps the old figure\'s prompt series and names, and the calls add up to each run\'s tokens', () => {
    const d = D('a05-tokens')
    expect(d.runs.map((r) => cumSeries(r).map((p) => p.prompt))).toEqual([
      [567, 1328, 2155, 2715, 3071, 3819, 4052, 4630, 5486, 5813, 6645, 7796, 7879],
      [567, 1328, 2155, 2712, 2965, 3759, 3991, 4060]])
    expect(d.runs.map(seriesName)).toEqual(['Run 1 (13 calls, 59,489 tokens)', 'Run 3 (8 calls, 23,159 tokens)'])
    for (const r of d.runs) {
      const s = cumSeries(r)
      expect(s[s.length - 1].all).toBe(r.tokens_in + r.tokens_out)
      expect(s[s.length - 1].gen).toBe(r.tokens_out)
    }
  })
  it('the slider\'s readout gives the article\'s ratios', () => {
    const d = D('a05-tokens')
    expect(cumSay(d, 1, 8)).toBe('After call 8: Run 1 has used 24,103 tokens and Run 3 23,159, all of its tokens: 1.04x as many.')
    expect(cumSay(d, 1, 13)).toBe('After call 13: Run 1 has used 59,489 tokens (55,956 read, 3,533 generated); Run 3 ended at call 8 with 23,159: 2.6x as many.')
    expect(cumSay(d, 0, 13)).toBe('Call 13: Run 1 sends 7,879 prompt tokens; Run 3 ended at call 8.')
    expect([1.0407, 1.3, 2.569].map(fmtRatio)).toEqual(['1.04x', '1.3x', '2.6x'])
  })
  it('the spreads: 648 groups, 350 that differ in steps, 278 above the diagonal', () => {
    const d = D('a05-spread')
    expect(d.groups).toHaveLength(648)
    for (const g of d.groups) { expect(g[3]).toBeLessThanOrEqual(g[4]); expect(g[5]).toBeLessThanOrEqual(g[6]) }
    const s = spreadStats(spreadPoints(d))
    expect([s.n, s.above]).toEqual([350, 278])
    expect(s.medX).toBeCloseTo(1.5, 6)
    expect(s.medY).toBeCloseTo(1.6775, 3)
    // the two models the articles name, and the third as article 14 writes it
    expect(d.models).toEqual(['gemini-2.5-flash-lite', 'gpt-5.6-luna', 'the third model'])
  })
  it('ticks too close to the one before are left out', () => {
    expect(spacedTicks([1, 1.25, 1.5, 2, 3], (v) => v * 40)).toEqual([1, 2, 3])
    expect(spacedTicks([1, 2, 3], (v) => v * 40)).toEqual([1, 2, 3])
  })
})

describe('article 06: phases and wasted work', () => {
  it('keeps the old figure\'s paths, tokens and where the tests first passed', () => {
    const runs = D('a06-band').runs
    const r2 = runs.find((r) => r.repeat === 2), r5 = runs.find((r) => r.repeat === 5)
    expect([pathOf(r2), pathOf(r5)]).toEqual(['RRRETETBS', 'RRRETS'])
    expect([r2.tokens, r5.tokens]).toEqual([12140, 6258])
    // the old figure counted tool calls from 0: first_pass 4 is the fifth tool call, T, in model call 3
    for (const r of [r2, r5]) expect(pathOf(r)[r.calls.slice(0, r.first_pass_call - 1).reduce((s, c) => s + c.letters.length, 0)]).toBe('T')
    for (const r of runs) expect(r.calls.reduce((s, c) => s + c.tokens, 0)).toBe(r.tokens)
  })
  it('the calls after the fix are the ones core/trajectory_fields counted', () => {
    for (const r of D('a06-band').runs) {
      const a = afterMark(r, 'fix')
      expect(a.calls.length, `Run ${r.repeat}`).toBe(r.calls_after_fix)
      expect(a.generated, `Run ${r.repeat}`).toBe(r.generated_after_fix)
      expect(r.calls.filter((c) => !c.submit).length).toBe(r.working_calls)
    }
    const r2 = D('a06-band').runs.find((r) => r.repeat === 2)
    expect(bandSay(r2, 'fix')).toBe('Run 2 (RRRETETBS, 12,140 tokens): the fix is its second edit, at model call 4 of 7. After it come 2 of its 6 working calls, the submit left out, with 494 generated tokens.')
    expect(bandSay(r2, 'pass')).toBe('Run 2 (RRRETETBS, 12,140 tokens): its tests first passed at model call 3 of 7; 3 more tool calls (ETB) came before submit.')
  })
  it('after the mark: the article\'s counts for both models and both marks', () => {
    const [gem, gpt] = D('a06-after').models
    expect(afterStats(gpt, 'pass')).toMatchObject({ runs: 119, more: 26, calls: 31 })
    expect(afterStats(gem, 'pass')).toMatchObject({ runs: 86, more: 0 })
    expect(afterStats(gem, 'fix')).toMatchObject({ runs: 75, one: 75, zero: 0 })
    expect(afterStats(gpt, 'fix')).toMatchObject({ runs: 118, one: 99, zero: 0 })
    expect(afterSay(D('a06-after'), 'fix')).toBe('After the fix, every passing run made at least one model call: gemini-2.5-flash-lite, exactly 1 in all 75; gpt-5.6-luna, exactly 1 in 99 of 118.')
  })
})
