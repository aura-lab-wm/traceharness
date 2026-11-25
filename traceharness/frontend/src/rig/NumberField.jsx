/* Rig · NumberField.jsx — the one number box of the workbench (runs per task, parallelism, the run limits,
   the harness blocks' numbers, repetitions, seeds, budgets).

   * Typing is free: nothing is changed under the cursor while the box has focus.
   * The value is checked when the box is left or Enter is pressed. Out of range, it is set to the nearest
     allowed value and one short line under the box says so ("Up to 20 runs per task, so this is set to
     20."), then fades back to the quiet range ("1–20 runs").
   * − / + beside the box and ↑ / ↓ in it step once (Shift, Page Up / Page Down: ten steps; Home / End:
     the limits). The buttons stop at the limits. They are not tab stops: the box is a spinbutton and
     its keys do the same (the WAI-ARIA spinbutton pattern).
   * No browser spinner; figures are right-aligned with tabular numerals. Styles: NumberField.css. */
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import './NumberField.css'

const isNum = (v) => typeof v === 'number' && Number.isFinite(v)
/** How long the line under the box says what changed before it fades back to the range. */
export const SAID_MS = 4000
const FADE_MS = 180
const decimals = (x) => { const m = /\.(\d+)$/.exec(String(x)); return m ? m[1].length : 0 }
/** 2,000,000 · 0.01 · 3 */
export const numText = (v) => (isNum(v) ? (Math.abs(v) >= 1000 ? v.toLocaleString('en-US', { maximumFractionDigits: 6 }) : String(v)) : '')

/** What typed text becomes once it is checked. Pure.
 *  → { value, why } where why is null (taken as typed), 'max' | 'min' (set to a limit), 'whole'
 *  (rounded), or 'nan' | 'empty' (not a number: the previous value stays). */
export function checkNumber(text, { min, max, whole = true, prev, allowEmpty = false }) {
  const t = String(text ?? '').trim()
  if (t === '') return allowEmpty ? { value: '', why: null } : { value: prev, why: 'empty' }
  const n = Number(t.replace(/[,\s_]/g, ''))
  if (!Number.isFinite(n)) return { value: prev, why: 'nan' }
  let value = n, why = null
  if (whole && !Number.isInteger(value)) { value = Math.round(value); why = 'whole' }
  if (isNum(min) && value < min) { value = min; why = 'min' }
  if (isNum(max) && value > max) { value = max; why = 'max' }
  return { value, why }
}

/** The short line that says why the box changed. `noun` reads after the number ("runs per task"). */
export function changedLine(why, { value, min, max, noun, typed }) {
  const n = noun ? ` ${noun}` : ''
  const range = isNum(min) && isNum(max) ? `from ${numText(min)} to ${numText(max)}` : isNum(min) ? `of at least ${numText(min)}` : isNum(max) ? `up to ${numText(max)}` : ''
  if (why === 'max') return `Up to ${numText(max)}${n}, so this is set to ${numText(value)}.`
  if (why === 'min') return `At least ${numText(min)}${min === 1 ? '' : n}, so this is set to ${numText(value)}.`
  if (why === 'whole') return `Whole numbers only, so ${typed} is set to ${numText(value)}.`
  if (why === 'nan' || why === 'empty') {
    const ask = `Enter a number${range ? ' ' + range : ''}`
    return isNum(value) ? `${ask}; this is back to ${numText(value)}.` : `${ask}.`
  }
  return ''
}

/**
 * <NumberField label value onChange min max step? nudge? unit? noun? allowEmpty? issue? disabled? el? id? hint?/>
 *   value       number, or '' (empty) where `allowEmpty`
 *   onChange    called with the checked number (never while typing)
 *   step        1 (whole numbers, the default) or 'any'
 *   nudge       how far − / + and ↑ / ↓ move (default 1, or 0.1 for an 'any' box narrower than 10)
 *   unit        shown after the range ("s", "USD"); `noun` is used in the line ("runs per task")
 *   issue       a standing problem with the value (set from elsewhere, e.g. the configuration file)
 *   hint        replaces the quiet range line
 */
