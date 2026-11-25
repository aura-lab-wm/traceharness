/* Rig · learn/figures/kinds/phase-band.jsx — where the fix falls in each run (article 06, figure 1). Every run of one
   task as a band of model calls, each coloured by its phase and lettered by its tool calls (the recorded path). A
   dashed line is the mark; the calls counted after it are hatched, the submit left out. Two marks: the fix (the last
   edit to a file of the final patch, as run pages mark it) and the first passing test run (the worked example's).
   Width: one block per model call, or blocks as wide as their tokens, since late calls re-read the longest
   conversation. The bands draw left to right once, then the mark and hatch fade in. Pressing a run says its numbers. */
import { useState } from 'react'
import { FigureCard, FigTable } from '../FigureCard'
import { fmt } from '../math'
import { useReveal, useWidth } from '../../motion'
import { cx, Seg, useSvgId, onKeyPress } from './figs-a-parts'
import './phase-band.css'

const ORDINAL = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth']
const MARKS = [['fix', 'the fix'], ['pass', 'first passing test']]
const WIDTHS = [['calls', 'one per model call'], ['tokens', 'by tokens']]
const BAND_H = 24
const runName = (r) => `Run ${r.repeat}`
export const pathOf = (r) => r.calls.map((c) => c.letters).join('')

/** The mark of a run and the calls counted after it (the submit left out). PURE. */
export function afterMark(run, mark) {
  const at = mark === 'fix' ? run.fix_call : run.first_pass_call
  if (at == null) return { at: null, calls: [], tools: 0, generated: 0 }
  const calls = run.calls.map((c, i) => ({ ...c, k: i + 1 })).filter((c) => c.k > at && !c.submit)
  return { at, calls, tools: calls.reduce((s, c) => s + c.letters.length, 0), generated: calls.reduce((s, c) => s + (c.generated || 0), 0) }
}
const working = (run) => run.calls.filter((c) => !c.submit).length
const editOrdinal = (run, at) => ORDINAL[run.calls.slice(0, at).reduce((s, c) => s + [...c.letters].filter((l) => l === 'E').length, 0) - 1] || 'last'

/** One run's numbers in words, for the mark shown. PURE. */
export function bandSay(run, mark) {
  const a = afterMark(run, mark)
  const n = run.calls.length
  const head = `${runName(run)} (${pathOf(run)}, ${fmt.int(run.tokens)} tokens)`
  if (mark === 'fix') {
    if (a.at == null) return `${head}: no fix was found.`
    const verb = a.calls.length === 1 ? 'comes' : 'come'
    return `${head}: the fix is its ${editOrdinal(run, a.at)} edit, at model call ${a.at} of ${n}. After it ${verb} ${a.calls.length} of its ${working(run)} working calls, the submit left out, with ${fmt.int(a.generated)} generated tokens.`
  }
  if (a.at == null) return `${head}: its tests never passed.`
  if (!a.tools) return `${head}: its tests first passed at model call ${a.at} of ${n}, and the next call was submit.`
  return `${head}: its tests first passed at model call ${a.at} of ${n}; ${a.tools} more tool calls (${a.calls.map((c) => c.letters).join('')}) came before submit.`
}
/** The note beside a band, in two short lines. */
const noteOf = (run, mark) => {
  const a = afterMark(run, mark)
  if (a.at == null) return [mark === 'fix' ? 'no fix' : 'never passed', '']
  return mark === 'fix' ? [`${a.calls.length} of ${working(run)} calls after`, `${fmt.int(a.generated)} generated`] : [`${a.tools} tool ${a.tools === 1 ? 'call' : 'calls'}`, 'after the pass']
}

