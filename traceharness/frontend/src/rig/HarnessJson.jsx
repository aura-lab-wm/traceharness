import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { downloadText } from './caseFile'
import { prepareHarnessJSON, recordedHarnessSnapshot } from './harness-json'
import './harness-json.css'

/** Every document is the complete source object, not a table's selected fields. */
export function HarnessJson({ documents = [], source, description, identity, loading = false, error, onRetry, title = 'Full harness JSON', missing = 'No harness JSON was recorded. A current preset is not substituted.' }) {
  const id = useId()
  const [selected, setSelected] = useState('')
  const [open, setOpen] = useState(false)
  const [wrap, setWrap] = useState(true)
  const [notice, setNotice] = useState('')
  const options = documents.filter((doc) => doc.value != null)
  const document = options.find((doc) => doc.id === selected) || options[0]
  const content = useMemo(() => {
    try { return document ? prepareHarnessJSON(document.value) : { json: null, redactions: 0 } }
    catch (failure) { return { json: null, error: failure.message } }
  }, [document?.value])
  const current = useRef(null)
  const version = document?.id + ':' + content.json
  current.current = version
  useEffect(() => { setNotice('') }, [version])
  const available = !loading && !error && content.json != null
  async function copy() {
    if (!available) return
    const at = version
    try {
      await navigator.clipboard.writeText(content.json)
      if (current.current === at) setNotice('JSON copied.')
    } catch { if (current.current === at) setNotice('Could not copy. Select the JSON text or download the file.') }
  }
  function download() {
    if (!available) return
    const name = (document.filename || 'harness.json').replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 180)
    setNotice(downloadText(name, content.json, 'application/json;charset=utf-8') ? 'JSON download prepared.' : 'Could not prepare the download. Select and copy the JSON text.')
  }
  return <section className="rg-hjson" aria-labelledby={id + '-heading'} data-el="harness-json">
    <div className="rg-hjson-head"><div><span className="rg-hjson-source">{source}</span><h3 id={id + '-heading'}>{title}</h3></div>
      <div className="rg-hjson-actions"><button type="button" className="rg-btn" aria-expanded={open} aria-controls={id + '-body'} onClick={() => setOpen(!open)}>{open ? 'Hide JSON' : 'View JSON'}</button><button type="button" className="rg-btn" onClick={copy} disabled={!available}>Copy JSON</button><button type="button" className="rg-btn" onClick={download} disabled={!available}>Download JSON</button></div>
    </div>
    {description && <p className="rg-hjson-description">{description}</p>}
    {identity && <p className="rg-hjson-identity">{identity}</p>}
    {loading ? <p role="status">Loading the harness JSON…</p> : error ? <p role="status">Harness JSON could not be loaded.{onRetry && <> <button type="button" className="rg-btn" onClick={onRetry}>Retry harness JSON</button></>}</p>
      : content.error ? <p role="status">{content.error}</p> : !document ? <p className="rg-hjson-missing">{missing}</p> : null}
    {open && available && <div id={id + '-body'}>
      {options.length > 1 && <div className="rg-hjson-documents" role="group" aria-label="JSON documents">{options.map((doc) => <button type="button" className="rg-btn" key={doc.id} aria-pressed={doc.id === document.id} onClick={() => setSelected(doc.id)}>{doc.label}</button>)}</div>}
      <div className="rg-hjson-file"><span>{document.filename || 'harness.json'} · {new TextEncoder().encode(content.json).length.toLocaleString()} bytes</span><label><input type="checkbox" checked={wrap} onChange={(event) => setWrap(event.target.checked)} />Wrap lines</label></div>
      {content.redactions > 0 && <p className="rg-hjson-redaction">Credential-shaped values were redacted in this view and its copy/download. Configuration fields are retained.</p>}
      <pre className={wrap ? 'wrap' : ''} tabIndex={0} role="textbox" aria-readonly="true" aria-multiline="true" aria-label="Harness JSON source">{content.json}</pre>
    </div>}
    {notice && <p role="status" className="rg-hjson-notice">{notice}</p>}
  </section>
}

export function RecordedHarnessJson({ run, detail, loading, error, onRetry }) {
  const snapshot = recordedHarnessSnapshot(run, detail)
  const reconstructed = snapshot.source === 'Importer reconstruction' || snapshot.source === 'Captured session'
  return <HarnessJson key={run.id} source={snapshot.source} loading={loading} error={error} onRetry={onRetry}
    identity={`Run ${run.id}${snapshot.hash ? ' · harness hash ' + snapshot.hash : ''}`}
    description={reconstructed ? 'Every supplied field is shown. Imported or captured metadata can be partial; it does not recover unrecorded native settings.' : 'Every field from this run’s start-of-run harness snapshot. It is independent of the current preset and editor draft.'}
    documents={[{ id: 'harness', label: 'Recorded harness', value: snapshot.config, filename: `harness-${run.id}.json` }]} />
}
