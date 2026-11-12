// Display formatting shared by the workbench components. Every number shown is one of three
// kinds: exact (bytes, counts, digests), estimate (always with "≈" or the word "estimate") or
// measured (reported by a run). A value that was not reported reads "not reported", never 0.
export const STATE_LABELS = { keep: 'Baseline', replace: 'Replacement', disable: 'Disabled' }
export const ESTIMATE_TOOLTIP = 'Estimate: characters divided by 3.9. Not billed tokens. Measured input tokens appear in run results.'
export const SUM_CAPTION = 'Sums over inventory fragments. A single request contains only some of them; measured input tokens come from a run.'
export const NOT_REPORTED = 'not reported'

export const formatCount = (value) => Number(value).toLocaleString()

/** Text sizes: B, KB, MB (decimal), exact below 1,000 bytes. */
export function formatBytes(value) {
  const bytes = Number(value)
  if (!Number.isFinite(bytes)) return NOT_REPORTED
  if (Math.abs(bytes) < 1000) return formatCount(bytes) + ' B'
  if (Math.abs(bytes) < 1000000) return (bytes / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 }) + ' KB'
  return (bytes / 1000000).toLocaleString(undefined, { maximumFractionDigits: 2 }) + ' MB'
}

/** Contract limits are defined in KiB, so sizes measured against them use KiB. */
export function formatKiB(value) {
  const bytes = Number(value)
  if (!Number.isFinite(bytes)) return NOT_REPORTED
  return (bytes / 1024).toLocaleString(undefined, { maximumFractionDigits: bytes < 10240 ? 1 : 0 }) + ' KiB'
}

export const formatSigned = (value, format = formatCount) => (value > 0 ? '+' : value < 0 ? '−' : '±') + format(Math.abs(value))

export const formatMoney = (value) => value === null || value === undefined || !Number.isFinite(Number(value)) ? NOT_REPORTED
  : '$' + Number(value).toLocaleString(undefined, { maximumFractionDigits: 6 })

export const formatMaybe = (value, format = formatCount) => value === null || value === undefined || !Number.isFinite(Number(value)) ? NOT_REPORTED : format(value)

export const shortDigest = (value, size = 12) => typeof value === 'string' ? value.slice(0, size) : ''

export const plural = (count, one, many = one + 's') => formatCount(count) + ' ' + (count === 1 ? one : many)

/** Codex titles repeat a file name and its full path. Show the name; keep the path beside it. */
export function promptDisplay(block) {
  const parts = block.title.split(' · ')
  return parts.length === 2 && parts[1].endsWith('/' + parts[0]) ? { title: parts[0], path: parts[1] } : { title: block.title, path: '' }
}

/** A date for a saved entry or an experiment. Accepts ISO text or epoch seconds. */
export function formatDate(value) {
  const date = typeof value === 'number' ? new Date(value * 1000) : new Date(value)
  return Number.isNaN(date.getTime()) ? 'date not reported' : date.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

/** True when the element currently has a box (it is not hidden by a layout tier). */
export const isDisplayed = (element) => !!element && typeof element.getClientRects === 'function' && element.getClientRects().length > 0

/** True when a key press belongs to a text field, select or other control that uses it. */
export function typingTarget(target) {
  if (!target || typeof target.closest !== 'function') return false
  if (target.isContentEditable) return true
  const tag = target.tagName
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (tag === 'INPUT') return !['checkbox', 'radio', 'button', 'submit', 'reset', 'file', 'range'].includes(target.type)
  return false
}
