/* Rig · StepRows.jsx — the pieces a run is drawn with on the step axis, shared by the run page (views/console.jsx),
   the task page and the all-runs view (RunLanes.jsx). Data come from run-shape.js; colour only from tokens.

     <StepLink …>      one step as one 40 px line: letter (in its phase colour) · step n · what it did · badges ·
                       phase · tokens · time. A real link to run:<id>:s<n>; a plain click picks the step.
     <RowCard rootRef render>  one hover card for every row in rootRef (rows carry data-card="<key>"): the
                       hover-intent.js timing, at once on keyboard focus, closed by Esc, a press, or leaving
     stepCard(…)       what the card says: phase, tokens in / out / cached, cost, time, cut, repeat, risk
     <PhaseBand …>     the run's phases as a strip, with the fix (dashed), the steps after it (hatched), the first
                       lookup (a tick) and the current step; `total` puts several runs on one scale
     <LayerToggles …>  Phase · Repeats · Cut outputs · After the fix */
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createHoverIntent } from './hover-intent'
import { positionCard, showCard } from './HoverCard'
import { PHASE_WORD, phaseSlot, stepFacts } from './token-model'
import { LAYERS, fixMark, fixWord } from './run-shape'
import { fmt } from './data'
import { Wb } from './ui'
import './steprows.css'

const { int } = fmt
const cx = (...a) => a.filter(Boolean).join(' ')
const POPOVER = typeof HTMLElement !== 'undefined' && typeof HTMLElement.prototype.showPopover === 'function' ? 'manual' : undefined
const keyboardFocus = (el) => { try { return el.matches(':focus-visible') } catch { return true } }
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/** The letter of a step on a tile in its phase's colour (neutral with the Phase layer off). */
export function StepTile({ shape, phase = true }) {
  const p = phase && shape.phase ? `rg-tok-p${phaseSlot(shape.phase)}` : null
  return <span className={cx('rg-sl-tile', p, p && 'tint')} aria-hidden="true">{shape.letter}</span>
}

/** What each one-letter tile means: the patterns alphabet's words (core/patterns.py ACTION_LABEL). */
export const LETTER_WORDS = Object.freeze({ L: 'list', R: 'read/view', F: 'search', W: 'write', E: 'edit', T: 'run tests', B: 'bash', S: 'submit' })
/** The key of the letters a view draws, in alphabet order; nothing when none of them is a known letter. */
export function LetterKey({ letters }) {
  const used = Object.keys(LETTER_WORDS).filter((l) => (letters || []).includes(l))
  if (!used.length) return null
  return (
    <span className="rg-sl-key" data-el="letter-key" role="group" aria-label="Step letters">
      {used.map((l) => <span key={l} className="rg-sl-key-i"><b className="rg-sl-tile" aria-hidden="true">{l}</b> {LETTER_WORDS[l]}</span>)}
    </span>
  )
}

/** The badges of a step: the fix and the first lookup always; "cut · 2,000 chars shown", "repeat of step k" and
 *  "after the fix" each behind its layer. */
export function stepBadges(shape, { layers, fix, lookup, firstAfter }) {
  const out = []
  if (fix && fix.step === shape.n) out.push({ k: 'fix', text: fixMark(fix), tone: 'fix' })
  if (lookup && lookup.step === shape.n) out.push({ k: 'look', text: 'first lookup', tone: 'look' })
  if (layers.has('c') && shape.cut) out.push({ k: 'cut', text: shape.cut.shown != null ? `cut · ${int(shape.cut.shown)} chars shown` : 'cut', tone: 'cut' })
  if (layers.has('r') && shape.repeatOf != null) out.push({ k: 'rep', text: `repeat of step ${shape.repeatOf}`, tone: 'rep' })
  if (layers.has('f') && firstAfter) out.push({ k: 'after', text: `after ${fixWord(fix)}`, tone: 'after' })
  return out
}

/** One step, one line. `meta` is the tokens · time words; `chip` the step's outcome ({tone, text}); `extra` sits last.
 *  `wrapName`: the all-runs view's lanes, where a line may take two lines, let a long tool name break after "_".
 *  `here`: the step is the one open in the panel, so the row says "you are here" and a plain click does nothing (a
 *  modified click is still the browser's: a new tab). */
