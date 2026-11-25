/* Rig · anHead.jsx — the answer head and the sections of an analysis document (views/analysis.css).
   Shared by views/analysis.jsx and TokensView.jsx, which would otherwise import each other. */
import { InfoTip } from './Inspector'

const cx = (...a) => a.filter(Boolean).join(' ')

/** The answer under the Asking line: one sentence (`lead`) with the "i" that explains the view (`about`,
 *  closed until asked for), the view's actions at its right, and an optional muted line (`sub`). */
export function Head({ lead, sub, about, actions, el }) {
  const info = about ? <InfoTip label="About this view" el="about-view">{about}</InfoTip> : null
  return (
    <div className="rg-an-head">
      {(lead || actions || info) && (
        <div className="rg-an-ans">
          {lead ? <><p className="rg-an-lead" data-el={el}>{lead}</p>{info}</> : <span className="rg-grow">{info}</span>}
          {actions && <span className="rg-an-acts">{actions}</span>}
        </div>
      )}
      {sub && <p className="rg-an-sub">{sub}</p>}
    </div>
  )
}
/** A section: heading + whitespace instead of another box. `info` puts an (i) after the title that opens the
 *  exact definition or formula of what the section shows. */
export function Sec({ title, info, meta, actions, el, children, className }) {
  const name = typeof title === 'string' ? title : undefined
  return (
    <section className={cx('rg-an-sec', className)} data-el={el} aria-label={name}>
      {(title || meta || actions) && (
        <div className="rg-an-sech"><h2>{title}{info && <InfoTip label={`How ${name || 'this'} is worked out`} el="sec-info">{info}</InfoTip>}</h2>{meta && <span className="rg-an-sechm">{meta}</span>}{actions && <span className="rg-an-secha">{actions}</span>}</div>
      )}
      {children}
    </section>
  )
}
