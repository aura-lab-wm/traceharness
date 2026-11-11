/** Keep credentials connected while either experiment view owns unresolved work.
 * History is an observation, not authority to release another view's Start.
 * Only a validated response for that experiment or a definite refusal releases
 * its hold. Nothing here persists a credential or starts/retries any work.
 */
export function createExperimentConnectionLease() {
  let observedActive = false
  const held = new Set()
  return {
    get current() { return observedActive || held.size > 0 },
    set current(value) { observedActive = Boolean(value) },
    reserve(id) { held.add(id) },
    confirm(record) {
      if (['running', 'cancelling'].includes(record.status)) held.add(record.id)
      else held.delete(record.id)
    },
    release(id) { held.delete(id) },
  }
}