export function StepLink({ href, shape, label, head, rest, badges, chip, meta, phase, phaseWord = true, isCur, here = false, tabIndex, onPick, extra, cardKey, wrapName = false }) {
  return (
    <a href={href} className="rg-cx-rowb rg-sl-row" tabIndex={tabIndex} aria-current={isCur ? 'step' : undefined} aria-label={here ? `${label} · you are here` : label}
      aria-disabled={here || undefined} data-here={here ? '' : undefined} data-card={cardKey ?? shape.n}
      onClick={(e) => { if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return; e.preventDefault(); if (!here) onPick() }}
      onKeyDown={(e) => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return; if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); if (!here) onPick() } }}>
      <StepTile shape={shape} phase={phase} />
      <span className="rg-cx-sn">{shape.n}</span>
      <span className="rg-sl-what"><span className={cx('t', head !== 'No tool call' && 'rg-mono')}>{wrapName ? <Wb>{head}</Wb> : head}</span>{rest && <span className="a">{rest}</span>}</span>
      {badges.map((b) => <span key={b.k} className={cx('rg-sl-badge', b.tone)} data-el={`badge-${b.k}`}>{b.text}</span>)}
      {chip && <span className={cx('rg-cx-chip', chip.tone)}>{chip.text}</span>}
      {phase && phaseWord && shape.phase && <span className={cx('rg-cx-ph', 'rg-sl-ph', `rg-tok-p${phaseSlot(shape.phase)}`)} data-el="phase-chip"><i className="rg-tok-sw" aria-hidden="true" />{shape.phase}</span>}
      <span className="rg-cx-stm">{meta}</span>
      {extra}
    </a>
  )
}

/** The facts of one step for its hover card: [label, value] pairs, nothing invented. */
export function stepCard({ st, shape, lead, timed, priced, usd, fix, risk, thr, calls, steps }) {
  const f = stepFacts(st.chat)
  const used = num(st.tokensIn) != null && num(st.tokensOut) != null
  const rows = [['phase', shape.phase ? `${shape.phase} · ${PHASE_WORD[shape.phase] || ''}`.replace(/ · $/, '') : 'not recorded']]
  if (shape.call != null && calls != null && steps != null && calls !== steps) rows.push(['model call', `${shape.call} of ${calls}`])
  if (lead != null) rows.push(['tokens', `this step's model call also asked for step ${lead}: one model call can ask for several tool calls, so its tokens, cost and time are on step ${lead}`])
  else {
    rows.push(['tokens in', used ? int(st.tokensIn) : 'not recorded'])
    rows.push(['tokens out', used ? int(st.tokensOut) : 'not recorded'])
    rows.push(['cached', f.cached == null ? 'unknown' : int(f.cached)])
    rows.push(['cost', priced && num(st.cost) != null && used && st.cost > 0 ? usd(st.cost) : 'not recorded'])
  }
  rows.push(['time', timed && num(st.ms) != null && st.ms > 0 ? (st.ms >= 1000 ? `${(st.ms / 1000).toFixed(2)} s` : `${Math.round(st.ms)} ms`) : 'not recorded'])
  rows.push(['output', shape.cut ? (shape.cut.shown != null ? `cut by the harness · ${int(shape.cut.shown)} chars shown` : 'cut by the harness') : 'not cut'])
  rows.push(['repeat', shape.repeatOf != null ? `same command as step ${shape.repeatOf}` : 'no'])
  if (fix && fix.step != null) {
    const counted = fix.from != null ? shape.n >= fix.from && shape.n <= fix.to : shape.n > fix.step
    const why = fix.call != null && shape.call === fix.call ? `the same model call as ${fixWord(fix)}` : 'a call that only submits'
    rows.push([fixMark(fix), fix.step === shape.n ? 'this step' : shape.n < fix.step ? `before it (step ${fix.step})` : counted ? `after it (step ${fix.step})` : `after it (step ${fix.step}), not counted: ${why}`])
  }
  if (risk != null) rows.push(['Sentinel risk', `${risk.toFixed(2)} · threshold ${thr.toFixed(2)} · ${risk >= thr ? 'at or above it' : 'below it'}`])
  return rows
}

/** One card for the rows of a list (rootRef): rows carry data-card="<key>"; `render(key)` gives the facts of that row
 *  ([label, value] pairs, or { title, rows }). Its own component, so a card moving from row to row redraws the card
 *  alone, not the list; it attaches to the list whenever the list appears (a page that first drew its loading
 *  state included). */
