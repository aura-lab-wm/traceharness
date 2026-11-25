/* Rig · TourButton.jsx — "Tour" at the top right of the top bar on every page, between the search field and Help: a
   play icon and the word. A click plays the tour of the page in view (Tour.jsx; the steps are pageTours.js). On a
   phone the bar has no room left for it beside the document switcher's title, so it is the first item of the bar's
   More menu instead (RigApp Controls), and the More button carries the pulse.
   useTourPulse: the first time a page type is shown, the button pulses once (the --rig-dur-pulse token; none under
   reduced motion, rig.css), and the page type is remembered as seen in rig.pagetour.v1; it never opens a tour. */
import { useEffect, useState } from 'react'
import { Icon } from './ui'
import { markPageTour, pageTourSeen } from './pageTourPrefs'

const PULSED = new Map(), PULSE_MS = 1400   // page type -> when its button first pulsed: the 1.2 s pulse and a little more

/** Does the Tour button pulse now? `tourKey` is pageTourKey() of the page in view. */
export function useTourPulse(tourKey) {
  // a page that redraws the bar while the pulse runs keeps it, instead of losing it to the mark; a later visit does not pulse
  const [, redraw] = useState(0)
  useEffect(() => {
    if (!tourKey || pageTourSeen(tourKey)) return
    PULSED.set(tourKey, Date.now())
    markPageTour(tourKey, 'seen')
    redraw((n) => n + 1)
  }, [tourKey])
  return !!tourKey && PULSED.has(tourKey) && Date.now() - PULSED.get(tourKey) < PULSE_MS
}

/** <TourButton pulse onStart/> — `onStart()` starts the tour of the page in view. */
export default function TourButton({ pulse, onStart }) {
  return (
    <button type="button" className={pulse ? 'rg-tourbtn pulse' : 'rg-tourbtn'} data-el="tour-this-page" aria-label="Tour this page"
      data-hint="A guided tour of this page" onClick={() => onStart()}>
      <Icon name="play" size={14} /><span className="rg-tourbtn-l">Tour</span>
    </button>
  )
}
