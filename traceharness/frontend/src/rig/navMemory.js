/* Rig · navMemory.js — where each page was scrolled to, per history entry and per tab, so Back and Forward
   come back to the place the reader left (a new page still opens at the top).

   Every history entry the shell writes carries an id in history.state ({ rig: <id> }); an entry the
   browser wrote itself (a typed address, a plain link) gets one when the shell first sees it. The scroll
   of each drawn document is kept under `<entry>|<pane>|<page>` (page = harnessViews.mountKey), and the
   last place of each tab under `<pane>|<page>`, for a tab brought forward again. While a restore runs the
   scroll events are its own (or the browser clamping a page being swapped), so they are not recorded. */

import { mountKey } from './harnessViews'

const byEntry = new Map()
const byTab = new Map()
const BASE = Date.now() * 1000
let seq = 0
let current = null
let quietUntil = 0
const MAX_ENTRIES = 400

const now = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now())
const readId = () => {
  try { const s = history.state; return s && typeof s === 'object' && Number.isFinite(s.rig) ? s.rig : null } catch { return null }
}

/** A fresh id for an entry about to be pushed. */
export function nextEntryId() { seq += 1; return BASE + seq }

/** The id of the history entry in view, giving it one (replaceState) when the browser wrote it without. */
export function ensureEntry() {
  let id = readId()
  if (id == null) {
    id = nextEntryId()
    try { history.replaceState({ ...(history.state && typeof history.state === 'object' ? history.state : {}), rig: id }, '', location.href) } catch { /* the entry keeps no id */ }
  }
  current = id
  return id
}
export function currentEntry() { return current == null ? ensureEntry() : current }
export function setCurrentEntry(id) { current = id }

/** Ignore scroll events for `ms` (a restore or a page swap is moving the scroller, not the reader). */
export function quiet(ms) { quietUntil = now() + ms }
export function endQuiet() { quietUntil = 0 }
export const isQuiet = () => now() < quietUntil

/** Record where the document `key` (`<pane>|<page>`) is scrolled to in the entry in view. `force` records
 *  even while quiet (the shell saving the page it is about to leave). */
export function noteScroll(key, top, win, force = false) {
  if (!key || (!force && isQuiet())) return
  const v = { top: Math.max(0, Math.round(top || 0)), win: Math.max(0, Math.round(win || 0)) }
  byEntry.set(`${currentEntry()}|${key}`, v)
  byTab.set(key, v)
  if (byEntry.size > MAX_ENTRIES) byEntry.delete(byEntry.keys().next().value)
}
/** Where `key` was in history entry `entry`, or null. */
export const recallEntry = (entry, key) => byEntry.get(`${entry}|${key}`) || null
/** Where the tab `key` was the last time it was shown, or null. */
export const recallTab = (key) => byTab.get(key) || null

/* ---------------------------------------------------------------- the drawn documents (RigApp's panes) */
const MOVES = ['wheel', 'touchstart', 'keydown', 'pointerdown']
const RESTORE_MS = 3000
/** `<pane>|<page>` of a drawn document (.rg-doc[data-doc][data-spec]). */
export const scrollKey = (el) => `${el.dataset.doc}|${mountKey(el.dataset.spec)}`
const drawnDocs = () => (typeof document === 'undefined' ? [] : [...document.querySelectorAll('.rg-doc[data-doc]')])
/** Keep where every drawn document is scrolled to, under the history entry about to be left. */
export function saveScrolls() { for (const d of drawnDocs()) noteScroll(scrollKey(d), d.scrollTop, window.scrollY, true) }
/** Put each drawn document where `want(el)` says ({ top, win }; null is the top). A page still loading is too
 *  short to scroll that far, so it tries again until it fits; the reader's own wheel, key or touch stops it. */
export function restoreScrolls(want) {
  const targets = drawnDocs().map((el) => [el, want(el)])
  const win = targets.reduce((a, [, w]) => Math.max(a, (w && w.win) || 0), 0)
  let stop = false, timer = null
  const end = () => { stop = true; endQuiet(); clearTimeout(timer); for (const m of MOVES) window.removeEventListener(m, end, true) }
  for (const m of MOVES) window.addEventListener(m, end, true)
  const t0 = Date.now()
  const step = () => {
    if (stop) return
    let done = true
    for (const [el, w] of targets) {
      const top = (w && w.top) || 0
      if (!el.isConnected) continue
      if (el.scrollTop !== top) el.scrollTop = top
      if (Math.abs(el.scrollTop - top) > 1) done = false
    }
    if (win && typeof window.scrollTo === 'function' && Math.abs(window.scrollY - win) > 1) { window.scrollTo(0, win); if (Math.abs(window.scrollY - win) > 1) done = false }
    if (done || Date.now() - t0 > RESTORE_MS) { end(); return }
    timer = setTimeout(step, 50)
  }
  quiet(RESTORE_MS + 100)
  step()
}

/** Forget everything (tests). */
export function resetNavMemory() { byEntry.clear(); byTab.clear(); current = null; quietUntil = 0 }
