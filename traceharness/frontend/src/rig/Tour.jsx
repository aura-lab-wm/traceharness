/* Rig · Tour.jsx — two tours with one card. The site tour: seven steps that point at the real
   console; each step may open a page (the shell restores the reader's own layout when the tour ends); it waits
   for Next. A page tour (Tour at the top right of the top bar, Help › Guide me through this page, ⌘K): up to six
   steps over the page the reader is on (pageTours.js); it never navigates, and it PLAYS: each step stays up for its
   reading time (tourPlay.readingMs), a thin bar showing the time left, then the next part is lit and glided into
   view by itself; it ends by itself after the last step. Pause/Play and Space stop and start it; hovering the card
   or tabbing to one of its controls holds it; under reduced motion it never moves by itself. Both spotlight the
   parts they talk about, put the card where it covers none of them, and take ×, Skip, Back and Next, the arrows
   and Esc. A tour ends on Finish, ×, Skip, Esc or a change of page; then the focus goes back to what opened it,
   the scroll the tour moved comes back, and a page tour marks its page type done (pageTourPrefs.js). A step whose
   part is not shown (checkVisibility: a closed <details> and an unselected tab are not) waits up to 3 s with
   "Loading…" (its time does not run), then is skipped and the steps are renumbered; it never lights the page
   title instead. While a tour runs the dimmed page keeps its clicks and keys from the reader, but the mouse wheel
   still scrolls it. A first visit only offers the site tour (TourOffer, in RigApp), so a deep link opens its own
   page. */
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { makeSpec } from './route'
import { load, paths, peek, short } from './data'
import { Icon, MOD } from './ui'
import { NAV } from './navTree'
import { PAGE_TOURS, GENERAL_PAGE_TOUR, pageTourKey, tourPageId } from './pageTours'
import { markPageTour } from './pageTourPrefs'
import { glide, readingMs } from './tourPlay'
import { tokenMs, useReducedMotion } from './learn/motion'

export { PAGE_TOURS, GENERAL_PAGE_TOUR, pageTourKey, tourPageId }

const HEAD = '[data-tour="page-header"]'
const words = (w) => (w.length < 2 ? w.join('') : `${w.slice(0, -1).join(', ')} and ${w[w.length - 1]}`)
/** The page list in words, from the list itself (navTree NAV), so the step names every row it shows. */
const listWords = () => {
  // Home first, then Datasets with the dataset in focus under it, then that dataset's places, then the shared ones
  const [first, ...more] = NAV
  const lib = more.find((s) => s.id === 'datasets')
  const rest = more.filter((s) => s !== lib)
  return `The page list: ${first.label}, then ${lib.label}${lib.children.length ? ` with its ${words(lib.children.map((c) => c.label))}` : ''}, then the dataset in focus (click its name to switch), then its ${words(rest.filter((s) => s.dataset).map((s) => s.label))}, then ${words(rest.filter((s) => !s.dataset).map((s) => s.label))}.`
}

/** The run the tour opens: a failed run of the dataset in focus when there is one, else its first. */
export function tourRun(dir) {
  const runs = dir ? peek(paths.runs(dir)) : null
  if (!Array.isArray(runs) || !runs.length) return null
  return (runs.find((r) => r.hidden_pass === false) || runs[0]).run_id || null
}

/** Each spot is a list of alternatives; the first that matches something shown is drawn (a
 *  comma list draws one box around all its matches). */
