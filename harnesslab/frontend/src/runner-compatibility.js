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
