// A runtime's model union cannot attest a particular task. Missing maps remain
// useful for draft authoring, but never establish execution compatibility.
export function taskCompatibility(task, runtime, modelId = '') {
  if (!runtime?.available) return { modelIds: [], status: 'Runtime unavailable', reason: runtime?.reason || 'This runtime is not available on the connected runner.' }
  if (!task) return { modelIds: runtime.model_ids || [], status: 'Choose a task', reason: '' }
  if (!task.ready) return { modelIds: [], status: 'Unavailable', reason: task.reason || 'This task package is not currently available.' }
  if (Array.isArray(task.runtime_ids) && !task.runtime_ids.includes(runtime.id)) return {
    modelIds: [], status: 'Different runtime', reason: 'This task is not registered for the selected runtime. Choose a supported task or harness.',
  }
  if (!task.model_ids_by_runtime) return {
    modelIds: [], status: 'Compatibility unreported', reason: 'Task-specific model compatibility has not been reported. Refresh the runner before running.',
  }
  const modelIds = (task.model_ids_by_runtime[runtime.id] || []).filter((id) => runtime.model_ids?.includes(id))
  if (!modelIds.length) return {
    modelIds, status: 'Not verified for this runtime', reason: 'This task has no verified model for the selected runtime. Choose another task or harness.',
  }
  if (modelId && !modelIds.includes(modelId)) return {
    modelIds, status: 'Different model', reason: 'The selected model is not verified for this task and runtime. Choose a supported model.',
  }
  return { modelIds, status: modelId ? 'Ready' : 'Choose a model', reason: '' }
}

/** The capability a run really needs: a native agent needs run.native; a task packaged in a container
    image (it carries environment digests) needs run.container; an in-process TraceHarness task needs
    only run.local, so it runs with no Docker and no setup. */
export function capabilityFor({ native = false, task = null } = {}) {
  if (native) return 'run.native'
  if (task && (task.environment_digests || task.environment_digest)) return 'run.container'
  return 'run.local'
}

/** A copy of the configuration that carries the explicit consent flag, or does not carry it at all. */
export function withUnverified(configuration, on) {
  const { unverified_ok: _drop, ...rest } = configuration
  return on ? { ...rest, unverified_ok: true } : rest
}
export const UNVERIFIED_LABEL = 'Run without a receipt on this machine (not verified)'
const RECEIPT_TEXT = /compatibility receipt|application receipt|not verified on this machine|unverified_ok/i
/** True when a backend issue or an inventory reason says the combination or profile has no receipt
    on this machine (so the user may confirm running it unverified). */
export const needsReceiptConsent = (...texts) => texts.flat().some((text) => typeof text === 'string' && RECEIPT_TEXT.test(text))
/** "Verified" or "Not verified on this machine" from a manifest's `verified`; '' when it is not recorded. */
export const verificationLabel = (manifest) => manifest?.verified === false ? 'Not verified on this machine' : manifest?.verified === true ? 'Verified' : ''

/** The manifest a trial ran under: its job's own when present, else the experiment's frozen arm manifest
    (trial job summaries deliberately exclude manifests, so the plan's arm is the recorded source). */
export function trialManifest(experiment, trial) {
  const arm = (experiment?.plan?.arms || []).find((row) => row.id === trial?.arm_id)
  return trial?.job?.manifest || arm?.manifest || null
}
/** One verification sentence for an experiment: any unverified trial makes the whole comparison unverified. */
export function experimentVerification(experiment) {
  const manifests = (experiment?.trials || []).map((trial) => trialManifest(experiment, trial)).filter(Boolean)
  if (manifests.some((m) => m.verified === false)) return 'Not verified on this machine'
  return manifests.length && manifests.every((m) => verificationLabel(m) === 'Verified') ? 'Verified' : ''
}
