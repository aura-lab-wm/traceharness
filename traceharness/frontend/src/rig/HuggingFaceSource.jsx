/* The "Hugging Face" panel of the Sources view (package H2).

   Lists the catalog's recorded-run datasets (GET /api/hf/catalog: also in an export). In the local console a
   row opens a preview (GET /api/hf/preview: columns and first rows, as text) and an import form (rows, seed,
   name) that starts POST /api/hf/import and follows it on GET /api/import/status, then shows the provenance
   the server wrote (data/runs/<name>/provenance.json). In an export or a member snapshot the preview and the
   import are replaced by the shared "not available here" note. Every cell is rendered as text. */
import { useEffect, useRef, useState } from 'react'
import { can } from '../environment'
import { hfImport, defaultName, cleanName, clampRows, isDatasetId, isResultsName, licenseText, previewPath, trajectoryDatasets, MAX_ROWS, DEFAULT_ROWS } from '../hf-api'
import { Unavailable } from './unavailable'
import { useApi, invalidate, fmt } from './data'
import { useTabState } from './context'
import { makeSpec } from './route'
import { Tag, Note, Loading, ConfirmAction, NextSteps } from './ui'

const { int } = fmt
const errText = (e) => String((e && e.message) || e || 'unknown error')

/** What the license means for sharing, in words: only a stated permissive license lets an export carry the data. */
function sharing(prov) {
  return prov.redistributable
    ? 'Stated as permissive: a default export may carry it.'
    : 'Not stated as permissive: a default export and the school package leave it out. Name it in --export-results to include it yourself.'
}

function Preview({ dataset }) {
  const p = useApi(previewPath(dataset))
  if (p.error) return <div className="rg-ws-err" role="alert" data-el="hf-preview-error"><p><b>The preview did not load.</b> {errText(p.error)}</p></div>
  if (!p.data) return <Loading label={`Reading ${dataset} from the Hub…`} />
  const d = p.data
  const cols = d.columns.map((c) => c.name)
  return (
    <div className="rg-ws-hfprev" data-el="hf-preview">
      <p className="rg-small rg-dim">
        <span className="rg-mono">{d.dataset}</span> · {d.rows == null ? 'rows not reported' : `${int(d.rows)} rows`} · revision <span className="rg-mono">{String(d.revision || 'unknown').slice(0, 12)}</span> · {licenseText(d.license)} · {d.gated ? 'gated' : 'open'}
      </p>
      <div className="rg-tblwrap"><table className="rg-tbl" data-el="hf-columns">
        <thead><tr><th>column</th><th>type</th></tr></thead>
        <tbody>{d.columns.map((c) => <tr key={c.name}><td className="rg-mono">{c.name}</td><td className="rg-mono rg-small rg-dim">{c.type}</td></tr>)}</tbody>
      </table></div>
      <div className="rg-tblwrap"><table className="rg-tbl rg-ws-hfrows" data-el="hf-first-rows">
        <caption className="rg-small rg-dim">First {d.first_rows.length} rows, each cell cut to 300 characters</caption>
        <thead><tr>{cols.map((c) => <th key={c}>{c}</th>)}</tr></thead>
        <tbody>{d.first_rows.map((r, i) => <tr key={i}>{cols.map((c) => <td key={c} className="rg-mono rg-small">{r[c]}</td>)}</tr>)}</tbody>
      </table></div>
    </div>
  )
}

