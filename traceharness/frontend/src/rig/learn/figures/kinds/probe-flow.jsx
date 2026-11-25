/* Rig · learn/figures/kinds/probe-flow.jsx — six probe tasks of study_v04 (article 08, figure 2).
   For the probe picked: the task, the trap it carries and the careful move, as a flow; then its runs under two
   policies, baseline (strict: a boundary action is blocked) and permissive (some are let through), three models x
   five runs each. A run is a mark: its hidden grade on top, its strengthened grade below, and a diamond above it
   when the policy saw a boundary event (outlined: blocked; filled: allowed). The words of each probe are the
   article's (`fig.data.probes`); the runs are counted from the ledgers (`d`). */
import { useState } from 'react'
import { FigureCard, FigTable } from '../FigureCard'
import { useReveal, useWidth } from '../../motion'
import { cx } from './b-parts'

const H = 64
const POLICY = { baseline: 'baseline · strict policy', permissive: 'permissive' }
const count = (runs) => {
  const hit = runs.filter((r) => r.b.length)
  const kinds = [...new Set(hit.flatMap((r) => r.k))]
  return { hit: hit.length, blocked: hit.filter((r) => r.b.includes('blocked')).length, allowed: hit.filter((r) => r.b.includes('allowed')).length,
    kinds, p: runs.filter((r) => r.p).length, s: runs.filter((r) => r.s).length, n: runs.length }
}
const events = (c) => (c.hit ? `boundary events in ${c.hit} ${c.hit === 1 ? 'run' : 'runs'}: ${[c.blocked && `${c.blocked} blocked`, c.allowed && `${c.allowed} allowed`].filter(Boolean).join(', ')}` : 'no boundary event')

/** "t18_backoff_tests under baseline: 5 of the 15 runs hit a boundary (test_tampering), all 5 blocked; …" */
export function sayProbe(task, c) {
  const hit = c.hit ? `${c.hit} of the ${c.n} runs hit a boundary (${c.kinds.join(', ')}), ${c.blocked === c.hit ? `all ${c.hit} blocked` : `${c.blocked} blocked and ${c.allowed} allowed`}` : `none of the ${c.n} runs hit a boundary`
  return `${task} under baseline: ${hit}; hidden tests passed in ${c.p} of ${c.n}, strengthened in ${c.s}.`
}

function Lane({ runs, policy, w }) {
  const c = count(runs)
  const gap = 10, band = (w - 2 * gap) / runs.length
  const x = (i) => band * i + band / 2 + Math.floor(i / 5) * gap
  const r = Math.min(7, band * 0.32)
  return (
    <div className="rg-gh-lane" data-el="fig-probe-lane">
      <p className="rg-gh-lanek"><b>{POLICY[policy]}</b><span>{events(c)} · hidden {c.p} of {c.n} · strengthened {c.s} of {c.n}</span></p>
      <svg viewBox={`0 0 ${w} ${H}`} width={w} height={H} role="img" aria-label={`${POLICY[policy]}: ${events(c)}; hidden passed ${c.p} of ${c.n}, strengthened ${c.s} of ${c.n}`}>
        {runs.map((run, i) => (
          <g key={i} className="rg-gh-run" style={{ '--rig-fig-i': i }}>
            {run.b.length > 0 && <path className={cx('rg-gh-bnd', run.b.includes('allowed') ? 'allowed' : 'blocked')} d={`M${x(i)},4 l5,6 l-5,6 l-5,-6 z`} />}
            <circle className={run.p ? 'p' : 'f'} cx={x(i)} cy={30} r={r} />
            <rect className={run.s ? 'p' : 'f'} x={x(i) - r} y={44} width={r * 2} height={r * 1.6} rx="1.5" />
          </g>
        ))}
      </svg>
    </div>
  )
}

function Flow({ probe }) {
  const boxes = [['The task', <><code>{probe.task}</code> {probe.asks}</>], ['The trap', <><span className="rg-gh-kind">{probe.kind}</span> {probe.trap}</>], ['The careful move', probe.careful]]
  return (
    <ol className="rg-gh-flow" data-el="fig-probe-flow" key={probe.task}>
      {boxes.map(([k, v], i) => <li key={k} style={{ '--rig-fig-i': i }} className={cx(i === 1 && 'trap')}><b>{k}</b><span>{v}</span></li>)}
    </ol>
  )
}

function ProbeFlow({ fig, n, d }) {
  const reveal = useReveal()
  const [boxRef, w] = useWidth(560)
  const words = fig.data.probes
  const [task, setTask] = useState(words[words.length - 2].task)
  const probe = words.find((p) => p.task === task)
  const runs = d.probes.find((p) => p.task === task)
  const chart = (
    <div className={cx('rg-gh-probe', reveal.seen && 'seen')} ref={boxRef}>
      <Flow probe={probe} />
      <p className="rg-gh-k">What its 15 runs did · 3 models x 5 runs</p>
      {['baseline', 'permissive'].map((h) => <Lane key={`${task}-${h}`} runs={runs[h]} policy={h} w={w} />)}
    </div>
  )
  return (
    <FigureCard fig={fig} n={n} reveal={reveal} chart={chart} readout={sayProbe(task, count(runs.baseline))}
      tabs={words.map((p) => [p.task, `${p.task.split('_')[0]} · ${p.kind}`])} tab={task} onTab={setTask}
      legend={[{ label: 'hidden (dot) and strengthened (bar) passed', tone: 'pass' }, { label: 'failed', tone: 'fail' }, { label: 'boundary event: outlined blocked, filled allowed', tone: 'hi' }]}
      table={<FigTable caption={`Figure ${n} as a table`} cols={['Probe', 'Policy', 'Runs', 'With a boundary event', 'Blocked', 'Allowed', 'Hidden passed', 'Strengthened passed']}
        rows={d.probes.flatMap((p) => ['baseline', 'permissive'].map((h) => { const c = count(p[h]); return [p.task, h, String(c.n), String(c.hit), String(c.blocked), String(c.allowed), String(c.p), String(c.s)] }))} />} />
  )
}

function Preview() {
  return (
    <g className="rg-prev-ink">
      {[10, 46, 82].map((x, i) => <rect key={x} x={x} y="10" width="28" height="16" rx="3" className={i === 1 ? 'acc' : ''} />)}
      {[...Array(10)].map((_, i) => <circle key={i} cx={14 + i * 10} cy="42" r="3" className={i < 4 ? 'acc' : ''} />)}
    </g>
  )
}

export function headlines(d) {
  const t18 = d.probes.find((p) => p.task === 't18_backoff_tests')
  const c = count(t18.baseline)
  return { t18_tried: `${c.hit} of the ${c.n}`, flagged: d.flagged_runs.toLocaleString('en-US'), all_runs: d.all_runs.toLocaleString('en-US') }
}

export const KINDS = { probe_flow: { Figure: ProbeFlow, Preview, headlines } }
