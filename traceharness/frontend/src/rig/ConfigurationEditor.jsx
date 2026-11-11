import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { encodeMemberJSON } from '../member-api'
import { parseConfiguration } from './views/harness-composer-state'
import './ConfigurationEditor.css'

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

function differences(before, after, path = '$', rows = []) {
  if (Object.is(before, after)) return rows
  if (before && after && typeof before === 'object' && typeof after === 'object' && Array.isArray(before) === Array.isArray(after)) {
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) differences(before[key], after[key], path + '.' + key, rows)
  } else rows.push({ path, before, after })
  return rows
}

export function ConfigurationEditor({ configuration, disabled = false, onApply, onPendingChange }) {
  const id = useId()
  const current = useMemo(() => { try { return formatted(configuration) } catch { return '' } }, [configuration])
  const [base, setBase] = useState(current)
  const [text, setText] = useState(current)
  const [applyError, setApplyError] = useState('')
  const parsed = useMemo(() => {
    try { return { value: parseConfiguration(text), error: '' } }
    catch (error) { return { value: null, error: error.message || 'The configuration is invalid.' } }
  }, [text])
  const changes = useMemo(() => parsed.value ? differences(configuration, parsed.value) : [], [configuration, parsed.value])
  const dirty = text !== base && (!parsed.value || changes.length > 0)
  const conflict = dirty && current !== base
  const pending = dirty || !!parsed.error || conflict
  const pendingCallback = useRef(onPendingChange)
  pendingCallback.current = onPendingChange
  useEffect(() => {
    if (!dirty && current !== base) { setBase(current); setText(current); setApplyError('') }
  }, [current, base, dirty])
  useEffect(() => { onPendingChange?.(pending) }, [pending, onPendingChange])
  useEffect(() => () => pendingCallback.current?.(false), [])
  function discard() { setBase(current); setText(current); setApplyError('') }
  function apply() {
    if (disabled || !dirty || !parsed.value) return
    try {
      if (onApply?.(parsed.value) === false) throw new Error('The JSON could not be applied. Your edits have been kept.')
      const applied = formatted(parsed.value)
      setBase(applied); setText(applied); setApplyError('')
    } catch (error) { setApplyError(error.message || 'The JSON could not be applied. Your edits have been kept.') }
  }
  return <div className="rg-json-editor">
    <p className="rg-small rg-dim">Edit the whole current configuration. Apply updates the fields together; each new dispatch still needs runner review.</p>
    {conflict && <p role="status" className="rg-json-editor-warning">The fields changed while these JSON edits were pending. Compare the changes below. Apply JSON replaces the current fields with this JSON version.</p>}
    <label className="rg-fld" htmlFor={id}>Configuration JSON<textarea id={id} className="rg-inp" rows={18} value={text} disabled={disabled} spellCheck={false} aria-invalid={!!parsed.error} aria-describedby={id + '-status'} onChange={event => { setText(event.target.value); setApplyError('') }} /></label>
    <div id={id + '-status'}>{parsed.error ? <p role="alert">{parsed.error}</p> : <p role="status" className="rg-small rg-dim">{dirty ? 'Unapplied JSON edits · review and dispatch are blocked until applied or discarded.' : 'JSON matches the current configuration.'}</p>}</div>
    {applyError && <p role="alert">{applyError}</p>}
    {!!changes.length && <details open className="rg-json-editor-diff"><summary>{changes.length} changed configuration fields</summary><div>{changes.map(row => <section key={row.path}><code>{row.path}</code><div className="rg-json-editor-diff-grid"><div><span>Current fields</span><pre tabIndex={0}>{formatted(row.before)}</pre></div><div><span>Pending JSON</span><pre tabIndex={0}>{formatted(row.after)}</pre></div></div></section>)}</div></details>}
    <div className="rg-row rg-wrap"><button type="button" className="rg-btn pri" onClick={apply} disabled={disabled || !dirty || !parsed.value}>Apply JSON</button><button type="button" className="rg-btn" onClick={discard} disabled={disabled || !pending}>Discard JSON edits</button></div>
  </div>
}
