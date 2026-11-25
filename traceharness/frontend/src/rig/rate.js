/* Rig · rate.js — a rate with its uncertainty, in words (RateWithCI.jsx). PURE.
   "62.5% ± 8.7": the rate, then half the 95% interval's width in points (the interval the backend
   computed: /metrics ci95 per condition, /overview pass_ci95 per dataset). Ties ranked "=1". */

const pc = (v) => `${(v * 100).toFixed(1)}%`

/**
 * @param {number|null|undefined} rate  0..1
 * @param {[number|null, number|null]|null|undefined} ci  the 95% interval, 0..1
 * @returns {{value: string, pm: string|null, lo: number|null, hi: number|null, words: string}}
 */
export function rateParts(rate, ci) {
  if (rate == null || Number.isNaN(rate)) return { value: '—', pm: null, lo: null, hi: null, words: 'not graded' }
  const has = !!ci && ci[0] != null && ci[1] != null
  if (!has) return { value: pc(rate), pm: null, lo: null, hi: null, words: `${pc(rate)}, no interval` }
  const [lo, hi] = ci
  return { value: pc(rate), pm: `± ${((hi - lo) * 50).toFixed(1)}`, lo, hi, words: `${pc(rate)}, 95% interval ${pc(lo)} to ${pc(hi)}` }
}

/**
 * Ranks for figures in display order: ties share a rank marked "=" ("=1"), the next rank skips them;
 * an unknown figure has none ("—").
 * @param {Array<number|null>} values
 * @param {{higherIsBetter?: boolean}} [opts]
 * @returns {string[]}
 */
export function rankLabels(values, { higherIsBetter = true } = {}) {
  return values.map((v) => {
    if (v == null) return '—'
    const better = values.filter((x) => x != null && (higherIsBetter ? x > v : x < v)).length
    const tied = values.filter((x) => x === v).length > 1
    return `${tied ? '=' : ''}${better + 1}`
  })
}
