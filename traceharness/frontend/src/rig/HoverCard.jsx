/* Rig · HoverCard.jsx — the one hover card, light, in the product's tokens.

   <HoverCard content el? toggle? portal? className? onOpenChange?>trigger</HoverCard>
     A card beside one trigger. Its words stay in the document (hidden while closed) and describe the
     trigger (aria-describedby), so a screen reader reads them on focus. It opens about 100 ms after the
     pointer arrives, at once on keyboard focus; a tap pins it; it closes 100 ms after the pointer leaves
     (the pointer may cross into the card), on blur, on Esc and on a press elsewhere. With `toggle` a click
     pins it open, even when the hover opened it, and the next click closes it (the (i), a glossary term, a
     harness name); without, a click closes it. The card sits in the top
     layer (popover) beside its target: never over it, never following the pointer. onOpenChange(open) is
     told each time it opens or closes (to fetch what the card shows only when it is asked for). With
     `portal` the card is drawn at the end of the rig instead of after the trigger, so a word inside a
     sentence (Term.jsx) leaves the sentence's text as it was.

   <HintLayer/>   mounted once by RigApp
     The same card for every element with data-hint="…": the rig's replacement for the native title.

   Timing and placement live in hover-intent.js. */
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { createHoverIntent, placeCard } from './hover-intent'
import './hovercard.css'

const cx = (...a) => a.filter(Boolean).join(' ')
const FOCUSABLE = 'a[href],button,input,select,textarea,summary,[tabindex]:not([tabindex="-1"])'
const isTouch = (e) => e.pointerType === 'touch'
/** The top layer where the browser has it; elsewhere (an old browser, the tests' DOM) a fixed card. */
const POPOVER = typeof HTMLElement !== 'undefined' && typeof HTMLElement.prototype.showPopover === 'function' ? 'manual' : undefined
/** Focus from the keyboard (or a focus() call), not from a mouse press. */
const keyboardFocus = (el) => { try { return el.matches(':focus-visible') } catch { return true } }

/* Where the pointer is, so a card can open where the pointer came into a wide target. A card keeps the place it
   opened at until it closes: it never follows the pointer. */
let pointer = null
if (typeof document !== 'undefined') document.addEventListener('pointermove', (e) => { pointer = { x: e.clientX, y: e.clientY } }, { capture: true, passive: true })
const anchors = new WeakMap()   // card -> { target, dx }: the pointer's offset in the target when the card opened

/** Show or hide a card: in the top layer where the browser has popovers, by data-open in any case. */
export function showCard(card, on) {
  if (!on) anchors.delete(card)
  card.setAttribute('data-open', on ? 'true' : 'false')
  if (typeof card.showPopover !== 'function') return
  try {
    const shown = card.matches(':popover-open')
    if (on && !shown) card.showPopover()
    if (!on && shown) card.hidePopover()
  } catch { /* not in the document any more */ }
}
/** Put an open card beside its target (hover-intent.js placeCard). */
export function positionCard(card, target) {
  if (!card || !target || typeof target.getBoundingClientRect !== 'function') return
  const r = target.getBoundingClientRect()
  card.style.maxHeight = ''
  const c = card.getBoundingClientRect()
  let a = anchors.get(card)
  if (!a || a.target !== target) {
    const inside = pointer && pointer.x >= r.left && pointer.x <= r.left + r.width && pointer.y >= r.top && pointer.y <= r.top + r.height
    a = { target, dx: inside ? pointer.x - r.left : null }
    anchors.set(card, a)
  }
  const p = placeCard({ left: r.left, top: r.top, width: r.width, height: r.height }, { w: c.width, h: c.height }, { w: window.innerWidth, h: window.innerHeight },
    a.dx == null ? null : r.left + a.dx)
  card.style.top = `${Math.round(p.top)}px`
  card.style.left = `${Math.round(p.left)}px`
  card.style.maxHeight = p.maxHeight != null ? `${Math.floor(p.maxHeight)}px` : ''
  card.setAttribute('data-side', p.side)
}
/** Add (or take back) one id in an element's aria-describedby, keeping the ids it already had. */
function describe(el, id, on) {
  if (!el) return
  const ids = (el.getAttribute('aria-describedby') || '').split(' ').filter((x) => x && x !== id)
  if (on) ids.push(id)
  if (ids.length) el.setAttribute('aria-describedby', ids.join(' '))
  else el.removeAttribute('aria-describedby')
}

