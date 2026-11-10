import { useEffect, useId, useRef, useState } from 'react'
import { api, IS_MEMBER } from '../../api'
import { requireStored, encodeMemberJSON } from '../../member-api'
import { runnerRequest, runnerCatalog, UNAVAILABLE_RUNNER } from '../../runner-api'
import { ByteMeter, NumericField, ToolChips } from '../harnessWorkspace'
import { fieldIssues, numberIssue } from '../harnessFields'
import { EvidenceOrigin } from '../shallowEvidence'
import { Go, Icon } from '../ui'
import { BlockCard } from './blocks'
import { CARDS, QUESTIONS, blocksFromAnswers } from './shallow-data'
import { blocksFromHarness, writeDraft } from './shallow-drafts'
import { configurationFor, expiryTime, fixedComposerDrafts, guidedBlocks, initialComposer, NATIVE_DRAFTS } from './harness-composer-state'
import './harness-composer.css'

const terminal = new Set(['succeeded', 'failed', 'cancelled', 'needs_attention'])
const jobStates = new Set(['queued', 'preparing', 'running', 'cancel_requested', 'succeeded', 'failed', 'cancelled', 'awaiting_credentials', 'needs_attention'])
const gradeLabels = { ungraded: 'Not graded', passed: 'Passed', failed: 'Failed', error: 'Grading error' }
const jsonKey = (value) => encodeMemberJSON(value)
const promptOf = (blocks) => blocks.find((b) => b.type === 'prompt')?.text || ''
const units = (value) => Number.isFinite(Number(value)) && value != null ? '$' + (Number(value) * 1e6).toLocaleString(undefined, { maximumFractionDigits: 3 }) : '—'
const readableTime = (value) => Number.isFinite(expiryTime(value)) ? new Date(expiryTime(value)).toLocaleTimeString() : 'unknown'
const asJob = (value) => {
  if (!value || !/^[A-Za-z0-9_-]{1,100}$/.test(value.id) || !jobStates.has(value.status)
    || value.grade !== undefined && !Object.hasOwn(gradeLabels, value.grade)
    || value.issues !== undefined && (!Array.isArray(value.issues) || value.issues.some((issue) => typeof issue !== 'string'))
    || value.manifest_sha256 !== undefined && !/^[a-f0-9]{64}$/.test(value.manifest_sha256)
    || value.artifacts !== undefined && (!Array.isArray(value.artifacts) || value.artifacts.some((a) => !a || typeof a.name !== 'string' || !Number.isFinite(a.bytes)))
    || value.usage !== undefined && (!value.usage || typeof value.usage !== 'object' || Array.isArray(value.usage))) throw new Error('The runner returned an incomplete job. Check the job service before retrying.')
  return value
}
const LIMIT_FIELDS = [
  { key: 'max_steps', label: 'Step cap', min: 1, max: 200 },
  { key: 'wall_time_seconds', label: 'Time limit (seconds)', min: 30, max: 3600 },
  { key: 'max_cost_usd', label: 'Model budget (USD)', min: 0.01, max: 100, step: 'any' },
]