export const TOUR_STEPS = [
  { id: 'datasets', title: 'Datasets', go: () => 'home', spots: [[HEAD], ['[data-el="dataset-list"]']],
    body: () => 'Every dataset on this computer is listed here, recorded runs and the bundled demo data alike. After the tour, open one to read its runs.' },
  { id: 'sidebar', title: 'The page list', spots: [['[data-tour="sidebar"]']],
    body: () => `${listWords()} The place you are in shows its pages under it; the arrow beside a place opens them without leaving the page.` },
  { id: 'context', title: 'What every page is about', spots: [['[data-el~="asking-sentence"]', '[data-tour="status-context"]']],
    body: () => 'Under each page title, the Asking line names the model, the harness and the oracle that grades each run. Change switches any of them on every page.' },
  { id: 'tasks-runs', title: 'Tasks and Runs', spots: [['[data-tour="nav-tasks"],[data-tour="nav-runs"]']],
    body: () => 'Tasks lists every task with the outcome of each of its runs. Runs lists every run, with filters for model, harness and outcome.' },
  { id: 'run', title: 'A run', go: (c) => (c.run ? makeSpec('run', c.run) : null), spots: (c) => (c.run ? [[HEAD], ['.rg-cx-stepcol']] : [['[data-tour="nav-runs"]']]),
    body: (c) => (c.run ? 'A run page shows the outcome, tokens, cost and time in its header, the steps the model took, and the detail of the step you select.'
      : 'Any run opens from Runs: its page shows the outcome, tokens, cost and time in its header, the steps the model took, and the detail of the step you select.') },
  { id: 'analysis', title: 'Analysis', go: (c) => (c.dir ? makeSpec('an', c.dir, 'family', c.model ? short(c.model) : null, c.harness) : null),
    // the matrix itself is lit, brought to the top so all of it fits with the card under it; the page title is not
    // lit, or the card would sit on the matrix
    top: true, spots: (c) => (c.dir ? [['[data-el="family-matrix"]', '[data-el="analysis-nav"]'], ['[data-kids="analysis"]', '[data-el="analysis-nav"]']] : [['[data-tour="nav-analysis"]']]),
    body: () => 'Analysis opens on Questions; its pages sit under it in four groups: which setup wins, can I trust it, how runs behave, and write it up (Run setup is there). In the Family matrix, a selected cell shows its evidence in the inspector.' },
  { id: 'find', title: 'Find, get help, add data', go: () => 'sources', spots: [['[data-tour="palette"]'], ['[data-el="tour-this-page"], [data-tour="help"]'], ['[data-tour="add-data"]']],
    body: () => `After the tour, press ${MOD} K to find any dataset, task, run or page, by its name now or an old one. Tour, beside it, plays a tour of the page you are on; Help (?) replays this one and opens Learn. Add data imports files, public samples and captured sessions.` },
]

/** Is an element drawn where the reader can see it? checkVisibility() where the browser has it (display:none, a
 *  closed <details> and an unselected tab panel all answer false; a closed <details> still has a box, so the box
 *  alone is not enough), with a box of some size. Without layout (a test document) the same rules are read from
 *  the markup. */
export function isShown(el) {
  if (!el || !el.isConnected) return false
  if (typeof el.checkVisibility === 'function') {
    if (!el.checkVisibility({ visibilityProperty: true })) return false
    const r = el.getBoundingClientRect()
    return r.width > 0 && r.height > 0
  }
  const view = el.ownerDocument.defaultView
  for (let n = el, child = null; n && n.nodeType === 1; child = n, n = n.parentElement) {
    if (n.hidden) return false
    // inside a closed <details> only its <summary> shows
    if (n.tagName === 'DETAILS' && child && !n.open && !(child.tagName === 'SUMMARY' && n.querySelector(':scope > summary') === child)) return false
    const st = view ? view.getComputedStyle(n) : null
    if (st && (st.display === 'none' || st.visibility === 'hidden')) return false
  }
  return true
}
const shownOf = (sel) => { try { return [...document.querySelectorAll(sel)].filter(isShown) } catch { return [] } }
/** A reader of the page in view for a step's words: has(sel) a shown match, exists(sel) any match, text(sel) the
 *  words of the first shown match. */
export function pageQuery() {
  return {
    has: (sel) => shownOf(sel).length > 0,
    exists: (sel) => { try { return !!document.querySelector(sel) } catch { return false } },
    text: (sel) => { const e = shownOf(sel)[0]; return e ? String(e.innerText ?? e.textContent ?? '').replace(/\s+/g, ' ').trim() : '' },
  }
}
function boxOf(sel) {
  let found = null
  for (const el of shownOf(sel)) {
    const r = el.getBoundingClientRect()
    found = found ? { x: Math.min(found.x, r.left), y: Math.min(found.y, r.top), r: Math.max(found.r, r.right), b: Math.max(found.b, r.bottom) } : { x: r.left, y: r.top, r: r.right, b: r.bottom }
  }
  return found && { x: found.x, y: found.y, w: found.r - found.x, h: found.b - found.y }
}
function firstMatch(spots) {
  for (const alts of spots) for (const sel of alts) { const el = shownOf(sel)[0]; if (el) return el }
  return null
}
/** Does the page show a step's part (its first spot, any of its alternatives)? */
const partShown = (spots) => !!(spots && spots[0] && firstMatch([spots[0]]))
function measure(spots) {
  const out = []
  for (const alts of spots) for (const sel of alts) { const b = boxOf(sel); if (b) { out.push(b); break } }
  return out
}
const same = (a, b) => a.length === b.length && a.every((x, i) => ['x', 'y', 'w', 'h'].every((k) => Math.abs(x[k] - b[i][k]) < 1))
const PAD = 6, GAP = 12, EDGE = 16
/** Where the card goes: beside the first box, else under, over or left of all of them, else in a free
 *  corner; never on any box it points at, and inside the window. When no place is free, the place that
 *  covers the least of the boxes. `boxes` is one box or a list. */
