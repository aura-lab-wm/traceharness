/* Rig · learn/figures/kinds/keep-matrix.jsx — what each source kept, field by field (article 03, figure 2).
   A row per field of a run, a column per source: the runner's study_v04, the SWE-rebench import (both counted over
   every run) and a SWE-bench predictions file (the format the evaluation guide describes, not a dataset). A cell is
   kept (✓), marked unknown (?), mapped into TraceHarness words (→), kept only as a fingerprint (#), or not in the
   format (·), with the runs that have it. The cells come in column by column once. Pressing a row says what happens
   to that field in each source; the row shown is inert and says so. */
import { useState } from 'react'
import { FigureCard, FigTable } from '../FigureCard'
import { fmt } from '../math'
import { useReveal } from '../../motion'
import { cx } from './figs-a-parts'
import './keep-matrix.css'

export const FIELDS = Object.freeze([
  { id: 'task', word: 'Task id', format: true },
  { id: 'model', word: 'Model', format: true },
  { id: 'messages', word: 'Each message' },
  { id: 'tool_calls', word: 'Tool calls and output', present: true },
  { id: 'patch', word: 'Final patch', format: true, present: true },
  { id: 'verdict', word: "The source's verdict" },
  { id: 'exit_reason', word: 'Exit reason', mapped: true },
  { id: 'tool_names', word: 'Tool names', mapped: true },
  { id: 'tokens', word: 'Token counts' },
  { id: 'timestamps', word: 'Timestamps' },
  { id: 'step_limit', word: 'Step limit' },
  { id: 'temperature', word: 'Temperature' },
  { id: 'prompt', word: 'System prompt' },
  { id: 'strong', word: 'Strengthened grade' },
])
const SOURCES = Object.freeze([
  { id: 'study_v04', word: 'study_v04', how: 'the runner' },
  { id: 'swe_rebench_openhands_qwen3coder', word: 'SWE-rebench', how: 'an import', imported: true },
  { id: 'predictions', word: 'Predictions file', how: 'a SWE-bench format', format: true },
])
export const KIND_WORDS = Object.freeze({
  kept: ['✓', 'kept'], unknown: ['?', 'marked unknown'], mapped: ['→', 'mapped into TraceHarness words'],
  fingerprint: ['#', 'kept only as a fingerprint'], absent: ['·', 'not in the format'],
})
const NUMBER_WORDS = ['no', 'one', 'two', 'three', 'four', 'five']

/** One cell: { kind, n, of } for a dataset (counted over its runs), { kind } for the format. PURE. */
export function keepCell(d, source, field) {
  const src = SOURCES.find((x) => x.id === source)
  if (src.format) return { kind: field.format ? 'kept' : 'absent' }
  const { runs: of, counts } = d.sets[source]
  if (field.id === 'prompt') {
    if (counts.prompt_text) return { kind: 'kept', n: counts.prompt_text, of }
    return counts.prompt_fingerprint ? { kind: 'fingerprint', n: counts.prompt_fingerprint, of } : { kind: 'unknown', n: 0, of }
  }
  const n = counts[field.id] || 0
  if (!n) return { kind: 'unknown', n, of }
  return { kind: field.mapped && src.imported ? 'mapped' : 'kept', n, of }
}

const share = ({ n, of }) => `${fmt.int(n)} of ${fmt.int(of)}`
/** A cell in words: what happened to the field in that source. PURE. */
export function cellWords(c, field) {
  if (c.n == null) return c.kind === 'kept' ? 'in the format' : 'not in the format'
  if (c.kind === 'unknown') return `recorded for ${share(c)} runs: marked unknown, so its pages say unknown, never 0`
  if (c.kind === 'mapped') return `mapped into TraceHarness words for ${share(c)} runs`
  if (c.kind === 'fingerprint') return `kept only as a fingerprint, a hash and a length, for ${share(c)} runs`
  return c.n === c.of || !field.present ? `kept for ${share(c)} runs` : `kept when present: ${share(c)} runs have one`
}

