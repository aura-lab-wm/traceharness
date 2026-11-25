/* Rig · harnessNames.js — one name per engine, and the names given to saved harnesses.
   A TraceHarness copy is TraceHarness running its own copy of an app's prompt and tools (a stand-in);
   your installed app is the app itself, run by the local runner (a native agent). */
export const standInName = (name) => `${name} — TraceHarness copy`
export const nativeName = (runtime) => `${runtime.name} — your installed app${runtime.available ? '' : ' (not connected)'}`

/* A saved harness is stored by its content ID (min_…), with no name of its own. The name given at Save is kept on
   this computer (the library's names.json, listed as `names`) so every browser shows it; this browser keeps a copy
   as the fallback. */
const NAMES_KEY = 'traceharness.harness-names'
const readNames = () => { try { const v = JSON.parse(localStorage.getItem(NAMES_KEY) || '{}'); return v && typeof v === 'object' && !Array.isArray(v) ? v : {} } catch { return {} } }
/** A name as it is saved: whitespace collapsed, at most 80 characters; '' when there is none. */
export const cleanHarnessName = (name) => String(name || '').replace(/\s+/g, ' ').trim().slice(0, 80)
const given = (v) => (typeof v === 'string' && v.trim() ? v.trim() : '')
/** "Minimal harness · 6 steps": what a saved harness is called when nobody named it. */
export const defaultHarnessName = (record) => `Minimal harness${Number.isFinite(record && record.max_steps) ? ` · ${record.max_steps} steps` : ''}`
/** The name a saved harness was given: the one stored on this computer (`stored`, the list's `names`), else the
 *  one kept in this browser, else its default. */
export const savedHarnessName = (record, stored) => {
  const id = record && record.id
  return (id && stored && Object.hasOwn(stored, id) && given(stored[id])) || (id && given(readNames()[id])) || defaultHarnessName(record)
}
/** Remember `name` for the harness `id` in this browser; true when it was kept. */
export function rememberHarnessName(id, name) {
  const clean = cleanHarnessName(name)
  if (!id || !clean) return false
  try { localStorage.setItem(NAMES_KEY, JSON.stringify({ ...readNames(), [id]: clean })); return true } catch { return false }
}
