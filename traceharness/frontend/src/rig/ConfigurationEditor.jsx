import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { encodeMemberJSON } from '../member-api'
import { diffText } from './native/diff'
import { utf8Bytes } from './native/text-metrics'
import { parseConfiguration } from './views/harness-composer-state'
import './ConfigurationEditor.css'

// Texts up to 32 KiB are parsed on every edit, so feedback is immediate. Above that, parsing and
// the field comparison wait for a 150 ms pause in typing, so a 1 MiB configuration does not parse
// on every keystroke. Apply always parses exactly the text in the box.
export const PARSE_IMMEDIATE_BYTES = 32 * 1024
export const PARSE_PAUSE_MS = 150
export const REQUEST_LIMIT_BYTES = 1024 * 1024
const LONG_STRING = 200
const MAX_DIFF_OPS = 4000

// Indent the existing encoder's tokens, preserving -0.0 and every string byte.
function formatted(value) {
  if (value === undefined) return 'Not set'
  if (Object.is(value, -0)) return '-0.0\n'
  const raw = encodeMemberJSON(value)
  let output = '', depth = 0, quoted = false, escaped = false
  for (const char of raw) {
    if (quoted) {
      output += char
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') quoted = false
    } else if (char === '"') { quoted = true; output += char }
    else if (char === '{' || char === '[') { depth++; output += char + '\n' + '  '.repeat(depth) }
    else if (char === '}' || char === ']') { depth--; output += '\n' + '  '.repeat(depth) + char }
    else if (char === ',') output += ',\n' + '  '.repeat(depth)
    else if (char === ':') output += ': '
    else output += char
  }
  return output + '\n'
}

const isObject = (value) => !!value && typeof value === 'object' && !Array.isArray(value)
/** Arrays whose items are objects with distinct string `block_id`s (profile overrides) compare by id, not by index. */
function keyedById(list) {
  if (!Array.isArray(list) || !list.every((item) => isObject(item) && typeof item.block_id === 'string')) return null
  const map = new Map(list.map((item) => [item.block_id, item]))
  return map.size === list.length ? map : null
}

export function differences(before, after, path = '$', rows = []) {
  if (Object.is(before, after)) return rows
  if (Array.isArray(before) && Array.isArray(after)) {
    const left = keyedById(before), right = keyedById(after)
    if (left && right) {
      for (const id of new Set([...right.keys(), ...left.keys()])) differences(left.get(id), right.get(id), path + '[block_id=' + JSON.stringify(id) + ']', rows)
      return rows
    }
  }
  if (before && after && typeof before === 'object' && typeof after === 'object' && Array.isArray(before) === Array.isArray(after)) {
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) differences(before[key], after[key], path + '.' + key, rows)
  } else rows.push({ path, before, after })
  return rows
}

function parse(text) {
  try { return { value: parseConfiguration(text), error: '' } }
  catch (error) { return { value: null, error: error.message || 'The configuration is invalid.' } }
}

/** A word-level diff of two long strings: deletions struck through, insertions underlined, so colour is not the only signal. */
function StringDiff({ before, after }) {
  const diff = useMemo(() => diffText(before, after), [before, after])
  const ops = diff.ops.slice(0, MAX_DIFF_OPS)
  return <div className="rg-json-editor-strdiff">
    <span>Word-level difference · {utf8Bytes(before).toLocaleString()} → {utf8Bytes(after).toLocaleString()} bytes{diff.granularity === 'word' ? '' : diff.granularity === 'line' ? ' · shown by line (too long for a word comparison)' : ' · shown whole (too long to compare)'}</span>
    <pre tabIndex={0} aria-label="Word-level difference">{ops.map((op, index) => op.op === 'equal' ? <span key={index}>{op.text}</span>
      : op.op === 'delete' ? <del key={index}><span className="sr-only">[removed: </span>{op.text}<span className="sr-only">]</span></del>
        : <ins key={index}><span className="sr-only">[added: </span>{op.text}<span className="sr-only">]</span></ins>)}</pre>
    {diff.ops.length > ops.length && <span>{(diff.ops.length - ops.length).toLocaleString()} more changed pieces are not shown. The full text is in the editor above.</span>}
  </div>
}

function Change({ row }) {
  const long = typeof row.before === 'string' && typeof row.after === 'string' && (row.before.length > LONG_STRING || row.after.length > LONG_STRING)
  return <section><code>{row.path}</code>{long ? <StringDiff before={row.before} after={row.after} />
    : <div className="rg-json-editor-diff-grid"><div><span>Current fields</span><pre tabIndex={0}>{formatted(row.before)}</pre></div><div><span>Pending JSON</span><pre tabIndex={0}>{formatted(row.after)}</pre></div></div>}</section>
}