export function NumberField({ label, value: given, onChange, min, max, step = 1, nudge, unit, noun, allowEmpty = false, issue, disabled, el, id: idProp, hint, describedBy, className, labelExtra, name: nameProp }) {
  // a caller that keeps the number as text ('3') is read as the number it spells
  const value = typeof given === 'string' && given.trim() !== '' && Number.isFinite(Number(given)) ? Number(given) : given
  const auto = useId()
  const id = idProp || auto
  const [draft, setDraft] = useState(null)        // the text while the box has focus; null = show the value
  const [said, setSaid] = useState(null)          // { text, fading }
  const timers = useRef([])
  useEffect(() => () => timers.current.forEach(clearTimeout), [])
  // a message that wraps makes the line taller; it keeps that height afterwards, so the fade back to the
  // one-line range never pulls the fields below it up
  const lineRef = useRef(null)
  const [lineH, setLineH] = useState(0)
  useLayoutEffect(() => {
    const h = said && lineRef.current ? lineRef.current.offsetHeight : 0
    if (h > lineH) setLineH(h)
  }, [said, lineH])
  const whole = step !== 'any'
  const by = nudge ?? (whole ? 1 : isNum(min) && isNum(max) && max - min <= 10 ? 0.1 : 1)
  const shown = draft ?? (isNum(value) ? String(value) : value ?? '')
  const say = (text) => {
    timers.current.forEach(clearTimeout)
    if (!text) { setSaid(null); return }
    setSaid({ text, fading: false })
    timers.current = [setTimeout(() => setSaid((s) => (s ? { ...s, fading: true } : s)), SAID_MS), setTimeout(() => setSaid(null), SAID_MS + FADE_MS)]
  }
  const check = (text) => {
    const r = checkNumber(text, { min, max, whole, prev: value, allowEmpty })
    say(changedLine(r.why, { value: r.value, min, max, noun: noun || unit, typed: String(text).trim() }))
    if (r.value !== value && (isNum(r.value) || (allowEmpty && r.value === ''))) onChange(r.value)
    return r.value
  }
  const commit = () => { if (draft != null) { check(draft); setDraft(null) } }
  const base = () => {
    if (draft != null) { const r = checkNumber(draft, { min, max, whole, prev: value }); if (isNum(r.value)) return r.value }
    return isNum(value) ? value : isNum(min) ? min : 0
  }
  const stepBy = (k) => {
    if (disabled) return
    const places = Math.max(decimals(by), whole ? 0 : decimals(base()))
    const next = +(base() + k * by).toFixed(Math.min(places, 6))
    setDraft(null)
    check(String(next))
  }
  const atMin = isNum(min) && isNum(value) && value <= min
  const atMax = isNum(max) && isNum(value) && value >= max
  const onKey = (e) => {
    const big = e.shiftKey ? 10 : 1
    if (e.key === 'Enter') { commit(); return }
    if (e.key === 'Escape' && draft != null) { e.preventDefault(); e.stopPropagation(); setDraft(null); return }
    let k = 0
    if (e.key === 'ArrowUp') k = big
    else if (e.key === 'ArrowDown') k = -big
    else if (e.key === 'PageUp') k = 10
    else if (e.key === 'PageDown') k = -10
    else if (e.key === 'Home' && isNum(min)) { e.preventDefault(); setDraft(null); check(String(min)); return }
    else if (e.key === 'End' && isNum(max)) { e.preventDefault(); setDraft(null); check(String(max)); return }
    if (!k) return
    e.preventDefault()
    stepBy(k)
  }
  const range = isNum(min) && isNum(max) ? `${numText(min)}–${numText(max)}` : isNum(min) ? `${numText(min)} or more` : isNum(max) ? `up to ${numText(max)}` : ''
  const quiet = hint ?? [range, unit].filter(Boolean).join(' ')
  const line = said ? said.text : issue || quiet
  const lineId = id + '-line'
  const name = nameProp || (typeof label === 'string' ? label : 'the value')
  return (
    <div className={['rg-fld rg-numf', className].filter(Boolean).join(' ')} data-el={el}>
      {label != null && <label htmlFor={id}>{label}{labelExtra}</label>}
      <div className={['rg-numf-box', disabled && 'off', issue && !said && 'bad'].filter(Boolean).join(' ')}>
        <button type="button" className="rg-numf-step" tabIndex={-1} aria-label={`Decrease ${name}`} aria-controls={id} disabled={disabled || atMin}
          onMouseDown={(e) => e.preventDefault()} onClick={(e) => stepBy(e.shiftKey ? -10 : -1)}>−</button>
        <input id={id} className="rg-inp rg-numf-in" type="text" inputMode={whole ? 'numeric' : 'decimal'} role="spinbutton" autoComplete="off" spellCheck={false}
          value={shown} disabled={disabled} aria-invalid={issue && !said ? true : undefined}
          aria-valuenow={isNum(value) ? value : undefined} aria-valuemin={isNum(min) ? min : undefined} aria-valuemax={isNum(max) ? max : undefined}
          aria-describedby={[line ? lineId : null, describedBy].filter(Boolean).join(' ') || undefined}
          onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={onKey} />
        <button type="button" className="rg-numf-step" tabIndex={-1} aria-label={`Increase ${name}`} aria-controls={id} disabled={disabled || atMax}
          onMouseDown={(e) => e.preventDefault()} onClick={(e) => stepBy(e.shiftKey ? 10 : 1)}>+</button>
      </div>
      {line ? <span id={lineId} ref={lineRef} style={lineH ? { minHeight: lineH } : undefined} className={['rg-numf-line', said && 'said', said && said.fading && 'fade', issue && !said && 'bad'].filter(Boolean).join(' ')}
        role={said ? 'status' : undefined} data-el={said && el ? `${el}-clamped` : undefined}>{line}</span> : <span className="rg-numf-line" ref={lineRef} style={lineH ? { minHeight: lineH } : undefined} aria-hidden="true">&nbsp;</span>}
    </div>
  )
}
