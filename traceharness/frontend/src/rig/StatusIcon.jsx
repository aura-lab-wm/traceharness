/* Rig · StatusIcon.jsx — a run's status by shape and colour, in the rig's stroke icons.

   <StatusIcon status size? label? decorative? className?/>
     pass      a filled circle with a check (the one filled shape)
     fail      a circle with an x
     cutoff    a circle with a pause (the run stopped at the output limit)
     ungraded  a dashed circle with a dash (never drawn as a fail)
     error     a triangle with an exclamation mark
   `status` is a name, a verdict (true / false / null) or an outcome word (status.js statusOf). Alone it is
   an image named by its word (or `label`); beside its word pass `decorative`, so the word is read once.
   Never a ticked box: it reads as a checkbox. */
import { STATUS_WORD, statusOf } from './status'

const cx = (...a) => a.filter(Boolean).join(' ')
const SHAPES = {
  pass: <><circle className="rg-st-fill" cx="12" cy="12" r="9" /><path className="rg-st-mark" d="M8.2 12.4l2.6 2.6 5-5.4" /></>,
  fail: <><circle cx="12" cy="12" r="9" /><path d="M9.2 9.2l5.6 5.6M14.8 9.2l-5.6 5.6" /></>,
  cutoff: <><circle cx="12" cy="12" r="9" /><path d="M10.2 8.8v6.4M13.8 8.8v6.4" /></>,
  ungraded: <><circle cx="12" cy="12" r="9" strokeDasharray="3.3 2.35" /><path d="M9.5 12h5" /></>,
  error: <><path d="M12 3.6 21.2 19.6H2.8z" /><path d="M12 10v4.2M12 17.1h.01" /></>,
}

export function StatusIcon({ status, size = 16, label, decorative = false, className }) {
  const s = SHAPES[status] ? status : statusOf(status)
  const name = decorative ? {} : { role: 'img', 'aria-label': label || STATUS_WORD[s] }
  return (
    <svg className={cx('rg-st', `rg-st-${s}`, className)} data-status={s} width={size} height={size} viewBox="0 0 24 24" aria-hidden={decorative ? 'true' : undefined} {...name}>
      {SHAPES[s]}
    </svg>
  )
}