export function ConfigurationEditor({ configuration, disabled = false, onApply, onPendingChange }) {
  const id = useId()
  const current = useMemo(() => { try { return formatted(configuration) } catch { return '' } }, [configuration])
  const [base, setBase] = useState(current)
  const [text, setText] = useState(current)
  const [settled, setSettled] = useState(current)
  const [applyError, setApplyError] = useState('')
  const textBytes = useMemo(() => utf8Bytes(text), [text])
  const immediate = textBytes <= PARSE_IMMEDIATE_BYTES
  const source = immediate ? text : settled
  const parsing = source !== text
  const parsed = useMemo(() => parse(source), [source])
  const changes = useMemo(() => parsed.value ? differences(configuration, parsed.value) : [], [configuration, parsed.value])
  const submitBytes = useMemo(() => { try { return parsed.value ? utf8Bytes(encodeMemberJSON(parsed.value)) : null } catch { return null } }, [parsed.value])
  const dirty = text !== base && (parsing || !parsed.value || changes.length > 0)
  const conflict = dirty && current !== base
  const pending = dirty || !!parsed.error || conflict
  const pendingCallback = useRef(onPendingChange)
  pendingCallback.current = onPendingChange
  useEffect(() => {
    if (immediate || settled === text) return
    const timer = setTimeout(() => setSettled(text), PARSE_PAUSE_MS)
    return () => clearTimeout(timer)
  }, [text, settled, immediate])
  useEffect(() => {
    if (!dirty && current !== base) { setBase(current); setText(current); setSettled(current); setApplyError('') }
  }, [current, base, dirty])
  useEffect(() => { onPendingChange?.(pending) }, [pending, onPendingChange])
  useEffect(() => () => pendingCallback.current?.(false), [])
  function edit(next) { setText(next); setApplyError(''); if (utf8Bytes(next) <= PARSE_IMMEDIATE_BYTES) setSettled(next) }
  function discard() { setBase(current); setText(current); setSettled(current); setApplyError('') }
  function apply() {
    if (disabled || !dirty) return
    const fresh = parsing ? parse(text) : parsed
    if (parsing) setSettled(text)
    if (!fresh.value || (parsing && !differences(configuration, fresh.value).length)) return
    try {
      if (onApply?.(fresh.value) === false) throw new Error('The JSON could not be applied. Your edits have been kept.')
      const applied = formatted(fresh.value)
      setBase(applied); setText(applied); setSettled(applied); setApplyError('')
    } catch (error) { setApplyError(error.message || 'The JSON could not be applied. Your edits have been kept.') }
  }
  function onKeyDown(event) {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); apply() }
  }
  const status = parsing ? 'Checking the JSON when you pause typing…'
    : dirty ? 'Unapplied JSON edits · review and dispatch are blocked until applied or discarded.' : 'JSON matches the current configuration.'
  return <div className="rg-json-editor">
    <p className="rg-json-editor-lede">Edit the whole current configuration. Apply (or Ctrl+Enter, ⌘+Enter on a Mac) updates the fields together; each new dispatch still needs runner review.</p>
    {conflict && <p role="status" className="rg-json-editor-warning">The fields changed while these JSON edits were pending. Compare the changes below. Apply JSON replaces the current fields with this JSON version.</p>}
    <label className="rg-fld" htmlFor={id}>Configuration JSON<textarea id={id} className="rg-inp rg-json-editor-input" rows={18} value={text} disabled={disabled} spellCheck={false} aria-invalid={!parsing && !!parsed.error}
      aria-describedby={id + '-status ' + id + '-size'} onChange={(event) => edit(event.target.value)} onKeyDown={onKeyDown} /></label>
    <p id={id + '-size'} className="rg-json-editor-size">{submitBytes === null || parsing
      ? `Editor text ${textBytes.toLocaleString()} bytes (exact, with indentation)`
      : `As submitted ${submitBytes.toLocaleString()} of ${REQUEST_LIMIT_BYTES.toLocaleString()} bytes (exact, 1 MiB request limit)${submitBytes > REQUEST_LIMIT_BYTES ? ' · over the limit: the runner refuses it' : submitBytes * 5 >= REQUEST_LIMIT_BYTES * 4 ? ' · near the limit' : ''}`}</p>
    <div id={id + '-status'}>{!parsing && parsed.error ? <p role="alert">{parsed.error}</p> : <p role="status" className="rg-json-editor-state">{status}</p>}</div>
    {applyError && <p role="alert">{applyError}</p>}
    {!parsing && !!changes.length && <details open className="rg-json-editor-diff"><summary>{changes.length} changed configuration fields</summary><div>{changes.map((row) => <Change key={row.path} row={row} />)}</div></details>}
    <div className="rg-row rg-wrap"><button type="button" className="rg-btn pri" onClick={apply} disabled={disabled || !dirty || parsing || !parsed.value}>Apply JSON</button><button type="button" className="rg-btn" onClick={discard} disabled={disabled || !pending}>Discard JSON edits</button></div>
  </div>
}
