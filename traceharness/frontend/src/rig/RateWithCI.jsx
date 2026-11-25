/* Rig · RateWithCI.jsx — a rate with its uncertainty, in the rig's own figures.

   <RateWithCI rate ci? n? rank? el? bar? classes?/>
     "62.5% ± 8.7", then a thin bar to the rate with the 95% interval as a whisker over it. `ci` is the
     interval the backend computed ([lo, hi], 0..1); without one there is no ± and no whisker. `n` (the
     graded runs) goes in the hover card with the exact interval. `rank` ("=1", rate.js rankLabels) goes in
     front. `classes` ({ root, value, bar }) lets a table keep its own column rules.
   <RateBar rate lo? hi? label? className?/>   the bar and whisker alone (a headline that sets its own figure). */
import { rateParts } from './rate'
import { fmt } from './data'
import './rate.css'

const cx = (...a) => a.filter(Boolean).join(' ')
const clamp = (v) => Math.max(0, Math.min(1, v))
const at = (v) => `${+(clamp(v) * 100).toFixed(2)}%`

export function RateBar({ rate, lo, hi, label, className }) {
  const has = lo != null && hi != null
  return (
    <span className={cx('rg-rate-bar', className)} role="img" aria-label={label}>
      <i style={{ width: at(rate) }} />
      {has && <b className="rg-rate-w" style={{ left: at(lo), width: `${+((clamp(hi) - clamp(lo)) * 100).toFixed(2)}%` }} />}
    </span>
  )
}

/** The words of a rate's hint: "62.5%, 95% interval … · over 120 graded runs". */
export const rateWords = (rate, ci, n) => { const p = rateParts(rate, ci); return n != null ? `${p.words} · over ${fmt.plural(n, 'graded run')}` : p.words }

/** `hint` false leaves the words to a card the caller draws around it (one card, not two). */
export function RateWithCI({ rate, ci, n, rank, el, bar = true, classes = {}, hint = true }) {
  const p = rateParts(rate, ci)
  return (
    <span className={cx('rg-rate', classes.root)} data-el={el} data-hint={hint ? rateWords(rate, ci, n) : undefined}>
      {rank && <span className="rg-rate-rank">{rank}</span>}
      <span className={cx('rg-rate-v rg-mono', classes.value)}>{p.value}</span>
      {p.pm && <span className="rg-rate-pm">{p.pm}</span>}
      {bar && rate != null && <RateBar rate={rate} lo={p.lo} hi={p.hi} label={p.words} className={classes.bar} />}
    </span>
  )
}