export function HarnessComposer({ args = [] }) {
  const instanceId = useId()
  const [state, setState] = useState(() => initialComposer(args))
  const [cards, setCards] = useState(CARDS)
  const [library, setLibrary] = useState([])
  const [fixedDrafts, setFixedDrafts] = useState(fixedComposerDrafts)
  const [accountLoaded, setAccountLoaded] = useState(!IS_MEMBER)
  const [accountError, setAccountError] = useState('')
  const [accountRevision, setAccountRevision] = useState(0)
  const [catalog, setCatalog] = useState(UNAVAILABLE_RUNNER)
  const [catalogLoading, setCatalogLoading] = useState(true)
  const [catalogError, setCatalogError] = useState('')
  const [catalogRevision, setCatalogRevision] = useState(0)
  const [storageError, setStorageError] = useState('')
  const [error, setError] = useState('')
  const [saved, setSaved] = useState('')
  const [saving, setSaving] = useState(false)
  const [pendingSelection, setPendingSelection] = useState('')
  const [modelQuery, setModelQuery] = useState('')
  const [preview, setPreview] = useState(null)
  const [previewError, setPreviewError] = useState('')
  const [key, setKey] = useState('')
  const [credential, setCredential] = useState(null)
  const [connecting, setConnecting] = useState(false)
  const [checking, setChecking] = useState(false)
  const [preflight, setPreflight] = useState(null)
  const [launching, setLaunching] = useState(false)
  const [job, setJob] = useState(null)
  const [jobError, setJobError] = useState('')
  const [cancelling, setCancelling] = useState(false)
  const active = useRef(true)
  const credentialGeneration = useRef(0)
  const credentialRef = useRef(null)
  const preflightRequest = useRef(null)
  const retry = useRef(null)
  const jobRequest = useRef(0)

  const fixed = state.selection.startsWith('fixed:')
  const native = state.selection.startsWith('native:')
  const card = cards.find((c) => c.id === state.selection.slice(6))
  const nativeChoices = catalog.runtimes.filter((r) => r.kind === 'native')
  const credentialsAvailable = catalog.runner.available && catalog.credentials_available
  const runtimes = nativeChoices.length ? nativeChoices : NATIVE_DRAFTS
  const runtime = native ? runtimes.find((r) => r.id === state.selection.slice(7)) : catalog.runtimes.find((r) => r.id === 'traceharness')
  const fixedPrompt = card ? fixedDrafts[card.id]?.prompt ?? card.prompt : ''
  const configuration = configurationFor(state, { card, runtime, fixedPrompt })
  const configurationKey = jsonKey(configuration)
  const currentConfiguration = useRef(configurationKey)
  currentConfiguration.current = configurationKey
  const prompt = configuration.prompt
  const tools = [...new Set(cards.flatMap((c) => c.tools || []))]
  const model = catalog.models.find((m) => m.id === state.model_id)
  const task = catalog.tasks.find((t) => t.id === state.task_id)
  const models = catalog.models.filter((m) => !Array.isArray(runtime?.model_ids) || runtime.model_ids.includes(m.id))
  const matchingModels = models.filter((m) => `${m.name || ''} ${m.id}`.toLowerCase().includes(modelQuery.toLowerCase()))
  const selectedModelAllowed = Array.isArray(runtime?.model_ids) && runtime.model_ids.includes(state.model_id)
  const editLocked = saving || launching
  const jobActive = job && !terminal.has(job.status)
  const blocksIssues = native || fixed ? [] : fieldIssues(state.blocks)
  const readyIssues = [
    ...(!catalog.execution_available || !catalog.runner.available ? [catalog.runner.message || 'No execution service is connected.'] : []),
    ...(!runtime?.available ? [runtime?.reason || 'This runtime is not available on the connected runner.'] : []),
    ...(!model || !selectedModelAllowed ? ['Select a model supported by this runtime.'] : []),
    ...(!task || !task.ready ? [task?.reason || 'Select a runnable task package. Recorded trajectories alone cannot be run.'] : []),
    ...(!prompt.trim() ? [native ? 'Enter instructions for this task.' : 'Enter a standing prompt.'] : []),
    ...blocksIssues,
    ...LIMIT_FIELDS.flatMap((field) => { const issue = numberIssue(configuration.limits[field.key], field); return issue ? [`${native && field.key === 'max_steps' ? 'Model request cap' : field.label}: ${issue}`] : [] }),
    ...(fixed && (!card || new TextEncoder().encode(prompt).length > card.cap_bytes) ? ['The fixed prompt is over its byte cap.'] : []),
  ]
  const reviewed = preflight?.key === configurationKey && preflight.result?.ok === true && preflight.result.issues.length === 0

  useEffect(() => {
    active.current = true
    return () => {
      active.current = false
      credentialGeneration.current++
      preflightRequest.current?.abort()
      const current = credentialRef.current
      if (current) runnerRequest('/credentials/' + current.credential_id, { method: 'DELETE' }).catch(() => {})
      credentialRef.current = null
    }
  }, [])
  useEffect(() => {
    setStorageError(writeDraft('composer', state))
    setSaved('')
  }, [state])
  useEffect(() => {
    let live = true
    const controller = new AbortController()
    setCatalogLoading(true); setCatalogError('')
    runnerRequest('/catalog', { signal: controller.signal }).then(runnerCatalog).then((data) => {
      if (live) setCatalog(data)
    }).catch((failure) => { if (live) { setCatalog(UNAVAILABLE_RUNNER); setCatalogError(failure.message) } })
      .finally(() => { if (live) setCatalogLoading(false) })
    return () => { live = false; controller.abort() }
  }, [catalogRevision])
  useEffect(() => {
    if (!IS_MEMBER) return
    let live = true
    const controller = new AbortController()
    setAccountLoaded(false); setAccountError('')
    Promise.all([api('/shallow/catalog', { signal: controller.signal }), api('/shallow/harnesses', { signal: controller.signal })]).then(([base, savedData]) => {
      if (!live) return
      const savedRows = new Map(savedData.harnesses.filter((r) => r.lane === 'fixed').map((r) => [r.id, r]))
      setCards(base.harnesses.map((r) => ({ ...r, ...(savedRows.has(r.id) ? { prompt: savedRows.get(r.id).prompt, hash: savedRows.get(r.id).hash } : {}),
        memberSaved: savedRows.has(r.id) && !(savedData.unconfirmed || []).includes(r.id), memberUnconfirmed: (savedData.unconfirmed || []).includes(r.id) })))
      setLibrary(savedData.harnesses.filter((r) => r.lane === 'minimal'))
      setAccountLoaded(savedData.loaded === true)
      if (savedData.loaded !== true) setAccountError('Account storage has not loaded. Your draft is still here; saving is unavailable.')
    }).catch((failure) => { if (live) setAccountError(failure.message) })
    return () => { live = false; controller.abort() }
  }, [accountRevision])
  useEffect(() => {
    setPreflight(null); setChecking(false); preflightRequest.current?.abort(); retry.current = null
  }, [configurationKey])
  useEffect(() => {
    if (native || fixed || !IS_MEMBER || blocksIssues.length) { setPreview(null); setPreviewError(''); return }
    let live = true
    const controller = new AbortController()
    setPreview(null); setPreviewError('')
    const timer = setTimeout(() => api('/shallow/compile', { method: 'POST', body: { blocks: state.blocks }, signal: controller.signal })
      .then((result) => { if (live) setPreview(result) }).catch((failure) => { if (live) setPreviewError(failure.message) }), 180)
    return () => { live = false; clearTimeout(timer); controller.abort() }
  }, [native, fixed, state.blocks, blocksIssues.length])
  useEffect(() => {
    if (!credential) return
    const ms = expiryTime(credential.expires_at) - Date.now()
    const timer = setTimeout(() => { setCredential(null); credentialRef.current = null; setError('Your OpenRouter connection expired. Connect it again before running.') }, Math.max(0, Math.min(ms, 2 ** 31 - 1)))
    return () => clearTimeout(timer)
  }, [credential])
  useEffect(() => {
    if (credentialsAvailable) return
    credentialGeneration.current++
    const current = credentialRef.current
    credentialRef.current = null; setCredential(null); setKey(''); setConnecting(false)
    if (current) runnerRequest('/credentials/' + current.credential_id, { method: 'DELETE' }).catch(() => {})
  }, [credentialsAvailable])
  useEffect(() => {
    if (!job || terminal.has(job.status)) return
    let live = true
    const controller = new AbortController()
    const timer = setTimeout(() => {
      const request = ++jobRequest.current
      runnerRequest('/jobs/' + job.id, { signal: controller.signal })
        .then((data) => { if (live && request === jobRequest.current) { setJob(asJob(data.job)); setJobError('') } })
        .catch(() => { if (live && request === jobRequest.current) setJobError('Live status could not be refreshed. The job outcome is not confirmed. Use Refresh status.') })
    }, 2000)
    return () => { live = false; clearTimeout(timer); controller.abort() }
  }, [job])

  function editPrompt(value) {
    setSaved(''); setError('')
    if (native) { setState((s) => ({ ...s, native_prompts: { ...s.native_prompts, [s.selection.slice(7)]: value } })); return }
    if (!fixed) { setState((s) => ({ ...s, blocks: s.blocks.map((b) => b.type === 'prompt' ? { ...b, text: value } : b) })); return }
    if (!card || !accountLoaded) return
    setFixedDrafts((old) => {
      const next = { ...old, [card.id]: { prompt: value, baseHash: old[card.id]?.baseHash || card.hash, basePresent: old[card.id]?.basePresent ?? card.memberSaved } }
      if (value === card.prompt && accountLoaded && !card.memberUnconfirmed) delete next[card.id]
      setStorageError(writeDraft('fixed', next)); return next
    })
  }
  function selectHarness(selection, carry = false) {
    setPendingSelection(''); setError(''); setSaved('')
    const row = selection.startsWith('fixed:') ? cards.find((c) => c.id === selection.slice(6)) : library.find((c) => selection === 'saved:' + c.id)
    if (selection.startsWith('fixed:') && row && carry) {
      setFixedDrafts((old) => {
        const next = { ...old, [row.id]: { prompt, baseHash: old[row.id]?.baseHash || row.hash, basePresent: old[row.id]?.basePresent ?? row.memberSaved } }
        setStorageError(writeDraft('fixed', next)); return next
      })
    }
    setState((s) => {
      const drafts = s.selection === 'custom' || s.selection.startsWith('saved:') ? { ...s.harness_drafts, [s.selection]: s.blocks } : s.harness_drafts
      let blocks = drafts[selection] || (selection.startsWith('saved:') && row ? blocksFromHarness(row) : s.blocks)
      if (carry && !selection.startsWith('native:') && !selection.startsWith('fixed:')) blocks = blocks.map((b) => b.type === 'prompt' ? { ...b, text: prompt } : b)
      return { ...s, selection, blocks, harness_drafts: drafts,
        native_prompts: selection.startsWith('native:') && carry ? { ...s.native_prompts, [selection.slice(7)]: prompt } : s.native_prompts }
    })
  }
  function chooseHarness(selection) {
    if (selection === state.selection) return
    if (prompt.trim()) setPendingSelection(selection)
    else selectHarness(selection)
  }
  function discardFixedDraft() {
    if (!card || editLocked) return
    const next = { ...fixedDrafts }; delete next[card.id]
    const failure = writeDraft('fixed', next); setStorageError(failure)
    if (failure) return
    setFixedDrafts(next); setError(''); setAccountRevision((n) => n + 1)
  }
  function editBlock(index, next) { setState((s) => ({ ...s, blocks: s.blocks.map((b, i) => i === index ? next : b) })) }
  function moveBlock(index, delta) { setState((s) => { const next = [...s.blocks]; const [b] = next.splice(index, 1); next.splice(index + delta, 0, b); return { ...s, blocks: next } }) }
  function changeAnswer(id, value) {
    setState((s) => { const answers = { ...s.answers, [id]: value }; const blocks = guidedBlocks(answers, promptOf(s.blocks)); writeDraft('answers', answers); writeDraft('customize', blocksFromAnswers(answers)); return { ...s, answers, blocks } })
  }
  async function saveHarness() {
    if (!accountLoaded || native || saving) return
    setSaving(true); setError(''); setSaved('')
    try {
      if (fixed) {
        const submitted = fixedPrompt
        const result = requireStored(await api('/shallow/harnesses', { method: 'POST', body: {
          id: card.id, prompt: submitted, ...((fixedDrafts[card.id]?.basePresent ?? card.memberSaved) ? { if_hash: fixedDrafts[card.id]?.baseHash || card.hash } : { if_absent: true }),
        } }))
        if (!active.current) return
        setCards((rows) => rows.map((r) => r.id === card.id ? { ...r, prompt: result.harness.prompt, hash: result.harness.hash, memberSaved: true, memberUnconfirmed: false } : r))
        setFixedDrafts((old) => { const next = { ...old }; delete next[card.id]; setStorageError(writeDraft('fixed', next)); return next })
      } else {
        const result = requireStored(await api('/shallow/wizard', { method: 'POST', body: { blocks: state.blocks } }))
        if (!active.current) return
        setPreview(result); setLibrary((rows) => [...rows.filter((r) => r.id !== result.harness.id), result.harness])
        writeDraft('customize-draft', state.blocks)
      }
      setSaved('Harness saved to your account. Model, task and run limits remain in this tab.')
    } catch (failure) { if (active.current) setError(failure.message) }
    finally { if (active.current) setSaving(false) }
  }
  async function connectKey() {
    if (!key.trim() || !credentialsAvailable) return
    const generation = ++credentialGeneration.current
    setConnecting(true); setError('')
    try {
      const result = await runnerRequest('/credentials', { method: 'POST', body: { api_key: key.trim() } })
      if (!/^[A-Za-z0-9_-]{1,100}$/.test(result.credential_id) || !(expiryTime(result.expires_at) > Date.now())) throw new Error('The key connection was not confirmed.')
      if (!active.current || generation !== credentialGeneration.current) {
        runnerRequest('/credentials/' + result.credential_id, { method: 'DELETE' }).catch(() => {}); return
      }
      const value = { credential_id: result.credential_id, expires_at: result.expires_at }
      credentialRef.current = value; setCredential(value); setKey('')
    } catch (failure) { if (active.current && generation === credentialGeneration.current) setError(failure.message) }
    finally { if (active.current && generation === credentialGeneration.current) setConnecting(false) }
  }
  async function clearKey() {
    const current = credentialRef.current
    credentialGeneration.current++; credentialRef.current = null
    setCredential(null); setKey(''); setConnecting(false)
    if (current) try { await runnerRequest('/credentials/' + current.credential_id, { method: 'DELETE' }) } catch { if (active.current) setError('The key was cleared from this page. Remote revocation is unconfirmed; the connection expires automatically.') }
  }
  async function reviewRun() {
    if (readyIssues.length || checking) return
    const snapshot = configurationKey
    const controller = new AbortController(); preflightRequest.current?.abort(); preflightRequest.current = controller
    setChecking(true); setError(''); setPreflight(null)
    try {
      const result = await runnerRequest('/preflight', { method: 'POST', body: { configuration }, signal: controller.signal })
      if (active.current && currentConfiguration.current === snapshot && !controller.signal.aborted) {
        if (typeof result.ok !== 'boolean' || !Array.isArray(result.issues) || result.issues.some((s) => typeof s !== 'string') || result.ok && !/^[a-f0-9]{64}$/.test(result.manifest_sha256)) throw new Error('The runner did not confirm a complete preflight.')
        setPreflight({ key: snapshot, result })
      }
    } catch (failure) { if (active.current && currentConfiguration.current === snapshot && !controller.signal.aborted) setError(failure.message) }
    finally { if (active.current && currentConfiguration.current === snapshot && preflightRequest.current === controller) setChecking(false) }
  }
  async function run() {
    if (!reviewed || readyIssues.length || !credential || expiryTime(credential.expires_at) <= Date.now() || launching || jobActive) return
    const manifestHash = preflight.result.manifest_sha256
    const identity = configurationKey + ':' + manifestHash + ':' + credential.credential_id
    if (retry.current?.identity !== identity || retry.current.confirmed) retry.current = { identity, key: crypto.randomUUID() }
    const request = ++jobRequest.current
    const submission = retry.current
    setLaunching(true); setError('')
    try {
      const data = await runnerRequest('/jobs', { method: 'POST', body: { configuration, manifest_sha256: manifestHash, credential_id: credential.credential_id, idempotency_key: submission.key } })
      if (active.current && request === jobRequest.current) { setJob(asJob(data.job)); submission.confirmed = true; setJobError('') }
    } catch (failure) {
      if (active.current) {
        if (failure.status === 409) { setPreflight(null); retry.current = null }
        setError(failure.message + (failure.status === 409 ? ' Review the run again before launching.' : ''))
      }
    }
    finally { if (active.current) setLaunching(false) }
  }
  async function refreshJob(cancel = false) {
    if (!job) return
    const request = ++jobRequest.current
    if (cancel) setCancelling(true)
    try {
      const data = await runnerRequest('/jobs/' + job.id + (cancel ? '/cancel' : ''), { method: cancel ? 'POST' : 'GET', ...(cancel ? { body: {} } : {}) })
      if (active.current && request === jobRequest.current) { setJob(asJob(data.job)); setJobError('') }
    } catch { if (active.current && request === jobRequest.current) setJobError(cancel ? 'Cancellation could not be confirmed. Refresh status before retrying.' : 'Live status is unconfirmed. Try refreshing again.') }
    finally { if (active.current) setCancelling(false) }
  }
  function exportConfiguration() {
    const url = URL.createObjectURL(new Blob([jsonKey(configuration)], { type: 'application/json' }))
    const a = document.createElement('a'); a.href = url; a.download = 'traceharness-configuration.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  return <div className="rg-dpad rg-harness rg-composer" data-el="harness-composer">
    <header className="rg-dh"><div className="t"><div className="rg-eyebrow">Harness workspace</div><h1>Harnesses</h1><p>Choose the agent, model and task. Shape its instructions, then review exactly what will run.</p></div><span className={`rg-composer-connection${catalog.runner.available ? ' connected' : ''}`}><span aria-hidden="true" />{catalogLoading ? 'Checking runner' : catalog.runner.available ? 'Runner connected' : 'Runner not connected'}</span></header>
    <EvidenceOrigin args={args} />
    <div className="rg-composer-selectors">
      <label className="rg-fld"><span className="rg-composer-step">01 · Harness</span><select className="rg-selc" aria-label="Harness" value={state.selection} disabled={editLocked} onChange={(e) => chooseHarness(e.target.value)}>
        <optgroup label="TraceHarness engine"><option value="custom">Custom TraceHarness harness</option>{library.map((r) => <option key={r.id} value={'saved:' + r.id}>Saved · {r.id}</option>)}</optgroup>
        <optgroup label="TraceHarness fixed presets · stand-ins">{cards.map((r) => <option key={r.id} value={'fixed:' + r.id}>{r.name} stand-in</option>)}</optgroup>
        <optgroup label="Native agent runtimes">{runtimes.map((r) => <option key={r.id} value={'native:' + r.id}>{r.name}{r.available ? '' : ' · unavailable'}</option>)}</optgroup>
      </select><small>{native ? 'Native runtime · ' + (runtime?.version || 'version not connected') : fixed ? 'TraceHarness preset. This is not the vendor runtime.' : 'Your own tools, instructions and limits.'}</small></label>
      <div className="rg-fld"><label className="rg-composer-step" htmlFor={instanceId + '-model-search'}>02 · Model</label><input id={instanceId + '-model-search'} className="rg-inp" type="search" aria-label="Search models" placeholder="Search OpenRouter models" value={modelQuery} onChange={(e) => setModelQuery(e.target.value)} />
        <select className="rg-selc" aria-label="Model" value={state.model_id} disabled={launching} onChange={(e) => setState((s) => ({ ...s, model_id: e.target.value }))}><option value="">{catalog.models.length ? 'Select a compatible model' : 'Model catalog unavailable'}</option>{state.model_id && !matchingModels.some((m) => m.id === state.model_id) && <option value={state.model_id}>{state.model_id} · not in this list</option>}{matchingModels.map((m) => <option key={m.id} value={m.id}>{m.name || m.id}</option>)}</select>
        <small>{model ? `${model.id} · ${units(model.pricing?.prompt)} in / ${units(model.pricing?.completion)} out per 1M tokens` : 'Availability is checked against the connected runtime.'}</small>
      </div>
      <label className="rg-fld"><span className="rg-composer-step">03 · Task</span><select className="rg-selc" aria-label="Task" value={state.task_id} disabled={launching} onChange={(e) => setState((s) => ({ ...s, task_id: e.target.value }))}><option value="">{catalog.tasks.length ? 'Select a task package' : 'No runnable task packages connected'}</option>{state.task_id && !task && <option value={state.task_id}>{state.task_id} · unavailable</option>}{catalog.tasks.map((t) => <option key={t.id} value={t.id} disabled={!t.ready}>{t.title || t.id}{t.ready ? '' : ' · unavailable'}</option>)}</select><small>{task ? `${task.repository || task.id} · ${task.revision || 'revision not verified'}` : 'A task needs source code, a pinned revision and a grading environment.'}</small></label>
    </div>
    {pendingSelection && <div className="rg-note" role="group" aria-label="Change harness"><p>How should the selected harness use your current prompt? Your earlier draft remains available when you switch back. Carrying a prompt does not carry tools or permissions between engines.</p><div className="rg-row rg-wrap"><button className="rg-btn" disabled={editLocked} onClick={() => selectHarness(pendingSelection, true)}>Carry my prompt</button><button className="rg-btn" disabled={editLocked} onClick={() => selectHarness(pendingSelection)}>Use selected harness prompt</button><button className="rg-btn ghost" onClick={() => setPendingSelection('')}>Cancel change</button></div></div>}
    {(storageError || accountError) && <div className="rg-note" role="alert">{storageError || accountError}{accountError && <><button className="rg-btn" onClick={() => setAccountRevision((n) => n + 1)}>Retry account data</button><a href="/login">Account</a></>}</div>}
    <div className="rg-composer-layout">
      <main className="rg-composer-editor">
        <section className="rg-pnl rg-composer-prompt"><div className="rg-pnl-h"><h2>{native && configuration.prompt_mode === 'append' ? 'Additional instructions' : 'Standing prompt'}</h2><span className="meta">{native ? configuration.prompt_mode === 'append' ? 'Appended to native instructions' : 'Runtime prompt override' : fixed ? 'Fixed shell · prompt only' : 'TraceHarness instructions'}</span></div><div className="rg-pnl-b">
          <label className="rg-fld"><span className="rg-composer-sr">Prompt</span><textarea className="rg-inp" aria-label="Prompt" value={prompt} rows={12} spellCheck={false} disabled={editLocked || fixed && (!card || !accountLoaded)} onChange={(e) => editPrompt(e.target.value)} placeholder={native ? 'Add the instructions this task needs. Native built-in instructions remain in place.' : 'Describe how the agent should inspect, edit and verify the repository.'} /></label>
          {fixed && card ? <ByteMeter used={new TextEncoder().encode(prompt).length} cap={card.cap_bytes} name={card.name} /> : <span className="rg-small rg-mute rg-mono">{new TextEncoder().encode(prompt).length.toLocaleString()} UTF-8 bytes · {native ? 'runtime validates the prompt limit' : 'compiled with the harness'}</span>}
          {fixed && card && <><ToolChips tools={card.tools} /><p className="rg-small rg-mute">Tools, permissions and byte caps belong to this TraceHarness preset, not the vendor’s native runtime.</p>{(!prompt.includes('verify') || !prompt.includes('modify the tests') || new TextEncoder().encode(prompt).length > card.cap_bytes) && <p className="rg-harness-warning">This prompt exceeds the preset’s byte cap or omits its verification and test-edit safeguards. Saving clips to the byte cap; review the saved text.</p>}{fixedDrafts[card.id] && <p className="rg-small">Unsaved draft in this tab</p>}{card.memberUnconfirmed && <p role="alert">Account storage has not confirmed this prompt. Your draft is still pending.</p>}</>}
          <div className="rg-row rg-wrap rg-composer-prompt-actions">{fixed && card && <button className="rg-btn" disabled={editLocked || prompt === card.prompt} onClick={() => editPrompt(card.prompt)}>Reset prompt</button>}
            {fixed && fixedDrafts[card?.id] && <button className="rg-btn" disabled={editLocked} onClick={discardFixedDraft}>Discard draft and reload saved prompt</button>}{fixed && <button className="rg-btn" disabled={editLocked || !card || !accountLoaded} onClick={() => { setState((s) => ({ ...s, selection: 'custom', blocks: configuration.harness.blocks, edit_mode: 'advanced' })); setSaved('') }}>Customize tools and limits</button>}
            {!fixed && !native && <><button className="rg-btn" disabled={editLocked} aria-expanded={state.edit_mode === 'guided'} onClick={() => setState((s) => ({ ...s, edit_mode: s.edit_mode === 'guided' ? 'prompt' : 'guided' }))}>Guide me</button><button className="rg-btn" disabled={editLocked} aria-expanded={state.edit_mode === 'advanced'} onClick={() => setState((s) => ({ ...s, edit_mode: s.edit_mode === 'advanced' ? 'prompt' : 'advanced' }))}>Advanced settings</button></>}
          </div>
        </div></section>
        {!native && !fixed && state.edit_mode === 'guided' && <section className="rg-composer-guide" aria-label="Guided harness setup"><div className="rg-composer-section-head"><h2>Guided setup</h2><span>Six choices, one configuration</span></div>{QUESTIONS.map((q) => <fieldset key={q.id} className="rg-harness-question" disabled={editLocked}><legend>{q.prompt}</legend><div className="rg-harness-options">{q.options.map(([value, label]) => <label key={value} className={`rg-harness-option${state.answers[q.id] === value ? ' selected' : ''}`}><input type="radio" name={instanceId + '-' + q.id} value={value} checked={state.answers[q.id] === value} onChange={() => changeAnswer(q.id, value)} /><span>{label}</span></label>)}</div></fieldset>)}<p className="rg-small rg-mute">Changing answers preserves your edited prompt. Reset explicitly to regenerate it.</p><button className="rg-btn" onClick={() => setState((s) => ({ ...s, blocks: blocksFromAnswers(s.answers) }))}>Reset to Wizard Answers</button></section>}
        {!native && !fixed && state.edit_mode === 'advanced' && <section className="rg-harness-blocks" aria-label="Advanced harness settings"><div className="rg-composer-section-head"><h2>Advanced settings</h2><button className="rg-btn" disabled={editLocked} onClick={() => setState((s) => ({ ...s, blocks: blocksFromAnswers(s.answers) }))}>Reset to Wizard Answers</button></div><fieldset className="rg-composer-fields" disabled={editLocked}>{state.blocks.map((block, i) => block.type === 'prompt' ? null : <BlockCard key={block.type} block={block} index={i} count={state.blocks.length} tools={tools} onChange={editBlock} onMove={moveBlock} allowRemove={false} />)}</fieldset></section>}
        {native && <div className="rg-note"><p>Native runtime settings are controlled by its verified adapter. TraceHarness block settings are not applied to this agent.</p>{runtime?.reason && <p className="rg-small">{runtime.reason}</p>}</div>}
        {[...(preview?.warnings || []), ...blocksIssues].map((warning) => <p className="rg-harness-warning" role="status" key={warning}>{warning}</p>)}
        {previewError && <p role="alert">{previewError}</p>}
        <section className="rg-pnl rg-composer-key"><div className="rg-pnl-h"><Icon name="sent" /><h2>OpenRouter connection</h2></div><div className="rg-pnl-b">
          {!credentialsAvailable ? <p className="rg-small">Connect an execution service before adding a key. No key is collected while the runner is unavailable.</p>
            : credential ? <><p role="status">Connected for this session · expires at {readableTime(credential.expires_at)}</p><button className="rg-btn" onClick={clearKey}>Disconnect OpenRouter</button></>
              : <><label className="rg-fld">OpenRouter API key<input className="rg-inp" type="password" autoComplete="off" spellCheck={false} value={key} disabled={connecting} onChange={(e) => setKey(e.target.value)} /></label><div className="rg-row rg-wrap"><button className="rg-btn" disabled={!key.trim() || connecting} onClick={connectKey}>{connecting ? 'Verifying key…' : 'Connect OpenRouter'}</button><button className="rg-btn ghost" onClick={clearKey}>Clear key</button></div></>}
          <p className="rg-small rg-mute">Your key is never included in saved harnesses or exported configurations. A connection is cleared when this workspace closes.</p>
        </div></section>
      </main>
      <aside className="rg-composer-review" aria-label="Run configuration"><div className="rg-composer-section-head"><h2>Run configuration</h2><Icon name="log" /></div><dl>
        <div><dt>Engine</dt><dd>{native ? runtime?.name || 'Native agent' : 'TraceHarness'}<small>{native ? 'Native runtime' : fixed ? `${card?.name || 'Selected'} stand-in` : 'Configurable engine'}</small></dd></div>
        <div><dt>Model</dt><dd>{state.model_id || 'Choose a model'}</dd></div><div><dt>Task</dt><dd>{task?.title || state.task_id || 'Choose a task'}{task?.revision && <small>{task.revision}</small>}</dd></div>
        <div><dt>Prompt</dt><dd>{new TextEncoder().encode(prompt).length.toLocaleString()} bytes · {configuration.prompt_mode}</dd></div>
      </dl><fieldset className="rg-composer-limits" disabled={launching}><legend>Run limits</legend>{LIMIT_FIELDS.filter((field) => native || field.key !== 'max_steps').map((field) => <NumericField key={field.key} field={native && field.key === 'max_steps' ? { ...field, label: 'Model request cap' } : field} value={state.limits[field.key]} onChange={(value) => setState((s) => ({ ...s, limits: { ...s.limits, [field.key]: value } }))} />)}{native ? <p className="rg-small rg-mute">This cap counts model requests. Native tool actions are controlled by the runtime.</p> : <p className="rg-small rg-mute">{configuration.limits.max_steps} steps · set by this harness</p>}</fieldset><div className="rg-composer-readiness" aria-live="polite"><strong>{reviewed ? 'Configuration verified' : 'Before this can run'}</strong>{readyIssues.length ? <ul>{[...new Set(readyIssues)].map((issue) => <li key={issue}>{issue}</li>)}</ul> : !reviewed ? <p>Review the configuration with the runner before launching.</p> : <p>The server validated this exact configuration. Running may spend your OpenRouter credits.</p>}{!credential && credentialsAvailable && <p>Connect your OpenRouter key to run.</p>}{preflight?.key === configurationKey && preflight.result.issues.map((issue) => <p key={issue} role="alert">{issue}</p>)}</div>
      <div className="rg-composer-actions"><button className="rg-btn" onClick={reviewRun} disabled={!!readyIssues.length || checking || launching}>{checking ? 'Reviewing…' : 'Review run'}</button><button className="rg-btn pri" onClick={run} disabled={!reviewed || !!readyIssues.length || !credential || launching || !!jobActive}>{launching ? 'Starting…' : job && terminal.has(job.status) ? 'Run again' : 'Run'}</button>
        {IS_MEMBER && !native && <button className="rg-btn" onClick={saveHarness} disabled={!accountLoaded || editLocked || fixed && !card || !prompt.trim() || !fixed && (!preview?.ok || !!blocksIssues.length)}>{saving ? 'Saving…' : 'Save harness'}</button>}
        <button className="rg-btn ghost" onClick={exportConfiguration}>Export configuration</button>
      </div><p className="rg-small rg-mute">Selections stay in this account’s tab. Saving a harness does not run a model.</p>
      {saved && <p role="status">{saved}</p>}{error && <p role="alert">{error}{error.includes('account changed') && <> <a href="/login">Account</a></>}</p>}
      {(catalogError || !catalog.runner.available) && <div className="rg-composer-service-note"><p>{catalogError || catalog.runner.message}</p><button className="rg-btn" disabled={catalogLoading} onClick={() => setCatalogRevision((n) => n + 1)}>Refresh runner</button></div>}
      </aside>
    </div>
    {job && <section className="rg-pnl rg-composer-job" aria-label="Current job"><div className="rg-pnl-h"><h2>Run {job.id}</h2><span className="meta">{job.status.replaceAll('_', ' ')}</span></div><div className="rg-pnl-b"><p>{job.cancellation_requested && !terminal.has(job.status) ? 'Cancellation requested; waiting for confirmed termination.' : job.status === 'succeeded' ? 'Execution completed. The task grade is reported separately below.' : terminal.has(job.status) ? 'The runner reported a final state.' : 'Showing status reported by the execution service.'}</p><p data-el="runner-job-grade"><strong>Task grade:</strong> {gradeLabels[job.grade] || 'Not reported'}</p>{job.manifest_sha256 && <p className="rg-small rg-mono">Configuration {job.manifest_sha256}</p>}{(job.issues || []).map((issue) => <p key={issue} role="alert">{issue}</p>)}{jobError && <p role="alert">{jobError}</p>}<div className="rg-row rg-wrap"><button className="rg-btn" disabled={launching} onClick={() => refreshJob()}>Refresh status</button>{!terminal.has(job.status) && <button className="rg-btn" disabled={cancelling || job.cancellation_requested} onClick={() => refreshJob(true)}>{cancelling ? 'Requesting cancellation…' : 'Cancel run'}</button>}</div>{job.usage && <dl className="rg-composer-usage">{Object.entries(job.usage).filter(([, value]) => value != null).map(([name, value]) => <div key={name}><dt>{name.replaceAll('_', ' ')}</dt><dd>{String(value)}</dd></div>)}</dl>}{job.artifacts?.length > 0 && <ul>{job.artifacts.map((a) => <li key={a.name}>{a.name} · {a.bytes} bytes</li>)}</ul>}</div></section>}
    <footer className="rg-composer-footer"><Go spec="shallowApply" className="rg-tlink">Compare one prompt across the six TraceHarness shells</Go><span>Native runtimes and lab stand-ins are distinct engines.</span></footer>
  </div>
}

export const views = {
  harnesses: { tag: 'cfg', title: () => 'Harnesses', crumbs: () => [['Harnesses']], render: HarnessComposer,
    palette: () => [{ title: 'Harnesses', detail: 'Choose a harness, model, task and prompt', spec: 'harnesses', keywords: 'native claude codex openrouter fixed minimal flexible run configuration' }] },
}
