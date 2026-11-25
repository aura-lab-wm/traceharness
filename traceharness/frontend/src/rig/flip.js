/* Rig · flip.js — rows that change place glide there instead of jumping (the Datasets list when it is
   sorted or filtered). FLIP: each row is measured where it was and where it is, put back by a transform,
   then let go, so only transform moves (200 ms, the shared ease). Nothing moves under reduced motion,
   on the first draw, or for a row that was not there before. */
import { useLayoutEffect, useRef } from 'react'

const reduced = () => typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** Where each row should start: { key: offset } for rows that moved more than a pixel. Pure. */
export function flipOffsets(before, after) {
  const out = {}
  for (const [k, is] of after) {
    const was = before.get(k)
    if (was != null && Math.abs(was - is) >= 1) out[k] = was - is
  }
  return out
}

/** useFlip(rootRef, selector, orderKey): rows under root matching selector, keyed by data-row, glide when
 *  orderKey (the keys in their new order) changes. */
export function useFlip(root, selector, orderKey) {
  const last = useRef(null)
  useLayoutEffect(() => {
    const el = root.current
    if (!el) return
    const rows = [...el.querySelectorAll(selector)]
    const now = new Map(rows.map((r) => [r.getAttribute('data-row'), r.offsetTop]))
    const before = last.current
    last.current = now
    if (!before || reduced()) return
    const off = flipOffsets(before, now)
    const moved = rows.filter((r) => off[r.getAttribute('data-row')] != null)
    if (!moved.length) return
    for (const r of moved) { r.classList.remove('rg-flip-go'); r.style.transform = `translateY(${off[r.getAttribute('data-row')]}px)` }
    void el.offsetHeight   // the start positions take effect before the rows are let go
    for (const r of moved) {
      r.classList.add('rg-flip-go')
      r.style.transform = ''
      r.addEventListener('transitionend', () => r.classList.remove('rg-flip-go'), { once: true })
    }
  }, [orderKey]) // eslint-disable-line react-hooks/exhaustive-deps
}