function Bands({ d, mark, width, pick, onPick, w, seen }) {
  const clip = useSvgId('band-clip'), hatch = useSvgId('band-hatch')
  const wide = w >= 520
  const [labW, noteW] = wide ? [104, 132] : [0, 0]
  const rowH = wide ? 44 : 66
  const top = 4
  const bandW = w - labW - noteW - (wide ? 16 : 0)
  const x0 = labW + (wide ? 8 : 0)
  const max = Math.max(...d.runs.map((r) => (width === 'calls' ? r.calls.length : r.calls.reduce((s, c) => s + c.tokens, 0))))
  const unit = bandW / max
  const h = top + d.runs.length * rowH
  return (
    <svg className={cx('rg-band-svg', seen && 'seen')} viewBox={`0 0 ${w} ${h}`} width={w} height={h} role="group"
      aria-label={d.runs.map((r) => `${runName(r)}: ${pathOf(r)}, ${fmt.int(r.tokens)} tokens, ${noteOf(r, mark).join(' ')}`).join('; ')}>
      <defs>
        <clipPath id={clip}><rect className="rg-band-grow" x="0" y="0" width={w} height={h} /></clipPath>
        <pattern id={hatch} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line className="rg-band-hatchl" x1="0" y1="0" x2="0" y2="6" /></pattern>
      </defs>
      {d.runs.map((r, i) => {
        const y = top + i * rowH + (wide ? (rowH - BAND_H) / 2 - 2 : 20)
        const a = afterMark(r, mark)
        let x = x0
        const segs = r.calls.map((c, k) => {
          const sw = (width === 'calls' ? 1 : c.tokens) * unit
          const s = { ...c, k: k + 1, x, w: sw }
          x += sw
          return s
        })
        const markX = a.at == null ? null : segs[a.at - 1].x + segs[a.at - 1].w
        const on = r.repeat === pick
        const go = () => { if (!on) onPick(r.repeat) }
        return (
          <g key={r.run_id} className={cx('rg-band-run', on && 'on')} role="button" tabIndex={0} data-el="fig-band-run" data-run={r.repeat}
            aria-pressed={on} aria-disabled={on || undefined} data-hint={on ? `${runName(r)} · shown` : `Read ${runName(r)}`}
            aria-label={`${runName(r)}: ${pathOf(r)}. ${on ? 'Shown in the line below' : 'Press to read its numbers'}`}
            onClick={go} onKeyDown={onKeyPress(go)}>
            <rect className="hit" x="0" y={top + i * rowH} width={w} height={rowH - 2} rx="4" />
            {wide ? (
              <>
                <text className="lab" x="8" y={y + 10}>{runName(r)}</text>
                <text className="sub" x="8" y={y + 25}>{fmt.int(r.tokens)} tokens</text>
                <text className="note" x={w - 8} y={y + 10} textAnchor="end">{noteOf(r, mark)[0]}</text>
                <text className="note sub2" x={w - 8} y={y + 25} textAnchor="end">{noteOf(r, mark)[1]}</text>
              </>
            ) : (
              <>
                <text className="lab" x="4" y={y - 7}>{runName(r)} <tspan className="sub">· {fmt.int(r.tokens)} tokens</tspan></text>
                <text className="note" x="4" y={y + BAND_H + 18}>{noteOf(r, mark).filter(Boolean).join(' · ')}</text>
              </>
            )}
            <g clipPath={`url(#${clip})`}>
              {segs.map((s) => (
                <g key={s.k} className={cx('seg', `ph-${s.phase || 'other'}`, s.submit && 'submit')}>
                  <rect className="fill" x={s.x + 1} y={y} width={Math.max(1, s.w - 2)} height={BAND_H} rx="2" />
                  <rect className="cap" x={s.x + 1} y={y} width={Math.max(1, s.w - 2)} height="3" rx="1" />
                  {s.w >= s.letters.length * 8 + 4 && <text className="let" x={s.x + s.w / 2} y={y + 17} textAnchor="middle">{s.letters}</text>}
                </g>
              ))}
            </g>
            {a.calls.map((c) => <rect key={c.k} className="rg-band-after" x={segs[c.k - 1].x + 1} y={y} width={Math.max(1, segs[c.k - 1].w - 2)} height={BAND_H} rx="2" fill={`url(#${hatch})`} />)}
            {markX != null && <line className="rg-band-mark" x1={markX} x2={markX} y1={y - 4} y2={y + BAND_H + 4} />}
          </g>
        )
      })}
    </svg>
  )
}

