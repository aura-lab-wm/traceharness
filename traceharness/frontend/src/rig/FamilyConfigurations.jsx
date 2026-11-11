import { useState } from 'react'
import { Go } from './ui'
import { makeSpec } from './route'

const object = (value) => value && typeof value === 'object' && !Array.isArray(value)
const text = (value) => typeof value === 'string' && value.length ? value : null
const number = (value) => typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString('en-US') : 'Not recorded'
const bytes = (value) => typeof value === 'string' ? new TextEncoder().encode(value).length : null
const sourceNames = { ledger: 'Recorded ledger', 'importer-reconstructed': 'Importer reconstruction', captured: 'Captured session', unknown: 'Source not recorded' }
const fields = [
  ['policy', 'Policy'], ['max_steps', 'Model-call cap'], ['max_total_tokens', 'Total token cap'],
  ['max_tokens_per_call', 'Output tokens / call'], ['temperature', 'Temperature'],
  ['context_window', 'Retained observations'], ['observation_chars', 'Characters / observation'], ['include_file_listing', 'Initial file listing'],
]
const fieldValue = (key, value) => key === 'policy' ? text(value) || 'Not recorded'
  : key === 'include_file_listing' ? value === true ? 'Included' : value === false ? 'Excluded' : 'Not recorded'
    : key === 'context_window' && value === 0 ? 'Full history' : number(value)

// Match exact run IDs supplied by the ledger endpoint. Neither the current
// harness files nor a configuration shared by another model establish coverage.
export function configurationCohort(versions, runs, harness) {
  const cohort = new Map(runs.filter((run) => run.harness === harness).map((run) => [run.id, run]))
  const candidates = (Array.isArray(versions) ? versions : []).filter((version) => version.harness_id === harness)
    .flatMap((version) => (Array.isArray(version.recorded_configurations) ? version.recorded_configurations : []).flatMap((entry) => {
      if (!text(entry.id) || !Array.isArray(entry.run_ids)) return []
      const runIds = [...new Set(entry.run_ids.filter((id) => cohort.has(id)))]
      return runIds.length ? [{ ...entry, config: object(entry.config) ? entry.config : null, hash: version.hash, runIds }] : []
    }))
  const counts = new Map()
  for (const entry of candidates) for (const id of entry.runIds) counts.set(id, (counts.get(id) || 0) + 1)
  const variants = candidates.map((entry) => ({ ...entry, runIds: entry.runIds.filter((id) => counts.get(id) === 1) })).filter((entry) => entry.runIds.length)
  const covered = variants.reduce((sum, entry) => sum + entry.runIds.length, 0)
  return { variants, total: cohort.size, covered, recorded: variants.filter((entry) => entry.config).reduce((sum, entry) => sum + entry.runIds.length, 0),
    missing: cohort.size - covered, conflicting: [...counts.values()].filter((count) => count > 1).length }
}

export function recordedRuntime(runtime) {
  if (!object(runtime)) return 'Not recorded'
  if (object(runtime.conflicts) && Object.keys(runtime.conflicts).length) return 'Conflicting metadata · inspect provenance'
  const name = [runtime.id, runtime.agent, runtime.engine, runtime.scaffold].find(text)
  const version = [runtime.version, runtime.agent_version, runtime.scaffold_version].find(text)
  return name ? name + (version ? ' · ' + version : '') : version ? 'Version ' + version + ' · identity not recorded' : 'Not recorded'
}