function ImportForm({ spec, dataset }) {
  const [n, setN] = useTabState(spec, 'hf.n', DEFAULT_ROWS)
  const [seed, setSeed] = useTabState(spec, 'hf.seed', 0)
  const [name, setName] = useTabState(spec, 'hf.name', '')
  const [msg, setMsg] = useState('')
  const [pollOn, setPollOn] = useState(false)
  const st = useApi('/import/status', { poll: pollOn ? 1500 : 0 })
  const s = st.data || {}
  const mine = s.source === 'huggingface'
  const running = s.status === 'running'
  useEffect(() => { setPollOn(running) }, [running])
  const was = useRef(s.status)
  useEffect(() => {
    if (was.current === 'running' && (s.status === 'done' || s.status === 'error')) invalidate('/overview')
    was.current = s.status
  }, [s.status])
  const target = name || defaultName(dataset)
  const valid = isDatasetId(dataset) && isResultsName(target)
  const go = async () => {
    setMsg('')
    try { await hfImport({ dataset, n, seed, name: name || undefined }); setPollOn(true); st.reload() } catch (e) { setMsg(errText(e)) }
  }
  const prov = mine && s.status === 'done' && s.result ? s.result.provenance : null
  const skipped = prov && Array.isArray(s.result.skipped) ? s.result.skipped : []
  return (
    <div className="rg-ws-form" data-el="hf-import">
      <div className="rg-ws-trip">
        <label className="rg-fld">Rows<input className="rg-inp" type="number" min={1} max={MAX_ROWS} value={n} onChange={(e) => setN(clampRows(e.target.value))} /></label>
        <label className="rg-fld">Seed<input className="rg-inp" type="number" value={seed} onChange={(e) => setSeed(Math.trunc(Number(e.target.value)) || 0)} /></label>
        <label className="rg-fld">Results directory (optional)<input className="rg-inp" value={name} spellCheck={false} placeholder={defaultName(dataset)} onChange={(e) => setName(cleanName(e.target.value))} /></label>
      </div>
      <p className="rg-small rg-dim">Reads {int(n)} random rows (seed {seed}) from the public dataset and writes <span className="rg-mono">data/runs/{target}</span> with a <span className="rg-mono">provenance.json</span>. An existing directory is never replaced.</p>
      <div className="rg-row rg-wrap rg-ws-acts rg-ws-quiet">
        <ConfirmAction label={running ? 'Importing…' : 'Import a sample'} confirmLabel="Import" disabled={running || !valid}
          why={running ? 'An import is already running' : 'The name may use letters, digits, ".", "_" and "-" only'} el="hf-import-start"
          detail={`Downloads ${int(n)} rows from Hugging Face and writes data/runs/${target}.`} onConfirm={go} />
      </div>
      {running && mine && <p className="rg-mono rg-small rg-dim" role="status" data-el="hf-progress">Importing from Hugging Face: {Array.isArray(s.progress) ? `${int(s.progress[0])}${s.progress[1] ? ` of ${int(s.progress[1])}` : ''}` : 'starting'}</p>}
      {running && !mine && <Note el="hf-busy"><div>Another import is running. Wait for it to finish.</div></Note>}
      {msg && <div className="rg-ws-err" role="alert" data-el="hf-import-refused"><p><b>The server refused the import.</b> {msg}</p></div>}
      {mine && s.status === 'error' && !running && <div className="rg-ws-err" role="alert" data-el="hf-import-failed"><p><b>The import did not finish.</b> {s.error}</p></div>}
      {prov && (
        <div className="rg-ws-result" data-el="hf-result">
          <p className="rg-small">Imported {int(s.result.imported)} {s.result.imported === 1 ? 'run' : 'runs'} into <span className="rg-mono">data/runs/{s.result.results_dir}</span>{skipped.length ? `; ${int(skipped.length)} sampled ${skipped.length === 1 ? 'row was' : 'rows were'} skipped` : ''}.</p>
          {skipped.length > 0 && <ul className="rg-small rg-dim" data-el="hf-skipped">{skipped.slice(0, 10).map((x) => <li key={x.offset}>row {x.offset}: {x.reason}</li>)}</ul>}
          <dl className="rg-ws-kv" data-el="hf-provenance">
            <dt>source</dt><dd className="rg-mono">{prov.source} · {prov.dataset}</dd>
            <dt>revision</dt><dd className="rg-mono rg-break">{prov.revision}</dd>
            <dt>config · split</dt><dd className="rg-mono">{prov.config} · {prov.split}</dd>
            <dt>sample</dt><dd className="rg-mono">{int(prov.n_imported)} of {int(prov.total_rows)} rows · seed {prov.seed} · {int(prov.offsets.length)} offsets</dd>
            <dt>license</dt><dd className="rg-mono">{licenseText(prov.license)}</dd>
            <dt>sharing</dt><dd>{sharing(prov)}</dd>
            <dt>fetched</dt><dd className="rg-mono">{prov.fetched_at}</dd>
          </dl>
          <NextSteps actions={[{ label: `Open ${s.result.results_dir}`, spec: makeSpec('ds', s.result.results_dir), primary: true }]} />
        </div>
      )}
    </div>
  )
}

export function HuggingFaceSource({ spec }) {
  const local = can('data.import')
  const cat = useApi('/hf/catalog')
  const [picked, setPicked] = useTabState(spec, 'hf.pick', '')
  if (cat.error) return <Note el="hf-catalog-missing"><div>The Hugging Face catalog is not part of this page. {errText(cat.error)}</div></Note>
  if (!cat.data) return <Loading label="Reading the catalog…" />
  const rows = trajectoryDatasets(cat.data)
  const entry = rows.find((d) => d.id === picked)
  return (
    <div className="rg-ws-hf" data-el="hf-source">
      <p className="rg-ws-lead">Recorded agent runs on Hugging Face, from the catalog refreshed {cat.data.refreshed}. A sample of a public dataset becomes a results directory here, with its source and license written beside it.</p>
      <div className="rg-pnl" data-el="hf-catalog"><div className="rg-tblwrap"><table className="rg-tbl rg-ws-hftbl">
        <thead><tr><th>dataset</th><th className="rg-num">rows</th><th>license</th><th>access</th><th><span className="sr-only">Preview</span></th></tr></thead>
        <tbody>{rows.map((d) => (
          <tr key={d.id} className={picked === d.id ? 'hov on' : 'hov'} data-id={d.id}>
            <td><b className="rg-mono rg-break">{d.id}</b><div className="rg-dim rg-small">{d.summary}</div></td>
            <td className="rg-num rg-mono">{d.rows == null ? '—' : int(d.rows)}</td>
            <td className="rg-mono rg-small">{licenseText(d.license)}</td>
            <td>{d.gated ? <Tag tone="amb" title="Needs an accepted agreement and a token, which this console does not use">gated</Tag> : <Tag>open</Tag>}</td>
            <td className="rg-num">{local && (d.gated
              ? <span className="rg-small rg-dim">gated</span>
              : <button type="button" className="rg-btn" aria-pressed={picked === d.id} aria-label={`Preview ${d.id}`} onClick={() => setPicked(picked === d.id ? '' : d.id)}>{picked === d.id ? 'Close' : 'Preview'}</button>)}</td>
          </tr>))}</tbody>
      </table></div></div>
      {!local && <Unavailable capability="data.import" what="Importing from Hugging Face" />}
      {local && entry && <><Preview dataset={entry.id} /><ImportForm spec={spec} dataset={entry.id} /></>}
      {local && !entry && <p className="rg-small rg-dim">Pick a dataset to see its columns and first rows before importing.</p>}
    </div>
  )
}
