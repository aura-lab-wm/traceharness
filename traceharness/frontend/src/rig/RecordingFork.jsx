import { useId, useState } from 'react'
import { useRig } from './context'
import { makeSpec } from './route'
import { prepareHarnessJSON, recordedHarnessSnapshot } from './harness-json'
import { configurationFromRecordedHarness } from './configuration-from-recording'
import { parseConfiguration } from './views/harness-composer-state'
import { readDraft, writeDraft } from './views/shallow-drafts'
import { encodeMemberJSON } from '../member-api'

export function safeRecordingSource(value) {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value) || typeof value.title !== 'string' || value.title.length > 200
      || value.note !== undefined && (typeof value.note !== 'string' || value.note.length > 2000)
      || !value.value || typeof value.value !== 'object' || Array.isArray(value.value)
      || value.hash != null && (typeof value.hash !== 'string' || !/^(?:[a-f0-9]{12}|[a-f0-9]{64})$/.test(value.hash))) return null
    const prepared = prepareHarnessJSON(value)
    if (!prepared.json || new TextEncoder().encode(prepared.json).length > 2 * 1024 * 1024) return null
    return { ...JSON.parse(prepared.json), redacted: !!value.redacted || prepared.redactions > 0 }
  } catch { return null }
}

export function stagedRecordingFork(args = []) {
  if (args[0] !== 'fork') return null
  const value = readDraft('recorded-fork')
  if (!value || typeof args[1] !== 'string' || value.request_id !== args[1]) {
    return { error: 'This recorded fork is no longer available in this tab. Open its run and fork it again.' }
  }
  try {
    const source = safeRecordingSource(value.source)
    if (!source) throw new Error()
    return { request_id: value.request_id, configuration: parseConfiguration(encodeMemberJSON(value.configuration)), source }
  } catch {
    return { error: 'The recorded fork is incomplete or unsupported. Your previous draft has been kept.' }
  }
}

export function ForkRecordedHarness({ run, detail, loading, error }) {
  const { openTab } = useRig()
  const id = useId()
  const [failure, setFailure] = useState('')
  const snapshot = recordedHarnessSnapshot(run, detail)
  let configuration, reason = ''
  try {
    if (loading || error || !snapshot.config) throw new Error('Load a complete recorded harness before forking it.')
    if (snapshot.source !== 'Recorded ledger') throw new Error('This source is partial or reconstructed. Its JSON can be exported, but an original executable harness cannot be recovered from it.')
    configuration = parseConfiguration(encodeMemberJSON(configurationFromRecordedHarness({ harness: snapshot.config, modelId: run.raw?.model || run.raw?.['gen_ai.request.model'] || run.model, taskId: run.task })))
  } catch (cause) { reason = cause.message }
  function fork() {
    if (!configuration) return
    try {
      const prepared = prepareHarnessJSON(snapshot.config)
      const request_id = crypto.randomUUID()
      const source = { kind: snapshot.source, title: `Run ${run.id}`, hash: snapshot.hash || null,
        value: JSON.parse(prepared.json), redacted: prepared.redactions > 0,
        note: 'Forked from recorded engine settings. Dispatch time, dollar and output-token caps are new limits; model/task availability and runtime compatibility require fresh runner review.' }
      const issue = writeDraft('recorded-fork', { request_id, configuration, source })
      if (issue) throw new Error(issue)
      setFailure('')
      openTab(makeSpec('harnesses', 'fork', request_id))
    } catch (cause) { setFailure(cause.message || 'The fork could not be opened. The recording is unchanged.') }
  }
  return <div className="rg-col" style={{ gap: 8, marginBottom: 16 }}>
    <div className="rg-row rg-wrap"><button type="button" className="rg-btn" disabled={!configuration} aria-describedby={id} onClick={fork}>Fork recorded harness</button><span className="rg-small rg-dim">Create an editable draft from this run.</span></div>
    <p id={id} className="rg-small rg-mute">{reason || 'The recorded settings are copied into a new draft. Review its model, task and resource caps before dispatching.'}</p>
    {failure && <p role="alert">{failure}</p>}
  </div>
}
