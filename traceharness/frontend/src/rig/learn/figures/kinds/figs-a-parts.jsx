/* Rig · learn/figures/kinds/figs-a-parts.jsx — what the figures of articles 02, 03, 05 and 06 share: the outcome labels
   in reading order with their tones, a segmented control for a second choice beside a card's tabs (the chosen one says
   it is shown and does nothing), an id that is safe inside url(#…), and how a ratio is written. */
import { useId } from 'react'
import './figs-a-parts.css'

export const cx = (...a) => a.filter(Boolean).join(' ')

/** The outcome labels (backend/outcomes_api MODES), in the article's words and its reading order, with a tone each. */
export const LABELS = Object.freeze([
  { id: 'passed', word: 'passed', tone: 'pass', group: 'passed' },
  { id: 'wrong_patch', word: 'wrong patch', tone: 'fail', group: 'failed with a patch' },
  { id: 'cutoff_no_patch', word: 'cut off, no patch', tone: 'cut', group: 'failed without a patch' },
  { id: 'step_limit_no_patch', word: 'step limit, no patch', tone: 'step', group: 'failed without a patch' },
  { id: 'no_patch', word: 'no patch', tone: 'none', group: 'failed without a patch' },
  { id: 'harness_error', word: 'harness error', tone: 'err', group: "not the agent's" },
  { id: 'ungraded', word: 'ungraded', tone: 'ung', group: 'unknown' },
])
export const labelOf = (id) => LABELS.find((l) => l.id === id) || { id, word: id, tone: 'ung', group: 'unknown' }

/** <Seg label options={[[value, words]]} value onChange el/>: segmented buttons; the chosen one is inert. */
export function Seg({ label, options, value, onChange, el }) {
  return (
    <div className="rg-lfig-seg rg-fa-seg" role="group" aria-label={label} data-el={el}>
      <span className="rg-fa-seg-k" aria-hidden="true">{label}</span>
      {options.map(([v, words]) => {
        const on = v === value
        return (
          <button key={v} type="button" className={cx(on && 'on')} aria-pressed={on} aria-disabled={on || undefined}
            data-hint={on ? `${words} · shown` : undefined} onClick={() => { if (!on) onChange(v) }}>{words}</button>
        )
      })}
    </div>
  )
}

/** An id for an SVG clip or pattern, unique per figure and safe in url(#…). */
export const useSvgId = (name) => `${name}-${useId().replace(/[^\w-]/g, '')}`

/** A ratio as the articles write one: two decimals near 1 (1.04x), one decimal above (2.6x). */
export const fmtRatio = (r) => `${r < 1.095 ? r.toFixed(2) : r.toFixed(1)}x`

/** Pressing Enter or Space on an SVG button does what a click does. */
export const onKeyPress = (fn) => (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn() } }
