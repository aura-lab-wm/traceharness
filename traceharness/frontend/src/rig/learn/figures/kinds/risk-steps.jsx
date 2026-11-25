/* Rig · learn/figures/kinds/risk-steps.jsx — Sentinel's risk over the steps of two runs (article 11, figure 1).
   Two runs of one task by one model under one harness: one failed, one passed. Before each step Sentinel's risk
   model, trained without this task, scores the run so far. A line per run is drawn step by step (Play, Back, Next),
   a threshold line the reader moves, and a ring where each run is first warned. Steps not reached yet are a faint
   dashed outline, so the whole run shows before Play. Beside the chart (under it on a
   phone): what each run did at the step, its risk and the features that moved the risk most. */
import { useEffect, useReducer, useRef, useState } from 'react'
import { FigureCard, FigTable } from '../FigureCard'
import { Icon } from '../../../ui'
import { stepper, START } from '../stepper'
import { linear } from '../math'
import { firstOver } from '../stats'
import { tokenMs, useReveal, useWidth } from '../../motion'
import './risk-steps.css'

const cx = (...a) => a.filter(Boolean).join(' ')
const PauseIcon = () => <svg className="rg-ico" width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14M16 5v14" /></svg>
const H = 250, L = 40, R = 64, T = 22, B = 30
const NAME = ['the run that failed', 'the run that passed']
const TONE = ['fail', 'pass']
const WORDS = {
  n_reads: 'files read so far', repeat_calls: 'repeated calls', token_frac: 'share of the token budget used',
  steps_without_edit: 'steps without an edit', last_test_failed: 'the last test run failed', n_tests: 'test runs so far',
  consecutive_failed_tests: 'failed test runs in a row', no_action: 'a reply with no tool call', n_edits: 'edits so far',
  step_frac: 'share of the step budget used', edited_since_last_test: 'an edit since the last test run', no_test_yet: 'no test run yet',
}
const EXIT = { no_action: 'it answered with no tool call, and the run stopped', submitted: 'it submitted', max_steps: 'it ran out of steps' }
const feature = (f) => WORDS[f] || f.replace(/_/g, ' ')
const t2 = (v) => v.toFixed(2)
const signed = (v) => `${v > 0 ? '+' : '−'}${Math.abs(v).toFixed(2)}`
const warnWords = (n) => (n ? `warned at step ${n}` : 'never warned')

function Chart({ d, at, thr, w, seen }) {
  const steps = Math.max(...d.runs.map((r) => r.steps.length))
  const x = linear([1, steps], [L, w - R])
  const y = linear([0, 1], [H - B, T])
  return (
    <svg className={cx('rg-risk-svg', seen && 'seen')} viewBox={`0 0 ${w} ${H}`} width={w} height={H} role="img"
      aria-label={d.runs.map((r, i) => `${NAME[i]}: ${r.steps.map((s) => `step ${s.n} ${s.risk.toFixed(3)}`).join(', ')}`).join('; ')}>
      {[0, 0.25, 0.5, 0.75, 1].map((v) => <g key={v}><line className="rg-lfig-grid" x1={L} x2={w - R} y1={y(v)} y2={y(v)} /><text className="rg-lfig-tick" x={L - 6} y={y(v) + 4} textAnchor="end">{v.toFixed(2)}</text></g>)}
      {[...Array(steps)].map((_, i) => <text key={i} className={cx('rg-lfig-tick', i === at && 'rg-risk-on')} x={x(i + 1)} y={H - 10} textAnchor="middle">{i + 1}</text>)}
      <line className="rg-risk-now" x1={x(at + 1)} x2={x(at + 1)} y1={T - 8} y2={H - B} />
      <g className="rg-risk-thr" style={{ transform: `translateY(${y(thr)}px)` }} data-el="fig-thr-line">
        <line x1={L} x2={w - R} y1="0" y2="0" />
        <text x={w - R + 6} y="4">{t2(thr)}</text>
      </g>
      {d.runs.map((r, i) => {
        const shown = r.steps.slice(0, at + 1)
        const warn = firstOver(r.steps, thr)
        const last = shown[shown.length - 1]
        return (
          <g key={r.run_id} className={cx('rg-risk-run', TONE[i])}>
            <polyline className="rg-risk-ghost" points={r.steps.map((x0) => `${x(x0.n)},${y(x0.risk)}`).join(' ')} />
            {shown.slice(1).map((s, k) => <line key={s.n} className="rg-risk-seg" pathLength="1" x1={x(shown[k].n)} y1={y(shown[k].risk)} x2={x(s.n)} y2={y(s.risk)} />)}
            {shown.map((s) => <circle key={s.n} className={cx('rg-risk-pt', s.n === at + 1 && 'now')} cx={x(s.n)} cy={y(s.risk)} r={s.n === at + 1 ? 5 : 3.5} />)}
            {warn && warn <= at + 1 && (
              <g className="rg-risk-warn" data-el="fig-warn">
                <circle cx={x(warn)} cy={y(r.steps[warn - 1].risk)} r="9" />
                <text x={x(warn) - 12} y={y(r.steps[warn - 1].risk) + (i ? 18 : -10)} textAnchor="end">warned</text>
              </g>
            )}
            {at + 1 > r.steps.length && <text className="rg-risk-end" x={x(last.n) + 8} y={y(last.risk) - 8}>stopped</text>}
          </g>
        )
      })}
    </svg>
  )
}