export function placeCard(boxes, card, win, avoid = []) {
  const list = (Array.isArray(boxes) ? boxes : [boxes]).filter(Boolean)
  const cw = Math.min(card.w || 360, win.w - 2 * EDGE), ch = card.h || 220
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(v, Math.max(lo, hi)))
  const centre = { x: (win.w - cw) / 2, y: (win.h - ch) / 2 }
  if (!list.length) return centre
  const pad = list.map((b) => ({ x: b.x - PAD - GAP / 2, y: b.y - PAD - GAP / 2, r: b.x + b.w + PAD + GAP / 2, b: b.y + b.h + PAD + GAP / 2 }))
  const all = pad.reduce((u, b) => ({ x: Math.min(u.x, b.x), y: Math.min(u.y, b.y), r: Math.max(u.r, b.r), b: Math.max(u.b, b.b) }))
  const first = pad[0]
  const fitX = (x) => clamp(x, EDGE, win.w - cw - EDGE), fitY = (y) => clamp(y, EDGE, win.h - ch - EDGE)
  const cands = [
    // beside a box, the first one first; a little lower too, to clear a box just above it (a page header)
    ...pad.flatMap((b) => [0, GAP * 2, GAP * 4].map((dy) => ({ x: b.r + GAP / 2, y: fitY(b.y + dy), side: true }))),
    { x: fitX(first.x), y: all.b + GAP / 2 },                          // under all of them
    { x: fitX(first.x), y: all.y - GAP / 2 - ch },                     // over all of them
    { x: first.x - GAP / 2 - cw, y: fitY(first.y), side: true },      // left of the first box
    { x: win.w - cw - EDGE, y: win.h - ch - EDGE }, { x: EDGE, y: win.h - ch - EDGE },
    { x: win.w - cw - EDGE, y: EDGE }, { x: EDGE, y: EDGE }, centre,
  ]
  const inside = (c) => c.x >= EDGE - 0.5 && c.y >= EDGE - 0.5 && c.x + cw <= win.w - EDGE + 0.5 && c.y + ch <= win.h - EDGE + 0.5
  const area = (c, bs) => bs.reduce((a, b) => a + Math.max(0, Math.min(c.x + cw, b.r) - Math.max(c.x, b.x)) * Math.max(0, Math.min(c.y + ch, b.b) - Math.max(c.y, b.y)), 0)
  // the section the next step points at is kept clear too (it is not lit), unless it overlaps what is lit
  const meets = (a, b) => a.x < b.r && b.x < a.r && a.y < b.b && b.y < a.b
  const raw = (b) => ({ x: b.x, y: b.y, r: b.x + b.w, b: b.y + b.h })
  const keep = (avoid || []).filter(Boolean).filter((a) => !list.some((b) => meets(raw(b), raw(a))))
    .map((b) => ({ x: b.x - PAD, y: b.y - PAD, r: b.x + b.w + PAD, b: b.y + b.h + PAD }))
  const cover = (c) => area(c, pad)
  const free = cands.find((c) => inside(c) && cover(c) === 0 && area(c, keep) === 0)
  if (free) return { x: free.x, y: free.y }
  // nowhere free: slide the card along the window edges and take the place that covers least (what is lit first)
  let best = null
  const spots = cands.filter(inside)
  for (const y of [win.h - ch - EDGE, EDGE, fitY(all.b + GAP / 2), fitY(all.y - GAP / 2 - ch)]) for (const x of [EDGE, win.w - cw - EDGE, fitX(first.x), centre.x]) spots.push({ x, y })
  for (const c of spots) {
    const k = cover(c) * 1e3 + area(c, keep)
    if (!best || k < best.k) best = { x: c.x, y: c.y, k }
  }
  return { x: best.x, y: best.y }
}
/** The part of a spot the tour lights: what lies inside the window, and no taller than leaves room for
 *  the card under it. A long list or a big panel is lit from its top (the tour scrolls it there). */
export function fitSpot(box, win, card) {
  const ch = card.h || 220
  const top = Math.max(box.y, 0), bottom = Math.min(box.y + box.h, win.h)
  const room = Math.max(48, win.h - ch - 2 * EDGE - 2 * (PAD + GAP) - top)
  const h = Math.min(bottom - top, room)
  return top === box.y && h === box.h ? box : { ...box, y: top, h: Math.max(0, h) }
}
const covers = (at, card, boxes) => boxes.some((b) => at.x < b.x + b.w + PAD && at.x + card.w > b.x - PAD && at.y < b.y + b.h + PAD && at.y + card.h > b.y - PAD)
/** The spots to light and where the card goes. When the spots together leave the card no free place
 *  (a phone, a run header that fills the screen), only the first is lit, so the card stays off it. */
