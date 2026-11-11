import { useEffect, useMemo, useRef, useState } from 'react'
import { runnerRequest } from '../runner-api'
import { expiryTime } from './views/harness-composer-state'
import {
  captureHarnessSnapshot,
  checkedExperimentHistory,
  checkedMatrixExperiment,
  checkedPreflightResponse,
  expandMatrixCells,
  experimentActive,
  matrixPlanDraft,
  removeHarnessSnapshot,
  replaceHarnessSnapshot,
  stableJSON,
} from './experiment-matrix-state'
import { HarnessJson } from './HarnessJson'
import './ExperimentWorkspace.css'

const cellIdentity = cell => `${cell.snapshotId}:${cell.modelId}:${cell.taskId}`

const GRADE_LABELS = {
  ungraded: 'Not graded',
  passed: 'Passed',
  failed: 'Failed',
  error: 'Grading error',
}

function amountNumber(value) {
  const parsed = Math.round(Number(value || 0) * 1e8) / 1e8
  return Number.isFinite(parsed) ? String(parsed) : '0'
}

function money(value) {
  return '$' + amountNumber(value)
}

function nextSnapshotLabel(snapshots) {
  let index = snapshots.length + 1
  const used = new Set(snapshots.map((row) => row.label))
  while (used.has(`Harness ${index}`)) index++
  return `Harness ${index}`
}

function describeCapturedConfiguration(configuration) {
  if (!configuration || typeof configuration !== 'object') return 'Configuration'
  if (configuration.version === 2) {
    const action = configuration.native_prompt_profile?.default_action || 'configured'
    const overrides = Array.isArray(configuration.native_prompt_profile?.overrides)
      ? configuration.native_prompt_profile.overrides.length
      : 0
    return `Native profile · ${action} default · ${overrides} override${overrides === 1 ? '' : 's'}`
  }
  if (configuration.runtime_id === 'traceharness') {
    if (configuration.harness?.lane === 'fixed' && configuration.harness?.id) {
      return `Preset · ${configuration.harness.id}`
    }
    if (configuration.harness?.id) return `TraceHarness · ${configuration.harness.id}`
    return 'Custom TraceHarness'
  }
  return `${configuration.runtime_id} · append overlay`
}

function describeTrialIdentity(trial, arm) {
  const manifest = trial?.job?.manifest || arm?.manifest || null
  const config = arm?.configuration || null
  const runtimeId = manifest?.runtime_id || config?.runtime_id || 'unknown-runtime'
  const runtimeVersion = manifest?.runtime_version ? `@${manifest.runtime_version}` : ''
  const modelId = manifest?.model_id || config?.model_id || 'unknown-model'
  const taskId = manifest?.task_id || config?.task_id || 'unknown-task'
  const taskRevision = manifest?.task_revision ? `@${manifest.task_revision.slice(0, 12)}` : ''
  const profile = manifest?.native_prompt_profile || (config?.version === 2 ? config.native_prompt_profile : null)

  let mode = manifest?.prompt_mode || config?.prompt_mode || ''
  if (profile) {
    mode = `native profile (${profile.default_action || 'configured'})`
  } else if (manifest?.harness?.id) {
    mode = `harness ${manifest.harness.id}`
  } else if (config?.harness?.lane === 'fixed' && config?.harness?.id) {
    mode = `preset ${config.harness.id}`
  }

  return {
    runtimeLine: `${runtimeId}${runtimeVersion} · ${modelId}`,
    taskLine: `${taskId}${taskRevision}${mode ? ' · ' + mode : ''}`,
  }
}

function upsertExperimentRow(rows, record) {
  const next = rows.filter((row) => row.id !== record.id)
  return [record, ...next]
}

function syncExperimentLease(leaseTarget, uncertainId, activeRecord, rows) {
  if (!leaseTarget) return
  leaseTarget.current = Boolean(uncertainId)
    || experimentActive(activeRecord)
    || rows.some(experimentActive)
}

