/* Rig · learn/figures/kinds/run-steps.jsx — one real run, one model call at a time (article 01, figure 1).
   Each step is a bar of the tokens its request sent: the part re-sent from the step before (that request and its
   reply) and the part new this step (mostly the last tool's output), with the reply's tokens on top. A step not
   reached yet is an outline. Play goes through the steps once; Back / Next and the step names move one at a time.
   Beside the bars (under them on a phone): what the step sent, what the model replied and the tool it called. */
import { useEffect, useReducer, useRef } from 'react'
import { FigureCard, FigTable } from '../FigureCard'
import { Icon } from '../../../ui'
import { stepper, START } from '../stepper'
import { fmt, linear } from '../math'
import { tokenMs, useReveal, useWidth } from '../../motion'

const cx = (...a) => a.filter(Boolean).join(' ')
const PauseIcon = () => <svg className="rg-ico" width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14M16 5v14" /></svg>
const H = 230, TOP = 24, BASE = H - 6
/** How a request splits: what the step before sent and got back (re-sent), and what is new. */
export function splitIn(steps, i) {
  const s = steps[i]
  if (i === 0) return { resent: 0, fresh: s.tokens_in }
  const before = steps[i - 1].tokens_in + steps[i - 1].tokens_out
  const resent = Math.min(before, s.tokens_in)
  return { resent, fresh: s.tokens_in - resent }
}

function Bars({ steps, at, w }) {
  const max = Math.max(...steps.map((s) => s.tokens_in + s.tokens_out))
  const y = linear([0, max], [BASE, TOP])
  const band = w / steps.length
  const bw = Math.min(56, band * 0.46)
  const h = (v) => BASE - y(v)
  return (
    <svg className="rg-steps-svg" viewBox={`0 0 ${w} ${H}`} width={w} height={H} role="img"
      aria-label={steps.map((s) => `Step ${s.n}: ${fmt.int(s.tokens_in)} tokens in, ${fmt.int(s.tokens_out)} out`).join('; ')}>
      <line x1="0" x2={w} y1={BASE} y2={BASE} className="rg-lfig-axis" />
      {steps.map((s, i) => {
        const x = band * i + (band - bw) / 2
        const { resent, fresh } = splitIn(steps, i)
        const state = i < at ? 'done' : i === at ? 'now' : 'todo'
        return (
          <g key={s.n} className={cx('rg-steps-bar', state)}>
            <rect className="frame" x={x} y={y(s.tokens_in + s.tokens_out)} width={bw} height={h(s.tokens_in + s.tokens_out)} rx="2" />
            <g className="fill">
              <rect className="resent" x={x} y={y(resent)} width={bw} height={h(resent)} />
              <rect className="fresh" x={x} y={y(resent + fresh)} width={bw} height={h(fresh)} />
              <rect className="out" x={x} y={y(s.tokens_in + s.tokens_out)} width={bw} height={h(s.tokens_out)} />
            </g>
            <text className="rg-lfig-val" x={x + bw / 2} y={y(s.tokens_in + s.tokens_out) - 6} textAnchor="middle">{fmt.int(s.tokens_in)}</text>
          </g>
        )
      })}
      {at < steps.length - 1 && (() => {
        const x0 = band * at + band / 2 + bw / 2, x1 = band * (at + 1) + (band - bw) / 2
        const y0 = y(steps[at].tokens_in + steps[at].tokens_out) + 4, y1 = y(splitIn(steps, at + 1).resent) + 4
        return <path key={at} className="rg-steps-carry" d={`M${x0},${y0} C${(x0 + x1) / 2},${Math.min(y0, y1) - 18} ${(x0 + x1) / 2},${Math.min(y0, y1) - 18} ${x1 - 3},${y1}`} markerEnd="url(#rg-steps-arrow)" />
      })()}
      <defs><marker id="rg-steps-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L8,4 L0,8 z" className="rg-steps-head" /></marker></defs>
    </svg>
  )
}

function Detail({ d, at }) {
  const s = d.steps[at]
  const { resent, fresh } = splitIn(d.steps, at)
  const last = at === d.steps.length - 1
  return (
    <div className="rg-steps-detail" key={at} data-el="fig-step-detail">
      <p className="rg-steps-k">Step {s.n} of {d.steps.length} <span className="rg-lfig-phase"><i style={{ background: `var(--rig-ph-${s.phase})` }} aria-hidden="true" />{s.phase}</span></p>
      <dl>
        <dt>Sent to the model</dt>
        <dd><b>{fmt.int(s.tokens_in)} tokens in</b>{at === 0 ? ': the system prompt and the issue.' : `: about ${fmt.int(resent)} re-sent from step ${s.n - 1} and ${fmt.int(fresh)} new.`}</dd>
        <dt>Reply</dt>
        <dd><b>{fmt.int(s.tokens_out)} tokens out</b>, finish reason <code className="rg-learn-code">{s.finish}</code><q className="rg-steps-q">{s.reply}</q></dd>
        <dt>Tool call</dt>
        <dd><code className="rg-learn-code">{[s.tool, s.arg].filter(Boolean).join(' ')}</code>{s.tests_passed != null && <span className={cx('rg-steps-chip', s.tests_passed ? 'p' : 'f')}>{s.tests_passed ? 'tests passed' : 'tests failed'}</span>}
          <span className="rg-steps-out">{s.result}</span></dd>
      </dl>
      {last && (
        <p className="rg-steps-end" data-el="fig-step-end">Graded: {['visible', 'hidden', 'strong'].map((k) => `${k === 'strong' ? 'strengthened' : k} ${d.grade[k] ? 'passed' : 'failed'}`).join(', ')}. Ended: {d.exit_reason}. {fmt.int(d.total_tokens)} tokens in all.</p>
      )}
    </div>
  )
}