export function ConfigurationSummary({ cohort, loading, error }) {
  if (loading) return <span className="rg-an-config-summary">Reading settings…</span>
  if (error) return <span className="rg-an-config-summary">Settings unavailable</span>
  const entries = cohort.variants.filter((entry) => entry.config)
  if (!entries.length) return <span className="rg-an-config-summary">Configuration not recorded</span>
  if (entries.length !== 1 || cohort.recorded !== cohort.total) return <span className="rg-an-config-summary">{entries.length} recorded snapshot{entries.length === 1 ? '' : 's'}<br />Settings for {cohort.recorded} / {cohort.total} runs</span>
  const config = entries[0].config
  const reconstructed = entries[0].source === 'importer-reconstructed'
  const tools = Array.isArray(config.tools) && config.tools.every((tool) => typeof tool === 'string') ? config.tools.length + ' tools' : 'Tools not recorded'
  return <span className="rg-an-config-summary">{tools} · {text(config.policy) || 'policy unknown'}<br />{reconstructed ? 'Importer-reconstructed settings' : <>{typeof config.max_steps === 'number' ? number(config.max_steps) + ' calls' : 'Call cap not recorded'} · {bytes(config.system_prompt) ?? 'Unknown'} prompt bytes</>}</span>
}

function BaselineDifference({ current, baseline }) {
  if (!current || !baseline) return null
  const changed = []
  for (const [key, label] of fields) {
    if (Object.hasOwn(current, key) && Object.hasOwn(baseline, key) && current[key] !== baseline[key]) changed.push(`${label}: ${fieldValue(key, baseline[key])} → ${fieldValue(key, current[key])}`)
  }
  if (Array.isArray(current.tools) && Array.isArray(baseline.tools)) {
    const removed = baseline.tools.filter((tool) => !current.tools.includes(tool))
    const added = current.tools.filter((tool) => !baseline.tools.includes(tool))
    if (removed.length) changed.push('Tools removed: ' + removed.join(', '))
    if (added.length) changed.push('Tools added: ' + added.join(', '))
  }
  if (typeof current.system_prompt === 'string' && typeof baseline.system_prompt === 'string' && current.system_prompt !== baseline.system_prompt) changed.push(`Standing prompt changed: ${bytes(baseline.system_prompt)} → ${bytes(current.system_prompt)} bytes`)
  return <div className="rg-an-config-diff" data-el="configuration-differences"><b>Compared with recorded baseline</b>{changed.length
    ? <ul>{changed.map((change) => <li key={change}>{change}</li>)}</ul>
    : <p>No differences in the fields shown above. Other recorded fields may differ.</p>}</div>
}

