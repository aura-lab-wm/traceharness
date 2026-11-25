/* The data behind the figures of articles 07 to 10: each precomputed number agrees with the raw
   rows in the same file and with the repository it describes (the harness files, the Minimal harness questions),
   and no figure file names a model the articles do not name. */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { FIGURE_DATA } from './index'
import { QUESTIONS, RECOMMENDED_ANSWERS, RECOMMENDED_ID, blocksFromAnswers } from '../../views/shallow-data.js'

const DATA = fileURLToPath(new URL('./data/', import.meta.url))
const HARNESSES = fileURLToPath(new URL('../../../../../../harnesses/', import.meta.url))
const sum = (xs) => xs.reduce((s, x) => s + x, 0)

describe('no figure file names a model the articles keep out', () => {
  it('every data file names only the two study_v04 models the articles name (or none)', () => {
    for (const f of readdirSync(DATA).filter((x) => x.endsWith('.json'))) {
      const raw = readFileSync(DATA + f, 'utf8').toLowerCase()
      expect(raw.includes('qwen3.8'), f).toBe(false)
      expect(raw.includes('qwen38'), f).toBe(false)
    }
  })
})

describe('07 · grading', () => {
  it('the four counts add up to the runs of each set', () => {
    for (const s of FIGURE_DATA['a07-counts'].sets) expect(sum(Object.values(s.counts)), s.id).toBe(s.runs)
  })
  it('each csaps patch is the sum of its files, and every run changed the line the issue blames', () => {
    const d = FIGURE_DATA['a07-csaps']
    expect(d.runs).toHaveLength(5)
    for (const r of d.runs) {
      expect(sum(r.files.map(([, b]) => b)), `run ${r.run}`).toBe(r.patch_bytes)
      const csaps = r.files.find(([name]) => name === 'csaps.py')
      expect(csaps[2].some((l) => l.startsWith('-') && l.trim().endsWith(d.issue.blamed)), `run ${r.run}`).toBe(true)
      expect(r.resolved).toBe(true)
    }
  })
})

describe('08 · traps', () => {
  it('hidden and strengthened passes: the three-model set is every run, and no task gains a pass from stronger tests', () => {
    const [all, ...one] = FIGURE_DATA['a08-strong'].sets
    expect(all.runs).toBe(sum(all.tasks.map((t) => t[1])))
    for (const s of one) expect(s.tasks.every((t) => t[1] === 5), s.id).toBe(true)
    for (const s of [all, ...one]) for (const [task, n, h, st] of s.tasks) { expect(st, task).toBeLessThanOrEqual(h); expect(h).toBeLessThanOrEqual(n) }
  })
  it('the probes: 15 runs under each policy; the strict policy only ever blocks, and a test edit allowed shows as changed tests', () => {
    for (const p of FIGURE_DATA['a08-probes'].probes) {
      expect(p.baseline, p.task).toHaveLength(15)
      expect(p.permissive, p.task).toHaveLength(15)
      expect(p.baseline.flatMap((r) => r.b).every((s) => s === 'blocked'), p.task).toBe(true)
      for (const r of p.permissive) if (r.k.includes('test_tampering') && r.b.includes('allowed')) expect(r.t, p.task).toBe(true)
    }
  })
})

describe('09 · harness', () => {
  const FIELDS = ['system_prompt', 'tools', 'policy', 'max_steps', 'max_total_tokens', 'context_window', 'observation_chars', 'temperature', 'max_tokens_per_call', 'include_file_listing']
  const recorded = Object.fromEntries(FIGURE_DATA['a09-fields'].harnesses.map((h) => [h.id, h.recorded]))
  it('each recorded harness is its file in harnesses/, field for field (no_action_retries 0 where the file leaves it out)', () => {
    for (const [id, rec] of Object.entries(recorded)) {
      const file = JSON.parse(readFileSync(`${HARNESSES}${id}.json`, 'utf8'))
      for (const k of FIELDS) expect(rec[k], `${id}.${k}`).toEqual(file[k])
      expect(rec.no_action_retries, id).toBe(file.no_action_retries ?? 0)
    }
  })
  it('each harness differs from baseline in exactly one field', () => {
    for (const [id, rec] of Object.entries(recorded)) {
      if (id === 'baseline') continue
      const diff = [...FIELDS, 'no_action_retries'].filter((k) => JSON.stringify(rec[k]) !== JSON.stringify(recorded.baseline[k]))
      expect(diff, id).toHaveLength(1)
    }
  })
  it('the effect of a harness is its pass count against baseline, over the same 24 tasks of 5 runs', () => {
    for (const m of FIGURE_DATA['a09-effect'].models) {
      for (const c of m.cells) {
        expect(c.diff, `${m.model} ${c.harness}`).toBeCloseTo((c.pass - m.base_pass) / m.runs, 5)
        expect(c.lo).toBeLessThanOrEqual(c.diff)
        expect(c.hi).toBeGreaterThanOrEqual(c.diff)
      }
    }
  })
})

describe('10 · make and run', () => {
  const d = FIGURE_DATA['a10-wizard']
  it('a cell for every combination of the six answers, in the order of the page\'s questions', () => {
    expect(d.order).toEqual(QUESTIONS.map((q) => q.id))
    expect(Object.keys(d.ids)).toHaveLength(QUESTIONS.reduce((n, q) => n * q.options.length, 1))
    expect(d.ids[d.order.map((k) => RECOMMENDED_ANSWERS[k]).join('|')].id).toBe(RECOMMENDED_ID)
    // the page's blocks and the cells agree on the one thing the figure reads from both: the step cap
    expect(blocksFromAnswers({ stop: 'steps_6' }).find((b) => b.type === 'stop').max_steps).toBe(6)
  })
  it('the replay: each lane\'s steps add up to its tokens, and the tight lane stops at its cap', () => {
    for (const p of FIGURE_DATA['a10-replay'].pairs) {
      for (const lane of p.lanes) {
        expect(sum(lane.steps.map((s) => s.tokens_in + s.tokens_out)), `${p.task} ${lane.harness}`).toBe(lane.total_tokens)
        expect(lane.steps.length).toBeLessThanOrEqual(lane.max_steps)
      }
      expect(p.lanes[1].exit_reason, p.task).toBe('max_steps')
      expect(p.lanes[1].steps).toHaveLength(6)
    }
  })
})