function RunAt({ run, i, at, thr }) {
  const s = run.steps[at]
  const head = <p className="rg-risk-who"><i className={cx('rg-lfig-sw', TONE[i])} aria-hidden="true" /><b>{i ? 'Passed run' : 'Failed run'}</b> <span>repeat {run.repeat}</span></p>
  if (!s) return <div className="rg-risk-at" data-el="fig-risk-run">{head}<p>Ended after step {run.steps.length}: {EXIT[run.exit] || run.exit}.</p></div>
  const over = s.risk >= thr - 1e-9
  const up = s.top.filter(([, c]) => c > 0), down = s.top.filter(([, c]) => c < 0)
  return (
    <div className="rg-risk-at" data-el="fig-risk-run">
      {head}
      <p>Risk before the step: <b className="rg-risk-num">{s.risk.toFixed(3)}</b> <span className={cx('rg-risk-chip', over && 'over')}>{over ? `over ${t2(thr)}: warned` : `under ${t2(thr)}`}</span></p>
      <p>Then: {s.tool ? <code className="rg-learn-code">{s.tool}</code> : 'no tool call'}{s.tests != null && <span className={cx('rg-steps-chip', s.tests ? 'p' : 'f')}>{s.tests ? 'tests passed' : 'tests failed'}</span>}</p>
      {s.patterns.length > 0 && <p>Detector: {s.patterns.join('; ')}</p>}
      <p className="rg-risk-why">{up.length > 0 && <>Raised by {up.map(([f, c]) => `${feature(f)} (${signed(c)})`).join(', ')}. </>}{down.length > 0 && <>Lowered by {down.map(([f, c]) => `${feature(f)} (${signed(c)})`).join(', ')}.</>}</p>
    </div>
  )
}

