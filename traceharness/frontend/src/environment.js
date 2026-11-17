/* Which console this is (SPEC 4.2) and what it can do here. TraceHarness runs only on the user's
   machine (0.6.0), so there are two modes:

   local   served by `python -m traceharness`: no embedded snapshot.
   export  a file written by --export: window.__TRACEHARNESS_DATA__ is set.

   The capability table is compiled in from the shared sources. The local runner's capabilities
   (SHARED.environment.runner) depend on this machine: they start as runner_not_ready, and
   applyRuntime() takes the backend's /api/environment answer before the first render (main.jsx).
   This module must not import api.js. Capabilities drive display only: every server keeps its own checks. */
import { LOCAL_APP, SHARED } from './shared/index.js'

const TABLE = SHARED.environment.table
const MESSAGES = SHARED.environment.messages
const RUNNER = new Set(SHARED.environment.runner || [])

function detectMode() {
  const win = typeof window === 'undefined' ? undefined : window
  return win && win.__TRACEHARNESS_DATA__ ? 'export' : 'local'
}

export const MODE = detectMode()
/** { available, store, label }: where saved harnesses live in this mode. */
export const LIBRARY = SHARED.environment.library[MODE]
export const HAS_LIBRARY = LIBRARY.available === true

const capabilities = Object.fromEntries(SHARED.environment.capabilities.map((id) => {
  const base = TABLE[id][MODE]
  const reason = base === 'ok' && RUNNER.has(id) ? 'runner_not_ready' : base
  return [id, Object.freeze({ available: reason === 'ok', reason })]
}))

export const ENV = Object.freeze({
  schema: SHARED.schema,
  mode: MODE,
  package_version: SHARED.package_version,
  local_app: LOCAL_APP,
  library: LIBRARY,
  capabilities,
})

/** Take the backend's live reasons for the local runner's capabilities. Only the local console
    applies them, only for the runner capabilities, and only reasons the shared table knows. */
export function applyRuntime(answer) {
  if (MODE !== 'local' || !answer || typeof answer !== 'object' || !answer.capabilities) return
  for (const id of RUNNER) {
    const reason = answer.capabilities[id]?.reason
    if (TABLE[id]?.[MODE] !== 'ok' || typeof reason !== 'string') continue
    if (reason !== 'ok' && !Object.hasOwn(MESSAGES, reason)) continue
    capabilities[id] = Object.freeze({ available: reason === 'ok', reason })
  }
}

const entry = (id) => (Object.hasOwn(capabilities, id) ? capabilities[id] : null)

/** True when the capability is available here. An unknown id is not. */
export const can = (id) => entry(id)?.available === true
/** "ok", "export_read_only", "runner_not_ready", ...; "unavailable" for an unknown id. */
export const reasonFor = (id) => entry(id)?.reason ?? 'unavailable'

/** The sentence that says why `what` is not available here, or '' when it is. */
export function why(id, what) {
  if (can(id)) return ''
  const template = MESSAGES[reasonFor(id)] ?? MESSAGES.unavailable
  const fill = { what: String(what), command: LOCAL_APP.command, url: LOCAL_APP.url }
  return template.replace(/\{(what|command|url)\}/g, (_, key) => fill[key])
}
