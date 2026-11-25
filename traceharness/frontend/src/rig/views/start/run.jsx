/* Rig · views/start/run.jsx — Home's "A run · five phases": one real run (start-run.json, written by
   scripts/learn_figures.py from study_v04), walked phase by phase. Five tabs, 01 Explore to 05 Submit; the panel
   draws the run's model calls as the Learn figure's phase band (the dashed line is the fix, hatched calls came after
   it), lights the calls of the phase in view, lists its tool calls as step lines, and says what they cost. The band
   fills in once when it is first seen (useReveal; nothing moves under reduced motion). The run's page and its task's
   all-runs view are links while its dataset is on this computer, and say so when it is not. */
import { useId, useRef, useState } from 'react'
import { makeSpec } from '../../route'
import { fmt } from '../../data'
import { Go, Icon } from '../../ui'
import { useReveal, useWidth } from '../../learn/motion'
import { RUN_PHASES, phaseTitle, phaseLine, runPhase } from './model'
import RUN from './start-run.json'
import '../../learn/figures/kinds/phase-band.css'
import '../start-run.css'

const cx = (...a) => a.filter(Boolean).join(' ')
const { int, plural } = fmt
const two = (i) => String(i + 1).padStart(2, '0')
/** The band's height and its blocks' (px); the width is the column's own (useWidth), so letters keep their size. */
const H = 40, BAND = 28, TOP = 6

/** The run's model calls as blocks lettered by their tool calls (R read, E edit, T test, B bash, S submit), the phase in
 *  view lit, the fix a dashed line and the calls after it hatched. */
function Band({ phase, seen }) {
  const hatch = `rg-start-hatch-${useId().replace(/:/g, '')}`
  const [box, w] = useWidth(640)
  const unit = w / RUN.calls.length
  const markX = RUN.fix_call == null ? null : RUN.fix_call * unit
  return (
    <div ref={box}>
      <svg className={cx('rg-band-svg rg-start-band-svg', seen && 'seen')} viewBox={`0 0 ${w} ${H}`} width={w} height={H} aria-hidden="true" focusable="false">
        <defs><pattern id={hatch} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line className="rg-band-hatchl" x1="0" y1="0" x2="0" y2="6" /></pattern></defs>
        <g className="rg-start-grow">
          {RUN.calls.map((c, i) => {
            const lit = c.tools.some((t) => t.phase === phase)
            const after = RUN.fix_call != null && c.k > RUN.fix_call && !c.submit
            const x = i * unit + 2, bw = Math.max(1, unit - 4)
            return (
              <g key={c.k} className={cx('seg', `ph-${c.phase || 'other'}`, c.submit && 'submit', !lit && 'rg-start-dim')} data-el="start-run-call" data-k={c.k} data-lit={lit ? '' : undefined} data-after={after ? '' : undefined}>
                <rect className="fill" x={x} y={TOP} width={bw} height={BAND} rx="2" />
                <rect className="cap" x={x} y={TOP} width={bw} height="3" rx="1" />
                {after && <rect className="rg-band-after" x={x} y={TOP} width={bw} height={BAND} rx="2" fill={`url(#${hatch})`} />}
                {bw >= c.letters.length * 9 + 8 && <text className="let" x={x + bw / 2} y={TOP + 19} textAnchor="middle">{c.letters}</text>}
              </g>
            )
          })}
        </g>
        {markX != null && <line className="rg-band-mark" data-el="start-run-fix" x1={markX} x2={markX} y1="1" y2={H - 1} />}
      </svg>
    </div>
  )
}

/** Where a phase's calls fall: before or after the fix, after the tests first passed. */
function whenWords(p) {
  if (!p.calls.length) return ''
  const fix = RUN.fix_call, pass = RUN.first_pass_call
  const parts = []
  if (fix != null) parts.push(p.afterFix.length === 0 ? `before the fix (model call ${fix})` : p.afterFix.length === p.calls.length ? `after the fix (model call ${fix})` : `${p.afterFix.length} after the fix`)
  if (pass != null && p.afterPass.length) parts.push(`after the tests first passed (model call ${pass})`)
  return parts.join(', ')
}

