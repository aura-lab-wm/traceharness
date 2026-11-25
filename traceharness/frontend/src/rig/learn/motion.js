/* Rig · learn/motion.js — the motion of a reading page, on the console's tokens and only where motion is wanted.
   * useReducedMotion: the reader's prefers-reduced-motion (rig.css also turns every animation off under it).
   * useReveal: a part of the page fades and rises once, the first time it scrolls into view (data-reveal; the
     look is learn.css). Nothing waits hidden when the browser has no IntersectionObserver, when motion is
     reduced, or when the part is already in view: it is simply there.
   * tokenMs: a --rig-dur-* token in milliseconds, for a figure's Play timer. */
import { useEffect, useRef, useState } from 'react'

const REDUCE = '(prefers-reduced-motion: reduce)'

export function prefersReducedMotion() {
  try { return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(REDUCE).matches } catch { return false }
}

export function useReducedMotion() {
  const [reduce, setReduce] = useState(prefersReducedMotion)
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined
    const mq = window.matchMedia(REDUCE)
    const on = () => setReduce(mq.matches)
    mq.addEventListener?.('change', on)
    return () => mq.removeEventListener?.('change', on)
  }, [])
  return reduce
}

/** { ref, seen, scrolled }: attach ref to the part; seen turns true once it has been in view (at once where
 *  nothing can animate); scrolled is true only when it came into view by scrolling, with motion allowed (the
 *  cue for a figure that plays once). */
export function useReveal() {
  const ref = useRef(null)
  const [state, setState] = useState({ seen: false, scrolled: false })
  useEffect(() => {
    const el = ref.current
    const show = () => setState((s) => (s.seen ? s : { seen: true, scrolled: false }))
    if (!el || typeof IntersectionObserver !== 'function' || prefersReducedMotion()) { show(); return undefined }
    const r = el.getBoundingClientRect()
    if (r.top < window.innerHeight && r.bottom > 0) { show(); return undefined }
    el.setAttribute('data-reveal', 'wait')
    const io = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return
      io.disconnect()
      el.setAttribute('data-reveal', 'in')
      setState({ seen: true, scrolled: true })
    }, { threshold: 0, rootMargin: '0px 0px -8% 0px' })   // any overlap: a part taller than the view never shows a share of itself
    io.observe(el)
    return () => { io.disconnect(); if (el.getAttribute('data-reveal') === 'wait') el.removeAttribute('data-reveal') }
  }, [])
  return { ref, ...state }
}

/** A --rig-dur-* token in ms, read from the page (the fallback where no stylesheet is loaded, as in a test). */
export function tokenMs(el, name, fallback) {
  try {
    const v = getComputedStyle(el || document.documentElement).getPropertyValue(name).trim()
    const m = v.match(/^([\d.]+)(ms|s)$/)
    if (m) return Number(m[1]) * (m[2] === 's' ? 1000 : 1)
  } catch { /* no layout here */ }
  return fallback
}

/** The width of an element in px (ResizeObserver), or `fallback` until it is measured or where it cannot be. */
export function useWidth(fallback = 640) {
  const ref = useRef(null)
  const [w, setW] = useState(fallback)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver !== 'function') return undefined
    const ro = new ResizeObserver(([e]) => { const x = Math.round(e.contentRect.width); if (x > 0) setW(x) })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, w]
}
