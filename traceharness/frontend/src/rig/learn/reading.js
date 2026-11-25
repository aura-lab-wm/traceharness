/* Rig · learn/reading.js — reading mode, the pure parts. PURE (the storage is passed in).
   Which section is in view (the "On this page" highlight), how far down the article the reader is (the progress
   bar), and the articles this browser has read (the Learn index's read / unread mark). */

/** The article counts as read once the reader is this far down it (the sources and terms are the last tenth). */
export const READ_AT = 0.9
/** localStorage key: a JSON list of article ids read in this browser. */
export const READ_KEY = 'rig.learn.read.v1'

/** Index of the last section whose top (px from the top of the view) has passed `line`; -1 above the first.
 *  A null top is a section that is not drawn. */
export function activeSection(tops, line) {
  let at = -1
  tops.forEach((t, i) => { if (t != null && t <= line) at = i })
  return at
}

/** 0 at the top of the article, 1 where its end reaches the bottom of the view.
 *  scrollTop: the scroller's; offsetTop: the article's top inside the scroller; height: the article's; viewport:
 *  the scroller's visible height. */
export function readingProgress({ scrollTop = 0, offsetTop = 0, height = 0, viewport = 0 } = {}) {
  const run = height - viewport
  if (!(height > 0)) return 0
  if (run <= 0) return 1
  const p = (scrollTop - offsetTop) / run
  return Number.isFinite(p) ? Math.min(1, Math.max(0, p)) : 0
}

/** The ids this browser has marked read; [] when storage is missing, blocked or holds something else. */
export function readIds(storage) {
  try {
    const v = JSON.parse(storage.getItem(READ_KEY) || '[]')
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []
  } catch {
    return []
  }
}

/** Mark `id` read and return the new list; a storage that throws keeps the page working (the mark is lost). */
export function markRead(storage, id) {
  const now = readIds(storage)
  const next = now.includes(id) ? now : [...now, id]
  try { storage.setItem(READ_KEY, JSON.stringify(next)) } catch { /* private window or blocked site data */ }
  return next
}

/** The browser's localStorage, or null where reading it throws. */
export function browserStorage() {
  try { return typeof window !== 'undefined' ? window.localStorage : null } catch { return null }
}