function Panel({ p, i, here }) {
  const n = RUN.calls.length
  return (
    <>
      <div className="rg-start-runl">
        {p.tools.length ? (
          <ol className="rg-start-steps" data-el="start-run-steps">
            {p.tools.map((t, j) => (
              <li key={j} className={`ph-${t.phase}`}>
                <span className="k">Call {t.k}</span>
                <code className="tool">{t.tool}</code>
                <code className="arg">{t.arg}</code>
                <span className={cx('st', /passed/.test(t.status) && 'ok', /failed|blocked|error/.test(t.status) && 'bad')}>{t.status}</span>
              </li>
            ))}
          </ol>
        ) : <p className="rg-start-none">Run {RUN.repeat} took no {phaseTitle(p.phase).toLowerCase()} step.</p>}
      </div>
      <div className="rg-start-runr" data-el="start-run-note">
        <p className="big"><b>{p.calls.length}</b> of {plural(n, 'model call')}</p>
        <p>{int(p.tokens)} tokens · {plural(p.tools.length, 'tool call')}</p>
        {p.calls.length > 0 && <p className="when">{phaseTitle(p.phase)} came {whenWords(p)}.</p>}
      </div>
      <div className="rg-start-runf">
        <span className="rg-start-kick" data-el="start-run-count">{i + 1} of {RUN_PHASES.length} phases</span>
        {here
          ? <Go link spec={makeSpec('run', RUN.run_id)} className="rg-tlink rg-start-runlink" el="start-run-open">Read this run step by step<Icon name="arrowr" size={14} /></Go>
          : <span className="rg-mute" data-el="start-run-absent">{RUN.dataset} is not on this computer: add it in Add data to open this run.</span>}
      </div>
    </>
  )
}

/** `here`: the run's dataset is in the library, so its pages open. */
export function RunPhases({ here }) {
  const [at, setAt] = useState(0)
  const reveal = useReveal()
  const list = useRef(null)
  const id = useId().replace(/:/g, '')
  const phase = RUN_PHASES[at]
  const p = runPhase(RUN, phase)
  const go = (i) => {
    const next = (i + RUN_PHASES.length) % RUN_PHASES.length
    setAt(next)
    const node = list.current && list.current.querySelectorAll('[role="tab"]')[next]
    if (node) node.focus()
  }
  const onKey = (e) => {
    const to = { ArrowRight: at + 1, ArrowLeft: at - 1, Home: 0, End: RUN_PHASES.length - 1 }[e.key]
    if (to == null) return
    e.preventDefault()
    go(to)
  }
  return (
    <section className="rg-start-sec rg-start-run" data-el="start-run" aria-labelledby={`${id}-h`}>
      <div className="rg-start-in">
        <p className="rg-start-kick">A run · five phases</p>
        <h2 id={`${id}-h`} className="rg-start-h2">What one run did, phase by phase</h2>
        <p className="rg-start-sub">Run {RUN.repeat} of <code>{RUN.task}</code> in <code>{RUN.dataset}</code>: {RUN.model} under the {RUN.harness} harness, {RUN.passed ? 'passed' : 'failed'}, {int(RUN.tokens)} tokens.
          {here && <> <Go link spec={makeSpec('lanes', RUN.dataset, RUN.model, RUN.harness, RUN.task)} className="rg-tlink" el="start-run-lanes">See all its runs side by side</Go>.</>}</p>
        <div className="rg-start-tabs" role="tablist" aria-label="The run's phases" ref={list} onKeyDown={onKey}>
          {RUN_PHASES.map((ph, i) => {
            const on = i === at
            return (
              <button key={ph} type="button" role="tab" id={`${id}-t${i}`} aria-controls={`${id}-p`} aria-selected={on} tabIndex={on ? 0 : -1}
                className={cx('rg-start-tab', `ph-${ph}`, on && 'on')} data-el="start-run-tab" data-hint={on ? `${phaseTitle(ph)} · shown below` : undefined}
                onClick={() => { if (!on) setAt(i) }}>
                <span className="n" aria-hidden="true">{two(i)}</span>{' '}
                <b>{phaseTitle(ph)}</b>{' '}
                <span className="s">{phaseLine(ph)}</span>
              </button>
            )
          })}
        </div>
        <div className={`rg-start-runp ph-${phase}`} role="tabpanel" id={`${id}-p`} aria-labelledby={`${id}-t${at}`} ref={reveal.ref}>
          <div className="rg-start-runb">
            <Band phase={phase} seen={reveal.seen} />
            <p className="rg-start-runk" aria-hidden="true"><span><i className="mk" />the fix</span><span><i className="ht" />after the fix</span><span>one block per model call</span><span>R read, E edit, T test, B bash, S submit</span></p>
          </div>
          <Panel p={p} i={at} here={here} />
        </div>
      </div>
    </section>
  )
}
