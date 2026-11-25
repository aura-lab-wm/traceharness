/* Rig · learn/figures/kinds/run-replay.jsx — one run replayed under two step caps (article 10, figure 2).
   The same task and repeat, run by one model under baseline (max_steps 20) and tight_budget (max_steps 6), as two
   lanes of model calls that advance together: each call is a cell in its phase colour, named by the tool it asked
   for, with the tokens so far under the lane. The tight lane meets a wall after its sixth call; when the replay
   passes it, the lane says it was cut off and how it was graded. Play goes through once (and once by itself when
   the figure first scrolls into view); Back / Next move one call at a time. */
import { useState } from 'react'
import { FigureCard, FigTable } from '../FigureCard'
import { useReveal, useWidth } from '../../motion'
import { StepControls, cx, int, useSteps } from './b-parts'

const H = 54
const SHORT = { read_file: 'read', edit_file: 'edit', write_file: 'write', run_tests: 'test', list_files: 'list', submit: 'submit', bash: 'bash' }
/** The tool's short name if it fits the cell (mono, about 7.2 px a character), else its first three letters. */
const fit = (tool, cell) => { const w = SHORT[tool] || tool; return (cell - 6) >= w.length * 7.2 ? w : w.slice(0, 3) }
/** Has this lane ended by call `at` (0-based)? A submitted run ends on its last call; a cut run on the call it was refused. */
export const ended = (lane, at) => (lane.exit_reason === 'max_steps' ? at >= lane.steps.length : at >= lane.steps.length - 1)
const graded = (lane) => `hidden tests ${lane.grade.hidden ? 'passed' : 'failed'}`
export const laneEnd = (lane) => (lane.exit_reason === 'max_steps' ? `cut off at max_steps ${lane.max_steps} · ${graded(lane)}` : `${lane.exit_reason} · ${graded(lane)}`)

function Lane({ lane, at, w, n }) {
  const cell = (w - 4) / n
  const shown = Math.min(at + 1, lane.steps.length)
  const tokens = lane.steps.slice(0, shown).reduce((s, x) => s + x.tokens_in + x.tokens_out, 0)
  const over = ended(lane, at)
  return (
    <div className={cx('rg-gh-rlane', over && 'over')} data-el="fig-lane">
      <p className="rg-gh-lanek"><b>{lane.harness}</b><span>max_steps {lane.max_steps} · {int(tokens)} tokens so far</span></p>
      <svg viewBox={`0 0 ${w} ${H}`} width={w} height={H} role="img"
        aria-label={`${lane.harness}: ${lane.steps.slice(0, shown).map((s, i) => `call ${i + 1} ${s.tool}`).join(', ')}`}>
        {[...Array(n)].map((_, i) => {
          const s = lane.steps[i]
          const x = 2 + i * cell
          if (!s) return null
          const state = i < at ? 'done' : i === at ? 'now' : 'todo'
          return (
            <g key={i} className={cx('rg-gh-rcell', state)}>
              <rect x={x + 2} y="6" width={cell - 4} height={H - 16} rx="4" style={{ '--gh-ph': `var(--rig-ph-${s.phase || 'other'})` }} />
              <text x={x + cell / 2} y={H / 2 + 2} textAnchor="middle">{fit(s.tool, cell)}</text>
              {s.tests_passed != null && <circle className={s.tests_passed ? 'p' : 'f'} cx={x + cell - 8} cy="12" r="3.5" />}
            </g>
          )
        })}
        {lane.max_steps < n + 1 && lane.exit_reason === 'max_steps' && (
          <g className="rg-gh-wall"><line x1={2 + lane.max_steps * cell} x2={2 + lane.max_steps * cell} y1="1" y2={H - 4} /></g>
        )}
      </svg>
      {over && <p className={cx('rg-gh-lend', lane.grade.hidden ? 'p' : 'f')} data-el="fig-lane-end">{laneEnd(lane)}</p>}
    </div>
  )
}