function RiskSteps({ fig, n, d }) {
  const reveal = useReveal()
  const [boxRef, w] = useWidth(360)
  const steps = Math.max(...d.runs.map((r) => r.steps.length))
  const [s, act] = useReducer(stepper, steps, START)
  const [thr, setThr] = useState(d.threshold)
  const played = useRef(false)
  // the first time the figure scrolls into view (motion allowed), it plays through once
  useEffect(() => { if (reveal.scrolled && !played.current) { played.current = true; act({ type: 'play' }) } }, [reveal.scrolled])
  useEffect(() => {
    if (!s.playing) return undefined
    const t = setTimeout(() => act({ type: 'tick' }), tokenMs(reveal.ref.current, '--rig-dur-pulse', 1200))
    return () => clearTimeout(t)
  }, [s.playing, s.at, reveal.ref])
  const last = steps - 1
  const controls = (
    <>
      <div className="rg-steps-ctl" data-el="fig-stepper">
        <button type="button" className="rg-btn rg-lfig-play" data-el="fig-play" onClick={() => act({ type: s.playing ? 'pause' : 'play' })}>
          {s.playing ? <PauseIcon /> : <Icon name="play" size={14} />}{s.playing ? 'Pause' : s.at === last ? 'Play again' : 'Play'}</button>
        <button type="button" className="rg-btn" data-el="fig-back" aria-disabled={s.at === 0 || undefined} data-hint={s.at === 0 ? 'This is the first step' : undefined}
          onClick={() => { if (s.at > 0) act({ type: 'back' }) }}>Back</button>
        <button type="button" className="rg-btn" data-el="fig-next" aria-disabled={s.at === last || undefined} data-hint={s.at === last ? 'This is the last step' : undefined}
          onClick={() => { if (s.at < last) act({ type: 'next' }) }}>Next step</button>
        <span className="rg-steps-pos" data-el="fig-step-pos">Step {s.at + 1} of {steps}</span>
      </div>
      <label className="rg-lfig-slider" data-el="fig-thr">
        <span>Threshold</span>
        <input type="range" min="0.3" max="0.95" step="0.05" value={thr} onChange={(e) => setThr(Number(e.target.value))} aria-valuetext={`threshold ${t2(thr)}`} />
        <output>{t2(thr)}</output>
      </label>
    </>
  )
  const aside = (
    <div className="rg-risk-detail" data-el="fig-risk-detail" key={s.at}>
      <p className="rg-steps-k">Step {s.at + 1} of {steps}</p>
      {d.runs.map((r, i) => <RunAt key={r.run_id} run={r} i={i} at={s.at} thr={thr} />)}
    </div>
  )
  return (
    <FigureCard fig={fig} n={n} reveal={reveal} aside={aside} controls={controls}
      legend={[{ label: `failed run (repeat ${d.runs[0].repeat})`, tone: 'fail' }, { label: `passed run (repeat ${d.runs[1].repeat})`, tone: 'pass' }, { label: 'threshold: warn at or over it', tone: 'thr' }]}
      chart={<div ref={boxRef}><Chart d={d} at={s.at} thr={thr} w={w} seen={reveal.seen} /><p className="rg-lfig-axisname">step of the run · risk of ending badly, scored before the step runs</p></div>}
      readout={`Threshold ${t2(thr)}: ${d.runs.map((r, i) => `${NAME[i]} is ${warnWords(firstOver(r.steps, thr))}`).join('; ')}.`}
      table={<FigTable caption={`Figure ${n} as a table`} cols={['Step', 'Failed run: then', 'Risk', 'Passed run: then', 'Risk']}
        rows={[...Array(steps)].map((_, k) => [String(k + 1), ...d.runs.flatMap((r) => { const x = r.steps[k]; return x ? [x.tool || 'no tool call', x.risk.toFixed(3)] : ['ended', '—'] })])} />} />
  )
}

function Preview({ d }) {
  const steps = Math.max(...d.runs.map((r) => r.steps.length))
  const X = (k) => 10 + ((k - 1) / (steps - 1)) * 100, Y = (v) => 50 - v * 42
  return (
    <g className="rg-prev-line">
      <line className="rg-prev-thr" x1="10" x2="110" y1={Y(d.threshold)} y2={Y(d.threshold)} />
      {d.runs.map((r, i) => <polyline key={r.run_id} className={i ? 'acc' : 'oth'} points={r.steps.map((s) => `${X(s.n)},${Y(s.risk)}`).join(' ')} />)}
    </g>
  )
}

/** The numbers the article quotes, as this figure draws them. */
export function headlines(d) {
  const [fail, pass] = d.runs
  const split = fail.steps.findIndex((s, i) => !pass.steps[i] || s.risk !== pass.steps[i].risk)
  return {
    fail_4: t2(fail.steps[split].risk), pass_4: t2(pass.steps[split].risk), pass_end: t2(pass.steps[pass.steps.length - 1].risk),
    thr: String(d.threshold), first_test: `step ${fail.steps.find((s) => s.tests === false).n}`,
  }
}

export const KINDS = { risk_steps: { Figure: RiskSteps, Preview, headlines } }