export function RowCard({ rootRef, render }) {
  const id = 'rg-rc-' + useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const card = useRef(null)
  const [n, setN] = useState(null)
  const target = useRef(null)
  const intent = useRef(null)
  const bound = useRef(null)
  if (!intent.current) intent.current = createHoverIntent({ onOpen: () => setN(target.current ? target.current.getAttribute('data-card') : null), onClose: () => setN(null) })
  useLayoutEffect(() => {
    const c = card.current
    if (!c) return
    showCard(c, n != null)
    if (n != null && target.current && target.current.isConnected) positionCard(c, target.current)
  }, [n])
  // after every render: attach to the list when it is (newly) there
  useEffect(() => {
    const root = rootRef.current
    if (!root || (bound.current && bound.current.root === root)) return
    if (bound.current) bound.current.off()
    const rowOf = (e) => (e.target && typeof e.target.closest === 'function' ? e.target.closest('[data-card]') : null)
    const aim = (r) => {
      if (target.current === r) return
      if (target.current) target.current.removeAttribute('aria-describedby')
      target.current = r
      r.setAttribute('aria-describedby', id)
      if (intent.current.isOpen()) setN(r.getAttribute('data-card'))
    }
    // a touch screen has no hover: a card opened by a tap's emulated pointer would stay over the rows
    const noHover = typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(hover: none)').matches
    const over = (e) => { if (e.pointerType === 'touch' || noHover) return; const r = rowOf(e); if (!r || !root.contains(r)) return; aim(r); intent.current.enter() }
    // the rows move under a card when the list scrolls: the card goes
    const scroll = () => { if (intent.current.isOpen()) intent.current.outside() }
    const out = (e) => { const r = rowOf(e); if (r && r === target.current && !r.contains(e.relatedTarget)) intent.current.leave() }
    const fin = (e) => { const r = rowOf(e); if (r && keyboardFocus(e.target)) { aim(r); intent.current.focus() } }
    const fout = (e) => { if (rowOf(e) === target.current) intent.current.blur() }
    const down = () => intent.current.outside()
    // a row's card is a hint, not a layer the reader opened: Esc closes it and still reaches the panel or the run
    const key = (e) => { if (e.key === 'Escape' && intent.current.isOpen()) intent.current.escape() }
    root.addEventListener('pointerover', over)
    // a scroll does not bubble: listen in the capture phase, so the list, its box or the page scrolling all count
    document.addEventListener('scroll', scroll, { capture: true, passive: true })
    root.addEventListener('pointerout', out)
    root.addEventListener('focusin', fin)
    root.addEventListener('focusout', fout)
    document.addEventListener('pointerdown', down, true)
    document.addEventListener('keydown', key, true)
    bound.current = { root, off: () => {
      root.removeEventListener('pointerover', over)
      document.removeEventListener('scroll', scroll, { capture: true })
      root.removeEventListener('pointerout', out)
      root.removeEventListener('focusin', fin)
      root.removeEventListener('focusout', fout)
      document.removeEventListener('pointerdown', down, true)
      document.removeEventListener('keydown', key, true)
    } }
  })
  useEffect(() => () => { intent.current.dispose(); if (bound.current) bound.current.off() }, [])
  const got = n != null ? render(n) : null
  const rows = Array.isArray(got) ? got : got && got.rows
  const title = got && !Array.isArray(got) ? got.title : `Step ${n}`
  return (
    <div className="rg-hc-card rg-sl-card" id={id} ref={card} popover={POPOVER} data-open="false" role="tooltip" data-el="step-card">
      {rows && <><b className="rg-sl-card-h">{title}</b><dl>{rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl></>}
    </div>
  )
}

/* ------------------------------------------------------------------ the band */
const at = (step, total) => `${(((step - 1) / total) * 100).toFixed(3)}%`
const span = (n, total) => `${((n / total) * 100).toFixed(3)}%`

/** segments: [{phase, from, to, n}] (run-shape bandSegments, or the task view's run-length phases);
 *  steps = this run's length; total = the axis length (the longest run on a shared axis); unit names a place on it
 *  ('step' on the run page and the lanes, 'model call' on the task page). fix: { step, from?, to?, path? } — from..to
 *  are the places counted after the fix (run-shape fixOf), hatched; `tailWords` closes the hatch's hover. A click past
 *  the run's end picks its last place. With `onPick` each phase band is a button ("Open step 4"): a pointer picks
 *  the place under it, the keyboard the band's first place; one band is in the tab order (the one holding `current`)
 *  and the arrows, Home and End move between them. */
export function PhaseBand({ segments, steps, total = steps, fix, lookup, current, onPick, label, el = 'phase-band', compact, unit = 'step', tailWords, card, hint: words }) {
  const ref = useRef(null)
  // `card(k)` -> { title, rows }: one hover card for the place under the pointer (hover-intent timing), set beside
  // the band, never over it; without it each mark keeps its one-line hint
  const cardRef = useRef(null)
  const [hot, setHot] = useState(null)
  const [open, setOpen] = useState(false)
  const [focusSeg, setFocusSeg] = useState(null)
  const intent = useRef(null)
  if (card && !intent.current) intent.current = createHoverIntent({ onOpen: () => setOpen(true), onClose: () => setOpen(false) })
  useEffect(() => () => { if (intent.current) intent.current.dispose() }, [])
  useLayoutEffect(() => {
    const c = cardRef.current
    if (!c) return
    showCard(c, open && hot != null)
    if (open && hot != null && ref.current) positionCard(c, ref.current)
  }, [open, hot])
  if (!steps) return null
  const placeAt = (e) => {
    const r = ref.current.getBoundingClientRect()
    return Math.max(1, Math.floor(((e.clientX - r.left) / (r.width || 1)) * total) + 1)
  }
  const pick = (e) => {
    if (!onPick || !ref.current) return
    onPick(Math.min(placeAt(e), steps))
  }
  const hint = (words) => (card ? undefined : words)
  const got = card && hot != null ? card(Math.min(hot, total)) : null
  const place = (a, b) => (a === b ? `${unit} ${a}` : `${unit}s ${a}–${b}`)
  const from = fix && fix.step != null ? (fix.from !== undefined ? fix.from : fix.step < steps ? fix.step + 1 : null) : null
  const to = from != null ? (fix.to !== undefined ? fix.to : steps) : null
  // the band in the tab order: the one last focused, else the one holding the current place, else the first
  const curSeg = current != null ? segments.findIndex((s) => current >= s.from && current <= s.to) : -1
  const tabSeg = focusSeg != null && focusSeg < segments.length ? focusSeg : Math.max(0, curSeg)
  const moveTo = (e, i) => {
    const k = e.key
    const j = k === 'ArrowRight' || k === 'ArrowDown' ? i + 1 : k === 'ArrowLeft' || k === 'ArrowUp' ? i - 1 : k === 'Home' ? 0 : k === 'End' ? segments.length - 1 : null
    if (j == null) return
    e.preventDefault(); e.stopPropagation()
    const next = Math.max(0, Math.min(segments.length - 1, j))
    const b = ref.current && ref.current.querySelectorAll('button.seg')[next]
    if (b) b.focus()
    setFocusSeg(next)
  }
  // a pointer picks the place under it; Enter or Space (a click with no pointer, detail 0) the band's first place
  const pickSeg = (e, s) => { e.stopPropagation(); onPick(e.detail === 0 ? s.from : Math.min(placeAt(e), steps)) }
  return (
    <div className={cx('rg-sl-band', compact && 'compact', onPick && 'pick')} ref={ref} data-el={el} role={onPick ? 'group' : 'img'} aria-label={label} data-hint={words} onClick={pick}
      onBlur={onPick ? (e) => { if (!e.currentTarget.contains(e.relatedTarget)) setFocusSeg(null) } : undefined}
      onPointerMove={card ? (e) => { if (e.pointerType === 'touch') return; setHot(placeAt(e)); intent.current.enter() } : undefined}
      onPointerLeave={card ? (e) => { if (e.pointerType !== 'touch') intent.current.leave() } : undefined}>
      {segments.map((s, i) => {
        const cls = cx('seg', s.phase ? `rg-tok-p${phaseSlot(s.phase)}` : 'none')
        const pos = { left: at(s.from, total), width: span(s.n, total) }
        const what = `${s.phase || 'phase not recorded'} · ${place(s.from, s.to)}`
        return onPick
          ? <button type="button" key={s.from} className={cls} style={pos} aria-label={`Open ${unit} ${s.from}`} data-hint={hint(what)} tabIndex={i === tabSeg ? 0 : -1}
              onClick={(e) => pickSeg(e, s)} onKeyDown={(e) => moveTo(e, i)} onFocus={() => setFocusSeg(i)} />
          : <i key={s.from} className={cls} style={pos} data-hint={hint(what)} />
      })}
      {steps < total && <i className="end" style={{ left: span(steps, total) }} aria-hidden="true" />}
      {from != null && <i className="tail" data-el="after-fix-tail" style={{ left: at(from, total), width: span(to - from + 1, total) }} data-hint={hint(`after ${fixWord(fix)}: ${place(from, to)}${tailWords ? ` · ${tailWords}` : ''}`)} />}
      {fix && fix.step != null && <i className="fix" data-el="fix-marker" style={{ left: at(fix.step, total) }} data-hint={hint(`${fixMark(fix)} · ${unit} ${fix.step}${fix.path ? ` · ${fix.path}` : ''}`)} />}
      {lookup && lookup.step != null && <i className="look" data-el="lookup-tick" style={{ left: at(lookup.step, total) }} data-hint={hint(`first lookup · ${unit} ${lookup.step}`)} />}
      {current != null && <i className="cur" style={{ left: at(current, total), width: span(1, total) }} aria-hidden="true" />}
      {card && (
        <div className="rg-hc-card rg-sl-card" ref={cardRef} popover={POPOVER} data-open="false" role="tooltip" data-el="band-card">
          {got && <><b className="rg-sl-card-h">{got.title}</b>{got.rows.length > 0 && <dl>{got.rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>}</>}
        </div>
      )}
    </div>
  )
}

/** Phase · Repeats · Cut outputs · After the fix, as pressed buttons; `counts` says how many steps each marks. */
export function LayerToggles({ layers, onChange, counts = {} }) {
  return (
    <div className="rg-sl-layers" role="group" aria-label="Layers" data-el="step-layers">
      {LAYERS.map((l) => {
        const on = layers.has(l.code)
        const n = counts[l.code]
        // nothing to mark in this run: shown disabled (still hoverable for its hint), so it does not read as a dead button
        const none = n === 0
        return (
          <button key={l.code} type="button" className={cx('rg-sl-layer', on && 'on', none && 'none')} aria-pressed={none ? undefined : on} aria-disabled={none || undefined}
            data-hint={none ? 'None in this run' : l.hint}
            onClick={() => { if (none) return; const s = new Set(layers); if (on) s.delete(l.code); else s.add(l.code); onChange(s) }}>
            {l.label}{n != null && <span className="n">{n}</span>}
          </button>
        )
      })}
    </div>
  )
}

/** The run page's band: the phases, what is marked on them in words, and "Jump to the fix". */
export function RunBand({ segments, steps, fix, lookup, current, onPick, onJump, words, tailWords, atFix = false }) {
  const phases = [...new Set(segments.map((s) => s.phase).filter(Boolean))]
  return (
    <section className="rg-sl-runband" data-el="run-band" aria-label="The run's phases, step by step">
      <div className="rg-sl-runband-h">
        <span className="t">Steps 1–{steps}</span>
        {phases.length > 0 && <span className="lg" aria-hidden="true">{phases.map((p) => <span key={p} className={`rg-tok-p${phaseSlot(p)}`}><i className="rg-tok-sw" />{p}</span>)}</span>}
        {words && <span className="w" data-el="run-band-words">{words}</span>}
        <span className="rg-grow" />
        {/* with that step open in the panel it says where you are and does nothing */}
        {fix && fix.step != null && onJump && (atFix
          ? <button type="button" className="rg-btn sm" data-el="jump-to-fix" aria-current="step" aria-disabled="true" data-here="" data-hint="That step is open below">At {fixWord(fix)} · step {fix.step}</button>
          : <button type="button" className="rg-btn sm" data-el="jump-to-fix" onClick={onJump}>Jump to {fixWord(fix)} · step {fix.step}</button>)}
      </div>
      <PhaseBand segments={segments} steps={steps} fix={fix} lookup={lookup} current={current} onPick={onPick} tailWords={tailWords}
        label={`${steps} steps by phase${fix && fix.step != null ? `; ${fixWord(fix)} at step ${fix.step}` : ''}${lookup && lookup.step != null ? `; first lookup at step ${lookup.step}` : ''}`} />
    </section>
  )
}
