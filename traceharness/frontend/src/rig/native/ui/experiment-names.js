// Names of paired experiments created or opened in this browser. The runner's experiment list
// carries no name (it is summary-only), so the panel remembers `id -> name` locally and says
// "name not loaded" for everything else. Names only: never a plan, a profile or prompt text.
import { MEMBER } from '../../../member-api'

const LIMIT = 64
const NAME_MAX = 120
const ID = /^[a-f0-9]{48}$/
const CREDENTIAL = /sk-[A-Za-z0-9_-]{8,}|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}|Bearer\s+[A-Za-z0-9._~+/-]{8,}/

export const experimentNamesKey = (scope) => scope
  ? 'traceharness.native.member.' + scope + '.experiment-names.v1' : 'traceharness.native.experiment-names.v1'

const usableName = (value) => typeof value === 'string' && !!value.trim() && value.length <= NAME_MAX
  && ![...value].some((char) => char.codePointAt(0) < 32 || char.codePointAt(0) === 127) && !CREDENTIAL.test(value)

function rows(storage, scope) {
  if (!storage) return []
  try {
    const value = JSON.parse(storage.getItem(experimentNamesKey(scope)) || 'null')
    if (!value || value.version !== 1 || !Array.isArray(value.names)) return []
    const seen = new Set()
    return value.names.filter((row) => Array.isArray(row) && row.length === 2 && ID.test(row[0]) && usableName(row[1])
      && !seen.has(row[0]) && seen.add(row[0])).slice(-LIMIT)
  } catch { return [] }
}

/** A plain `{ id: name }` object for the experiments remembered in this browser. Never throws. */
export function readExperimentNames(storage, scope) {
  return Object.fromEntries(rows(storage, scope))
}

/** Remember one name (newest last, at most 64). Returns true when it was stored. */
export function rememberExperimentName(storage, scope, id, name) {
  if (!storage || !ID.test(String(id)) || !usableName(name)) return false
  const next = [...rows(storage, scope).filter((row) => row[0] !== id), [id, name.trim()]].slice(-LIMIT)
  try { storage.setItem(experimentNamesKey(scope), JSON.stringify({ version: 1, names: next })); return true } catch { return false }
}

export function forgetExperimentNames(storage, scope) {
  try { storage?.removeItem(experimentNamesKey(scope)); return true } catch { return false }
}

/** The signed-in member scope, or null outside member mode. */
export const experimentNameScope = () => MEMBER?.scope || null

/** This browser's localStorage when it accepts a write, otherwise null. Never throws. */
export function experimentNameStorage() {
  try {
    const storage = globalThis.localStorage
    if (!storage) return null
    const probe = 'traceharness.native.experiment-names.probe'
    storage.setItem(probe, '1')
    storage.removeItem(probe)
    return storage
  } catch { return null }
}