export function lightAndPlace(boxes, card, win, avoid = []) {
  const size = { w: Math.min(card.w || 360, win.w - 2 * EDGE), h: card.h || 220 }
  // spots that already lie inside the window are lit whole when the card has a free place beside, over or under
  // them; only otherwise is a tall one cut to leave the card room under it
  const whole = boxes.filter((b) => b.h > 0 && b.y >= 0 && b.y + b.h <= win.h)
  if (whole.length && whole.length === boxes.length) {
    const at = placeCard(whole, size, win, avoid)
    if (!covers(at, size, whole)) return { at, lit: whole }
  }
  // a spot that runs past the window is lit down to the window's edge when the card has a free place over it (the
  // tour scrolls a tall part down to leave that room), so the card never sits on the part's unlit rest
  const clip = boxes.map((b) => ({ ...b, y: Math.max(b.y, 0), h: Math.min(b.y + b.h, win.h) - Math.max(b.y, 0) })).filter((b) => b.h > 0)
  if (clip.length === boxes.length && clip.length) {
    const at = placeCard(clip, size, win, avoid)
    if (!covers(at, size, clip)) return { at, lit: clip }
  }
  const lit = boxes.map((b) => fitSpot(b, win, size)).filter((b) => b.h > 0)
  const at = placeCard(lit, size, win, avoid)
  if (lit.length < 2 || !covers(at, size, lit)) return { at, lit }
  const one = lit.slice(0, 1)
  return { at: placeCard(one, size, win, avoid), lit: one }
}
/** The spots of the step after `step` (a page tour's next section, which the card keeps clear); none after the
 *  last step or for a step whose spots depend on a page it opens. */
export const nextSpots = (list, step) => { const s = list[step + 1]; return s && Array.isArray(s.spots) ? s.spots : [] }
function holes(boxes) {
  return boxes.map(({ x, y, w, h }) => {
    const X = x - PAD, Y = y - PAD, W = w + 2 * PAD, H = h + 2 * PAD, r = Math.min(8, W / 2, H / 2)
    return `M${X + r} ${Y}H${X + W - r}A${r} ${r} 0 0 1 ${X + W} ${Y + r}V${Y + H - r}A${r} ${r} 0 0 1 ${X + W - r} ${Y + H}H${X + r}A${r} ${r} 0 0 1 ${X} ${Y + H - r}V${Y + r}A${r} ${r} 0 0 1 ${X + r} ${Y}Z`
  }).join('')
}
const WAIT = 3000, POLL = 250, LOAD_WAIT = 30000
/** The page says it is still reading its data: a step waits for it (up to 30 s) before its own 3 s start. */
const pageLoading = () => shownOf('#rig-doc-main [data-el="loading-state"]').length > 0
/** The element that scrolls `el` along an axis ('y' or 'x'): the nearest ancestor that overflows and may scroll. */
function scrollerOf(el, axis = 'y') {
  const view = (el && el.ownerDocument && el.ownerDocument.defaultView) || window
  for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
    const st = view.getComputedStyle(n)
    const over = axis === 'y' ? st.overflowY : st.overflowX
    const room = axis === 'y' ? n.scrollHeight > n.clientHeight : n.scrollWidth > n.clientWidth
    if (room && /(auto|scroll|overlay)/.test(over)) return n
  }
  return document.scrollingElement || null
}
/** The scroll positions a tour moves, kept the first time it moves each one, so they come back when it ends. */
function scrollKeeper() {
  const kept = new Map()
  return {
    keep(el) {
      for (let n = el && el.parentElement; n && n.nodeType === 1; n = n.parentElement) {
        if (!kept.has(n) && (n.scrollHeight > n.clientHeight || n.scrollWidth > n.clientWidth)) kept.set(n, [n.scrollTop, n.scrollLeft])
      }
    },
    restore() { for (const [n, [top, left]] of kept) if (n.isConnected) { n.scrollTop = top; n.scrollLeft = left } },
  }
}

/** <Tour step onStep onClose go ctx steps? page? here?/> — rendered by the shell while a tour runs. `ctx` is
 *  { dir, model, harness } of the dataset in focus; `go(spec)` shows one page for a site-tour step. A page tour
 *  passes its `page` (pageTourKey) and `here`, the spec in view: it ends when `here` names another page, and it
 *  plays (the site tour, which opens pages itself, waits for Next). */
