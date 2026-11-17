import { LIBRARY } from './environment.js'

// Match the backend encoder: Python retains -0.0 in temperature identity.
export function encodeJSON(value, key) {
  if (key === 'temperature' && Object.is(value, -0)) return '-0.0'
  if (Array.isArray(value)) return '[' + value.map((item) => encodeJSON(item) ?? 'null').join(',') + ']'
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).filter((name) => value[name] !== undefined)
      .map((name) => JSON.stringify(name) + ':' + encodeJSON(value[name], name)).join(',') + '}'
  }
  return JSON.stringify(value)
}

/** Where saved harnesses live in this console, as the start of a sentence: "This computer". */
export function libraryPlace() {
  const label = LIBRARY.label || 'the harness library'
  return label[0].toUpperCase() + label.slice(1)
}

export function requireStored(result) {
  if (result?.stored !== true) throw new Error(`${libraryPlace()} did not confirm this save. Your draft has been kept; retry before leaving this tab.`)
  if (!result.harness || typeof result.harness.id !== 'string' || typeof result.harness.prompt !== 'string') throw new Error('The save response was incomplete. Your draft has been kept; reload before retrying.')
  return result
}