export function keepSay(d, fieldId) {
  const field = FIELDS.find((f) => f.id === fieldId)
  return `${field.word}. ${SOURCES.map((s) => `${s.word} (${s.how}): ${cellWords(keepCell(d, s.id, field), field)}`).join('. ')}.`
}

function Grid({ d, pick, onPick, seen }) {
  return (
    <div className={cx('rg-keep', seen && 'seen')}>
      <div className="rg-keep-head" aria-hidden="true">
        <span />
        {SOURCES.map((s) => <span key={s.id}><b className={cx(!s.format && 'rg-keep-ds')}>{s.word}</b><i>{s.how}</i></span>)}
      </div>
      <ol className="rg-keep-rows" aria-label="What each source kept, field by field">
        {FIELDS.map((f, r) => {
          const on = f.id === pick
          return (
            <li key={f.id}>
              <button type="button" className={cx('rg-keep-row', on && 'on')} data-el="fig-keep-row" data-field={f.id} aria-pressed={on} aria-disabled={on || undefined}
                data-hint={on ? `${f.word} · shown` : `What each source did with ${f.word.toLowerCase()}`} onClick={() => { if (!on) onPick(f.id) }}>
                <span className="rg-keep-name">{f.word}</span>
                {SOURCES.map((s, c) => {
                  const cell = keepCell(d, s.id, f)
                  return (
                    <span key={s.id} className={cx('rg-keep-cell', `k-${cell.kind}`)} style={{ '--rig-fig-i': c * 3 + r / 5 }}
                      aria-label={`${s.word}: ${cellWords(cell, f)}`}>
                      <b aria-hidden="true">{KIND_WORDS[cell.kind][0]}</b>{cell.n != null && <span aria-hidden="true">{fmt.int(cell.n)}</span>}
                    </span>
                  )
                })}
              </button>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

function KeepMatrix({ fig, n, d }) {
  const reveal = useReveal()
  const [pick, setPick] = useState('tokens')
  return (
    <FigureCard fig={fig} n={n} reveal={reveal}
      legend={Object.entries(KIND_WORDS).map(([k, [sym, words]]) => ({ label: `${sym} ${words}`, tone: `fa-keep-${k}` }))}
      chart={<Grid d={d} pick={pick} onPick={setPick} seen={reveal.seen} />}
      readout={keepSay(d, pick)}
      table={<FigTable caption={`Figure ${n} as a table`} tall cols={['Field', ...SOURCES.map((s) => `${s.word} (${s.how})`)]}
        rows={FIELDS.map((f) => [f.word, ...SOURCES.map((s) => { const c = keepCell(d, s.id, f); return c.n == null ? KIND_WORDS[c.kind][1] : `${KIND_WORDS[c.kind][1]}, ${share(c)}` })])} />} />
  )
}

function Preview({ d }) {
  return (
    <g>{FIELDS.slice(0, 7).map((f, r) => SOURCES.map((s, c) => (
      <rect key={`${f.id}${s.id}`} className={`rg-prev-keep k-${keepCell(d, s.id, f).kind}`} x={30 + c * 26} y={4 + r * 7} width="22" height="5" rx="1" />
    )))}</g>
  )
}

/** The numbers the article quotes, as this figure draws them. */
export function headlines(d) {
  const out = {}
  SOURCES.filter((s) => !s.format).forEach((s, j) => {
    for (const f of FIELDS) { const c = keepCell(d, s.id, f); out[`${f.id}_${j}`] = share(c) }
  })
  const chars = d.sets.swe_rebench_openhands_qwen3coder.prompt_chars
  if (chars.length === 1) out.prompt_chars = fmt.int(chars[0])
  out.fields_pred = `${NUMBER_WORDS[FIELDS.filter((f) => f.format).length]} fields`
  return out
}

export const KINDS = { keep_matrix: { Figure: KeepMatrix, Preview, headlines } }
