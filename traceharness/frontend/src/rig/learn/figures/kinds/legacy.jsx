/* Rig · learn/figures/kinds/legacy.jsx — the first eight figure kinds, drawn in the FigureCard.
   Their numbers are written in the article (`data`). They are HTML so they reflow to a phone; the line chart is
   the only SVG. Each chart also has its Table view. */
import { FigureCard, FigTable } from '../FigureCard'

const cx = (...a) => a.filter(Boolean).join(' ')
const num = (v) => Number(v).toLocaleString('en-US')

function StepFlow({ d }) {
  const boxes = [['Sent to the model', `${d.in1} tokens in`], ['Reply', `${d.out1} tokens out`], ['Tool call', d.tool, true], ['Next step sends', `${d.in2} tokens in`]]
  return (
    <>
      <ol className="rg-learn-flow">
        {boxes.map(([k, v, mono], i) => <li key={k} className={cx(i === 3 && 'acc')}><b>{k}</b><span className={cx(mono && 'rg-mono')}>{v}</span></li>)}
      </ol>
      <p className="rg-learn-fignote">The tool's output joins the conversation, so the next step sends it too.</p>
    </>
  )
}

function Bars({ d }) {
  const base = d.base ?? 0
  const top = Math.max(...d.values)
  return (
    <div className="rg-learn-bars" role="list" aria-label={d.axis}>
      <p className="rg-learn-axis">{d.axis}</p>
      {d.labels.map((l, i) => (
        <div key={l} role="listitem" className="rg-learn-bar">
          <span>{l}</span>
          <span className="rg-learn-track"><i style={{ width: `${Math.max(2, ((d.values[i] - base) / (top - base || 1)) * 100)}%` }} /></span>
          <span className="rg-mono">{d.values[i].toFixed(2)}×{d.notes && d.notes[i] ? <span className="rg-mute"> · {d.notes[i]}</span> : null}</span>
        </div>
      ))}
    </div>
  )
}

function Lines({ d }) {
  const top = Math.max(...d.series.flatMap((s) => s.values))
  const n = Math.max(...d.series.map((s) => s.values.length))
  const W = 600, H = 200
  const pts = (vs) => vs.map((v, i) => `${(i / Math.max(1, n - 1)) * W},${H - (v / top) * H}`).join(' ')
  return (
    <div className="rg-learn-lines">
      <p className="rg-learn-axis">{d.y} · up to {num(top)}</p>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={d.series.map((s) => `${s.name}: ${s.values.map(num).join(', ')}`).join('; ')}>
        <line x1="0" y1={H} x2={W} y2={H} className="base" />
        {d.series.map((s) => <polyline key={s.name} points={pts(s.values)} className={s.accent ? 'acc' : 'oth'} />)}
      </svg>
      <p className="rg-learn-axis rg-learn-axis-x"><span>{d.x} 1</span><span>{d.x} {n}</span></p>
      <ul className="rg-learn-legend">
        {d.series.map((s) => <li key={s.name}><i className={s.accent ? 'acc' : 'oth'} />{s.name}</li>)}
      </ul>
    </div>
  )
}

function Grid() {
  const rows = [['FAIL_TO_PASS', 'fails (bug present)', 'must pass'], ['PASS_TO_PASS', 'passes', 'must still pass']]
  return (
    <div className="rg-learn-grid" role="table" aria-label="What each test set must do">
      <div role="row" className="h"><span role="columnheader" /><span role="columnheader">before the patch</span><span role="columnheader">after the patch</span></div>
      {rows.map(([k, before, after]) => (
        <div role="row" key={k}><span role="rowheader" className="rg-mono">{k}</span><span role="cell">{before}</span><span role="cell" className="acc">{after}</span></div>
      ))}
    </div>
  )
}

