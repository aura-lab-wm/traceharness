/* Rig · learn/figures/kinds/b-parts.jsx — small parts the figures of articles 07 to 10 share: a row of choice
   buttons (the chosen one says it is shown and does nothing more), and Play / Back / Next for a figure that steps.
   The look is grade-harness.css; the steps run on the stepper reducer (../stepper.js), so Play goes through once,
   stops on the last step and never loops. */
import { useEffect, useReducer, useRef } from 'react'
import { Icon } from '../../../ui'
import { stepper, START } from '../stepper'
import { tokenMs } from '../../motion'
import './grade-harness.css'

export const cx = (...a) => a.filter(Boolean).join(' ')
const PauseIcon = () => <svg className="rg-ico" width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14M16 5v14" /></svg>

/** Choice buttons: options [[value, words, hint?, plain?]] (plain: the words as text, when `words` is markup);
 *  the chosen one is inert and says "· shown". */
export function Pick({ label, options, value, onPick, el, className }) {
  return (
    <div className={cx('rg-gh-pick', className)} role="group" aria-label={label} data-el={el}>
      {options.map(([v, words, hint, plain]) => {
        const on = v === value
        return (
          <button key={v} type="button" className={cx('rg-gh-pickb', on && 'on')} aria-pressed={on}
            data-hint={on ? `${plain || words} · shown` : hint} onClick={() => { if (!on) onPick(v) }}>{words}</button>
        )
      })}
    </div>
  )
}

/** A figure that steps: { s, act } of the stepper, playing once when it first scrolls into view (`autoplay`),
 *  one step per two pulses. `onTick(at)` runs as each played step lands. */
export function useSteps(n, reveal, { autoplay = false, onTick } = {}) {
  const [s, act] = useReducer(stepper, n, START)
  const played = useRef(false)
  const tick = useRef(onTick)
  tick.current = onTick
  useEffect(() => { if (autoplay && reveal.scrolled && !played.current) { played.current = true; act({ type: 'play' }) } }, [autoplay, reveal.scrolled])
  useEffect(() => {
    if (!s.playing) return undefined
    const t = setTimeout(() => { if (tick.current) tick.current(s.at); act({ type: 'tick' }) }, tokenMs(reveal.ref.current, '--rig-dur-pulse', 1200) * 2)
    return () => clearTimeout(t)
  }, [s.playing, s.at, reveal.ref])
  return [s, act]
}

/** Play / Pause, Back and Next, and "Step k of n" (`pos` words it). Back on the first step and Next on the last
 *  stay visible, inert, and say why. */
export function StepControls({ s, act, pos, nextWords = 'Next step', playWords = 'Play' }) {
  const last = s.n - 1
  return (
    <div className="rg-gh-ctl" data-el="fig-stepper">
      <button type="button" className="rg-btn rg-lfig-play" data-el="fig-play" onClick={() => act({ type: s.playing ? 'pause' : 'play' })}>
        {s.playing ? <PauseIcon /> : <Icon name="play" size={14} />}{s.playing ? 'Pause' : s.at === last ? 'Play again' : playWords}</button>
      <button type="button" className="rg-btn" data-el="fig-back" aria-disabled={s.at === 0 || undefined} data-hint={s.at === 0 ? 'This is the first step' : undefined}
        onClick={() => { if (s.at > 0) act({ type: 'back' }) }}>Back</button>
      <button type="button" className="rg-btn" data-el="fig-next" aria-disabled={s.at === last || undefined} data-hint={s.at === last ? 'This is the last step' : undefined}
        onClick={() => { if (s.at < last) act({ type: 'next' }) }}>{nextWords}</button>
      <span className="rg-gh-pos" data-el="fig-step-pos">{pos}</span>
    </div>
  )
}

/** A snake_case name that may break after each underscore, so a narrow card wraps it between words. */
export const Snake = ({ name }) => name.split('_').map((w, j, a) => <span key={j}>{w}{j < a.length - 1 && <>_<wbr /></>}</span>)

/** A whole number with thousands commas, a share as "50.2%". */
export const int = (v) => Number(v).toLocaleString('en-US')
export const pct1 = (a, b) => `${((a / b) * 100).toFixed(1)}%`