function RunReplay({ fig, n, d }) {
  const reveal = useReveal()
  const [boxRef, w] = useWidth(560)
  const [tab, setTabNow] = useState(0)
  const [moved, setMoved] = useState(false)   // a tab was pressed: nothing plays by itself again
  const setTab = (t) => { setMoved(true); setTabNow(t) }
  const pair = d.pairs[tab]
  const len = Math.max(...pair.lanes.map((l) => l.steps.length + (l.exit_reason === 'max_steps' ? 1 : 0)))
  const most = Math.max(...pair.lanes.map((l) => l.steps.length))
  return <Replay key={tab} {...{ fig, n, d, pair, tab, setTab, len, most, reveal, boxRef, w }} autoplay={!moved} />
}

function Replay({ fig, n, d, pair, tab, setTab, len, most, reveal, boxRef, w, autoplay }) {
  const steps = len   // every lane reaches its end: a cut lane needs the call after its last
  const [s, act] = useSteps(steps, reveal, { autoplay })
  const say = (lane) => {
    const x = lane.steps[s.at]
    if (x) return `${lane.harness} ${[SHORT[x.tool] || x.tool, x.arg].filter(Boolean).join(' ')}`
    return `${lane.harness} ${ended(lane, s.at) ? laneEnd(lane) : 'waiting'}`
  }
  const chart = (
    <div ref={boxRef} className="rg-gh-replay">
      {pair.lanes.map((l) => <Lane key={l.harness} lane={l} at={s.at} w={w} n={most} />)}
      <ol className="rg-gh-rx" style={{ gridTemplateColumns: `repeat(${most}, minmax(0, 1fr))` }} aria-label="Model calls">
        {[...Array(most)].map((_, i) => {
          const here = i === s.at
          return <li key={i}><button type="button" className={cx('rg-gh-rxb', here && 'on')} aria-current={here ? 'step' : undefined} aria-disabled={here || undefined}
            data-hint={here ? `Call ${i + 1} · shown` : `Show call ${i + 1}`} onClick={() => { if (!here) act({ type: 'go', at: i }) }}>{i + 1}</button></li>
        })}
      </ol>
    </div>
  )
  return (
    <FigureCard fig={fig} n={n} reveal={reveal} chart={chart}
      tabs={d.pairs.map((p, i) => [i, `${p.task} · Run ${p.run}`])} tab={tab} onTab={setTab}
      legend={[{ label: 'a call, in its phase colour', tone: 'in' }, { label: 'tests passed / failed in that call', tone: 'pass' }, { label: 'the step cap', tone: 'gh-ink' }]}
      controls={<StepControls s={s} act={act} pos={`Step ${s.at + 1} of ${steps}`} />}
      readout={`Step ${s.at + 1}: ${pair.lanes.map(say).join('; ')}.`}
      table={<FigTable tall caption={`Figure ${n} as a table`} cols={['Harness', 'Call', 'Tool', 'Phase', 'Tokens in', 'Tokens out']}
        rows={pair.lanes.flatMap((l) => [...l.steps.map((x, i) => [l.harness, String(i + 1), [x.tool, x.arg].filter(Boolean).join(' '), x.phase || '', int(x.tokens_in), int(x.tokens_out)]),
          [l.harness, 'end', laneEnd(l), '', '', int(l.total_tokens)]])} />} />
  )
}

function Preview({ d }) {
  const p = d.pairs[0]
  return (
    <g className="rg-prev-ink">
      {p.lanes.map((l, j) => l.steps.map((_, i) => <rect key={`${j}${i}`} x={8 + i * 13} y={12 + j * 18} width="11" height="12" rx="2" className={j ? '' : 'acc'} />))}
      <line x1={8 + 6 * 13 - 1} x2={8 + 6 * 13 - 1} y1="26" y2="46" />
    </g>
  )
}

export function headlines(d) {
  const out = {}
  d.pairs.forEach((p, i) => p.lanes.forEach((l, j) => { out[`steps_${i}_${j}`] = `${l.steps.length} steps` }))
  return out
}

export const KINDS = { run_replay: { Figure: RunReplay, Preview, headlines } }
