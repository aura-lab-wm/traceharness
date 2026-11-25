/* Rig · learn/figures/kinds/label-mix.jsx — one model's runs under each harness, by outcome label (article 02, figure 2).
   A row per harness, baseline first: a bar of its 120 runs split by label, in the article's order (passed, wrong patch,
   then the no-patch labels). The bars grow once from the left. Pressing a row compares it with baseline in the
   readout; the row shown is inert and says so. Tabs: the two models the articles name. */
import { useState } from 'react'
import { FigureCard, FigTable } from '../FigureCard'
import { fmt } from '../math'
import { useReveal } from '../../motion'
import { LABELS, cx } from './figs-a-parts'
import './label-mix.css'

const BASE = 'baseline'
const total = (h) => Object.values(h.labels).reduce((s, n) => s + n, 0)
const n = (h, id) => h.labels[id] || 0
/** The labels any harness of this model has, in reading order. */
export const mixLabels = (m) => LABELS.filter((l) => m.harnesses.some((h) => n(h, l.id)))

/** The readout for one harness: its labels, and against baseline what changed. PURE. */
export function mixSay(m, harness) {
  const h = m.harnesses.find((x) => x.harness === harness)
  const labels = mixLabels(m)
  const own = labels.map((l) => `${fmt.int(n(h, l.id))} ${l.word}`).join(', ')
  if (harness === BASE) return `${m.model} under baseline: ${own}, of ${fmt.int(total(h))} runs. Press another harness to compare it with baseline.`
  const b = m.harnesses.find((x) => x.harness === BASE)
  const moved = labels.filter((l) => n(h, l.id) !== n(b, l.id)).map((l) => `${l.word} ${fmt.int(n(b, l.id))} → ${fmt.int(n(h, l.id))}`)
  return `${m.model} under ${harness}, against baseline: ${moved.length ? moved.join(', ') : 'no label changed'}, of ${fmt.int(total(h))} runs each.`
}

function Rows({ m, pick, onPick, seen }) {
  const labels = mixLabels(m)
  return (
    <ol className={cx('rg-mix', seen && 'seen')} aria-label={`${m.model}: each harness's runs by label`}>
      {m.harnesses.map((h, i) => {
        const on = h.harness === pick
        const all = total(h)
        return (
          <li key={h.harness} style={{ '--rig-fig-i': i }}>
            <button type="button" className={cx('rg-mix-row', on && 'on')} data-el="fig-mix-row" aria-pressed={on} aria-disabled={on || undefined}
              data-hint={on ? `${h.harness} · shown` : `Compare ${h.harness} with baseline`} onClick={() => { if (!on) onPick(h.harness) }}>
              <span className="rg-mix-name">{h.harness}{h.harness === BASE && <span className="rg-mix-tag">the reference</span>}</span>
              <span className="rg-mix-bar" role="img" aria-label={`${h.harness}: ${labels.map((l) => `${n(h, l.id)} ${l.word}`).join(', ')} of ${all}`}>
                {labels.map((l) => (n(h, l.id) ? (
                  <i key={l.id} className={`fa-${l.tone}`} style={{ width: `${(n(h, l.id) / all) * 100}%` }}>
                    {n(h, l.id) / all >= 0.06 && <b>{n(h, l.id)}</b>}
                  </i>
                ) : null))}
              </span>
            </button>
          </li>
        )
      })}
    </ol>
  )
}

function LabelMix({ fig, n: num, d }) {
  const reveal = useReveal()
  const [tab, setTab] = useState(0)
  const [pick, setPick] = useState('reprompt')
  const m = d.models[tab]
  const shown = m.harnesses.some((h) => h.harness === pick) ? pick : BASE
  const labels = mixLabels(m)
  return (
    <FigureCard fig={fig} n={num} reveal={reveal}
      tabs={d.models.map((x, i) => [i, `${x.model} · ${x.harnesses.length} harnesses`])} tab={tab} onTab={setTab}
      legend={labels.map((l) => ({ label: l.word, tone: `fa-${l.tone}` }))}
      chart={<div><Rows m={m} pick={shown} onPick={setPick} seen={reveal.seen} />
        <p className="rg-lfig-axisname rg-mix-axis"><span>0</span><span>runs of each harness, {fmt.int(total(m.harnesses[0]))} in all</span><span>{fmt.int(total(m.harnesses[0]))}</span></p></div>}
      readout={mixSay(m, shown)}
      table={<FigTable caption={`Figure ${num} as a table: ${m.model}, runs by label`} cols={['Harness', ...labels.map((l) => l.word), 'runs']}
        rows={m.harnesses.map((h) => [h.harness, ...labels.map((l) => fmt.int(n(h, l.id))), fmt.int(total(h))])} />} />
  )
}

function Preview({ d }) {
  const m = d.models[0]
  const labels = mixLabels(m)
  return (
    <g>{m.harnesses.slice(0, 5).map((h, r) => {
      let x = 10
      return labels.map((l) => {
        const wd = (n(h, l.id) / total(h)) * 100
        const el = <rect key={`${r}${l.id}`} className={`rg-prev-fa-${l.tone}`} x={x} y={6 + r * 9.5} width={wd} height="7" />
        x += wd
        return el
      })
    })}</g>
  )
}

/** The numbers the article quotes, as this figure draws them. */
export function headlines(d) {
  const out = { runs: fmt.int(total(d.models[0].harnesses[0])) }
  d.models.forEach((m, j) => m.harnesses.forEach((h) => {
    const all = fmt.int(total(h))
    out[`cut_${j}_${h.harness}`] = fmt.int(n(h, 'cutoff_no_patch'))
    if (!n(h, 'cutoff_no_patch')) out[`cut_${j}_${h.harness}`] = `0 of ${all}`
    out[`passed_${j}_${h.harness}`] = `${fmt.int(n(h, 'passed'))} of ${all}`
  }))
  return out
}

export const KINDS = { label_mix: { Figure: LabelMix, Preview, headlines } }
