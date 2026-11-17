/* Which console this is (SPEC 4.2) and what it can do here.

   local   served by `python -m traceharness`: no embedded snapshot.
   export  a file written by --export: window.__TRACEHARNESS_DATA__ is set.
   member  the snapshot served to a signed-in member: the data is set and the Worker's marker
           window.__TRACEHARNESS_MEMBER__ is { version: 1, scope: <24 hex> } (the test member-api.js uses).

   The capability table is compiled in from the shared sources, so an older snapshot without
   /environment still gets the right answers. This module reads the two globals itself and must not
   import api.js or member-api.js. Capabilities drive display only: every server keeps its own checks. */
import { LOCAL_APP, SHARED } from './shared/index.js'

const SCOPE = /^[a-f0-9]{24}$/

function detectMode() {
  const win = typeof window === 'undefined' ? undefined : window
  if (!win || !win.__TRACEHARNESS_DATA__) return 'local'
  const marker = win.__TRACEHARNESS_MEMBER__
  return marker?.version === 1 && SCOPE.test(marker.scope) ? 'member' : 'export'
}

const TABLE = SHARED.environment.table
const MESSAGES = SHARED.environment.messages

export const MODE = detectMode()
/** { available, store, label }: where saved harnesses live in this mode. */
export const LIBRARY = SHARED.environment.library[MODE]
export const HAS_LIBRARY = LIBRARY.available === true
export const ENV = Object.freeze({
  schema: SHARED.schema,
  mode: MODE,
  package_version: SHARED.package_version,
  local_app: LOCAL_APP,
  library: LIBRARY,
  capabilities: Object.freeze(Object.fromEntries(SHARED.environment.capabilities.map((id) => [
    id, Object.freeze({ available: TABLE[id][MODE] === 'ok', reason: TABLE[id][MODE] }),
  ]))),
})

const entry = (id) => (Object.hasOwn(ENV.capabilities, id) ? ENV.capabilities[id] : null)

/** True when the capability is available in this mode. An unknown id is not. */
export const can = (id) => entry(id)?.available === true
/** "ok", "export_read_only", "local_only", "hosted_only", ...; "unavailable" for an unknown id. */
export const reasonFor = (id) => entry(id)?.reason ?? 'unavailable'

/** The sentence that says why `what` is not available here, or '' when it is. */
export function why(id, what) {
  if (can(id)) return ''
  const template = MESSAGES[reasonFor(id)] ?? MESSAGES.unavailable
  const fill = { what: String(what), command: LOCAL_APP.command, url: LOCAL_APP.url }
  return template.replace(/\{(what|command|url)\}/g, (_, key) => fill[key])
}
