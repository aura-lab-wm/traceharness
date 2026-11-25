/* Rig · TourOffer.jsx — a first visit's offer of the site tour: a small card in the corner, not a
   dialog, so the page under it (a deep link included) stays usable. Taking the tour or saying no
   thanks puts it away for good (prefs: rig.tour.v1). */
import { useId } from 'react'
import { Icon } from './ui'

export default function TourOffer({ onStart, onDismiss }) {
  const id = useId()
  return (
    <section className="rg-tour-offer" data-el="tour-offer" role="region" aria-labelledby={`${id}-t`}>
      <Icon name="q" size={16} />
      <div className="rg-grow">
        <p className="rg-tour-offer-t" id={`${id}-t`}>New here?</p>
        <p className="rg-tour-offer-b">Seven short steps show where the datasets, runs and analysis pages are.</p>
        <div className="rg-tour-offer-a">
          <button type="button" className="rg-btn pri" onClick={onStart}>Take the 1-minute tour</button>
          <button type="button" className="rg-btn ghost" onClick={onDismiss}>No thanks</button>
        </div>
      </div>
    </section>
  )
}