function RunSteps({ fig, n, d }) {
  const reveal = useReveal()
  const [boxRef, w] = useWidth(360)
  const [s, act] = useReducer(stepper, d.steps.length, START)
  const played = useRef(false)
  // the first time the figure scrolls into view (motion allowed), it plays through once
  useEffect(() => { if (reveal.scrolled && !played.current) { played.current = true; act({ type: 'play' }) } }, [reveal.scrolled])
  useEffect(() => {
    if (!s.playing) return undefined
    const t = setTimeout(() => act({ type: 'tick' }), tokenMs(reveal.ref.current, '--rig-dur-pulse', 1200) * 2)
    return () => clearTimeout(t)
  }, [s.playing, s.at, reveal.ref])
  const cur = d.steps[s.at]
  const last = d.steps.length - 1
  const controls = (
    <div className="rg-steps-ctl" data-el="fig-stepper">
      <button type="button" className="rg-btn rg-lfig-play" data-el="fig-play" onClick={() => act({ type: s.playing ? 'pause' : 'play' })}>
        {s.playing ? <PauseIcon /> : <Icon name="play" size={14} />}{s.playing ? 'Pause' : s.at === last ? 'Play again' : 'Play'}</button>
      <button type="button" className="rg-btn" data-el="fig-back" aria-disabled={s.at === 0 || undefined} data-hint={s.at === 0 ? 'This is the first step' : undefined}
        onClick={() => { if (s.at > 0) act({ type: 'back' }) }}>Back</button>
      <button type="button" className="rg-btn" data-el="fig-next" aria-disabled={s.at === last || undefined} data-hint={s.at === last ? 'This is the last step' : undefined}
        onClick={() => { if (s.at < last) act({ type: 'next' }) }}>Next step</button>
      <span className="rg-steps-pos" data-el="fig-step-pos">Step {s.at + 1} of {d.steps.length}</span>
    </div>
  )
  const chart = (
    <div ref={boxRef} className="rg-steps-chart">
      <Bars steps={d.steps} at={s.at} w={w} />
      <ol className="rg-steps-x" style={{ gridTemplateColumns: `repeat(${d.steps.length}, minmax(0, 1fr))` }}>
        {d.steps.map((x, i) => {
          const here = i === s.at
          return (
            <li key={x.n}><button type="button" className={cx('rg-steps-name', here && 'on')} aria-current={here ? 'step' : undefined} aria-disabled={here || undefined}
              data-hint={here ? `Step ${x.n} · shown` : `Show step ${x.n}`} onClick={() => { if (!here) act({ type: 'go', at: i }) }}>
              <b>{x.n}</b><span>{x.tool}</span></button></li>
          )
        })}
      </ol>
    </div>
  )
  return (
    <FigureCard fig={fig} n={n} reveal={reveal} chart={chart} aside={<Detail d={d} at={s.at} />} controls={controls}
      legend={[{ label: 're-sent from the step before', tone: 'resent' }, { label: 'new this step', tone: 'fresh' }, { label: 'reply (tokens out)', tone: 'out' }]}
      readout={`Step ${cur.n}: ${[cur.tool, cur.arg].filter(Boolean).join(' ')}, ${fmt.int(cur.tokens_in)} tokens in, ${fmt.int(cur.tokens_out)} out.`}
      table={<FigTable caption={`Figure ${n} as a table`} cols={['Step', 'Tool', 'Phase', 'Tokens in', 'Tokens out']}
        rows={d.steps.map((x) => [String(x.n), [x.tool, x.arg].filter(Boolean).join(' '), x.phase, fmt.int(x.tokens_in), fmt.int(x.tokens_out)])} />} />
  )
}

function Preview({ d }) {
  const max = Math.max(...d.steps.map((s) => s.tokens_in))
  const band = 104 / d.steps.length
  return <g className="rg-prev-ink">{d.steps.map((s, i) => <rect key={s.n} x={8 + i * band + band * 0.2} y={48 - (s.tokens_in / max) * 38} width={band * 0.6} height={(s.tokens_in / max) * 38} rx="1.5" className={i === d.steps.length - 1 ? 'acc' : ''} />)}</g>
}

/** The numbers the article quotes, as this figure draws them. */
export function headlines(d) {
  const out = { total: fmt.int(d.total_tokens) }
  d.steps.forEach((s) => { out[`in_${s.n}`] = fmt.int(s.tokens_in); out[`out_${s.n}`] = fmt.int(s.tokens_out) })
  return out
}

export const KINDS = { run_steps: { Figure: RunSteps, Preview, headlines } }
