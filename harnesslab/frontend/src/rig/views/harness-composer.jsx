import { useEffect, useId, useMemo, useRef, useState } from 'react'
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
import { applyConfiguration, configurationFor, configurationText, expiryTime, fixedComposerDrafts, forkAsCustom, guidanceFor, initialComposer, NATIVE_DRAFTS, parseConfiguration } from './harness-composer-state'
import { HarnessPicker } from '../harnessPicker'
import { ConfigurationLibrary } from '../configurationLibrary'
import { addCheckpoint, compareConfigurations, deleteCheckpoint, loadCheckpoints, persistCheckpoints, renameCheckpoint, restoreCheckpoint } from '../configuration-checkpoints'
import './harness-composer.css'

const terminal = new Set(['succeeded', 'failed', 'cancelled', 'needs_attention'])
const jobStates = new Set(['queued', 'preparing', 'running', 'cancel_requested', 'succeeded', 'failed', 'cancelled', 'awaiting_credentials', 'needs_attention'])
const gradeLabels = { ungraded: 'Not graded', passed: 'Passed', failed: 'Failed', error: 'Grading error' }
const jsonKey = (value) => encodeMemberJSON(value)
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
const harnessContentKey = (blocks = []) => jsonKey([...blocks].sort((a, b) => a.type.localeCompare(b.type)).map((block) => Object.fromEntries(Object.entries(block).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => [key, key === 'names' ? [...value].sort() : value]))))
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
  const [storageErrors, setStorageErrors] = useState({})
  const storageError = [...new Set(Object.values(storageErrors).filter(Boolean))].join(' ')
  function setStorageError(message, source = 'fixed') { setStorageErrors((old) => ({ ...old, [source]: message })) }
  const [error, setError] = useState('')
  const [saved, setSaved] = useState('')
  const [saving, setSaving] = useState(false)
  const [configNotice, setConfigNotice] = useState('')
  const [undoConfiguration, setUndoConfiguration] = useState(null)
  const [expandedPrompt, setExpandedPrompt] = useState(false)
  const [checkpointData, setCheckpointData] = useState(loadCheckpoints)
  const [showCheckpoints, setShowCheckpoints] = useState(false)
  const [mobileSetup, setMobileSetup] = useState(() => window.matchMedia?.('(max-width: 760px)').matches || false)
  const [setupExpanded, setSetupExpanded] = useState(false)
  const [comparedCheckpoint, setComparedCheckpoint] = useState('')
  const [deletedCheckpoint, setDeletedCheckpoint] = useState(null)
  const [checkpointNotice, setCheckpointNotice] = useState('')
  const checkpoints = checkpointData.checkpoints
  const promptInput = useRef(null)
  const [importing, setImporting] = useState(false)
  const importInput = useRef(null)
  const importGeneration = useRef(0)
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
  const checkpointComparison = useMemo(() => {
    const entry = checkpoints.find((row) => row.id === comparedCheckpoint)
    if (!entry) return null
    try { return { id: entry.id, ...compareConfigurations(configuration, entry.configuration) } }
    catch { return null }
  }, [configurationKey, comparedCheckpoint, checkpoints])
  const prompt = configuration.prompt
  const guidance = guidanceFor(state.blocks, state.answers)
  const tools = [...new Set(cards.flatMap((c) => c.tools || []))]
  const model = catalog.models.find((m) => m.id === state.model_id)
  const task = catalog.tasks.find((t) => t.id === state.task_id)
  const models = catalog.models.filter((m) => !runtime?.available || !Array.isArray(runtime?.model_ids) || runtime.model_ids.includes(m.id))
  const selectedModelAllowed = Array.isArray(runtime?.model_ids) && runtime.model_ids.includes(state.model_id)
  const editLocked = saving || launching || importing
  const jobActive = job && !terminal.has(job.status)
  const blocksIssues = native || fixed ? [] : fieldIssues(state.blocks)
  const readyIssues = [
    ...(!catalog.execution_available || !catalog.runner.available ? [catalog.runner.message || 'No execution service is connected.'] : []),
    ...(!runtime?.available ? [runtime?.reason || 'This runtime is not available on the connected runner.'] : []),
    ...(!model ? ['Select a model.'] : runtime?.available && !selectedModelAllowed ? ['The selected model is not verified for this runtime. Choose a supported model.'] : []),
    ...(!task || !task.ready ? [task?.reason || 'Select a runnable task package. Recorded trajectories alone cannot be run.'] : []),
    ...(task?.ready && Array.isArray(task.runtime_ids) && !task.runtime_ids.includes(configuration.runtime_id) ? ['This task is not registered for the selected runtime. Choose a supported task or harness.'] : []),
    ...(!prompt.trim() ? [native ? 'Enter instructions for this task.' : 'Enter a standing prompt.'] : []),
    ...blocksIssues,
    ...LIMIT_FIELDS.flatMap((field) => { const issue = numberIssue(configuration.limits[field.key], field); return issue ? [`${native && field.key === 'max_steps' ? 'Model request cap' : field.label}: ${issue}`] : [] }),
    ...(fixed && (!card || new TextEncoder().encode(prompt).length > card.cap_bytes) ? ['The fixed prompt is over its byte cap.'] : []),
  ]
  const reviewed = preflight?.key === configurationKey && preflight.result?.ok === true && preflight.result.issues.length === 0

  useEffect(() => {
    const media = window.matchMedia?.('(max-width: 760px)')
    if (!media) return
    const changed = () => setMobileSetup(media.matches)
    media.addEventListener('change', changed)
    return () => media.removeEventListener('change', changed)
  }, [])
  useEffect(() => {
    active.current = true
    return () => {
      active.current = false
      importGeneration.current++
      credentialGeneration.current++
      preflightRequest.current?.abort()
      const current = credentialRef.current
      if (current) runnerRequest('/credentials/' + current.credential_id, { method: 'DELETE' }).catch(() => {})
      credentialRef.current = null
    }
  }, [])
  useEffect(() => {
    setStorageError(writeDraft('composer', state), 'composer')
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
    setError(''); setSaved('')
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
    if (selection === state.selection || editLocked) return
    selectHarness(selection, state.preserve_prompt)
  }
  function discardFixedDraft() {
    if (!card || editLocked) return
    const snapshot = editorSnapshot()
    const next = { ...fixedDrafts }; delete next[card.id]
    const failure = writeDraft('fixed', next); setStorageError(failure)
    if (failure) return
    setUndoConfiguration(snapshot); setConfigNotice('Reloading the saved prompt. Undo restores the previous editor draft.')
    setFixedDrafts(next); setError(''); setAccountRevision((n) => n + 1)
  }
  function editBlock(index, next) { setState((s) => ({ ...s, blocks: s.blocks.map((b, i) => i === index ? next : b) })) }
  function moveBlock(index, delta) { setState((s) => { const next = [...s.blocks]; const [b] = next.splice(index, 1); next.splice(index + delta, 0, b); return { ...s, blocks: next } }) }
  function changeAnswer(id, value) {
    setState((s) => {
      const answers = { ...s.answers, [id]: value }
      const generated = blocksFromAnswers(answers)
      const target = { touch: ['tools', 'names'], dangerous: ['policy', 'mode'], history: ['context', 'window'], stop: ['stop', 'max_steps'] }[id]
      const blocks = target ? s.blocks.map((block) => block.type === target[0] ? { ...block, [target[1]]: generated.find((b) => b.type === target[0])[target[1]] } : block) : s.blocks
      writeDraft('answers', answers); writeDraft('customize', generated)
      return { ...s, answers, blocks }
    })
  }
  async function saveHarness() {
    if (!accountLoaded || native || saving) return
    setSaving(true); setError(''); setSaved('')
    let confirmedBlocks
    try {
      if (fixed) {
        const submitted = fixedPrompt
        const result = requireStored(await api('/shallow/harnesses', { method: 'POST', body: {
          id: card.id, prompt: submitted, ...((fixedDrafts[card.id]?.basePresent ?? card.memberSaved) ? { if_hash: fixedDrafts[card.id]?.baseHash || card.hash } : { if_absent: true }),
        } }))
        if (!active.current) return
        confirmedBlocks = blocksFromHarness({ ...card, ...result.harness })
        setCards((rows) => rows.map((r) => r.id === card.id ? { ...r, prompt: result.harness.prompt, hash: result.harness.hash, memberSaved: true, memberUnconfirmed: false } : r))
        setFixedDrafts((old) => { const next = { ...old }; delete next[card.id]; setStorageError(writeDraft('fixed', next)); return next })
      } else {
        const result = requireStored(await api('/shallow/wizard', { method: 'POST', body: { blocks: state.blocks } }))
        if (!active.current) return
        confirmedBlocks = blocksFromHarness(result.harness)
        setPreview(result); setLibrary((rows) => [...rows.filter((r) => r.id !== result.harness.id), result.harness])
        writeDraft('customize-draft', state.blocks)
      }
      setSaved({ key: harnessContentKey(confirmedBlocks), message: 'Harness saved to your account. Model, task and run limits remain in this tab.' })
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
    if (editLocked || readyIssues.length || checking) return
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
    if (editLocked || !reviewed || readyIssues.length || !credential || expiryTime(credential.expires_at) <= Date.now() || launching || jobActive) return
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
  function showEditor(mode) {
    const next = state.edit_mode === mode ? 'prompt' : mode
    setState((s) => ({ ...s, edit_mode: next }))
    if (next !== 'prompt') setTimeout(() => document.getElementById(instanceId + '-' + next)?.focus(), 0)
  }
  function downloadConfiguration(value, filename = 'traceharness-configuration.json') {
    const url = URL.createObjectURL(new Blob([configurationText(value)], { type: 'application/json' }))
    const a = document.createElement('a'); a.href = url; a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  function exportConfiguration() {
    try { downloadConfiguration(configuration); setError('') }
    catch (failure) { setError(failure.message) }
  }
  function storeCheckpoints(next) {
    if (editLocked) return false
    const failure = persistCheckpoints(next)
    if (failure) throw new Error(failure)
    setCheckpointData({ checkpoints: next, warning: '', dropped: 0 })
    return true
  }
  function createCheckpoint(name) {
    setCheckpointNotice('')
    const next = addCheckpoint(checkpoints, name, configuration)
    if (!storeCheckpoints(next)) return false
    setComparedCheckpoint(next[next.length - 1].id); setCheckpointNotice('Checkpoint stored in this tab. Export it for a portable copy.')
  }
  function renameStoredCheckpoint(id, name) {
    setCheckpointNotice('')
    if (!storeCheckpoints(renameCheckpoint(checkpoints, id, name))) return false
    setCheckpointNotice('Checkpoint renamed in this tab.')
  }
  function removeCheckpoint(id) {
    setCheckpointNotice('')
    const removed = checkpoints.find((row) => row.id === id)
    if (!storeCheckpoints(deleteCheckpoint(checkpoints, id))) return false
    setDeletedCheckpoint(removed); setCheckpointNotice('Checkpoint deleted from this tab. Undo is available.')
    if (comparedCheckpoint === id) setComparedCheckpoint('')
  }
  function undoCheckpointDeletion() {
    if (!deletedCheckpoint || editLocked) return
    setCheckpointNotice('')
    try {
      if (!storeCheckpoints([...checkpoints, deletedCheckpoint])) return
      setDeletedCheckpoint(null); setCheckpointNotice('Deleted checkpoint restored in this tab.')
    } catch (failure) { setError(failure.message) }
  }
  function restoreStoredCheckpoint(id) {
    if (editLocked) return false
    const value = restoreCheckpoint(checkpoints, id)
    const result = applyConfiguration(state, value)
    const originalCard = value.harness.lane === 'fixed' ? cards.find((row) => row.id === value.harness.id) : null
    const sameShell = originalCard && accountLoaded && harnessContentKey(blocksFromHarness({ ...originalCard, prompt: value.prompt })) === harnessContentKey(value.harness.blocks)
    if (sameShell) {
      result.state.selection = 'fixed:' + originalCard.id
      result.state.blocks = state.blocks
      result.state.answers = state.answers
      result.state.edit_mode = state.edit_mode
      result.state.harness_drafts = { ...state.harness_drafts, ...((state.selection === 'custom' || state.selection.startsWith('saved:')) ? { [state.selection]: state.blocks } : {}) }
      result.fixedDrafts = { ...fixedDrafts }
      if (value.prompt === originalCard.prompt) delete result.fixedDrafts[originalCard.id]
      else result.fixedDrafts[originalCard.id] = { prompt: value.prompt, baseHash: originalCard.hash, basePresent: !!originalCard.memberSaved }
      result.notice = 'Restored the checkpoint as a fixed-preset draft. Account saves are unchanged.'
    } else result.notice = 'Restored checkpoint. ' + result.notice
    applyDraft(result); setComparedCheckpoint(id)
    setTimeout(() => promptInput.current?.focus(), 0)
  }
  function compareCheckpoint(id) {
    const entry = restoreCheckpoint(checkpoints, id)
    compareConfigurations(configuration, entry)
    setComparedCheckpoint(id)
  }
  function toggleCheckpoints() {
    const next = !showCheckpoints; setShowCheckpoints(next)
    if (next) setTimeout(() => document.getElementById(instanceId + '-checkpoints')?.querySelector('input')?.focus(), 0)
  }
  function editorSnapshot(previous = state) {
    const drafts = JSON.parse(jsonKey(fixedDrafts))
    if (fixed && card) drafts[card.id] = { prompt: fixedPrompt, baseHash: fixedDrafts[card.id]?.baseHash || card.hash, basePresent: fixedDrafts[card.id]?.basePresent ?? !!card.memberSaved }
    return { state: JSON.parse(jsonKey(previous)), fixedDrafts: drafts }
  }
  function undoEditorChange() {
    if (!undoConfiguration || editLocked) return
    setState(undoConfiguration.state); setFixedDrafts(undoConfiguration.fixedDrafts)
    setStorageError(writeDraft('fixed', undoConfiguration.fixedDrafts))
    setUndoConfiguration(null); setConfigNotice('Restored the configuration from before the last change.'); setSaved(''); setError('')
  }
  function resetToAnswers(promptOnly = false) {
    if (editLocked) return
    const generated = blocksFromAnswers(state.answers)
    const blocks = promptOnly ? state.blocks.map((block) => block.type === 'prompt' ? generated.find((b) => b.type === 'prompt') : block) : generated
    applyDraft({ state: { ...state, blocks }, notice: promptOnly ? 'Applied the prompt template. Other settings are unchanged.' : 'Reset the prompt and settings to the remembered wizard answers.' })
  }
  function resetFixedPrompt() {
    if (!card || editLocked) return
    setUndoConfiguration(editorSnapshot()); editPrompt(card.prompt); setConfigNotice('Restored the account prompt. Undo is available.')
  }
  function applyDraft(result) {
    setUndoConfiguration(editorSnapshot(result.previousState || state))
    if (result.fixedDrafts) { setFixedDrafts(result.fixedDrafts); setStorageError(writeDraft('fixed', result.fixedDrafts)) }
    setState(result.state); setConfigNotice(result.notice); setError(''); setSaved('')
  }
  function customizeCurrent() {
    try { applyDraft(forkAsCustom(state, { card, runtime, fixedPrompt })) }
    catch (failure) { setError(failure.message) }
  }
  async function importConfiguration(event) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || editLocked) return
    if (file.size > 1024 * 1024) { setError('Choose a configuration JSON file smaller than 1 MiB.'); return }
    const generation = ++importGeneration.current
    setImporting(true); setError(''); setPreflight(null); setChecking(false)
    preflightRequest.current?.abort(); retry.current = null
    try {
      const value = parseConfiguration(await file.text())
      if (active.current && generation === importGeneration.current) applyDraft(applyConfiguration(state, value))
    } catch (failure) { if (active.current && generation === importGeneration.current) setError(failure.message) }
    finally { if (active.current && generation === importGeneration.current) setImporting(false) }
  }
  const harnessOptions = [
    { value: 'custom', label: 'Custom TraceHarness harness', description: 'Edit every tool, instruction and limit', group: 'Your configurations' },
    ...library.map((r) => ({ value: 'saved:' + r.id, label: (r.prompt || '').replace(/\s+/g, ' ').slice(0, 72) || r.id, description: r.id, meta: `${r.tools?.length || 0} tools · ${r.max_steps} steps`, group: 'Saved configurations' })),
    ...cards.map((r) => ({ value: 'fixed:' + r.id, label: r.name + ' stand-in', description: 'TraceHarness preset · customize to edit its tools', meta: `${r.tools.length} tools · ${r.max_steps} steps`, group: 'Fixed starting points' })),
    ...runtimes.map((r) => ({ value: 'native:' + r.id, label: r.name, description: r.version ? `Native runtime · ${r.version}` : 'Native runtime · not connected', status: r.available ? 'Available' : 'Unavailable', group: 'Native agents' })),
  ]
  const modelOptions = models.map((m) => ({ value: m.id, label: m.name || m.id, description: `${m.id}${Number.isFinite(m.context_length) ? ' · ' + m.context_length.toLocaleString() + ' context' : ''}${Array.isArray(m.supported_parameters) && m.supported_parameters.includes('tools') ? ' · tools' : ''}`,
    meta: `${units(m.pricing?.prompt)} in / ${units(m.pricing?.completion)} out per 1M tokens`,
    group: m.id.split('/')[0], status: runtime?.available && runtime.model_ids?.includes(m.id) ? 'Verified for runtime' : undefined }))
  if (state.model_id && !modelOptions.some((m) => m.value === state.model_id)) modelOptions.unshift({ value: state.model_id, label: state.model_id, description: 'Saved selection is absent from this runtime’s model list', status: 'Unavailable' })
  const taskOptions = catalog.tasks.map((t) => ({ value: t.id, label: t.title || t.id, description: t.repository || t.id,
    meta: t.revision ? `Revision ${t.revision}` : 'Revision not verified', status: !t.ready ? 'Unavailable' : Array.isArray(t.runtime_ids) && !t.runtime_ids.includes(configuration.runtime_id) ? 'Different runtime' : 'Ready' }))
  if (state.task_id && !task) taskOptions.unshift({ value: state.task_id, label: state.task_id, description: 'Saved task is absent from the connected catalog', status: 'Unavailable' })

  return <div className="rg-dpad rg-harness rg-composer" data-el="harness-composer">
    <header className="rg-dh"><div className="t"><div className="rg-eyebrow">Harness workspace</div><h1>Harnesses</h1><p>Compose the agent, model, task and instructions for a reproducible run.</p></div><span className={`rg-composer-connection${catalog.runner.available ? ' connected' : ''}`}><span aria-hidden="true" />{catalogLoading ? 'Checking runner' : catalog.runner.available ? 'Runner connected' : 'Runner not connected'}</span></header>
    <EvidenceOrigin args={args} />
    <div className="rg-composer-toolbar"><p>Start from a preset, reopen a saved harness, or import a configuration.</p><div className="rg-row rg-wrap"><button type="button" className="rg-btn" aria-label="Configuration checkpoints" aria-expanded={showCheckpoints} aria-controls={instanceId + '-checkpoints'} onClick={toggleCheckpoints}>Checkpoints<span aria-hidden="true">{checkpoints.length ? ` (${checkpoints.length})` : ''}</span></button><input ref={importInput} type="file" accept="application/json,.json" aria-label="Import configuration file" hidden onChange={importConfiguration} /><button className="rg-btn" disabled={editLocked} onClick={() => importInput.current?.click()}>{importing ? 'Importing…' : 'Import configuration'}</button><button className="rg-btn" disabled={importing} onClick={exportConfiguration}>Export configuration</button>{IS_MEMBER && !native && <button className="rg-btn" onClick={saveHarness} disabled={!accountLoaded || editLocked || fixed && !card || !prompt.trim() || !fixed && (!preview?.ok || !!blocksIssues.length)}>{saving ? 'Saving…' : 'Save harness'}</button>}</div></div>
    {saved && saved.key === harnessContentKey(configuration.harness.blocks) && <p role="status">{saved.message}</p>}{error && <p role="alert">{error}{error.includes('account changed') && <> <a href="/login">Account</a></>}</p>}
    {mobileSetup && <section className="rg-composer-setup-summary" aria-label="Selected configuration"><dl><div><dt>Harness</dt><dd>{harnessOptions.find((row) => row.value === state.selection)?.label || state.selection}</dd></div><div><dt>Model</dt><dd>{model?.name || state.model_id || 'Not selected'}</dd></div><div><dt>Task</dt><dd>{task?.title || state.task_id || 'Not selected'}</dd></div></dl><button type="button" className="rg-btn" aria-expanded={setupExpanded} aria-controls={instanceId + '-selections'} onClick={() => setSetupExpanded((value) => !value)}>{setupExpanded ? 'Done selecting' : 'Edit selections'}</button></section>}
    <div id={instanceId + '-selections'} className="rg-composer-setup" hidden={mobileSetup && !setupExpanded}>
    <div className="rg-composer-selectors">
      <HarnessPicker label="Harness" step="01" value={state.selection} options={harnessOptions} onChange={chooseHarness} disabled={editLocked} searchPlaceholder="Search presets, saved harnesses and native agents" hint={native ? 'Native runtime · ' + (runtime?.version || 'version not connected') : fixed ? 'TraceHarness preset. This is not the vendor runtime.' : 'Your own tools, instructions and limits.'} />
      <HarnessPicker label="Model" step="02" value={state.model_id} options={modelOptions} onChange={(model_id) => setState((s) => ({ ...s, model_id }))} disabled={editLocked} loading={catalogLoading} placeholder={catalog.models.length ? 'Choose an OpenRouter model' : 'Model catalog unavailable'} searchPlaceholder="Search models or providers" emptyMessage="No models match this search" hint={model ? `${model.id} · ${units(model.pricing?.prompt)} in / ${units(model.pricing?.completion)} out per 1M tokens` : 'Search by model name or provider.'} />
      <HarnessPicker label="Task" step="03" value={state.task_id} options={taskOptions} onChange={(task_id) => setState((s) => ({ ...s, task_id }))} disabled={editLocked} loading={catalogLoading} placeholder={catalog.tasks.length ? 'Choose a task package' : 'No runnable task packages connected'} searchPlaceholder="Search tasks or repositories" emptyMessage={catalog.tasks.length ? 'No tasks match this search' : 'No runnable task packages connected. A task needs source code, a pinned revision and a grading environment.'} hint={task ? `${task.repository || task.id} · ${task.revision || 'revision not verified'}` : 'Use a registered repository task with a pinned revision and grader.'} />
    </div>
    {(state.model_id || state.task_id) && <div className="rg-row rg-wrap rg-composer-selection-actions">{state.model_id && <button className="rg-btn ghost" disabled={editLocked} onClick={() => setState((s) => ({ ...s, model_id: '' }))}>Clear model</button>}{state.task_id && <button className="rg-btn ghost" disabled={editLocked} onClick={() => setState((s) => ({ ...s, task_id: '' }))}>Clear task</button>}</div>}
    <div className="rg-composer-switch-policy"><label><input type="checkbox" checked={!!state.preserve_prompt} disabled={editLocked} onChange={(event) => setState((s) => ({ ...s, preserve_prompt: event.target.checked }))} />Keep prompt when switching harnesses</label><span>Each harness keeps its own draft. Tools and permissions stay with the selected engine.</span></div>
    </div>
    {configNotice && <div className="rg-note rg-composer-import-status" role="status"><p>{configNotice}</p>{undoConfiguration && <button className="rg-btn" disabled={editLocked} onClick={undoEditorChange}>Undo configuration change</button>}</div>}
    {(model || task) && <details className="rg-composer-details"><summary>Selection details</summary><dl>{model && <><div><dt>Model</dt><dd>{model.id}</dd></div>{Number.isFinite(model.context_length) && <div><dt>Context window</dt><dd>{model.context_length.toLocaleString()} tokens</dd></div>}<div><dt>Runtime compatibility</dt><dd>{runtime?.available ? selectedModelAllowed ? 'Verified by the connected runtime' : 'Not verified for this runtime' : 'Not verified · connect a runtime before execution'}</dd></div></>}{task && <><div><dt>Repository</dt><dd>{task.repository || 'Not supplied'}</dd></div><div><dt>Revision</dt><dd>{task.revision || 'Not verified'}</dd></div>{task.environment_digest && <div><dt>Environment</dt><dd>{task.environment_digest}</dd></div>}{Array.isArray(task.runtime_ids) && <div><dt>Task runtimes</dt><dd>{task.runtime_ids.join(', ') || 'None registered'}</dd></div>}{task.reason && <div><dt>Task status</dt><dd>{task.reason}</dd></div>}</>}</dl></details>}
    {(storageError || accountError) && <div className="rg-note" role="alert">{storageError || accountError}{accountError && <><button className="rg-btn" onClick={() => setAccountRevision((n) => n + 1)}>Retry account data</button><a href="/login">Account</a></>}</div>}
    <div className="rg-composer-layout">
      <section className="rg-composer-editor" aria-label="Configuration editor">
        <section className={`rg-pnl rg-composer-prompt${expandedPrompt ? ' is-expanded' : ''}`}><div className="rg-pnl-h"><h2>{native && configuration.prompt_mode === 'append' ? 'Additional instructions' : 'Standing prompt'}</h2><span className="meta">{native ? configuration.prompt_mode === 'append' ? 'Appended to native instructions' : 'Runtime prompt override' : fixed ? 'Fixed shell · prompt only' : 'TraceHarness instructions'}</span></div><div className="rg-pnl-b">
          <div className="rg-row rg-wrap rg-composer-prompt-actions"><button className="rg-btn ghost" aria-expanded={expandedPrompt} onClick={() => setExpandedPrompt((value) => !value)}>{expandedPrompt ? 'Reduce editor' : 'Expand editor'}</button>{fixed && card && <button className="rg-btn" disabled={editLocked || prompt === card.prompt} onClick={resetFixedPrompt}>Reset prompt</button>}
            {fixed && fixedDrafts[card?.id] && <button className="rg-btn" disabled={editLocked} onClick={discardFixedDraft}>Discard draft and reload saved prompt</button>}{fixed && <button className="rg-btn" disabled={editLocked || !card || !accountLoaded} onClick={customizeCurrent}>Customize tools and limits</button>}
            {!fixed && !native && <><button className="rg-btn" disabled={editLocked} aria-expanded={state.edit_mode === 'guided'} aria-controls={instanceId + '-guided'} onClick={() => showEditor('guided')}>Guide me</button><button className="rg-btn" disabled={editLocked} aria-expanded={state.edit_mode === 'advanced'} aria-controls={instanceId + '-advanced'} onClick={() => showEditor('advanced')}>Advanced settings</button></>}
          </div>
          <label className="rg-fld"><span className="rg-composer-sr">Prompt</span><textarea ref={promptInput} className="rg-inp" aria-label="Prompt" value={prompt} rows={12} spellCheck={false} disabled={editLocked || fixed && (!card || !accountLoaded)} onChange={(e) => editPrompt(e.target.value)} placeholder={native ? 'Add the instructions this task needs. Native built-in instructions remain in place.' : 'Describe how the agent should inspect, edit and verify the repository.'} /></label>
          {fixed && card ? <ByteMeter used={new TextEncoder().encode(prompt).length} cap={card.cap_bytes} name={card.name} /> : <span className="rg-small rg-mute rg-mono">{new TextEncoder().encode(prompt).length.toLocaleString()} UTF-8 bytes · {native ? 'runtime validates the prompt limit' : 'compiled with the harness'}</span>}
          {fixed && card && <><ToolChips tools={card.tools} /><p className="rg-small rg-mute">Tools, permissions and byte caps belong to this TraceHarness preset, not the vendor’s native runtime.</p>{(!prompt.includes('verify') || !prompt.includes('modify the tests') || new TextEncoder().encode(prompt).length > card.cap_bytes) && <p className="rg-harness-warning">This prompt exceeds the preset’s byte cap or omits its verification and test-edit safeguards. Saving clips to the byte cap; review the saved text.</p>}{fixedDrafts[card.id] && <p className="rg-small">Unsaved draft in this tab</p>}{card.memberUnconfirmed && <p role="alert">Account storage has not confirmed this prompt. Your draft is still pending.</p>}</>}

        </div></section>
        {!native && !fixed && state.edit_mode === 'guided' && <section className="rg-composer-guide" id={instanceId + '-guided'} tabIndex={-1} aria-label="Guided harness setup"><div className="rg-composer-section-head"><h2>Guided setup</h2><span>Six choices, one configuration</span></div>{QUESTIONS.map((q) => <fieldset key={q.id} className="rg-harness-question" disabled={editLocked}><legend>{q.id === 'verify' ? 'Prompt verification template' : q.prompt}</legend><div className="rg-harness-options">{q.options.map(([value, label]) => <label key={value} className={`rg-harness-option${guidance.selections[q.id] === value ? ' selected' : ''}`}><input type="radio" name={instanceId + '-' + q.id} value={value} checked={guidance.selections[q.id] === value} onChange={() => changeAnswer(q.id, value)} /><span>{label}</span></label>)}</div>{guidance.custom.includes(q.id) && <p className="rg-small rg-mute">Custom setting. Choose an answer to replace only this setting.</p>}{guidance.resetDifferences.includes(q.id) && <p className="rg-small rg-mute">Reset value: {q.options.find(([value]) => value === state.answers[q.id])?.[1]}</p>}{q.id === 'verify' && <div className="rg-row rg-wrap"><p className="rg-small rg-mute">This choice sets the prompt template. Apply it explicitly to replace your current instructions.</p><button type="button" className="rg-btn" disabled={editLocked} onClick={() => resetToAnswers(true)}>Apply prompt template</button></div>}</fieldset>)}<p className="rg-small rg-mute">Guidance reflects your current configuration. Reset replaces the prompt and all seven blocks with the remembered wizard answers; Undo is available.</p><button className="rg-btn" disabled={editLocked} onClick={() => resetToAnswers()}>Reset to Wizard Answers</button></section>}
        {!native && !fixed && state.edit_mode === 'advanced' && <section className="rg-harness-blocks" id={instanceId + '-advanced'} tabIndex={-1} aria-label="Advanced harness settings"><div className="rg-composer-section-head"><h2>Advanced settings</h2><button className="rg-btn" disabled={editLocked} onClick={() => resetToAnswers()}>Reset to Wizard Answers</button></div><fieldset className="rg-composer-fields" disabled={editLocked}>{state.blocks.map((block, i) => block.type === 'prompt' ? null : <BlockCard key={block.type} block={block} index={i} count={state.blocks.length} tools={tools} onChange={editBlock} onMove={moveBlock} allowRemove={false} />)}</fieldset></section>}
        {native && <div className="rg-note"><p>Native runtime settings are controlled by its verified adapter. TraceHarness block settings are not applied to this agent.</p>{runtime?.reason && <p className="rg-small">{runtime.reason}</p>}</div>}
        {[...(preview?.warnings || []), ...blocksIssues].map((warning) => <p className="rg-harness-warning" role="status" key={warning}>{warning}</p>)}
        {previewError && <p role="alert">{previewError}</p>}
        {credentialsAvailable ? <section className="rg-pnl rg-composer-key"><div className="rg-pnl-h"><Icon name="sent" /><h2>OpenRouter connection</h2></div><div className="rg-pnl-b">
          {!credentialsAvailable ? <p className="rg-small">Connect an execution service before adding a key. No key is collected while the runner is unavailable.</p>
            : credential ? <><p role="status">Connected for this session · expires at {readableTime(credential.expires_at)}</p><button className="rg-btn" onClick={clearKey}>Disconnect OpenRouter</button></>
              : <><label className="rg-fld">OpenRouter API key<input className="rg-inp" type="password" autoComplete="off" spellCheck={false} value={key} disabled={connecting} onChange={(e) => setKey(e.target.value)} /></label><div className="rg-row rg-wrap"><button className="rg-btn" disabled={!key.trim() || connecting} onClick={connectKey}>{connecting ? 'Verifying key…' : 'Connect OpenRouter'}</button><button className="rg-btn ghost" onClick={clearKey}>Clear key</button></div></>}
          <p className="rg-small rg-mute">Your key is never included in saved harnesses or exported configurations. A connection is cleared when this workspace closes.</p>
        </div></section> : <details className="rg-composer-details"><summary>OpenRouter connection</summary><p>Connect an execution service before adding a key. No key is collected while the runner is unavailable. Keys are excluded from saved and exported configurations.</p></details>}
      </section>
      <aside className="rg-composer-review" aria-label="Run configuration"><div className="rg-composer-section-head"><h2>Run configuration</h2><Icon name="log" /></div><dl>
        <div><dt>Engine</dt><dd>{native ? runtime?.name || 'Native agent' : 'TraceHarness'}<small>{native ? 'Native runtime' : fixed ? `${card?.name || 'Selected'} stand-in` : 'Configurable engine'}</small></dd></div>
        <div><dt>Model</dt><dd>{state.model_id || 'Choose a model'}</dd></div><div><dt>Task</dt><dd>{task?.title || state.task_id || 'Choose a task'}{task?.revision && <small>{task.revision}</small>}</dd></div>
        <div><dt>Prompt</dt><dd>{new TextEncoder().encode(prompt).length.toLocaleString()} bytes · {configuration.prompt_mode}</dd></div>
      </dl><fieldset className="rg-composer-limits" disabled={editLocked}><legend>Run limits</legend>{LIMIT_FIELDS.filter((field) => native || field.key !== 'max_steps').map((field) => <NumericField key={field.key} field={native && field.key === 'max_steps' ? { ...field, label: 'Model request cap' } : field} value={state.limits[field.key]} onChange={(value) => setState((s) => ({ ...s, limits: { ...s.limits, [field.key]: value } }))} />)}{native ? <p className="rg-small rg-mute">This cap counts model requests. Native tool actions are controlled by the runtime.</p> : <p className="rg-small rg-mute">{configuration.limits.max_steps} steps · set by this harness</p>}</fieldset><div className="rg-composer-readiness" aria-live="polite"><strong>{reviewed ? 'Configuration verified' : 'Before this can run'}</strong>{readyIssues.length ? <ul>{[...new Set(readyIssues)].map((issue) => <li key={issue}>{issue}</li>)}</ul> : !reviewed ? <p>Review the configuration with the runner before launching.</p> : <p>The server validated this exact configuration. Running may spend your OpenRouter credits.</p>}{!credential && credentialsAvailable && <p>Connect your OpenRouter key to run.</p>}{preflight?.key === configurationKey && preflight.result.issues.map((issue) => <p key={issue} role="alert">{issue}</p>)}</div>
      <div className="rg-composer-actions"><button className="rg-btn" onClick={reviewRun} disabled={editLocked || !!readyIssues.length || checking}>{checking ? 'Reviewing…' : 'Review run'}</button><button className="rg-btn pri" onClick={run} disabled={editLocked || !reviewed || !!readyIssues.length || !credential || !!jobActive}>{launching ? 'Starting…' : job && terminal.has(job.status) ? 'Run again' : 'Run'}</button>


      </div><p className="rg-small rg-mute">Selections stay in this account’s tab. Saving a harness does not run a model.</p>

      {(catalogError || !catalog.runner.available) && <div className="rg-composer-service-note">{catalogError && <p role="alert">{catalogError}</p>}<button className="rg-btn" disabled={catalogLoading} onClick={() => setCatalogRevision((n) => n + 1)}>Refresh runner</button></div>}
      </aside>
    </div>
    {showCheckpoints && <div id={instanceId + '-checkpoints'} className="rg-composer-checkpoints">
      {checkpointData.warning && <p role="alert">{checkpointData.warning}</p>}
      {checkpointNotice && <p role="status">{checkpointNotice}</p>}
      {deletedCheckpoint && <button type="button" className="rg-btn" disabled={editLocked} onClick={undoCheckpointDeletion}>Undo checkpoint deletion</button>}
      {comparedCheckpoint && !checkpointComparison && checkpoints.some((row) => row.id === comparedCheckpoint) && <p role="status">Complete valid configuration values to compare with this checkpoint.</p>}
      <ConfigurationLibrary entries={checkpoints} busy={editLocked} comparison={checkpointComparison} onCreate={createCheckpoint} onRename={renameStoredCheckpoint} onDelete={removeCheckpoint} onRestore={restoreStoredCheckpoint} onCompare={compareCheckpoint} onExport={(id) => downloadConfiguration(restoreCheckpoint(checkpoints, id), 'traceharness-checkpoint.json')} />
    </div>}
    {job && <section className="rg-pnl rg-composer-job" aria-label="Current job"><div className="rg-pnl-h"><h2>Run {job.id}</h2><span className="meta">{job.status.replaceAll('_', ' ')}</span></div><div className="rg-pnl-b"><p>{job.cancellation_requested && !terminal.has(job.status) ? 'Cancellation requested; waiting for confirmed termination.' : job.status === 'succeeded' ? 'Execution completed. The task grade is reported separately below.' : terminal.has(job.status) ? 'The runner reported a final state.' : 'Showing status reported by the execution service.'}</p><p data-el="runner-job-grade"><strong>Task grade:</strong> {gradeLabels[job.grade] || 'Not reported'}</p>{job.manifest_sha256 && <p className="rg-small rg-mono">Configuration {job.manifest_sha256}</p>}{(job.issues || []).map((issue) => <p key={issue} role="alert">{issue}</p>)}{jobError && <p role="alert">{jobError}</p>}<div className="rg-row rg-wrap"><button className="rg-btn" disabled={launching} onClick={() => refreshJob()}>Refresh status</button>{!terminal.has(job.status) && <button className="rg-btn" disabled={cancelling || job.cancellation_requested} onClick={() => refreshJob(true)}>{cancelling ? 'Requesting cancellation…' : 'Cancel run'}</button>}</div>{job.usage && <dl className="rg-composer-usage">{Object.entries(job.usage).filter(([, value]) => value != null).map(([name, value]) => <div key={name}><dt>{name.replaceAll('_', ' ')}</dt><dd>{String(value)}</dd></div>)}</dl>}{job.artifacts?.length > 0 && <ul>{job.artifacts.map((a) => <li key={a.name}>{a.name} · {a.bytes} bytes</li>)}</ul>}</div></section>}
    <footer className="rg-composer-footer"><Go spec="shallowApply" className="rg-tlink">Compare one prompt across the six TraceHarness shells</Go><span>Native runtimes and lab stand-ins are distinct engines.</span></footer>
  </div>
}

export const views = {
  harnesses: { tag: 'cfg', title: () => 'Harnesses', crumbs: () => [['Harnesses']], render: HarnessComposer,
    palette: () => [{ title: 'Harnesses', detail: 'Choose a harness, model, task and prompt', spec: 'harnesses', keywords: 'native claude codex openrouter fixed minimal flexible run configuration' }] },
}