const PART_TONES = ['pass', 'fail', 'amb', 'none']
function Stacked({ d }) {
  return (
    <div className="rg-learn-stacked">
      <ul className="rg-learn-legend">{d.labels.map((l, i) => <li key={l}><i className={PART_TONES[i]} />{l}</li>)}</ul>
      {d.rows.map((r) => (
        <div key={r.name} className="rg-learn-srow">
          <span className="rg-mono">{r.name}</span>
          <span className="rg-learn-sbar" role="img" aria-label={`${r.name}: ${r.parts.map((p, i) => `${p} ${d.labels[i]}`).join(', ')} of ${d.total}`}>
            {r.parts.map((p, i) => (p ? <i key={i} className={PART_TONES[i]} style={{ width: `${(p / d.total) * 100}%` }} /> : null))}
          </span>
          <span className="rg-learn-scount">{r.parts.map((p, i) => `${p} ${d.labels[i]}`).join(' · ')}</span>
        </div>
      ))}
    </div>
  )
}

function Paths({ d }) {
  return (
    <div className="rg-learn-paths">
      {d.runs.map((r) => {
        const last = r.path.length - 1
        return (
          <div key={r.name} className="rg-learn-prow">
            <b>{r.name}</b>
            <span className="rg-learn-letters" role="img" aria-label={`${r.name}: ${r.path.split('').join(' ')}, tests first passed at call ${r.first_pass + 1}`}>
              {r.path.split('').map((c, i) => <i key={i} className={cx(i === r.first_pass && 'first', i > r.first_pass && i < last && 'after')}>{c}</i>)}
            </span>
            <span className="rg-mono rg-mute">{r.tokens} tokens</span>
          </div>
        )
      })}
    </div>
  )
}

function Forest({ d }) {
  const lo = Math.min(0, ...d.rows.map((r) => r[2])), hi = Math.max(0, ...d.rows.map((r) => r[3]))
  const X = (v) => `${(((v - lo) / (hi - lo || 1)) * 100).toFixed(2)}%`
  const pts = (v) => `${v > 0 ? '+' : ''}${v.toFixed(1)}`
  return (
    <div className="rg-learn-forest">
      {d.rows.map(([name, pt, a, b]) => (
        <div key={name} className="rg-learn-frow">
          <span className="rg-mono">{name}</span>
          <span className="rg-cibar" role="img" aria-label={`${name}: ${pts(pt)} points, 95% interval ${a.toFixed(1)} to ${b.toFixed(1)}`}>
            <span className="z" style={{ left: X(0) }} />
            <span className="ci" style={{ left: X(a), width: `calc(${X(b)} - ${X(a)})` }} />
            <span className="pt" style={{ left: `calc(${X(pt)} - 1px)` }} />
          </span>
          <span className="rg-mono">{pts(pt)} <span className="rg-mute">({a.toFixed(1)} to {b.toFixed(1)})</span></span>
        </div>
      ))}
    </div>
  )
}

function Table({ d }) {
  return (
    <FigTable caption="Figure table" cols={['', ...d.cols]} rows={d.rows.map(([k, ...v]) => [k, ...v.map(num)])} />
  )
}

/* the Table view of each chart: the same numbers, one row each */
const TABLES = {
  bars: (d) => ({ cols: ['', d.axis, ...(d.notes ? ['note'] : [])], rows: d.labels.map((l, i) => [l, `${d.values[i].toFixed(2)}×`, ...(d.notes ? [d.notes[i]] : [])]) }),
  lines: (d) => ({ cols: [d.x, ...d.series.map((s) => s.name)], rows: [...Array(Math.max(...d.series.map((s) => s.values.length)))].map((_, i) => [String(i + 1), ...d.series.map((s) => (s.values[i] == null ? '—' : num(s.values[i])))]) }),
  stacked: (d) => ({ cols: ['', ...d.labels, 'of'], rows: d.rows.map((r) => [r.name, ...r.parts.map(String), String(d.total)]) }),
  forest: (d) => ({ cols: ['', 'points', '95% low', '95% high'], rows: d.rows.map(([name, pt, a, b]) => [name, pt.toFixed(1), a.toFixed(1), b.toFixed(1)]) }),
  paths: (d) => ({ cols: ['run', 'calls, in order', 'tests first passed at call', 'tokens'], rows: d.runs.map((r) => [r.name, r.path, String(r.first_pass + 1), String(r.tokens)]) }),
}

