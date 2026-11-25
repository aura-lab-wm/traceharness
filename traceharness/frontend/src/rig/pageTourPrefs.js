/* Rig · pageTourPrefs.js — what this browser remembers of the page tours, per page type (pageTours.pageTourKey):
   'seen' once its "Tour this page" chip was shown (it pulses only before that), 'done' once its tour ended.
   Stored as one JSON object under rig.pagetour.v1; without storage it is remembered for this visit only. */
export const PAGE_TOUR_KEY = 'rig.pagetour.v1'

let memory = {}             // used only where the browser keeps no storage
/** { [pageKey]: 'seen' | 'done' } */
export function readPageTours() {
  let raw
  try { raw = localStorage.getItem(PAGE_TOUR_KEY) } catch { return { ...memory } }
  if (raw == null) return {}
  try {
    const v = JSON.parse(raw)
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {}
  } catch { return {} }
}
function write(next) {
  try { localStorage.setItem(PAGE_TOUR_KEY, JSON.stringify(next)) } catch { memory = next }
}
/** Has this page type's chip been shown before (or its tour taken)? */
export const pageTourSeen = (key) => !!key && !!readPageTours()[key]
/** Mark a page type: 'seen' never overwrites 'done'. */
export function markPageTour(key, state) {
  if (!key) return
  const cur = readPageTours()
  if (cur[key] === state || (state === 'seen' && cur[key] === 'done')) return
  write({ ...cur, [key]: state })
}
/** Forget everything (tests). */
export function resetPageTours() { memory = {}; try { localStorage.removeItem(PAGE_TOUR_KEY) } catch { /* nothing stored */ } }
