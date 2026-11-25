/* Rig · recent.js — the last dataset, task and run this browser opened, for Home's "Pick up where you left off".
   Kept in localStorage (rig.recent.v1) as { ds, task, run }: one entry per kind, { kind, spec, dir, task, run, at }.
   The spec is the page itself, without a step, a selection or an evidence chain. The storage is passed in; a
   storage that is missing, blocked or holds anything else reads as no history and is never written to by force. */
import { makeSpec, parseSpec } from './route'

export const RECENT_KEY = 'rig.recent.v1'
const KINDS = ['ds', 'task', 'run']
const isText = (v) => typeof v === 'string' && v !== '' && v.length < 400

/** The page a spec shows, as a link to keep, or null for a page this list does not hold. */
function pageOf(spec) {
  const { kind, args } = parseSpec(spec)
  if (kind === 'ds' && args[0]) return makeSpec('ds', ...args.slice(0, 3))
  if (kind === 'task' && args.length >= 4 && args.slice(0, 4).every(Boolean)) return makeSpec('task', ...args.slice(0, 4))
  if (kind === 'run' && args[0]) return makeSpec('run', args[0])
  return null
}

function readAll(storage) {
  try {
    const v = JSON.parse(storage.getItem(RECENT_KEY) || '{}')
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {}
  } catch {
    return {}
  }
}

/** Note that `spec` was opened; `ctx` is what the page is about ({ dir, task, run }). */
export function noteVisit(storage, spec, ctx = {}, at = Date.now()) {
  const page = pageOf(spec)
  if (!page || !storage) return
  const kind = parseSpec(page).kind
  const c = ctx || {}
  const entry = { kind, spec: page, at, ...(isText(c.dir) && { dir: c.dir }), ...(isText(c.task) && { task: c.task }), ...(isText(c.run) && { run: c.run }) }
  try {
    const all = readAll(storage)
    storage.setItem(RECENT_KEY, JSON.stringify({ ...Object.fromEntries(KINDS.filter((k) => all[k]).map((k) => [k, all[k]])), [kind]: entry }))
  } catch { /* blocked storage: this visit is not remembered */ }
}

/** The entries kept, newest first; an entry that does not read as one of ours is left out. */
export function readRecent(storage) {
  if (!storage) return []
  const all = readAll(storage)
  return KINDS.map((k) => all[k])
    .filter((e) => e && typeof e === 'object' && KINDS.includes(e.kind) && isText(e.spec) && Number.isFinite(e.at) && pageOf(e.spec) === e.spec && parseSpec(e.spec).kind === e.kind)
    .map((e) => ({ kind: e.kind, spec: e.spec, at: e.at, dir: isText(e.dir) ? e.dir : null, task: isText(e.task) ? e.task : null, run: isText(e.run) ? e.run : null }))
    .sort((a, b) => b.at - a.at)
}
