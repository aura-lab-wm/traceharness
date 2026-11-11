import { IS_STATIC } from './api'
import { MEMBER, encodeMemberJSON } from './member-api'

export const UNAVAILABLE_RUNNER = Object.freeze({
  version: 1,
  runner: { available: false, message: 'No execution service is connected. You can configure and save harnesses here.' },
  runtimes: [], models: [], tasks: [], credentials_available: false, execution_available: false,
})

export const RUNNER_ARTIFACT_NAMES = new Set(['manifest.json', 'grade.json', 'trace.jsonl', 'messages.json', 'patch.diff', 'summary.json', 'native-prompt-profile.json', 'native-prompt-application.json', 'native-prompt-observations.json'])
const ARTIFACT_MAX_BYTES = 1024 * 1024
const IMAGE_ID = /^(?:[a-zA-Z0-9][a-zA-Z0-9./:_-]*@)?sha256:[a-f0-9]{64}$/
const RUNTIME_IDS = new Set(['traceharness', 'native-claude-code', 'native-codex'])

const artifactRoute = (path) => {
  const match = /^\/jobs\/([a-f0-9]{48})\/artifacts\/([^/]+)$/.exec(path)
  return !!match && RUNNER_ARTIFACT_NAMES.has(match[2])
}

const allowed = (path, method) => method === 'GET' && ['/catalog', '/jobs'].includes(path)
  || method === 'GET' && /^\/prompt-inventory\/(native-claude-code|native-codex)$/.test(path)
  || method === 'GET' && /^\/jobs\/[A-Za-z0-9_-]{1,100}$/.test(path)
  || method === 'GET' && artifactRoute(path)
  || method === 'POST' && ['/preflight', '/credentials', '/jobs'].includes(path)
  || method === 'POST' && /^\/jobs\/[A-Za-z0-9_-]{1,100}\/cancel$/.test(path)
  || method === 'DELETE' && /^\/credentials\/[A-Za-z0-9_-]{1,100}$/.test(path)