export function ExperimentWorkspace({
  configuration,
  catalog,
  credential = null,
  available = false,
  disabled = false,
  lease,
  onOpenJob,
}) {
  const [open, setOpen] = useState(false)
  const [experimentName, setExperimentName] = useState('Harness × model × task matrix')
  const [snapshotName, setSnapshotName] = useState('Harness 1')
  const [snapshots, setSnapshots] = useState([])
  const [selectedModelIds, setSelectedModelIds] = useState([])
  const [selectedTaskIds, setSelectedTaskIds] = useState([])
  const [modelQuery, setModelQuery] = useState('')
  const [taskQuery, setTaskQuery] = useState('')
  const [repeats, setRepeats] = useState('1')
  const [seed, setSeed] = useState('0')
  const [budgetUsd, setBudgetUsd] = useState('10')
  const [excludedCells, setExcludedCells] = useState(new Set())
  const [uncertainStart, setUncertainStart] = useState(null)
  const [review, setReview] = useState(null)
  const [experiment, setExperiment] = useState(null)
  const [history, setHistory] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [nowMs, setNowMs] = useState(() => Date.now())

  const mountedRef = useRef(true)
  const busyRef = useRef(false)
  const reviewGenerationRef = useRef(0)
  const latestContextRef = useRef({ key: '', catalog: null })
  const pendingCreateRef = useRef(null)
  const uncertainStartRef = useRef(null)
  const currentExperimentRef = useRef(null)
  const historyRef = useRef([])
  const leaseRef = useRef(lease)

  leaseRef.current = lease
  busyRef.current = busy
  currentExperimentRef.current = experiment
  historyRef.current = history

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const credentialExpiresAtMs = credential?.credential_id && credential.expires_at !== undefined
    ? expiryTime(credential.expires_at)
    : null

  useEffect(() => {
    setNowMs(Date.now())
    if (credentialExpiresAtMs === null || !Number.isFinite(credentialExpiresAtMs)) return undefined
    const delay = credentialExpiresAtMs - Date.now()
    if (delay <= 0) return undefined
    const timer = window.setTimeout(() => {
      if (mountedRef.current) setNowMs(Date.now() + 1)
    }, Math.min(delay + 25, 2147483647))
    return () => window.clearTimeout(timer)
  }, [credentialExpiresAtMs])

  const credentialReady = Boolean(credential?.credential_id)
    && (credential.expires_at === undefined || (Number.isFinite(credentialExpiresAtMs) && credentialExpiresAtMs > nowMs))

  const modelOptions = useMemo(() => {
    const base = Array.isArray(catalog?.models) ? catalog.models : []
    const seen = new Set(base.map((row) => row.id))
    const retained = selectedModelIds
      .filter((id) => !seen.has(id))
      .map((id) => ({ id, name: id, missing: true }))
    return [...base, ...retained]
  }, [catalog, selectedModelIds])

  const taskOptions = useMemo(() => {
    const base = Array.isArray(catalog?.tasks) ? catalog.tasks : []
    const seen = new Set(base.map((row) => row.id))
    const retained = selectedTaskIds
      .filter((id) => !seen.has(id))
      .map((id) => ({ id, title: id, ready: false, reason: 'Selected task is absent from the connected catalog.' }))
    return [...base, ...retained]
  }, [catalog, selectedTaskIds])

  const orderedModelIds = useMemo(() => {
    const selected = new Set(selectedModelIds)
    return modelOptions.filter((row) => selected.has(row.id)).map((row) => row.id)
  }, [modelOptions, selectedModelIds])

  const orderedTaskIds = useMemo(() => {
    const selected = new Set(selectedTaskIds)
    return taskOptions.filter((row) => selected.has(row.id)).map((row) => row.id)
  }, [taskOptions, selectedTaskIds])

  const filteredModels = useMemo(() => {
    const needle = modelQuery.trim().toLowerCase()
    if (!needle) return modelOptions
    return modelOptions.filter((model) =>
      `${model.name || ''} ${model.id}`.toLowerCase().includes(needle))
  }, [modelOptions, modelQuery])

  const filteredTasks = useMemo(() => {
    const needle = taskQuery.trim().toLowerCase()
    if (!needle) return taskOptions
    return taskOptions.filter((task) =>
      `${task.title || ''} ${task.id} ${task.repository || ''}`.toLowerCase().includes(needle))
  }, [taskOptions, taskQuery])

  const expanded = useMemo(() => {
    const count = snapshots.length * orderedModelIds.length * orderedTaskIds.length
    if (count > 512) return { cells: [], issue: `${count} candidate cells. Narrow the axes to at most 512 candidates, then select up to 64 trials.` }
    return expandMatrixCells({ snapshots, modelIds: orderedModelIds, taskIds: orderedTaskIds, catalog })
  }, [snapshots, orderedModelIds, orderedTaskIds, catalog])
  const includedCells = useMemo(() => expanded.cells.filter(cell => !excludedCells.has(cellIdentity(cell))), [expanded.cells, excludedCells])

  const draftEvaluation = useMemo(() => {
    try {
      if (expanded.issue) throw new Error(expanded.issue)
      const built = matrixPlanDraft({
        name: experimentName,
        seed,
        repeats,
        budgetUsd,
        cells: includedCells,
      })
      return { ok: true, ...built, key: stableJSON(built.plan), issue: '' }
    } catch (err) {
      return {
        ok: false,
        plan: null,
        trialCount: 0,
        maximumCostUsd: 0,
        bytes: 0,
        key: '',
        issue: err?.message || 'Complete the matrix plan before reviewing.',
      }
    }
  }, [experimentName, seed, repeats, budgetUsd, expanded.issue, includedCells])

  const draftIssue = draftEvaluation.ok ? '' : draftEvaluation.issue
  const draftKey = draftEvaluation.key
  latestContextRef.current = { key: draftKey, catalog }

  const activeReview = !draftIssue && review?.key === draftKey && review.catalog === catalog
    ? review
    : null
  const reviewed = Boolean(activeReview?.result?.ok)

  useEffect(() => {
    if (!available) return undefined
    let cancelled = false
    runnerRequest('/experiments')
      .then((data) => {
        if (cancelled || !mountedRef.current) return
        const items = checkedExperimentHistory(data)
        historyRef.current = items
        setHistory(items)
        syncExperimentLease(leaseRef.current, uncertainStartRef.current, currentExperimentRef.current, items)
      })
      .catch((err) => {
        if (!cancelled && mountedRef.current) {
          setError(err?.message || 'Could not load saved experiments.')
        }
      })
    return () => { cancelled = true }
  }, [available])

  useEffect(() => {
    if (!available || !experiment || !experimentActive(experiment)) return undefined
    const targetId = experiment.id
    const timer = window.setTimeout(async () => {
      if (!mountedRef.current || busyRef.current || currentExperimentRef.current?.id !== targetId) return
      try {
        const response = await runnerRequest(`/experiments/${targetId}`)
        if (!mountedRef.current || currentExperimentRef.current?.id !== targetId) return
        const checked = checkedMatrixExperiment(response?.experiment, targetId)
        if (!experimentActive(checked) && uncertainStartRef.current === targetId) {
          uncertainStartRef.current = null
        setUncertainStart(null)
        }
        currentExperimentRef.current = checked
        const nextHistory = upsertExperimentRow(historyRef.current, checked)
        historyRef.current = nextHistory
        setExperiment(checked)
        setHistory(nextHistory)
        syncExperimentLease(leaseRef.current, uncertainStartRef.current, checked, nextHistory)
      } catch (err) {
        if (mountedRef.current) setError(err?.message || 'Could not refresh active experiment.')
      }
    }, 2500)
    return () => window.clearTimeout(timer)
  }, [available, experiment, busy])

  const invalidateAuthoringReview = () => {
    reviewGenerationRef.current += 1
    setReview(null)
  }

  const handleCaptureSnapshot = () => {
    try {
      const next = captureHarnessSnapshot(snapshots, snapshotName, configuration)
      invalidateAuthoringReview()
      setSnapshots(next)
      setSnapshotName(nextSnapshotLabel(next))
      setError('')
    } catch (err) {
      setError(err?.message || 'Could not capture harness snapshot.')
    }
  }

  const handleReplaceSnapshot = (snapshotId) => {
    try {
      const next = replaceHarnessSnapshot(snapshots, snapshotId, configuration)
      invalidateAuthoringReview()
      setSnapshots(next)
      setError('')
    } catch (err) {
      setError(err?.message || 'Could not update harness snapshot.')
    }
  }

  const handleRemoveSnapshot = (snapshotId) => {
    try {
      const next = removeHarnessSnapshot(snapshots, snapshotId)
      invalidateAuthoringReview()
      setSnapshots(next)
      setError('')
    } catch (err) {
      setError(err?.message || 'Could not remove harness snapshot.')
    }
  }

  const toggleModel = (modelId) => {
    invalidateAuthoringReview()
    setError('')
    setSelectedModelIds((current) =>
      current.includes(modelId) ? current.filter((id) => id !== modelId) : [...current, modelId])
  }

  const toggleTask = (taskId, ready) => {
    invalidateAuthoringReview()
    setError('')
    setSelectedTaskIds((current) => {
      if (current.includes(taskId)) return current.filter((id) => id !== taskId)
      if (!ready) return current
      return [...current, taskId]
    })
  }

  const handleReviewPlan = async () => {
    if (busy || disabled || !available || !draftEvaluation.ok) return
    const generation = ++reviewGenerationRef.current
    const started = {
      key: draftEvaluation.key,
      catalog,
      plan: draftEvaluation.plan,
      trialCount: draftEvaluation.trialCount,
    }
    setBusy(true)
    setError('')
    try {
      const response = await runnerRequest('/experiments/preflight', {
        method: 'POST',
        body: { plan: started.plan },
      })
      const checked = checkedPreflightResponse(response, started.trialCount)
      if (!mountedRef.current || generation !== reviewGenerationRef.current) return
      if (latestContextRef.current.key !== started.key || latestContextRef.current.catalog !== started.catalog) return
      setReview({ key: started.key, catalog: started.catalog, result: checked })
    } catch (err) {
      if (mountedRef.current && generation === reviewGenerationRef.current) {
        setReview(null)
        setError(err?.message || 'Could not review matrix experiment.')
      }
    } finally {
      if (mountedRef.current) setBusy(false)
    }
  }

  const handleFreezePlan = async () => {
    if (busy || disabled || !reviewed || !draftEvaluation.ok || !activeReview) return
    const planSha = activeReview.result.plan_sha256
    const signature = `${draftEvaluation.key}:${planSha}`
    if (pendingCreateRef.current?.signature !== signature) {
      pendingCreateRef.current = {
        signature,
        key: 'exp-' + globalThis.crypto.randomUUID(),
      }
    }
    const idempotencyKey = pendingCreateRef.current.key
    setBusy(true)
    setError('')
    try {
      const response = await runnerRequest('/experiments', {
        method: 'POST',
        body: {
          idempotency_key: idempotencyKey,
          plan_sha256: planSha,
          plan: draftEvaluation.plan,
        },
      })
      const checked = checkedMatrixExperiment(response?.experiment)
      pendingCreateRef.current = null
      if (!mountedRef.current) return
      currentExperimentRef.current = checked
      const nextHistory = upsertExperimentRow(historyRef.current, checked)
      historyRef.current = nextHistory
      setExperiment(checked)
      setHistory(nextHistory)
      syncExperimentLease(leaseRef.current, uncertainStartRef.current, checked, nextHistory)
    } catch (err) {
      if (err?.status === 409) {
        pendingCreateRef.current = null
        setReview(null)
      }
      if (mountedRef.current) {
        setError(err?.message || 'Could not freeze matrix experiment.')
      }
    } finally {
      if (mountedRef.current) setBusy(false)
    }
  }

  const handleRefreshHistory = async () => {
    if (busy || !available) return
    setBusy(true)
    setError('')
    try {
      const data = await runnerRequest('/experiments')
      const items = checkedExperimentHistory(data)
      if (!mountedRef.current) return
      historyRef.current = items
      setHistory(items)
      syncExperimentLease(leaseRef.current, uncertainStartRef.current, currentExperimentRef.current, items)
    } catch (err) {
      if (mountedRef.current) setError(err?.message || 'Could not refresh saved experiments.')
    } finally {
      if (mountedRef.current) setBusy(false)
    }
  }

  const handleLoadExperiment = async (experimentId) => {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const response = await runnerRequest(`/experiments/${experimentId}`)
      const checked = checkedMatrixExperiment(response?.experiment, experimentId)
      if (!mountedRef.current) return
      if (!experimentActive(checked) && uncertainStartRef.current === experimentId) {
        uncertainStartRef.current = null
        setUncertainStart(null)
      }
      currentExperimentRef.current = checked
      const nextHistory = upsertExperimentRow(historyRef.current, checked)
      historyRef.current = nextHistory
      setExperiment(checked)
      setHistory(nextHistory)
      syncExperimentLease(leaseRef.current, uncertainStartRef.current, checked, nextHistory)
    } catch (err) {
      if (mountedRef.current) setError(err?.message || 'Could not load experiment.')
    } finally {
      if (mountedRef.current) setBusy(false)
    }
  }

  const handleStartExperiment = async () => {
    if (busy || disabled || uncertainStartRef.current || leaseRef.current?.current || !credentialReady || !experiment || !['ready', 'paused'].includes(experiment.status)) return
    const targetId = experiment.id
    uncertainStartRef.current = targetId
    setUncertainStart(targetId)
    syncExperimentLease(leaseRef.current, uncertainStartRef.current, experiment, historyRef.current)
    setBusy(true)
    setError('')
    try {
      const response = await runnerRequest(`/experiments/${targetId}/start`, {
        method: 'POST',
        body: {
          credential_id: credential.credential_id,
          plan_sha256: experiment.plan_sha256,
        },
      })
      const checked = checkedMatrixExperiment(response?.experiment, targetId)
      uncertainStartRef.current = null
        setUncertainStart(null)
      if (!mountedRef.current) return
      currentExperimentRef.current = checked
      const nextHistory = upsertExperimentRow(historyRef.current, checked)
      historyRef.current = nextHistory
      setExperiment(checked)
      setHistory(nextHistory)
      syncExperimentLease(leaseRef.current, uncertainStartRef.current, checked, nextHistory)
    } catch (err) {
      if (err?.status >= 400 && err?.status < 500) {
        if (uncertainStartRef.current === targetId) { uncertainStartRef.current = null; setUncertainStart(null) }
        setUncertainStart(null)
        try {
          const data = await runnerRequest('/experiments')
          const items = checkedExperimentHistory(data)
          historyRef.current = items
          if (mountedRef.current) setHistory(items)
          syncExperimentLease(leaseRef.current, uncertainStartRef.current, currentExperimentRef.current, items)
        } catch {
          syncExperimentLease(leaseRef.current, uncertainStartRef.current, currentExperimentRef.current, historyRef.current)
        }
      } else {
        syncExperimentLease(leaseRef.current, uncertainStartRef.current, currentExperimentRef.current, historyRef.current)
      }
      if (mountedRef.current) {
        setError(err?.message || 'Could not start experiment.')
      }
    } finally {
      if (mountedRef.current) setBusy(false)
    }
  }

  const handleCancelExperiment = async () => {
    if (busy || !experiment || ['completed', 'cancelled'].includes(experiment.status)) return
    const targetId = experiment.id
    setBusy(true)
    setError('')
    try {
      const response = await runnerRequest(`/experiments/${targetId}/cancel`, {
        method: 'POST',
        body: {},
      })
      const checked = checkedMatrixExperiment(response?.experiment, targetId)
      if (!experimentActive(checked) && uncertainStartRef.current === targetId) {
        uncertainStartRef.current = null
        setUncertainStart(null)
      }
      if (!mountedRef.current) return
      currentExperimentRef.current = checked
      const nextHistory = upsertExperimentRow(historyRef.current, checked)
      historyRef.current = nextHistory
      setExperiment(checked)
      setHistory(nextHistory)
      syncExperimentLease(leaseRef.current, uncertainStartRef.current, checked, nextHistory)
    } catch (err) {
      if (mountedRef.current) setError(err?.message || 'Could not cancel experiment.')
    } finally {
      if (mountedRef.current) setBusy(false)
    }
  }

  const handleExportExperiment = () => {
    if (!experiment) return
    try {
      const verified = checkedMatrixExperiment(experiment, experiment.id)
      const blob = new Blob([stableJSON(verified) + '\n'], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `traceharness-experiment-${verified.id}.json`
      anchor.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      setError(err?.message || 'Could not export experiment results.')
    }
  }

  const modelById = useMemo(
    () => new Map(modelOptions.map((model) => [model.id, model])),
    [modelOptions],
  )
  const taskById = useMemo(
    () => new Map(taskOptions.map((task) => [task.id, task])),
    [taskOptions],
  )
  const frozenArmById = useMemo(
    () => new Map((experiment?.plan?.arms || []).map((arm) => [arm.id, arm])),
    [experiment],
  )
  const reviewArmById = useMemo(
    () => new Map((activeReview?.result?.plan?.arms || []).map((arm) => [arm.id, arm])),
    [activeReview],
  )

  const parsedRepeatsPreview = /^\d+$/.test(String(repeats)) ? Number(repeats) : 0
  const plannedTrialPreview = includedCells.length * parsedRepeatsPreview

  return (
    <details className="rg-pnl rg-matrix-experiments" open={open}>
      <summary
        onClick={(event) => {
          event.preventDefault()
          setOpen((current) => !current)
        }}
      >
        Experiment matrix <span>Harness × model × task</span>
      </summary>

      {open && (
        <div className="rg-pnl-b">
          <p className="rg-sub">
            Capture immutable harness snapshots from the composer above, choose models and runnable tasks, verify the worst-case budget ceiling, then freeze and run an interleaved trial schedule.
          </p>

          <div className="rg-matrix-fields">
            <label className="rg-fld">
              <span>Experiment name</span>
              <input
                className="rg-inp"
                value={experimentName}
                maxLength={120}
                onChange={(event) => {
                  invalidateAuthoringReview()
                  setExperimentName(event.target.value)
                }}
              />
            </label>
            <label className="rg-fld">
              <span>Harness snapshot name</span>
              <input
                className="rg-inp"
                value={snapshotName}
                maxLength={80}
                onChange={(event) => setSnapshotName(event.target.value)}
              />
            </label>
            <button
              type="button"
              className="rg-btn"
              disabled={busy || disabled}
              onClick={handleCaptureSnapshot}
            >
              Capture current harness
            </button>
          </div>

          {snapshots.length > 0 && (
            <ul className="rg-matrix-snapshots" aria-label="Captured harnesses">
              {snapshots.map((snapshot) => (
                <li key={snapshot.id} className="rg-matrix-snapshot">
                  <div className="rg-matrix-snapshot-copy">
                    <strong>{snapshot.label}</strong>
                    <small>
                      {describeCapturedConfiguration(snapshot.configuration)} · cap {money(snapshot.configuration.limits.max_cost_usd)}/trial
                    </small>
                  </div>
                  <div className="rg-matrix-snapshot-actions">
                    <button
                      type="button"
                      className="rg-btn"
                      aria-label={`Update harness ${snapshot.label}`}
                      disabled={busy || disabled}
                      onClick={() => handleReplaceSnapshot(snapshot.id)}
                    >
                      Update with current
                    </button>
                    <button
                      type="button"
                      className="rg-btn"
                      aria-label={`Remove harness ${snapshot.label}`}
                      disabled={busy}
                      onClick={() => handleRemoveSnapshot(snapshot.id)}
                    >
                      Remove
                    </button>
                  </div>
                  <HarnessJson title={`Captured configuration · ${snapshot.label}`} source="Immutable harness snapshot" description="Model and task are selected independently below. This snapshot changes only when you choose Update with current." documents={[{ id: snapshot.id, label: snapshot.label, value: snapshot.configuration, filename: `harness-${snapshot.id}.json` }]} />
                </li>
              ))}
            </ul>
          )}

          <div className="rg-matrix-axes">
            <div className="rg-matrix-axis" role="group" aria-label="Matrix models">
              <div className="rg-matrix-axis-head">
                <h3>Models</h3>
                <span>{orderedModelIds.length} selected</span>
              </div>
              <div className="rg-matrix-axis-tools">
                <div className="rg-fld">
                  <input
                    className="rg-inp"
                    type="search"
                    aria-label="Filter matrix models"
                    placeholder="Filter models…"
                    value={modelQuery}
                    onChange={(event) => setModelQuery(event.target.value)}
                  />
                </div>
                <button
                  type="button"
                  className="rg-btn"
                  disabled={busy || modelOptions.length === 0}
                  onClick={() => {
                    invalidateAuthoringReview()
                    setSelectedModelIds(modelOptions.map((row) => row.id))
                  }}
                >
                  Select all models
                </button>
                <button
                  type="button"
                  className="rg-btn"
                  disabled={busy || selectedModelIds.length === 0}
                  onClick={() => {
                    invalidateAuthoringReview()
                    setSelectedModelIds([])
                  }}
                >
                  Clear models
                </button>
              </div>
              <ul className="rg-matrix-choices">
                {filteredModels.map((model) => {
                  const checked = selectedModelIds.includes(model.id)
                  const title = model.name || model.id
                  return (
                    <li
                      key={model.id}
                      className={`rg-matrix-choice${checked ? ' is-selected' : ''}`}
                    >
                      <input
                        type="checkbox"
                        aria-label={`Select model ${title}`}
                        checked={checked}
                        disabled={busy}
                        onChange={() => toggleModel(model.id)}
                      />
                      <div className="rg-matrix-choice-body">
                        <strong>{title}</strong>
                        <small className="rg-mono">{model.id}</small>
                      </div>
                    </li>
                  )
                })}
              </ul>
            </div>

            <div className="rg-matrix-axis" role="group" aria-label="Matrix tasks">
              <div className="rg-matrix-axis-head">
                <h3>Tasks</h3>
                <span>{orderedTaskIds.length} selected</span>
              </div>
              <div className="rg-matrix-axis-tools">
                <div className="rg-fld">
                  <input
                    className="rg-inp"
                    type="search"
                    aria-label="Filter matrix tasks"
                    placeholder="Filter tasks…"
                    value={taskQuery}
                    onChange={(event) => setTaskQuery(event.target.value)}
                  />
                </div>
                <button
                  type="button"
                  className="rg-btn"
                  disabled={busy || !taskOptions.some((row) => row.ready)}
                  onClick={() => {
                    invalidateAuthoringReview()
                    setSelectedTaskIds(taskOptions.filter((row) => row.ready).map((row) => row.id))
                  }}
                >
                  Select runnable tasks
                </button>
                <button
                  type="button"
                  className="rg-btn"
                  disabled={busy || selectedTaskIds.length === 0}
                  onClick={() => {
                    invalidateAuthoringReview()
                    setSelectedTaskIds([])
                  }}
                >
                  Clear tasks
                </button>
              </div>
              <ul className="rg-matrix-choices">
                {filteredTasks.map((task) => {
                  const checked = selectedTaskIds.includes(task.id)
                  const itemDisabled = busy || (!task.ready && !checked)
                  const title = task.title || task.id
                  return (
                    <li
                      key={task.id}
                      className={`rg-matrix-choice${checked ? ' is-selected' : ''}${!task.ready ? ' is-disabled' : ''}`}
                    >
                      <input
                        type="checkbox"
                        aria-label={`Select task ${title}`}
                        checked={checked}
                        disabled={itemDisabled}
                        onChange={() => toggleTask(task.id, Boolean(task.ready))}
                      />
                      <div className="rg-matrix-choice-body">
                        <strong>{title}</strong>
                        <small className="rg-mono">
                          {task.id}
                          {task.repository ? ` · ${task.repository}` : ''}
                          {task.revision ? `@${task.revision.slice(0, 12)}` : ''}
                        </small>
                        {!task.ready && (
                          <span className="rg-matrix-choice-reason">
                            {task.reason || 'Task is not runnable.'}
                          </span>
                        )}
                      </div>
                    </li>
                  )
                })}
              </ul>
            </div>
          </div>

          <div className="rg-matrix-fields">
            <label className="rg-fld">
              <span>Repetitions</span>
              <input
                className="rg-inp"
                type="number"
                min="1"
                max="10"
                value={repeats}
                onChange={(event) => {
                  invalidateAuthoringReview()
                  setRepeats(event.target.value)
                }}
              />
            </label>
            <label className="rg-fld">
              <span>Schedule seed</span>
              <input
                className="rg-inp"
                inputMode="numeric"
                value={seed}
                onChange={(event) => {
                  invalidateAuthoringReview()
                  setSeed(event.target.value)
                }}
              />
            </label>
            <label className="rg-fld">
              <span>Experiment budget (USD)</span>
              <input
                className="rg-inp"
                inputMode="decimal"
                value={budgetUsd}
                onChange={(event) => {
                  invalidateAuthoringReview()
                  setBudgetUsd(event.target.value)
                }}
              />
            </label>
          </div>

          <section className="rg-matrix-preview" aria-label="Expanded matrix cells">
            <div className="rg-matrix-preview-head">
              <strong>Expanded matrix cells</strong>
              <span>
                {includedCells.length} included / {expanded.cells.length} candidates · {plannedTrialPreview} trials
                {!draftIssue ? ` · ceiling ${money(draftEvaluation.maximumCostUsd)}` : ''}
              </span>
            </div>
            <div className="rg-row rg-wrap" style={{ marginBottom: 10 }}>
              <button type="button" className="rg-btn" disabled={busy || !expanded.cells.length} onClick={() => { invalidateAuthoringReview(); setExcludedCells(new Set(expanded.cells.filter(cell => !cell.compatible).map(cellIdentity))) }}>Select verified cells</button>
              <button type="button" className="rg-btn" disabled={busy || !excludedCells.size} onClick={() => { invalidateAuthoringReview(); setExcludedCells(new Set()) }}>Include all cells</button>
              <span className="rg-small rg-dim">Excluded cells stay visible and will not be scheduled.</span>
            </div>
            {expanded.cells.length > 0 ? (
              <ol className="rg-matrix-cells">
                {expanded.cells.map((cell) => {
                  const modelDisplay = modelById.get(cell.modelId)?.name || cell.modelId
                  const taskDisplay = taskById.get(cell.taskId)?.title || cell.taskId
                  return (
                    <li
                      key={cell.id}
                      className={`rg-matrix-cell${cell.compatible ? '' : ' is-incompatible'}`}
                    >
                      <input type="checkbox" aria-label={`Include cell ${cell.label}`} checked={!excludedCells.has(cellIdentity(cell))} disabled={busy} onChange={() => { invalidateAuthoringReview(); setExcludedCells(previous => { const next = new Set(previous); const key = cellIdentity(cell); if (next.has(key)) next.delete(key); else next.add(key); return next }) }} />
                      <div className="rg-matrix-cell-main">
                        <strong>{cell.snapshotLabel}</strong>
                        <span>{modelDisplay}</span>
                        <span className="rg-mono">{taskDisplay}</span>
                      </div>
                      <div className="rg-matrix-cell-meta">
                        <span className="rg-mono">{cell.runtimeId}</span>
                        <span className="rg-mono">{money(cell.maxCostUsd)}</span>
                        {cell.compatible ? (
                          <span>Compatible</span>
                        ) : (
                          cell.issues.map((issue) => <span key={issue}>{issue}</span>)
                        )}
                      </div>
                    </li>
                  )
                })}
              </ol>
            ) : (
              <p className="rg-sub">Capture at least one harness snapshot and select models and runnable tasks to expand matrix arms.</p>
            )}
          </section>

          {draftIssue && (
            <p className="rg-matrix-issue" role="status">{draftIssue}</p>
          )}

          <div className="rg-exe-actions">
            <button
              type="button"
              className="rg-btn"
              disabled={busy || disabled || !available || Boolean(draftIssue)}
              onClick={handleReviewPlan}
            >
              Review matrix experiment
            </button>
            <button
              type="button"
              className="rg-btn pri"
              disabled={busy || disabled || !reviewed}
              onClick={handleFreezePlan}
            >
              Freeze matrix experiment
            </button>
          </div>

          {activeReview && (
            <div className="rg-matrix-review" role="region" aria-label="Matrix experiment review">
              {activeReview.result.issues.map((issue) => (
                <p key={issue} className="rg-err" role="alert">{issue}</p>
              ))}
              {activeReview.result.ok && (
                <>
                  <strong>
                    {activeReview.result.trial_count} planned trials · maximum {money(activeReview.result.maximum_cost_usd)} · budget {money(draftEvaluation.plan.budget_usd)}
                  </strong>
                  <p className="rg-sub rg-mono">Plan {activeReview.result.plan_sha256}</p>
                  <ol>
                    {activeReview.result.plan.schedule.map((row) => {
                      const armLabel = reviewArmById.get(row.arm_id)?.label || row.arm_id
                      return (
                        <li key={row.id}>
                          Repeat {row.repeat} · {armLabel} · <span className="rg-mono">{row.manifest_sha256.slice(0, 12)}</span>
                        </li>
                      )
                    })}
                  </ol>
                </>
              )}
            </div>
          )}

          {error && <p className="rg-err" role="alert">{error}</p>}

          {experiment && (
            <section className="rg-matrix-results" aria-label="Matrix experiment results">
              <div className="rg-matrix-result-head">
                <h3>{experiment.plan.name}</h3>
                <strong>{experiment.status}</strong>
              </div>
              <p className="rg-sub rg-mono">Plan {experiment.plan_sha256}</p>
              <p className="rg-sub">
                {experiment.trial_count} trials · ceiling {money(experiment.maximum_cost_usd)}
                {experiment.plan.budget_usd !== undefined ? ` · budget ${money(experiment.plan.budget_usd)}` : ''}
              </p>

              <HarnessJson title="Frozen experiment JSON" source="Saved runner record" description="The reviewed configurations, resolved manifests and complete schedule retained for this experiment." documents={[{ id: experiment.id, label: 'Frozen plan', value: experiment.plan, filename: `experiment-plan-${experiment.id}.json` }]} />
              {experiment.issues.map((issue) => (
                <p key={issue} className="rg-err" role="alert">{issue}</p>
              ))}

              <div className="rg-exe-actions">
                <button
                  type="button"
                  className="rg-btn pri"
                  disabled={busy || disabled || !!uncertainStart || !!leaseRef.current?.current || !credentialReady || !['ready', 'paused'].includes(experiment.status)}
                  onClick={handleStartExperiment}
                >
                  {experiment.status === 'paused' ? 'Resume experiment' : 'Start experiment'}
                </button>
                <button
                  type="button"
                  className="rg-btn"
                  disabled={busy}
                  onClick={() => handleLoadExperiment(experiment.id)}
                >
                  Refresh experiment
                </button>
                <button
                  type="button"
                  className="rg-btn"
                  disabled={busy || ['completed', 'cancelled'].includes(experiment.status)}
                  onClick={handleCancelExperiment}
                >
                  Cancel experiment
                </button>
                <button
                  type="button"
                  className="rg-btn"
                  disabled={busy}
                  onClick={handleExportExperiment}
                >
                  Export experiment results
                </button>
              </div>

              {uncertainStart && <p role="status" className="rg-matrix-issue">Start outcome is unconfirmed. Refresh the experiment before taking another start action.</p>}
              {!credentialReady && ['ready', 'paused'].includes(experiment.status) && (
                <p className="rg-sub">
                  Connect an active OpenRouter key above before starting or resuming this frozen experiment.
                </p>
              )}

              <p className="rg-sub">
                {experiment.summary.finalized_trials} finalized · {experiment.summary.active_trials} active · {experiment.summary.pending_trials} pending
              </p>
              <p className="rg-sub">
                Confirmed cost subtotal: {money(experiment.summary.confirmed_cost_usd)} · {experiment.summary.cost_unknown_trials} trials with unconfirmed cost
              </p>

              <div className="rg-matrix-scroll" role="region" aria-label="Experiment trial queue" tabIndex={0}>
                <table className="rg-tbl rg-matrix-table">
                  <thead>
                    <tr>
                      <th>Repeat</th>
                      <th>Arm</th>
                      <th>Identity</th>
                      <th>Execution</th>
                      <th>Grade</th>
                      <th>Reported cost</th>
                      <th>Job</th>
                    </tr>
                  </thead>
                  <tbody>
                    {experiment.trials.map((trial) => {
                      const arm = frozenArmById.get(trial.arm_id)
                      const identity = describeTrialIdentity(trial, arm)
                      const trialIssues = [...new Set([...(trial.issues || []), ...(trial.job?.issues || [])])]
                      const costUsd = trial.job?.usage?.cost_usd
                      const jobId = trial.job?.id || trial.job_id || null
                      const gradeText = trial.job
                        ? (GRADE_LABELS[trial.job.grade || 'ungraded'] || 'Not graded')
                        : 'Pending'
                      return (
                        <tr key={trial.id}>
                          <td>{trial.repeat}</td>
                          <td>{arm?.label || trial.arm_id}</td>
                          <td>
                            <div className="rg-matrix-identity">
                              <span>{identity.runtimeLine}</span>
                              <span>{identity.taskLine}</span>
                              <code className="rg-mono">{trial.manifest_sha256}</code>
                            </div>
                          </td>
                          <td>
                            <div>{trial.status}</div>
                            {trialIssues.map((issue) => (
                              <div key={issue} className="rg-sub">{issue}</div>
                            ))}
                          </td>
                          <td>{gradeText}</td>
                          <td>
                            {costUsd === undefined || costUsd === null ? (
                              'Unconfirmed'
                            ) : (
                              <span className="rg-matrix-cost">
                                <span className="rg-mute">$</span>
                                {amountNumber(costUsd)}
                              </span>
                            )}
                          </td>
                          <td>
                            {jobId && onOpenJob ? (
                              <button
                                type="button"
                                className="rg-btn"
                                aria-label={`Open job ${jobId}`}
                                onClick={() => onOpenJob(jobId)}
                              >
                                Open job
                              </button>
                            ) : (
                              '—'
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              {experiment.plan.version === 1 && experiment.summary.comparisons.length > 0 && (
                <div className="rg-sub">
                  {experiment.summary.comparisons.map((comparison) => (
                    <p key={comparison.arm_id}>
                      Paired summary ({comparison.arm_id}): {comparison.graded_pairs ?? 0} of {comparison.planned_pairs ?? 0} pairs graded.
                    </p>
                  ))}
                </div>
              )}
            </section>
          )}

          {available && (
            <>
              <div className="rg-matrix-history">
                <strong>Saved experiments</strong>
                <button
                  type="button"
                  className="rg-btn"
                  disabled={busy}
                  onClick={handleRefreshHistory}
                >
                  Refresh experiments
                </button>
              </div>
              {history.length > 0 && (
                <div className="rg-matrix-history-list">
                  {history.map((row) => (
                    <button
                      key={row.id}
                      type="button"
                      className="rg-btn"
                      disabled={busy}
                      onClick={() => handleLoadExperiment(row.id)}
                    >
                      {row.id.slice(0, 8)} · {row.status} · {row.trial_count} trials
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </details>
  )
}