function legacy(kind, Draw) {
  return function LegacyFigure({ fig, n, d }) {
    const t = TABLES[kind] && TABLES[kind](d)
    return <FigureCard fig={fig} n={n} chart={<Draw d={d} />} table={t && <FigTable caption={`Figure ${n} as a table`} cols={t.cols} rows={t.rows} />} />
  }
}

/* small drawings for the Learn index: the shape of each kind */
const P = {
  step_flow: () => <g className="rg-prev-ink">{[8, 36, 64, 92].map((x, i) => <rect key={x} x={x} y="18" width="22" height="20" rx="3" className={i === 3 ? 'acc' : ''} />)}</g>,
  bars: ({ d }) => { const top = Math.max(...d.values); const b = d.base ?? 0; return <g className="rg-prev-ink">{d.values.map((v, i) => <rect key={i} x="10" y={8 + i * 11} width={Math.max(4, ((v - b) / (top - b || 1)) * 96)} height="7" rx="1.5" />)}</g> },
  lines: ({ d }) => { const top = Math.max(...d.series.flatMap((s) => s.values)); return <g className="rg-prev-line">{d.series.map((s) => <polyline key={s.name} className={s.accent ? 'acc' : 'oth'} points={s.values.map((v, i) => `${8 + (i / Math.max(1, s.values.length - 1)) * 104},${48 - (v / top) * 40}`).join(' ')} />)}</g> },
  grid: () => <g className="rg-prev-ink">{[0, 1].map((r) => [0, 1].map((c) => <rect key={`${r}${c}`} x={30 + c * 42} y={10 + r * 20} width="38" height="16" rx="2" className={c === 1 ? 'acc' : ''} />))}</g>,
  stacked: ({ d }) => <g>{d.rows.slice(0, 4).map((r, i) => { let x = 10; return r.parts.map((p, j) => { const w = (p / d.total) * 100; const el = <rect key={`${i}${j}`} x={x} y={8 + i * 11} width={w} height="7" className={`rg-prev-${PART_TONES[j]}`} />; x += w; return el }) })}</g>,
  paths: ({ d }) => <g className="rg-prev-ink">{d.runs.slice(0, 3).map((r, i) => r.path.split('').slice(0, 12).map((c, j) => <rect key={`${i}${j}`} x={8 + j * 9} y={10 + i * 14} width="7" height="10" rx="1.5" className={j > r.first_pass ? 'acc' : ''} />))}</g>,
  forest: ({ d }) => { const lo = Math.min(0, ...d.rows.map((r) => r[2])), hi = Math.max(0, ...d.rows.map((r) => r[3])); const X = (v) => 10 + ((v - lo) / (hi - lo || 1)) * 100; return <g className="rg-prev-ink"><line x1={X(0)} x2={X(0)} y1="4" y2="52" className="z" />{d.rows.slice(0, 4).map(([k, pt, a, b], i) => <g key={k}><line x1={X(a)} x2={X(b)} y1={10 + i * 12} y2={10 + i * 12} /><circle cx={X(pt)} cy={10 + i * 12} r="2.5" /></g>)}</g> },
  table: ({ d }) => <g className="rg-prev-ink">{[...Array(Math.min(4, d.rows.length + 1))].map((_, i) => <rect key={i} x="10" y={8 + i * 11} width="100" height="7" rx="1.5" className={i ? '' : 'acc'} />)}</g>,
}

const DRAW = { step_flow: StepFlow, bars: Bars, lines: Lines, grid: Grid, stacked: Stacked, paths: Paths, forest: Forest, table: Table }
export const KINDS = Object.fromEntries(Object.entries(DRAW).map(([k, Draw]) => [k, { Figure: legacy(k, Draw), Preview: P[k] }]))
