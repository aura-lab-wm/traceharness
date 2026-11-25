/* Rig · tourPlay.js — how a page tour plays like a video (Tour.jsx). PURE but for glide().
   readingMs: how long a step stays up: 4 s, plus 1 s per 20 words of its title and text, at most 9 s.
   glide: scrolls a part into view smoothly, in the --rig-dur-2 token on --rig-ease (cubic-bezier(.2,0,0,1)):
   the instant scroll is made first to learn where every scroller ends up, put back, then eased there. */
export const READ_BASE_MS = 4000
export const READ_CAP_MS = 9000
const MS_PER_WORD = 1000 / 20

const wordsIn = (text) => String(text || '').split(/\s+/).filter(Boolean).length
/** Milliseconds a step with this text stays up before the tour moves on. */
export const readingMs = (text) => Math.min(READ_CAP_MS, READ_BASE_MS + wordsIn(text) * MS_PER_WORD)

/** cubic-bezier(x1, y1, x2, y2) as a function of progress 0..1 (Newton steps on x, then y). */
export function bezier(x1, y1, x2, y2) {
  const at = (a, b, t) => 3 * a * t * (1 - t) ** 2 + 3 * b * t * t * (1 - t) + t ** 3
  const slope = (a, b, t) => 3 * a * (1 - t) ** 2 + 6 * (b - a) * t * (1 - t) + 3 * (1 - b) * t * t
  return (p) => {
    if (p <= 0) return 0
    if (p >= 1) return 1
    let t = p
    for (let i = 0; i < 6; i++) { const d = slope(x1, x2, t); if (Math.abs(d) < 1e-6) break; t -= (at(x1, x2, t) - p) / d }
    return at(y1, y2, Math.min(1, Math.max(0, t)))
  }
}
const EASE = bezier(0.2, 0, 0, 1)

/** Every element that can scroll above `el`, and the page itself. */
function scrollersAbove(el) {
  const out = []
  for (let n = el && el.parentElement; n && n.nodeType === 1; n = n.parentElement) {
    if (n.scrollHeight > n.clientHeight || n.scrollWidth > n.clientWidth) out.push(n)
  }
  const page = typeof document !== 'undefined' && document.scrollingElement
  if (page && !out.includes(page)) out.push(page)
  return out
}

/** Run `jump` (an instant scroll of `el` into view), then ease every scroller it moved from where it was to where
 *  it ended, over `ms`. With no time (reduced motion) or no animation frames the jump stays as it is. Returns a
 *  stop function that leaves every scroller at its end. */
export function glide(el, jump, ms) {
  const list = scrollersAbove(el)
  const from = list.map((n) => [n.scrollTop, n.scrollLeft])
  jump()
  const to = list.map((n) => [n.scrollTop, n.scrollLeft])
  const moved = list.some((_, i) => from[i][0] !== to[i][0] || from[i][1] !== to[i][1])
  if (!ms || !moved || typeof requestAnimationFrame !== 'function') return () => {}
  const set = (k) => list.forEach((n, i) => {
    n.scrollTop = from[i][0] + (to[i][0] - from[i][0]) * k
    n.scrollLeft = from[i][1] + (to[i][1] - from[i][1]) * k
  })
  set(0)
  const t0 = Date.now()
  let frame = 0
  const step = () => {
    const p = Math.min(1, (Date.now() - t0) / ms)
    set(EASE(p))
    frame = p < 1 ? requestAnimationFrame(step) : 0
  }
  frame = requestAnimationFrame(step)
  return () => { if (frame) { cancelAnimationFrame(frame); frame = 0; set(1) } }
}