export function FamilyConfiguration({ harness, modelLabel, cohort, baseline, loading, error, onRetry }) {
  const [selected, setSelected] = useState('')
  const entry = cohort.variants.find((variant) => variant.id + ':' + variant.hash === selected) || cohort.variants[0]
  const config = entry?.config
  const reconstructed = entry?.source === 'importer-reconstructed'
  const tools = Array.isArray(config?.tools) && config.tools.every((tool) => typeof tool === 'string') ? config.tools : null
  const baselineConfig = baseline?.variants.length === 1 && baseline.recorded === baseline.total ? baseline.variants[0].config : null
  return <section className="rg-an-config rg-pnl" aria-label="Agent and harness configuration" data-el="family-configuration">
    <div className="rg-an-config-head"><div><div className="rg-lbl">Agent & harness configuration</div><h2>{harness}</h2><p>{modelLabel} · settings recorded with these runs</p></div>
      {!loading && !error && <span className="rg-small">Configuration recorded for <b>{cohort.recorded} / {cohort.total}</b> runs</span>}
    </div>
    {loading ? <p role="status">Reading recorded configurations…</p> : error ? <div><p role="status">Recorded configurations are unavailable. The matrix results remain available.</p><button type="button" className="rg-btn" onClick={onRetry}>Retry configurations</button></div> : <>
      {cohort.missing > 0 && <p className="rg-an-config-warning">{cohort.missing} run{cohort.missing === 1 ? '' : 's'} could not be matched to a configuration record.{cohort.conflicting > 0 ? ' Conflicting records are excluded from this inspector.' : ''} No current preset is substituted.</p>}
      {cohort.variants.length > 1 && <div className="rg-an-config-versions" aria-label="Recorded configuration snapshots"><p><b>{cohort.variants.length} snapshots contribute to this column.</b> Inspect each version; the matrix combines their outcomes.</p><div className="rg-row rg-wrap">{cohort.variants.map((variant, index) => <button type="button" key={variant.id + ':' + variant.hash} className="rg-btn" aria-pressed={variant === entry} onClick={() => setSelected(variant.id + ':' + variant.hash)}>Snapshot {index + 1} · {variant.runIds.length} runs</button>)}</div></div>}
      {entry ? <>
        {reconstructed && <p className="rg-an-config-warning">Importer-reconstructed settings. These are not recovered original agent settings. Values can be placeholders or observed maxima; they do not establish native tools or configured limits.</p>}
        {entry.source === 'captured' && <p className="rg-an-config-warning">Captured session metadata. Unrecorded native settings remain unknown.</p>}
        <dl className="rg-an-config-fields">
          <div><dt>Agent / runtime</dt><dd>{recordedRuntime(entry.runtime)}</dd></div>
          <div><dt>Configuration source</dt><dd>{sourceNames[entry.source] || sourceNames.unknown}</dd></div>
          {fields.map(([key, label]) => <div key={key}><dt>{reconstructed ? key + ' (imported)' : label}</dt><dd>{reconstructed && key === 'context_window' ? number(config?.[key]) : fieldValue(key, config?.[key])}</dd></div>)}
        </dl>
        <div className="rg-an-config-tools"><h3>{reconstructed ? 'Mapped tools from importer' : 'Available tools'}</h3>{tools ? tools.length ? <ul>{tools.map((tool, index) => <li key={index}><code>{tool}</code></li>)}</ul> : <p>{reconstructed ? 'No mapped tools supplied.' : 'No tools in this recorded configuration.'}</p> : <p>Not recorded</p>}</div>
        {!config && <p className="rg-an-config-warning">No harness settings were recorded for these {entry.runIds.length} runs.</p>}
        {config && <details className="rg-an-config-prompt"><summary>Standing prompt <span>{bytes(config.system_prompt) === null || reconstructed && config.system_prompt === '' ? 'Not supplied' : bytes(config.system_prompt).toLocaleString('en-US') + ' bytes'}</span></summary>
          {typeof config.system_prompt === 'string' ? config.system_prompt ? <pre>{config.system_prompt}</pre> : <p>{reconstructed ? 'Prompt text was not supplied by the importer.' : 'The recorded prompt is empty.'}</p> : <p>Not recorded</p>}
        </details>}
        {harness !== 'baseline' && <BaselineDifference current={config} baseline={baselineConfig} />}
        <details className="rg-an-config-provenance"><summary>Provenance and recorded fields</summary><dl>
          <div><dt>Recorded harness hash</dt><dd><code>{text(entry.hash) || 'Not recorded'}</code></dd></div>
          <div><dt>Snapshot identity</dt><dd><code>{entry.id}</code></dd></div>
          {text(entry.runtime?.image) && <div><dt>Runtime image</dt><dd><code>{entry.runtime.image}</code></dd></div>}
          {text(entry.runtime?.binary_sha256) && <div><dt>Executable SHA-256</dt><dd><code>{entry.runtime.binary_sha256}</code></dd></div>}
        </dl>{entry.runtime && <><h3>Recorded runtime fields and sources</h3><pre>{JSON.stringify(entry.runtime, null, 2)}</pre></>}{config && <><h3>Exact recorded configuration</h3><pre>{JSON.stringify(config, null, 2)}</pre></>}</details>
        <div className="rg-an-config-footer"><span>Snapshot covers {entry.runIds.length} runs in this filter.</span><Go spec={makeSpec('run', entry.runIds[0])} className="rg-tlink">Open a matching run ledger →</Go></div>
      </> : <p>No recorded settings are available for this selection.</p>}
    </>}
  </section>
}
