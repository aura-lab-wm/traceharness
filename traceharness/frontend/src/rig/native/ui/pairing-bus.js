// A one-slot, in-page hand-off from the Native Prompts workbench to the "Compare prompt variants"
// panel. The host passes neither component a reference to the other, so the workbench publishes
// "pair this exact profile against its baseline" here and the experiments panel takes it once its
// own `configuration` prop carries that same profile. Nothing here touches storage or the network,
// and a request never carries inventory text: only the member's profile as canonical JSON.
import { stableJSON } from '../../paired-experiments-state'

const LABEL_MAX = 80
const REQUEST_MAX_AGE_MS = 5 * 60 * 1000
let pending = null
const listeners = new Set()

const printable = (value) => typeof value === 'string' && !!value.trim() && value.length <= LABEL_MAX
  && ![...value].some((char) => char.codePointAt(0) < 32 || char.codePointAt(0) === 127)

/** The comparison key both sides compute: sorted keys, no whitespace, overrides as carried. */
export const pairingKey = (profile) => stableJSON(profile)

function notify() {
  for (const listener of Array.from(listeners)) {
    try { listener(pending) } catch { /* A failing listener must not block the others. */ }
  }
}

/** Publish a request. Returns the stored request, or throws with a sentence for the member. */
export function requestPairing({ profile, label, includeNoneIncluded = false, now = Date.now() }) {
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) throw new Error('Pairing needs the current native prompt profile.')
  if (!printable(label)) throw new Error('Name the edited arm with 1–80 printable characters.')
  pending = Object.freeze({ key: pairingKey(profile), runtime_id: String(profile.runtime_id || ''), label: label.trim(),
    include_none_included: includeNoneIncluded === true, requested_at: now })
  notify()
  return pending
}

/** The request still waiting, or null. A request older than five minutes is dropped. */
export function pendingPairing(now = Date.now()) {
  if (pending && now - pending.requested_at > REQUEST_MAX_AGE_MS) pending = null
  return pending
}

/** Take the pending request only when it was made for exactly this version-2 configuration. */
export function takePairing(configuration, now = Date.now()) {
  const request = pendingPairing(now)
  if (!request || configuration?.version !== 2 || !configuration.native_prompt_profile
    || configuration.runtime_id !== request.runtime_id || pairingKey(configuration.native_prompt_profile) !== request.key) return null
  pending = null
  notify()
  return request
}

export function clearPairing() {
  if (!pending) return
  pending = null
  notify()
}

/** Listener receives the pending request (or null) after every change. Returns unsubscribe. */
export function subscribePairing(listener) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