export default function Tour({ step, onStep, onClose, go, ctx, steps: list = TOUR_STEPS, page = null, here = null }) {
  const id = useId()
  const card = useRef(null), next = useRef(null), layer = useRef(null), toggle = useRef(null)
  const play = !!page
  const reduce = useReducedMotion()
  const [paused, setPaused] = useState(false)      // the reader pressed Pause (or Space)
  const [hover, setHover] = useState(false)        // the pointer is on the card
  const [kbHold, setKbHold] = useState(false)      // the reader tabbed to one of the card's controls
  const [boxes, setBoxes] = useState([])
  const [size, setSize] = useState({ w: 0, h: 0 })
  const sizeRef = useRef(size)
  sizeRef.current = size
  const [win, setWin] = useState(() => ({ w: window.innerWidth || 0, h: window.innerHeight || 0 }))
  const [skipped, setSkipped] = useState(() => new Set())
  const skippedRef = useRef(skipped)
  const preSkipped = useRef(new Set())         // later steps left out of the count before they were reached
  skippedRef.current = skipped
  const [waiting, setWaiting] = useState(false)
  const waitingRef = useRef(waiting)
  waitingRef.current = waiting
  const [recheck, setRecheck] = useState(0)    // the step's part went away after it was shown: wait for it again
  const seen = useRef(-1)                       // the step whose part has been shown
  const timeLeft = useRef({ step: -1, ms: 0 }) // the reading time left of a step held part way (a hold, Pause)
  const touched = useRef(false)                // a touch screen: its emulated mouseenter is not a hover
  const wheeled = useRef(false)              // the reader scrolled during this step: the tour stops bringing the part back
  const way = useRef(1)                      // the way the reader moves: +1 Next, -1 Back (a skipped step is passed that way)
  const [keeper] = useState(scrollKeeper)
  const left = useRef(false)                 // the tour ended because the page changed
  const dir = ctx && ctx.dir
  useEffect(() => { if (dir && !peek(paths.runs(dir))) load(paths.runs(dir)) }, [dir])
  const c = { ...ctx, run: tourRun(dir) }
  const s = list[Math.min(step, list.length - 1)]
  const spots = typeof s.spots === 'function' ? s.spots(c) : s.spots
  const target = s.go ? s.go(c) : null
  useEffect(() => { if (target) go(target) }, [step, target]) // eslint-disable-line react-hooks/exhaustive-deps
  const spotKey = JSON.stringify(spots)
  const nextKey = JSON.stringify(nextSpots(list, step))
  const [avoid, setAvoid] = useState([])
  const order = list.map((_, i) => i).filter((i) => !skipped.has(i))
  const last = !order.some((i) => i > step)
  const prev = [...order].reverse().find((i) => i < step)

  /* the step's part: open what hides it (reveal), then wait up to 3 s for it; a part the page does not draw is skipped */
  const skip = useCallback(() => {
    const rest = list.map((_, i) => i).filter((i) => i !== step && !skippedRef.current.has(i))
    setSkipped((p) => new Set([...p, step]))
    setWaiting(false)
    const fwd = rest.find((i) => i > step), bwd = [...rest].reverse().find((i) => i < step)
    const to = way.current < 0 ? (bwd ?? fwd) : fwd
    if (to == null) onClose(true)
    else onStep(to)
  }, [list, step, onClose, onStep])
  useEffect(() => {
    const spotList = JSON.parse(spotKey)
    let undo = null
    const reveal = () => {
      if (!s.reveal || undo) return
      const el = document.querySelector(s.reveal)
      if (!el) return
      if (el.tagName === 'DETAILS') {
        undo = el.open ? () => {} : () => { if (el.isConnected) el.open = false }
        el.open = true
        return
      }
      const tabs = el.closest('[role="tablist"]')
      const was = tabs && tabs.querySelector('[role="tab"][aria-selected="true"]')
      undo = was && was !== el ? () => { if (was.isConnected) was.click() } : () => {}
      if (was !== el) el.click()
    }
    const t0 = Date.now()
    let from = t0
    const check = () => {
      reveal()
      if (partShown(spotList)) { seen.current = step; setWaiting(false); return true }
      // the 3 s start once the page has its data: a page still reading it holds the step (30 s at most)
      if (pageLoading() && Date.now() - t0 < LOAD_WAIT) from = Date.now()
      if ((s.loaded && shownOf(s.loaded).length > 0) || Date.now() - from >= WAIT) { skip(); return true }
      setWaiting(true)
      return false
    }
    let t = null
    if (!check()) t = setInterval(() => { if (check()) clearInterval(t) }, POLL)
    return () => { if (t) clearInterval(t); if (undo) undo() }
  }, [spotKey, step, recheck]) // eslint-disable-line react-hooks/exhaustive-deps

  // a later step whose part the drawn page does not have is left out of the count from the start
  // (and counted again if the page draws it later: some parts come after the rest of the page)
  useEffect(() => {
    const ahead = () => {
      const gone = list.map((x, i) => i).filter((i) => i > step && !skippedRef.current.has(i) && Array.isArray(list[i].spots)
        && list[i].loaded && shownOf(list[i].loaded).length > 0 && !partShown(list[i].spots))
      const back = [...preSkipped.current].filter((i) => i > step && skippedRef.current.has(i) && partShown(list[i].spots))
      for (const i of gone) preSkipped.current.add(i)
      for (const i of back) preSkipped.current.delete(i)
      if (gone.length || back.length) setSkipped((p) => new Set([...p, ...gone].filter((i) => !back.includes(i))))
    }
    ahead()
    const t = setInterval(ahead, POLL)
    return () => clearInterval(t)
  }, [list, step])

  // a spot below the fold is brought into view, at once (a smooth scroll runs past 200 ms); a step with `top` brings its
  // spot to the top, so a tall one is lit whole with room for the card under it; another tall spot is brought up to
  // just under the card's height, so the card goes over it and covers none of it
  const toTop = !!s.top
  useEffect(() => {
    const spotList = JSON.parse(spotKey)
    let stop = null
    const reveal = () => {
      // a `top` step waits for its own first choice (the page it opens draws after this runs), not a stand-in
      const el = toTop ? firstMatch([[spotList[0][0]]]) : firstMatch(spotList)
      if (!el || typeof el.scrollIntoView !== 'function') return false
      keeper.keep(el)
      // the part glides into view in the motion token; under reduced motion it is there at once
      const ms = reduce ? 0 : tokenMs(el, '--rig-dur-2', 180)
      if (toTop) { stop = glide(el, () => el.scrollIntoView({ block: 'start', inline: 'nearest' }), ms); return true }
      // the whole part, when a comma list lights several pieces of it (a heading and the sentence under it)
      const sel = spotList.flat().find((x) => shownOf(x).includes(el))
      const u = (sel && boxOf(sel)) || null
      const r = u ? { top: u.y, bottom: u.y + u.h, height: u.h } : el.getBoundingClientRect()
      const tall = r.height > window.innerHeight / 2
      const room = (sizeRef.current.h || 220) + EDGE + GAP + PAD
      if (r.top < 0 || r.bottom > window.innerHeight || (tall && r.top > room + window.innerHeight / 8)) {
        stop = glide(el, () => {
          el.scrollIntoView({ block: tall ? 'start' : 'center', inline: 'nearest' })
          const sc = tall ? scrollerOf(el, 'y') : null
          if (sc && sc !== document.scrollingElement) sc.scrollTop -= room
        }, ms)
      }
      return true
    }
    // the page may still move under the part (a chart or a list drawn late): until the reader scrolls, a part that
    // has moved by more than a line is brought back
    wheeled.current = false
    let shown = null, at = 0, tries = 0, since = 0
    const watch = () => {
      // a page still reading its data does not use up the tries
      if (!shown) { if (reveal()) { shown = firstMatch(spotList); at = shown ? shown.getBoundingClientRect().top : 0; since = Date.now() } else if (!pageLoading() && ++tries > 12) clearInterval(t); return }
      if (wheeled.current || Date.now() - since < 400) return          // the glide itself is not the page moving
      // the part itself, found again: a page that redraws puts a new element in its place
      const now = firstMatch(spotList)
      if (!now) return
      const top = now.getBoundingClientRect().top
      if (now !== shown || Math.abs(top - at) > 40) { if (stop) stop(); shown = now; reveal(); at = now.getBoundingClientRect().top; since = Date.now() }
    }
    const t = setInterval(watch, 250)
    watch()
    return () => { clearInterval(t); if (stop) stop() }
  }, [spotKey, toTop, step, keeper, reduce])
  const remeasure = useCallback(() => {
    // a part the page took away again (it redrew while reading its data) is waited for again, the step held meanwhile
    if (seen.current === step && !waitingRef.current && !partShown(JSON.parse(spotKey))) { seen.current = -1; timeLeft.current = { step: -1, ms: 0 }; setWaiting(true); setRecheck((n) => n + 1) }
    const b = measure(JSON.parse(spotKey))
    setBoxes((p) => (same(p, b) ? p : b))
    const a = measure(JSON.parse(nextKey))
    setAvoid((p) => (same(p, a) ? p : a))
    setWin((w) => (w.w === window.innerWidth && w.h === window.innerHeight ? w : { w: window.innerWidth, h: window.innerHeight }))
    const el = card.current
    if (el) setSize((z) => (z.w === el.offsetWidth && z.h === el.offsetHeight ? z : { w: el.offsetWidth, h: el.offsetHeight }))
  }, [spotKey, nextKey, step])
  useLayoutEffect(() => { remeasure() }, [remeasure, step])
  useEffect(() => {
    // the page a step opens draws over a few frames (data, fonts); keep the spotlight on it, and on a scroll at once
    const t = setInterval(remeasure, 250)
    window.addEventListener('resize', remeasure)
    window.addEventListener('scroll', remeasure, true)
    return () => { clearInterval(t); window.removeEventListener('resize', remeasure); window.removeEventListener('scroll', remeasure, true) }
  }, [remeasure])

  /* the end: a page tour ends when the page in view changes (a selection inside it does not); the site tour, which
     opens pages itself, ends when the reader goes Back or Forward */
  const [startPage] = useState(() => (page && here ? tourPageId(here) : null))
  useEffect(() => {
    if (startPage == null || !here || tourPageId(here) === startPage) return
    left.current = true
    onClose(false)
  }, [here]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (page) return undefined
    const off = () => { left.current = true; onClose(false) }
    window.addEventListener('popstate', off)
    window.addEventListener('hashchange', off)
    return () => { window.removeEventListener('popstate', off); window.removeEventListener('hashchange', off) }
  }, [page, onClose])
  // the control that opened the tour, read while the tour first renders (before Next takes the focus), gets the focus
  // back when it closes (Help when that control is gone); a page tour gives back the scroll it moved and is done
  const [opener] = useState(() => document.activeElement)
  useEffect(() => {
    // the site tour puts the focus on Next; a page tour on Pause, and leaves it where the reader moved it in the card
    if (!play) { next.current?.focus(); return }
    const a = document.activeElement
    if (!card.current || !card.current.contains(a) || a.disabled) toggle.current?.focus()
  }, [step, play, prev])
  useEffect(() => () => {
    if (page) {
      if (page !== 'general') markPageTour(page, 'done')
      if (!left.current) keeper.restore()
    }
    const help = [...document.querySelectorAll('[data-tour="help"]')].find(isShown) || document.querySelector('[data-tour="help"]')
    const back = opener && opener.isConnected && opener !== document.body && typeof opener.focus === 'function' ? opener : help
    if (back) back.focus()
  }, [opener, page, keeper])
  const forward = useCallback(() => {
    way.current = 1
    // a step left out of the count whose part the page has drawn since (the count check runs every 250 ms)
    const late = [...preSkipped.current].filter((i) => i > step && Array.isArray(list[i].spots) && partShown(list[i].spots)).sort((x, y) => x - y)[0]
    const to = [order.find((i) => i > step), late].filter((i) => i != null).sort((x, y) => x - y)[0]
    if (to === late && late != null) { preSkipped.current.delete(late); setSkipped((p) => new Set([...p].filter((i) => i !== late))) }
    if (to == null) onClose(true)
    else onStep(to)
  }, [order, onClose, onStep, step, list])
  const back = useCallback(() => { way.current = -1; if (prev != null) onStep(prev) }, [onStep, prev])
  // Pause and Play: Play also lets go of a hold (the pointer may still be on the card that was just pressed)
  const flip = useCallback(() => {
    if (!play || reduce) return
    const stopped = paused || hover || kbHold
    setHover(false); setKbHold(false); setPaused(!stopped)
  }, [play, reduce, paused, hover, kbHold])
  useEffect(() => {
    const onKey = (e) => {
      const typing = e.target && typeof e.target.closest === 'function' && e.target.closest('input, textarea, select, [contenteditable]')
      if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); onClose(false); return }
      if (typing) return
      if (e.key === 'ArrowRight') { e.preventDefault(); e.stopImmediatePropagation(); forward(); return }
      if (e.key === 'ArrowLeft') { e.preventDefault(); e.stopImmediatePropagation(); back(); return }
      // Space plays and pauses a page tour; on one of the card's buttons it presses that button, as a button does
      if (play && e.key === ' ' && !(card.current && e.target && e.target.nodeType === 1 && e.target.closest('button') && card.current.contains(e.target))) {
        e.preventDefault(); e.stopImmediatePropagation(); flip(); return
      }
      // the console's own shortcuts wait until the tour is over
      if (e.metaKey || e.ctrlKey || e.altKey || e.key === '?' || e.key === '/') e.stopImmediatePropagation()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [forward, back, onClose, play, flip])
  const trap = (e) => {
    if (e.key !== 'Tab') return
    if (play) setKbHold(true)                  // the reader moves through the controls: the step holds
    const els = [...card.current.querySelectorAll('button:not([disabled])')]
    const first = els[0], end = els[els.length - 1]
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); end.focus() }
    else if (!e.shiftKey && document.activeElement === end) { e.preventDefault(); first.focus() }
  }
  // the wheel scrolls what lies under the pointer, below the layer (the layer keeps the clicks)
  const onWheel = (e) => {
    wheeled.current = true
    const L = layer.current
    if (!L || typeof document.elementFromPoint !== 'function') return
    const was = L.style.pointerEvents
    L.style.pointerEvents = 'none'
    let under = null
    try { under = document.elementFromPoint(e.clientX, e.clientY) } finally { L.style.pointerEvents = was }
    const k = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? window.innerHeight : 1
    const box = scrollerOf(under, e.deltaY ? 'y' : 'x')
    if (!box) return
    const by = { left: e.deltaX * k, top: e.deltaY * k }
    if (typeof box.scrollBy === 'function') box.scrollBy(by)
    else { box.scrollLeft += by.left; box.scrollTop += by.top }
  }
  const body = typeof s.body === 'function' ? s.body({ ...c, q: pageQuery() }) : s.body
  // read on every render, so a part that has just been drawn (a tab the step selected) shows before the next check
  const loading = waiting && !partShown(spots)

  /* play: the step's reading time runs while nothing holds it; what is left is kept through a hold, and a new step
     (by itself, Next, Back or the arrows) starts with its full time */
  const readMs = readingMs(`${s.title} ${body}`)
  const mode = !play ? null : reduce ? 'still' : paused ? 'paused' : hover || kbHold ? 'held' : 'playing'
  const running = mode === 'playing' && !loading
  // a step reached again (Next, Back, by itself) starts with its full time, whatever it had left before
  useEffect(() => { timeLeft.current = { step: -1, ms: 0 } }, [step])
  const forwardRef = useRef(forward)
  forwardRef.current = forward
  useEffect(() => {
    if (!running) return undefined
    if (timeLeft.current.step !== step) timeLeft.current = { step, ms: readMs }
    const t0 = Date.now()
    const t = setTimeout(() => { timeLeft.current = { step: -1, ms: 0 }; forwardRef.current() }, timeLeft.current.ms)
    return () => {
      clearTimeout(t)
      if (timeLeft.current.step === step) timeLeft.current = { step, ms: Math.max(0, timeLeft.current.ms - (Date.now() - t0)) }
    }
  }, [running, step, readMs])
  const stopped = mode !== 'playing'
  const { at, lit } = lightAndPlace(loading ? [] : boxes, size, win, avoid)
  const n = order.indexOf(step) + 1 || step + 1
  return (
    <div className="rg-tour-layer" data-el="tour" ref={layer} onWheel={onWheel}>
      <svg className="rg-tour-dim" width={win.w} height={win.h} aria-hidden="true">
        <path fillRule="evenodd" d={`M0 0H${win.w}V${win.h}H0Z${holes(lit)}`} />
        {lit.map((b, i) => <rect key={i} className="rg-tour-ring" x={b.x - PAD} y={b.y - PAD} width={b.w + 2 * PAD} height={b.h + 2 * PAD} rx="8" />)}
      </svg>
      <div className="rg-tour-card" role="dialog" aria-modal="true" aria-labelledby={`${id}-t`} aria-describedby={`${id}-b`} ref={card} onKeyDown={trap}
        style={{ '--rig-tour-x': `${Math.round(at.x)}px`, '--rig-tour-y': `${Math.round(at.y)}px` }} data-step={s.id} data-wait={loading ? '' : undefined} data-play={mode || undefined}
        onTouchStart={play ? () => { touched.current = true } : undefined}
        onMouseEnter={play ? () => { if (!touched.current) setHover(true) } : undefined} onMouseLeave={play ? () => setHover(false) : undefined}
        onBlur={play ? (e) => { if (!e.currentTarget.contains(e.relatedTarget)) setKbHold(false) } : undefined}>
        <button type="button" className="rg-tour-x" aria-label="Close tour" data-hint="Close tour (Esc)" onClick={() => onClose(false)}><Icon name="x" size={14} /></button>
        {/* the time left in the step: a thin bar that runs down while the tour plays, and stops with it */}
        {play && !reduce && !loading && <div className="rg-tour-time" data-el="tour-time" aria-hidden="true"><i key={step} style={{ '--rig-tour-t': `${readMs}ms` }} /></div>}
        <p className="rg-tour-n">Step {n} of {order.length}</p>
        {/* a playing tour moves on by itself: a screen reader hears each new step */}
        {play && <p className="sr-only" aria-live="polite">{`Step ${n} of ${order.length}: ${s.title}`}</p>}
        <h2 className="rg-tour-t" id={`${id}-t`}>{s.title}</h2>
        <p className="rg-tour-b" id={`${id}-b`} role={loading ? 'status' : undefined}>{loading ? 'Loading…' : body}</p>
        <div className="rg-tour-f">
          {play && (
            <button type="button" className="rg-btn ghost rg-tour-play" ref={toggle} data-el="tour-play" onClick={flip}
              aria-disabled={reduce || undefined} data-hint={reduce ? 'Each step waits for Next: your system asks for less motion' : stopped ? 'Play: each step moves on by itself (Space)' : 'Pause on this step (Space)'}>
              <Icon name={stopped ? 'play' : 'pause'} size={14} />{stopped ? 'Play' : 'Pause'}
            </button>
          )}
          <button type="button" className="rg-btn ghost" onClick={() => onClose(false)}>Skip tour</button>
          <span className="rg-grow" />
          <button type="button" className="rg-btn" disabled={prev == null} onClick={back}>Back</button>
          <button type="button" className="rg-btn pri" ref={next} onClick={forward}>{last ? 'Finish' : 'Next'}</button>
        </div>
      </div>
    </div>
  )
}
