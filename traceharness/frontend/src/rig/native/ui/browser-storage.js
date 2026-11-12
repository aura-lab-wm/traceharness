// Access to this browser's localStorage for the workbench's "saved in this browser" features.
// Storage can be absent, blocked by policy, or throw on first touch (private modes): every caller
// receives either a working Storage or null and shows "cannot store" copy instead of failing.
import { MEMBER } from '../../../member-api'

/** localStorage when it accepts a write, otherwise null. Never throws. */
export function browserStorage() {
  try {
    const storage = globalThis.localStorage
    if (!storage) return null
    const probe = 'traceharness.native.storage-probe'
    storage.setItem(probe, '1')
    storage.removeItem(probe)
    return storage
  } catch { return null }
}

/** The signed-in member scope, or null outside member mode. Keys are namespaced by it. */
export const memberScope = () => MEMBER?.scope || null
