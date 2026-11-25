/* Rig · status.js — a run's status as one of five names, for StatusIcon.jsx. PURE.
   pass · fail · cutoff (a fail that ended at the output limit before any patch) · ungraded · error. */

export const STATUSES = ['pass', 'fail', 'cutoff', 'ungraded', 'error']
export const STATUS_WORD = { pass: 'Pass', fail: 'Fail', cutoff: 'Cut off', ungraded: 'Ungraded', error: 'Error' }
const NAMES = { pass: 'pass', passed: 'pass', fail: 'fail', failed: 'fail', cutoff: 'cutoff', ungraded: 'ungraded', unknown: 'ungraded', error: 'error', harnesserror: 'error' }

/**
 * The status of a verdict (true / false / null), an outcome word ('Pass', 'Fail', 'Cut off', 'Ungraded')
 * or a status name. Anything else is ungraded, never a pass or a fail by accident.
 * @param {boolean|null|undefined|string} x
 * @returns {'pass'|'fail'|'cutoff'|'ungraded'|'error'}
 */
export function statusOf(x) {
  if (x === true) return 'pass'
  if (x === false) return 'fail'
  if (x == null) return 'ungraded'
  return NAMES[String(x).toLowerCase().replace(/[\s_-]/g, '')] || 'ungraded'
}
