/* Rig · learn/figures/kinds/var-share.jsx — where the spread of passes and fails goes (article 14, figure 2).
   The Experiment page's two-factor fit, recomputed here from the pass counts of every model, harness and task: each
   part's sum of squares over the total, one bar per part. The model and harness parts are the factor colour; task
   and noise are grey. The tabs refit smaller designs (two close models, one model alone), and the bars move: a
   share describes the design that was run. */
import { useState } from 'react'
import { FigureCard, FigTable } from '../FigureCard'
import { fmt, linear } from '../math'
import { factorial } from '../stats'
import { useReveal, useWidth } from '../../motion'
import './var-share.css'

const cx = (...a) => a.filter(Boolean).join(' ')
const TERMS = ['model', 'harness', 'model x harness', 'task', 'condition x task', 'residual (repeats)']
const FACTOR = [true, true, true, false, false, false]
const NARROW = 460, ROW = 34, ROWN = 46, MAXS = 0.7

const designName = (d, g) => (g.models.length === d.models.length ? `All ${d.models.length} models`
  : g.models.length === 1 ? `${d.models[g.models[0]]} alone` : g.models.map((m) => d.models[m]).join(' and '))

function Bars({ share, w, seen }) {
  const narrow = w < NARROW
  const LW = narrow ? 4 : 150, VW = 56
  const x = linear([0, MAXS], [LW, w - VW])
  const RH = narrow ? ROWN : ROW
  const H = TERMS.length * RH + 24
  return (
    <svg className={cx('rg-vs-svg', seen && 'seen')} viewBox={`0 0 ${w} ${H}`} width={w} height={H} role="img"
      aria-label={TERMS.map((t, i) => `${t} ${fmt.pct1(share[i])}`).join(', ')}>
      {[0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7].map((v) => <g key={v}><line className="rg-lfig-grid" x1={x(v)} x2={x(v)} y1="0" y2={H - 22} /><text className="rg-lfig-tick" x={x(v)} y={H - 6} textAnchor="middle">{Math.round(v * 100)}%</text></g>)}
      {TERMS.map((t, i) => {
        const y = i * RH + (narrow ? 22 : 8)
        return (
          <g key={t} className={cx('rg-vs-bar', FACTOR[i] && 'factor')} style={{ '--rig-fig-i': i }}>
            <text className="rg-vs-name" x={narrow ? LW : LW - 10} y={narrow ? y - 6 : y + 13} textAnchor={narrow ? 'start' : 'end'}>{t}</text>
            <rect x="0" y={y} width="1" height="18" style={{ transform: `translateX(${x(0)}px) scaleX(${seen ? Math.max(0.5, x(share[i]) - x(0)) : 0.5})` }} />
            <text className="rg-lfig-val rg-vs-val" style={{ transform: `translateX(${x(seen ? share[i] : 0)}px)` }} x="6" y={y + 13}>{fmt.pct1(share[i])}</text>
          </g>
        )
      })}
    </svg>
  )
}

function VarShare({ fig, n, d }) {
  const reveal = useReveal()
  const [boxRef, w] = useWidth(560)
  const [tab, setTab] = useState(0)
  const g = d.designs[tab]
  const f = factorial(d.cells, g.models, d.runs)
  const big = f.share.indexOf(Math.max(...f.share))
  const single = g.models.length === 1
  return (
    <FigureCard fig={fig} n={n} reveal={reveal}
      tabs={d.designs.map((x, i) => [i, `${designName(d, x)} · ${fmt.int(x.runs)} runs`])} tab={tab} onTab={setTab}
      legend={[{ label: 'the model and harness parts', tone: 'at' }, { label: 'task and run-to-run parts', tone: 'all' }]}
      chart={<div ref={boxRef}><Bars share={f.share} w={w} seen={reveal.seen} /><p className="rg-lfig-axisname">each part's sum of squares over the total, {f.total.toFixed(1)}</p></div>}
      readout={`${designName(d, g)}, ${fmt.int(g.runs)} runs: model ${fmt.pct1(f.share[0])}${single ? ' (one model)' : ''}, harness ${fmt.pct1(f.share[1])}, model x harness ${fmt.pct1(f.share[2])}. The largest part is ${TERMS[big]}, ${fmt.pct1(f.share[big])}.`}
      table={<FigTable caption={`Figure ${n} as a table`} cols={['Part', 'Sum of squares', 'Share']}
        rows={[...TERMS.map((t, i) => [t, f.ss[i].toFixed(2), fmt.pct1(f.share[i])]), ['total', f.total.toFixed(1), '100%']]} />} />
  )
}

function Preview({ d }) {
  const g = d.designs[0]
  return <g className="rg-prev-ink">{g.share.map((s, i) => <rect key={i} x="10" y={5 + i * 8} width={Math.max(2, (s / MAXS) * 100)} height="5.5" rx="1.5" className={FACTOR[i] ? 'acc' : ''} />)}</g>
}

/** The numbers the article quotes, as this figure draws them. */
export function headlines(d) {
  const fit = (g) => factorial(d.cells, g.models, d.runs)
  const all = fit(d.designs[0])
  const strong = fit(d.designs.find((g) => g.models.length === 2))
  const alone = fit(d.designs.find((g) => g.models.length === 1))
  return {
    model: fmt.pct1(all.share[0]), harness: fmt.pct1(all.share[1]), inter: fmt.pct1(all.share[2]), task: fmt.pct1(all.share[3]),
    cxt: fmt.pct1(all.share[4]), resid: fmt.pct1(all.share[5]), total: all.total.toFixed(1),
    strong_model: fmt.pct1(strong.share[0]), alone_harness: fmt.pct1(alone.share[1]),
  }
}

export const KINDS = { var_share: { Figure: VarShare, Preview, headlines } }
