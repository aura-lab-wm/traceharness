/* Rig · learn/figures/kinds/after-hist.jsx — the work runs did after a mark, run by run (article 06, figure 2). Bars:
   how many baseline runs of each of the two models the articles name made 0, 1, 2, 3 or 4+ calls after it, side by
   side. Two marks, as in figure 1: the first passing test run (tool calls after it, before submit, over the runs that
   had one) and the fix (model calls after it, the submit left out, over the runs that passed). The bars rise once. */
import { useState } from 'react'
import { FigureCard, FigTable } from '../FigureCard'
import { fmt, linear, ticks } from '../math'
import { useReveal, useWidth } from '../../motion'
import { cx, Seg } from './figs-a-parts'
import './after-hist.css'

const MARKS = [['pass', 'first passing test'], ['fix', 'the fix']]
const BINS = ['0', '1', '2', '3', '4+']
const H = 220, L = 40, R = 8, T = 22, B = 30

/** The runs a mark counts and their calls after it, binned 0, 1, 2, 3, 4+. PURE. */
export function afterStats(m, mark) {
  const vals = m.runs.filter(([passed, ap, af]) => (mark === 'pass' ? ap != null : passed && af != null)).map(([, ap, af]) => (mark === 'pass' ? ap : af))
  const bins = BINS.map((_, i) => vals.filter((v) => (i === 4 ? v >= 4 : v === i)).length)
  return { of: m.runs.length, runs: vals.length, more: vals.filter((v) => v > 0).length, one: bins[1], zero: bins[0], calls: vals.reduce((s, v) => s + v, 0), bins }
}

const passWords = (m) => {
  const s = afterStats(m, 'pass')
  return s.more ? `${m.model}, ${s.more} of ${s.runs} runs with one made more tool calls (${s.calls} in all)` : `${m.model}, 0 of ${s.runs}: the next call was always submit`
}
const fixWords = (m) => {
  const s = afterStats(m, 'fix')
  return `${m.model}, exactly 1 in ${s.one === s.runs ? `all ${s.runs}` : `${s.one} of ${s.runs}`}${s.zero ? `, none in ${s.zero}` : ''}`
}
/** The readout: both models after the mark shown. PURE. */
export function afterSay(d, mark) {
  if (mark === 'pass') return `After the first passing test: ${d.models.map(passWords).join('; ')}.`
  const none = d.models.reduce((s, m) => s + afterStats(m, 'fix').zero, 0)
  return `After the fix, ${none ? `${none} passing runs made no model call` : 'every passing run made at least one model call'}: ${d.models.map(fixWords).join('; ')}.`
}

function Chart({ d, mark, w, seen }) {
  const stats = d.models.map((m) => afterStats(m, mark))
  const top = Math.max(1, ...stats.flatMap((s) => s.bins))
  const tk = ticks(0, top, 4)
  const y = linear([0, tk[tk.length - 1]], [H - B, T])
  const band = (w - L - R) / BINS.length
  const bw = Math.min(30, (band * 0.7) / stats.length)
  return (
    <svg className={cx('rg-ahist-svg', seen && 'seen')} viewBox={`0 0 ${w} ${H}`} width={w} height={H} role="img"
      aria-label={d.models.map((m, j) => `${m.model}: ${BINS.map((b, i) => `${b}: ${stats[j].bins[i]}`).join(', ')}`).join('; ')}>
      {tk.map((v) => <g key={v}><line className="rg-lfig-grid" x1={L} x2={w - R} y1={y(v)} y2={y(v)} /><text className="rg-lfig-tick" x={L - 6} y={y(v) + 4} textAnchor="end">{v}</text></g>)}
      {BINS.map((b, i) => {
        const x0 = L + band * i + (band - bw * stats.length) / 2
        return (
          <g key={b}>
            {stats.map((s, j) => (
              <g key={j} className={cx('rg-ahist-bar', `m${j}`)} style={{ '--rig-fig-i': i * 2 + j }}>
                <rect className="rg-bar-grow" x={x0 + j * bw + 1} y={y(s.bins[i])} width={bw - 2} height={Math.max(0, H - B - y(s.bins[i]))} rx="2" />
                <text className="rg-lfig-val" x={x0 + j * bw + bw / 2} y={y(s.bins[i]) - 6} textAnchor="middle">{s.bins[i]}</text>
              </g>
            ))}
            <text className="rg-lfig-tick" x={L + band * i + band / 2} y={H - 10} textAnchor="middle">{b}</text>
          </g>
        )
      })}
      <line className="rg-lfig-axis" x1={L} x2={w - R} y1={H - B} y2={H - B} />
      <text className="rg-lfig-tick" x={L} y="12">runs</text>
    </svg>
  )
}

function AfterHist({ fig, n, d }) {
  const reveal = useReveal()
  const [boxRef, w] = useWidth(560)
  const [mark, setMark] = useState('pass')
  const cols = d.models.flatMap((x) => MARKS.map(([k, words]) => [x, k, `${x.model} · after ${words}`]))
  return (
    <FigureCard fig={fig} n={n} reveal={reveal}
      legend={d.models.map((m, j) => ({ label: `${m.model} · ${afterStats(m, mark).runs} ${mark === 'pass' ? 'runs with a passing test' : 'passing runs'}`, tone: `fa-m${j}`, brand: m.model }))}
      chart={<div ref={boxRef}><Chart d={d} mark={mark} w={w} seen={reveal.seen} />
        <p className="rg-lfig-axisname">{mark === 'pass' ? 'tool calls after the first passing test run, before submit' : 'model calls after the fix, the submit left out'}</p></div>}
      controls={<Seg label="Mark" options={MARKS} value={mark} onChange={setMark} el="fig-mark" />}
      readout={afterSay(d, mark)}
      table={<FigTable caption={`Figure ${n} as a table: runs by calls after each mark`} cols={['calls after the mark', ...cols.map((c) => c[2])]}
        rows={[...BINS.map((b, i) => [b, ...cols.map(([x, k]) => String(afterStats(x, k).bins[i]))]),
          ['runs counted', ...cols.map(([x, k]) => String(afterStats(x, k).runs))],
          ['calls in all', ...cols.map(([x, k]) => fmt.int(afterStats(x, k).calls))]]} />} />
  )
}

function Preview({ d }) {
  const s = afterStats(d.models[1], 'pass')
  const top = Math.max(...s.bins)
  return <g className="rg-prev-ink">{s.bins.map((v, i) => <rect key={i} x={12 + i * 21} y={50 - (v / top) * 42} width="15" height={Math.max(1, (v / top) * 42)} rx="1.5" className={i ? 'acc' : ''} />)}</g>
}

/** The numbers the article quotes, as this figure draws them. */
export function headlines(d) {
  const out = {}
  d.models.forEach((m, j) => {
    const p = afterStats(m, 'pass'), f = afterStats(m, 'fix')
    out[`with_pass_${j}`] = `${p.runs} of ${p.of}`
    out[`pass_n_${j}`] = String(p.runs)
    out[`more_${j}`] = `${p.more} of those ${p.runs}`
    out[`calls_${j}`] = String(p.calls)
    out[`fix_one_${j}`] = String(f.one)
    out[`fix_n_${j}`] = String(f.runs)
  })
  return out
}

export const KINDS = { after_hist: { Figure: AfterHist, Preview, headlines } }
