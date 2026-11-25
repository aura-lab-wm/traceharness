/* Rig · tours/words.js — what the page tours share. PURE.
   HEAD is the page header (PageHeader, level 1); q is the page reader Tour.pageQuery() hands a step's body. */
export const HEAD = '[data-tour="page-header"]'

/** The fix marker's own words on a run page ("the fix" or "the last edit"), from its Jump button. */
export const jumpWords = (q) => q.text('[data-el="jump-to-fix"]').replace(/^Jump to\s+/, '').split(' · ')[0]

/** The marks of a value the source did not record that a part of the page shows, in words. */
export function unrecorded(q, sel) {
  const t = q.text(sel)
  // "not recorded" says so itself; the other two marks are named
  const marks = [/—/.test(t) && '“—”', /\bunknown\b/.test(t) && '“unknown”'].filter(Boolean)
  return marks.length ? ` ${marks.join(' and ')} mean${marks.length > 1 ? '' : 's'} not recorded.` : ''
}

/** A clause said only where the page draws `sel`. */
export const when = (q, sel, words) => (q.has(sel) ? words : '')