export function HoverCard({ content, children, el, toggle = false, portal = false, className, onOpenChange }) {
  const id = 'rg-hc-' + useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const anchor = useRef(null)
  const card = useRef(null)
  const touch = useRef(false)
  const [open, setOpen] = useState(false)
  const [host, setHost] = useState(null)
  const intent = useRef(null)
  const told = useRef(onOpenChange)
  told.current = onOpenChange
  if (!intent.current) {
    const set = (v) => { setOpen(v); if (told.current) told.current(v) }
    intent.current = createHoverIntent({ onOpen: () => set(true), onClose: () => set(false) })
  }
  useEffect(() => () => intent.current.dispose(), [])
  useLayoutEffect(() => { if (portal && anchor.current) setHost(anchor.current.closest('.rig') || document.body) }, [portal])
  const trigger = () => {
    const a = anchor.current
    if (!a) return null
    const t = [...a.querySelectorAll(FOCUSABLE)].find((n) => !card.current || !card.current.contains(n))
    return t || a
  }
  // the trigger is described by the card on every render (a re-render may replace the trigger node)
  useLayoutEffect(() => {
    const t = trigger()
    describe(t, id, true)
    if (toggle && t && t !== anchor.current) t.setAttribute('aria-expanded', open ? 'true' : 'false')
  })
  useLayoutEffect(() => {
    const c = card.current
    if (!c) return
    showCard(c, open)
    if (open) positionCard(c, trigger())
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!open) return undefined
    const onKey = (e) => { if (e.key === 'Escape' && intent.current.escape()) { e.preventDefault(); e.stopPropagation() } }
    const onDown = (e) => { if (!inside(e.target)) intent.current.outside() }
    // a scroll inside the card itself (a tall card scrolls) leaves it where it is
    const onMove = (e) => { if (!inCard(e && e.target)) positionCard(card.current, trigger()) }
    document.addEventListener('keydown', onKey, true)
    document.addEventListener('pointerdown', onDown, true)
    window.addEventListener('scroll', onMove, true)
    window.addEventListener('resize', onMove)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      document.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('scroll', onMove, true)
      window.removeEventListener('resize', onMove)
    }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  const inCard = (n) => !!(card.current && n && n.nodeType === 1 && card.current.contains(n))
  const inside = (n) => !!(anchor.current && n && anchor.current.contains(n)) || inCard(n)
  const box = (
    <div className="rg-hc-card" id={id} ref={card} popover={POPOVER} data-open="false" role={toggle ? undefined : 'tooltip'}
      onPointerEnter={portal ? (e) => { if (!isTouch(e)) intent.current.enter() } : undefined}
      onPointerLeave={portal ? (e) => { if (!isTouch(e)) intent.current.leave() } : undefined}>{content}</div>
  )
  return (
    <span className={cx('rg-hc', className)} data-el={el} ref={anchor}
      onPointerEnter={(e) => { if (!isTouch(e)) intent.current.enter() }}
      onPointerLeave={(e) => { if (!isTouch(e)) intent.current.leave() }}
      onPointerDown={(e) => {
        touch.current = isTouch(e)
        if (!touch.current && !toggle && !inCard(e.target)) intent.current.outside()
      }}
      onClick={(e) => {
        if (inCard(e.target)) return
        if (touch.current) intent.current.tap()
        else if (toggle) intent.current.click()
        touch.current = false
      }}
      onFocus={(e) => { if (inCard(e.target) || keyboardFocus(e.target)) intent.current.focus() }}
      onBlur={(e) => { if (!inside(e.relatedTarget)) intent.current.blur() }}>
      {children}
      {portal ? host && createPortal(box, host) : box}
    </span>
  )
}

/** The hint layer: one card that shows the data-hint of whatever the pointer rests on or the keyboard
 *  focuses, in place of the native title. Mounted once, inside the .rig root (it reads its tokens). */
export function HintLayer() {
  const ref = useRef(null)
  useEffect(() => {
    const c = ref.current
    if (!c) return undefined
    let target = null
    const textOf = (t) => (t && t.getAttribute('data-hint')) || ''
    const draw = () => {
      if (!target || !target.isConnected || !textOf(target)) { intent.outside(); return }
      c.textContent = textOf(target)
      describe(target, c.id, true)
      showCard(c, true)
      positionCard(c, target)
    }
    const intent = createHoverIntent({ onOpen: draw, onClose: () => { showCard(c, false); describe(target, c.id, false) } })
    const hintOf = (n) => {
      const t = n && typeof n.closest === 'function' ? n.closest('[data-hint]') : null
      return t && textOf(t) ? t : null
    }
    const aim = (t) => {
      if (t === target) return
      if (intent.isOpen()) { describe(target, c.id, false); target = t; draw() } else target = t
    }
    const over = (e) => {
      if (isTouch(e)) return
      const t = hintOf(e.target)
      if (!t) { if (target && !target.contains(e.target)) intent.leave(); return }
      aim(t)
      intent.enter()
    }
    const out = (e) => {
      if (isTouch(e) || !target) return
      if (hintOf(e.target) === target && !target.contains(e.relatedTarget)) intent.leave()
    }
    const focusin = (e) => {
      const t = e.target
      if (!t || typeof t.hasAttribute !== 'function' || !t.hasAttribute('data-hint') || !textOf(t) || !keyboardFocus(t)) return
      aim(t)
      intent.focus()
    }
    const focusout = (e) => { if (target && e.target === target) intent.blur() }
    const down = (e) => {
      const t = hintOf(e.target)
      if (isTouch(e) && t) {
        if (t !== target) { intent.outside(); target = t }
        intent.tap()
        return
      }
      intent.outside()
    }
    // a hint is not a layer of its own: Esc closes it and still reaches the menu or page under it
    const key = (e) => { if (e.key === 'Escape' && intent.isOpen()) intent.escape() }
    const move = (e) => { if (intent.isOpen() && !(e && e.target && e.target.nodeType === 1 && c.contains(e.target))) positionCard(c, target) }
    document.addEventListener('pointerover', over, true)
    document.addEventListener('pointerout', out, true)
    document.addEventListener('focusin', focusin, true)
    document.addEventListener('focusout', focusout, true)
    document.addEventListener('pointerdown', down, true)
    document.addEventListener('keydown', key, true)
    window.addEventListener('scroll', move, true)
    window.addEventListener('resize', move)
    return () => {
      intent.dispose()
      document.removeEventListener('pointerover', over, true)
      document.removeEventListener('pointerout', out, true)
      document.removeEventListener('focusin', focusin, true)
      document.removeEventListener('focusout', focusout, true)
      document.removeEventListener('pointerdown', down, true)
      document.removeEventListener('keydown', key, true)
      window.removeEventListener('scroll', move, true)
      window.removeEventListener('resize', move)
    }
  }, [])
  return <div className="rg-hc-card rg-hint" id="rg-hint" ref={ref} popover={POPOVER} data-open="false" role="tooltip" />
}
