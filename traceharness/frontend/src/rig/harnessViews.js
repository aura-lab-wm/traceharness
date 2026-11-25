/* The Harnesses page has one job per view. The view is a `view:<id>` pair in the tab's spec
   (harnesses:view:experiments), so each view has its own link. The pair is not part of the
   document's identity: RigApp keys the mounted page by docKey(spec), so switching views keeps
   every draft, capture and running job on the page. */
import { makeSpec, parseSpec } from './route'
import { stripVS } from './viewState'

export const HARNESS_VIEWS = [
  { id: 'setup', label: 'One run' },
  { id: 'experiments', label: 'Experiments' },
  { id: 'versions', label: 'Saved versions' },
  { id: 'file', label: 'Configuration file' },
  { id: 'runs', label: 'Recent runs' },
]
const IDS = new Set(HARNESS_VIEWS.map((v) => v.id))

/** The view a Harnesses tab shows: the last `view:<id>` pair in its args, else 'setup'. */
export function harnessView(args = []) {
  const at = args.lastIndexOf('view')
  const id = at >= 0 ? args[at + 1] : null
  return IDS.has(id) ? id : 'setup'
}

/** The same args without any `view:<id>` pair. */
function withoutView(args = []) {
  const out = []
  for (let i = 0; i < args.length; i++) {
    if (args[i] === 'view' && i + 1 < args.length) { i++; continue }
    out.push(args[i])
  }
  return out
}

/** The spec of a Harnesses tab showing `view`; 'setup' (the default) writes no pair. */
export function harnessSpec(args = [], view = 'setup') {
  const rest = withoutView(args)
  return IDS.has(view) && view !== 'setup' ? makeSpec('harnesses', ...rest, 'view', view) : makeSpec('harnesses', ...rest)
}

/** What a mounted page is keyed by: the spec without its `view:<id>` pair. */
export function docKey(spec) {
  const s = stripVS(spec)
  const { kind, args } = parseSpec(s)
  if (kind !== 'harnesses' || !args.includes('view')) return s
  const chain = s.indexOf('~') < 0 ? '' : s.slice(s.indexOf('~'))
  return harnessSpec(args) + chain
}

/** The one-shot directives a Harnesses link may carry before its view and origin: json, customize,
 *  guided, custom, fixed[:<card>], saved:<id>, fork:<id>. The page applies one when it opens; it is not
 *  part of which page is open. */
const DIRECTIVE_ARITY = { json: 0, customize: 0, guided: 0, custom: 0, fixed: 1, saved: 1, fork: 1 }
/** The Harnesses args without their one-shot directive (args[0], and its value), keeping view and origin. */
export function withoutDirective(args = []) {
  const n = DIRECTIVE_ARITY[args[0]]
  if (n == null) return [...args]
  return args.slice(args[0] === 'fixed' && (args[1] === 'view' || args[1] === 'from' || args[1] == null) ? 1 : 1 + n)
}
const originArgs = (args = []) => { const at = args.lastIndexOf('from'); return at >= 0 && args[at + 1] ? ['from', args[at + 1]] : [] }
const chainOf = (s) => (s.indexOf('~') < 0 ? '' : s.slice(s.indexOf('~')))
const shortModel = (m) => (String(m ?? '').includes('/') ? String(m).split('/').slice(1).join('/') : String(m ?? ''))
/** Where a page that names a condition keeps its model: the argument index. */
const MODEL_AT = Object.freeze({ ds: 1, an: 2, tasks: 1, task: 1, lanes: 1, field: 1 })
const withShortModel = (kind, args) => {
  const at = MODEL_AT[kind]
  return at == null || !args[at] ? args : args.map((a, i) => (i === at ? shortModel(a) : a))
}

/** What the pane keys the drawn page by. A page stays mounted while the reader moves inside it, so its
 *  scroll, focus and unsaved input stay: a run across its steps (run:<id>:s<n>), a task across its runs and
 *  evidence tabs (task:<dir>:<model>:<harness>:<task>, the first four args), an event ledger across its
 *  events (span:<id>, fork:<id>), the all-runs view across its focus, Harnesses across its views and its
 *  one-shot directives (harnesses + its evidence origin), a dataset's Runs list across its scope
 *  (field:<dir>). A short and a full model id are one page.
 *  Everything else is docKey. */
export function mountKey(spec) {
  const s = String(spec || '')
  const { kind, args: raw } = parseSpec(s)
  const args = withShortModel(kind, raw)
  const chain = chainOf(s)
  if (kind === 'lanes') return makeSpec('lanes', ...args.slice(0, 4))
  if (kind === 'task') return makeSpec('task', ...args.slice(0, 4)) + chain
  if ((kind === 'span' || kind === 'fork' || kind === 'run') && args.length >= 1) return makeSpec(kind, args[0]) + chain
  if (kind === 'harnesses') return makeSpec('harnesses', ...originArgs(args)) + chain
  // the Runs list of a dataset stays mounted across its model and harness scope (its search and chips stay);
  // a condition's Tasks page across its "better / worse than" filter and its spread order
  if (kind === 'field') return makeSpec('field', args[0]) + chain
  if (kind === 'tasks') return makeSpec('tasks', ...args.slice(0, 3)) + chain
  if (MODEL_AT[kind] != null) return docKey(makeSpec(kind, ...args) + chain)
  return docKey(s)
}

/** One address per page: the old spellings of a page name it the same way (Session capture is `capture`,
 *  Import files is `sources`, Advanced settings is `harnesses:customize`). */
export function canonicalAddress(spec) {
  const s = String(spec || '')
  const { kind, args } = parseSpec(s)
  const chain = chainOf(s)
  if (kind === 'sources' && args[0] === 'capture') return 'capture' + chain
  if (kind === 'sources' && args[0] === 'import') return makeSpec('sources', ...args.slice(1)) + chain
  if (kind === 'blocks' && args[0] === 'customize') return makeSpec('harnesses', ...args) + chain
  return s
}

/** The page and what it shows, in one spelling, so two links that show the same thing compare equal: the
 *  address made canonical, the page's own selections (viewState) left out, a model by its short id, the
 *  Harnesses view written last, and a page that names no condition given the one it shows
 *  (`resolve(dir)` → { model, harness }, the condition in focus for that dataset). A link to a Harnesses
 *  directive (harnesses:fixed:codex) is a request of its own, so it keeps it. */
export function canonSpec(spec, resolve) {
  const s = stripVS(canonicalAddress(spec))
  const { kind, args: raw } = parseSpec(s)
  const chain = chainOf(s)
  let args = withShortModel(kind, raw)
  if (kind === 'harnesses') return harnessSpec(args, harnessView(args)) + chain
  if (kind === 'an' && !args[1]) args = [args[0], 'family', ...args.slice(2)]
  const at = MODEL_AT[kind]
  // a bare Runs list (field:<dir>) lists every model: it names no condition, so none is filled in
  if (at != null && ['ds', 'an', 'tasks'].includes(kind) && args[0] && !args[at] && typeof resolve === 'function') {
    const c = resolve(args[0]) || {}
    if (c.model) {
      const next = [...args]
      next[at] = shortModel(c.model)
      if (!next[at + 1]) next[at + 1] = c.harness || ''
      args = next
    }
  }
  return makeSpec(kind, ...args) + chain
}

/** The page a spec opens, whatever it shows inside it: the tab it belongs in. */
export const pageKey = (spec, resolve) => mountKey(canonSpec(spec, resolve))