export async function runnerRequest(path, { method = 'GET', body, signal } = {}) {
  if (!allowed(path, method)) throw new Error('This runner action is not supported.')
  if (IS_STATIC && !MEMBER) {
    if (path === '/catalog' && method === 'GET') return UNAVAILABLE_RUNNER
    throw new Error('This offline export is not connected to an execution service.')
  }
  const controller = new AbortController()
  const cancel = () => controller.abort()
  if (signal?.aborted) cancel()
  signal?.addEventListener('abort', cancel, { once: true })
  const timeout = setTimeout(cancel, 20_000)
  const headers = new Headers({ 'content-type': 'application/json' })
  if (MEMBER) headers.set('x-traceharness-member-scope', MEMBER.scope)
  try {
    const response = await fetch('/api/runner' + path, {
      method, headers, signal: controller.signal, credentials: 'same-origin',
      mode: 'same-origin', redirect: 'error', cache: 'no-store',
      ...(method === 'GET' || body === undefined ? {} : { body: encodeMemberJSON(body) }),
    })
    let data
    try { data = await response.json() } catch { throw new Error('The runner returned an unreadable response.') }
    if (!response.ok) {
      // Credential transport errors must never echo a provider response or key.
      const message = path.startsWith('/credentials')
        ? response.status === 401 ? 'The key could not be verified. Check it and try again.'
          : response.status === 409 ? 'The signed-in account changed. Reload before connecting a key.'
            : 'The key connection could not be confirmed. Try again when the runner is available.'
        : data?.error || data?.detail || 'The runner request failed.'
      const error = new Error(typeof message === 'string' ? message : 'The runner request failed.')
      error.status = response.status
      throw error
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('The runner returned an incomplete response.')
    return data
  } catch (error) {
    if (controller.signal.aborted) throw new Error('The runner request was interrupted. Its outcome is unconfirmed; your configuration is still here.')
    if (path.startsWith('/credentials') && !error.status) throw new Error('The key connection could not be confirmed. Try again when the runner is available.')
    throw error
  } finally {
    clearTimeout(timeout)
    signal?.removeEventListener('abort', cancel)
  }
}

export function runnerCatalog(data) {
  if (data?.version !== 1 || !data.runner || typeof data.runner.available !== 'boolean'
    || !['runtimes', 'models', 'tasks'].every((key) => Array.isArray(data[key]) && data[key].every((row) => row && typeof row.id === 'string'))
    || typeof data.credentials_available !== 'boolean' || typeof data.execution_available !== 'boolean') {
    throw new Error('The runner catalog is incomplete. Execution remains unavailable.')
  }
  const text = (value) => typeof value === 'string'
  const optionalText = (value) => value === undefined || text(value)
  if (!optionalText(data.runner.message)
    || data.runtimes.some((r) => !text(r.name) || !['traceharness', 'native'].includes(r.kind) || typeof r.available !== 'boolean'
      || !['replace', 'append'].includes(r.prompt_mode) || !optionalText(r.reason)
      || !(optionalText(r.version) || r.available === false && r.version === null)
      || r.native_prompts !== undefined && (!r.native_prompts || typeof r.native_prompts !== 'object' || Array.isArray(r.native_prompts)
        || r.kind !== 'native' || typeof r.native_prompts.available !== 'boolean' || typeof r.native_prompts.execution_available !== 'boolean'
        || !['embedded', 'overlay'].includes(r.native_prompts.mode) || !text(r.native_prompts.reason)
        || r.native_prompts.available && !/^[a-f0-9]{64}$/.test(r.native_prompts.inventory_sha256)
        || !r.native_prompts.available && r.native_prompts.execution_available)
      || r.model_ids !== undefined && (!Array.isArray(r.model_ids) || r.model_ids.some((id) => !text(id))))
    || data.models.some((m) => !optionalText(m.name)
      || m.context_length !== undefined && (!Number.isSafeInteger(m.context_length) || m.context_length <= 0)
      || m.supported_parameters !== undefined && (!Array.isArray(m.supported_parameters) || m.supported_parameters.length > 50 || m.supported_parameters.some((p) => !text(p) || p.length > 80))
      || m.pricing !== undefined && (m.pricing === null || typeof m.pricing !== 'object' || Array.isArray(m.pricing)
        || ['prompt', 'completion'].some((key) => m.pricing[key] !== undefined && (!text(m.pricing[key]) || m.pricing[key].length > 40 || !/^\d+(?:\.\d+)?$/.test(m.pricing[key])))))
    || data.tasks.some((t) => !optionalText(t.title) || !optionalText(t.repository) || !optionalText(t.revision) || !optionalText(t.reason) || typeof t.ready !== 'boolean'
      || t.environment_digest !== undefined && (!text(t.environment_digest) || t.environment_digest.length > 256)
      || t.environment_digests !== undefined && (!t.environment_digests || typeof t.environment_digests !== 'object' || Array.isArray(t.environment_digests)
        || !Array.isArray(t.runtime_ids) || !Object.keys(t.environment_digests).length || Object.entries(t.environment_digests).some(([id, image]) => !RUNTIME_IDS.has(id) || typeof image !== 'string' || !IMAGE_ID.test(image) || !t.runtime_ids.includes(id))
        || t.runtime_ids?.some((id) => !Object.hasOwn(t.environment_digests, id)))
      || t.runtime_ids !== undefined && (!Array.isArray(t.runtime_ids) || !t.runtime_ids.length || t.runtime_ids.length > RUNTIME_IDS.size
        || t.runtime_ids.some((id) => !RUNTIME_IDS.has(id)) || new Set(t.runtime_ids).size !== t.runtime_ids.length))
    || ['runtimes', 'models', 'tasks'].some((key) => new Set(data[key].map((r) => r.id)).size !== data[key].length)) {
    throw new Error('The runner catalog is incomplete. Execution remains unavailable.')
  }
  const runtimeById = new Map(data.runtimes.map((row) => [row.id, row]))
  const modelIds = new Set(data.models.map((row) => row.id))
  for (const task of data.tasks) {
    if (task.model_ids_by_runtime === undefined) continue
    const pairs = task.model_ids_by_runtime
    if (!pairs || typeof pairs !== 'object' || Array.isArray(pairs) || !Array.isArray(task.runtime_ids)
      || Object.keys(pairs).length !== task.runtime_ids.length || Object.keys(pairs).some((id) => !task.runtime_ids.includes(id))
      || task.runtime_ids.some((id) => !Object.hasOwn(pairs, id) || !Array.isArray(pairs[id]) || pairs[id].length > 2000
        || new Set(pairs[id]).size !== pairs[id].length || pairs[id].some((model) => !text(model) || !modelIds.has(model)
          || !runtimeById.get(id)?.available || !runtimeById.get(id)?.model_ids?.includes(model)))
      || task.ready !== Object.values(pairs).some((ids) => ids.length > 0)) {
      throw new Error('The runner catalog is incomplete. Execution remains unavailable.')
    }
  }
  return data
}


export async function decodeRunnerArtifact(data, expected) {
  const failure = () => { throw new Error('Artifact integrity could not be verified. No file was downloaded.') }
  if (!expected || !RUNNER_ARTIFACT_NAMES.has(expected.name) || !data || data.name !== expected.name
    || data.encoding !== 'base64' || !Number.isSafeInteger(data.bytes) || data.bytes < 0 || data.bytes > ARTIFACT_MAX_BYTES
    || data.bytes !== expected.bytes || !/^[a-f0-9]{64}$/.test(data.sha256) || data.sha256 !== expected.sha256
    || typeof data.content !== 'string' || data.content.length > 4 * Math.ceil(ARTIFACT_MAX_BYTES / 3)
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data.content)) failure()
  let bytes
  try {
    const binary = atob(data.content)
    if (binary.length !== data.bytes) failure()
    bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (byte) => byte.toString(16).padStart(2, '0')).join('')
    if (hash !== data.sha256) failure()
  } catch { failure() }
  return bytes
}
