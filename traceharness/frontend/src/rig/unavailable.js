/* One note for "not available here" (SPEC 4.2): why(capability, what), with the capability and the
   reason on data attributes so a test or a proof can find it. Renders nothing when the capability
   is available. A .js file built with createElement, so it is not an orphan .jsx before a view
   imports it. */
import { createElement } from 'react'
import { can, reasonFor, useEnvironment, why } from '../environment.js'

export function Unavailable({ capability, what, el = 'unavailable-note' }) {
  useEnvironment()
  if (can(capability)) return null
  return createElement('div', {
    className: 'rg-note',
    'data-el': el,
    'data-capability': capability,
    'data-reason': reasonFor(capability),
  }, why(capability, what))
}