function PhaseBand({ fig, n, d }) {
  const reveal = useReveal()
  const [boxRef, w] = useWidth(560)
  const [mark, setMark] = useState('fix')
  const [width, setWidth] = useState('calls')
  const [pick, setPick] = useState(2)
  const run = d.runs.find((r) => r.repeat === pick) || d.runs[0]
  const phases = [...new Set(d.runs.flatMap((r) => r.calls.map((c) => c.phase || 'other')))]
  return (
    <FigureCard fig={fig} n={n} reveal={reveal}
      legend={[...phases.map((p) => ({ label: p, tone: `fa-ph-${p}` })), { label: mark === 'fix' ? 'the fix' : 'first passing test', tone: 'fa-mark' }, { label: 'counted after it', tone: 'fa-hatch' }]}
      chart={<div ref={boxRef}><Bands d={d} mark={mark} width={width} pick={run.repeat} onPick={setPick} w={w} seen={reveal.seen} />
        <p className="rg-lfig-axisname">{width === 'calls' ? 'one block per model call' : 'each block as wide as the tokens of its call'} · letters: R read, E edit, T test, B bash, S submit · {d.task}, {d.model}</p></div>}
      controls={<><Seg label="Mark" options={MARKS} value={mark} onChange={setMark} el="fig-mark" /><Seg label="Width" options={WIDTHS} value={width} onChange={setWidth} el="fig-width" /></>}
      readout={bandSay(run, mark)}
      table={<FigTable caption={`Figure ${n} as a table`} cols={['run', 'calls, in order', 'tokens', 'model calls', 'the fix at model call', 'calls after the fix', 'generated after the fix', 'tests first passed at call', 'tool calls after the pass, before submit']}
        rows={d.runs.map((r) => {
          const f = afterMark(r, 'fix'), p = afterMark(r, 'pass')
          const tool = p.at == null ? '—' : `tool call ${r.calls.slice(0, p.at - 1).reduce((s, c) => s + c.letters.length, 0) + r.calls[p.at - 1].letters.indexOf('T') + 1} (model call ${p.at})`
          return [runName(r), pathOf(r), fmt.int(r.tokens), String(r.calls.length), f.at == null ? '—' : String(f.at), `${f.calls.length} of ${working(r)}`, fmt.int(f.generated), tool, String(p.tools)]
        })} />} />
  )
}

function Preview({ d }) {
  return (
    <g>{d.runs.map((r, i) => {
      const unit = 104 / Math.max(...d.runs.map((x) => x.calls.length))
      return r.calls.map((c, k) => <rect key={`${i}${k}`} className={`rg-prev-ph ph-${c.phase || 'other'}`} x={8 + k * unit} y={6 + i * 9.5} width={unit - 1.5} height="7" rx="1" />)
    })}</g>
  )
}

/** The numbers the article quotes, as this figure draws them. */
export function headlines(d) {
  const out = {}
  for (const r of d.runs) {
    const f = afterMark(r, 'fix'), p = afterMark(r, 'pass')
    out[`tokens_${r.repeat}`] = fmt.int(r.tokens)
    out[`path_${r.repeat}`] = pathOf(r)
    out[`after_fix_${r.repeat}`] = `${f.calls.length} of its ${working(r)}`
    out[`generated_after_${r.repeat}`] = fmt.int(f.generated)
    out[`after_pass_${r.repeat}`] = `${p.tools} more`
    out[`fix_call_${r.repeat}`] = `${f.at} of ${r.calls.length}`
  }
  return out
}

export const KINDS = { phase_band: { Figure: PhaseBand, Preview, headlines } }
