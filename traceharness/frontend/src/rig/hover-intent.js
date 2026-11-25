/* Rig · hover-intent.js — when a hover card opens and closes, and where it goes. PURE: no DOM, no React.
   HoverCard.jsx (the card beside one trigger) and the hint layer (every [data-hint] in the rig) both use it.

   Timing: opens OPEN_DELAY after the pointer arrives (90 ms, so the card is on screen about 100 ms
   after it, a frame later), at once on keyboard focus; a click or a tap
   opens it at once and pins it; it closes CLOSE_DELAY after the pointer leaves (so the pointer can cross into
   the card) unless pinned, at once on blur unless pinned, on Esc, on a second click and on a press elsewhere.
   Place: under its target, else above it, else on the roomier of the two with a scroll inside; never over
   the target (on a wide one, where the pointer came in), never following the pointer, kept EDGE px inside the window. */

export const OPEN_DELAY = 90
export const CLOSE_DELAY = 100
export const GAP = 6
export const EDGE = 8
/** How far left of the pointer a card opened by the pointer starts, so the pointer sits just inside it. */
export const POINTER_INSET = 16

/**
 * @param {{left:number, top:number, width:number, height:number}} target  the trigger's box in the window
 * @param {{w:number, h:number}} card  the card's size
 * @param {{w:number, h:number}} view  the window's size
 * @returns {{top:number, left:number, side:'below'|'above', maxHeight:number|null}}
 */
export function placeCard(target, card, view, pointerX = null) {
  const below = target.top + target.height + GAP
  const roomBelow = view.h - EDGE - below
  const roomAbove = target.top - GAP - EDGE
  // on a wide target (a step row) the card opens where the pointer came in, kept inside the target; with no
  // pointer (keyboard focus) it keeps the target's left edge
  const x = pointerX == null ? target.left
    : Math.max(target.left, Math.min(pointerX - POINTER_INSET, target.left + target.width - card.w))
  const left = Math.max(EDGE, Math.min(x, view.w - EDGE - card.w))
  if (card.h <= roomBelow) return { top: below, left, side: 'below', maxHeight: null }
  if (card.h <= roomAbove) return { top: target.top - GAP - card.h, left, side: 'above', maxHeight: null }
  if (roomBelow >= roomAbove) return { top: below, left, side: 'below', maxHeight: Math.max(0, roomBelow) }
  return { top: EDGE, left, side: 'above', maxHeight: Math.max(0, roomAbove) }
}

/**
 * The open state of one card. The caller tells it what the hand did; it calls onOpen / onClose.
 * @param {{onOpen:() => void, onClose:() => void, openDelay?:number, closeDelay?:number}} opts
 */
export function createHoverIntent({ onOpen, onClose, openDelay = OPEN_DELAY, closeDelay = CLOSE_DELAY }) {
  let open = false, pinned = false, hovered = false, focused = false, keyPin = false
  let openT = null, closeT = null
  const stop = () => { clearTimeout(openT); clearTimeout(closeT); openT = closeT = null }
  const show = () => { stop(); if (!open) { open = true; onOpen() } }
  const hide = () => { stop(); pinned = false; keyPin = false; if (open) { open = false; onClose() } }
  return {
    enter() {
      hovered = true
      clearTimeout(closeT); closeT = null
      if (!open && openT == null) openT = setTimeout(show, openDelay)
    },
    leave() {
      hovered = false
      clearTimeout(openT); openT = null
      if (open && !pinned && !focused) closeT = setTimeout(hide, closeDelay)
    },
    focus() { focused = true; show() },
    // a card pinned from the keyboard goes when the focus moves on; one pinned by the mouse stays
    blur() {
      focused = false
      if (open && (!pinned || keyPin) && !hovered) hide()
    },
    // a click pins the card, whether the hover already opened it or not; the next click closes it
    click() { if (open && pinned) hide(); else { show(); pinned = true; keyPin = focused } },
    tap() { if (open && pinned) hide(); else { show(); pinned = true } },
    outside() { hovered = false; focused = false; hide() },
    escape() { const was = open; hovered = false; hide(); return was },
    isOpen: () => open,
    isPinned: () => pinned,
    dispose() { stop() },
  }
}
