// Undo and redo for authoring state. In memory only: it ends when the page is left.
// A history never clones a state: callers must treat states as immutable values, which
// is how the workbench already handles a draft.
import { utf8Bytes } from './text-metrics'

export const HISTORY_LIMITS = Object.freeze({ entries: 50, bytes: 8 * 1024 * 1024 })

const sizes = new WeakMap()

function sizeOf(entry) {
  let size = sizes.get(entry)
  if (size === undefined) {
    size = utf8Bytes(JSON.stringify(entry.state) ?? '') + utf8Bytes(entry.label)
    sizes.set(entry, size)
  }
  return size
}

/** Keep the newest entries: at most 50 and at most 8 MiB of serialized state. */
function bounded(entries) {
  let start = Math.max(0, entries.length - HISTORY_LIMITS.entries), total = 0
  for (let index = entries.length - 1; index >= start; index--) {
    total += sizeOf(entries[index])
    if (total > HISTORY_LIMITS.bytes && index < entries.length - 1) { start = index + 1; break }
  }
  return start ? entries.slice(start) : entries
}

const entryOf = (state, label) => ({ state, label: typeof label === 'string' ? label : '' })

export function createHistory() {
  return { past: [], future: [] }
}

/**
 * Record the state that existed BEFORE an edit, with a label naming the edit.
 * A new edit clears redo. The most recent step is always kept, even when it alone is
 * larger than the byte bound.
 */
export function historyPush(history, previous, label) {
  return { past: bounded([...history.past, entryOf(previous, label)]), future: [] }
}

/** Step back. Returns the state to show and the label of the edit that was undone, or null. */
export function historyUndo(history, current) {
  if (!history.past.length) return null
  const entry = history.past[history.past.length - 1]
  return { history: { past: history.past.slice(0, -1), future: bounded([...history.future, entryOf(current, entry.label)]) }, state: entry.state, label: entry.label }
}

/** Step forward again. Returns the state to show and the label of the edit that was redone, or null. */
export function historyRedo(history, current) {
  if (!history.future.length) return null
  const entry = history.future[history.future.length - 1]
  return { history: { past: bounded([...history.past, entryOf(current, entry.label)]), future: history.future.slice(0, -1) }, state: entry.state, label: entry.label }
}
