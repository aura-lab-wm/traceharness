import { IS_STATIC } from './api'
import { MEMBER, encodeMemberJSON } from './member-api'

export const UNAVAILABLE_RUNNER = Object.freeze({
  version: 1,
  runner: { available: false, message: 'No execution service is connected. You can configure and save harnesses here.' },
  runtimes: [], models: [], tasks: [], credentials_available: false, execution_available: false,
})

const RUNTIME_IDS = new Set(['traceharness', 'native-claude-code', 'native-codex'])

const allowed = (path, method) => method === 'GET' && ['/catalog', '/jobs'].includes(path)
  || method === 'GET' && /^\/jobs\/[A-Za-z0-9_-]{1,100}$/.test(path)
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
      body: body === undefined ? undefined : encodeMemberJSON(body),
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
      || r.model_ids !== undefined && (!Array.isArray(r.model_ids) || r.model_ids.some((id) => !text(id))))
    || data.models.some((m) => !optionalText(m.name)
      || m.context_length !== undefined && (!Number.isSafeInteger(m.context_length) || m.context_length <= 0)
      || m.supported_parameters !== undefined && (!Array.isArray(m.supported_parameters) || m.supported_parameters.length > 50 || m.supported_parameters.some((p) => !text(p) || p.length > 80))
      || m.pricing !== undefined && (m.pricing === null || typeof m.pricing !== 'object' || Array.isArray(m.pricing)
        || ['prompt', 'completion'].some((key) => m.pricing[key] !== undefined && (!text(m.pricing[key]) || m.pricing[key].length > 40 || !/^\d+(?:\.\d+)?$/.test(m.pricing[key])))))
    || data.tasks.some((t) => !optionalText(t.title) || !optionalText(t.repository) || !optionalText(t.revision) || !optionalText(t.reason) || typeof t.ready !== 'boolean'
      || t.environment_digest !== undefined && (!text(t.environment_digest) || t.environment_digest.length > 256)
      || t.runtime_ids !== undefined && (!Array.isArray(t.runtime_ids) || !t.runtime_ids.length || t.runtime_ids.length > RUNTIME_IDS.size
        || t.runtime_ids.some((id) => !RUNTIME_IDS.has(id)) || new Set(t.runtime_ids).size !== t.runtime_ids.length))
    || ['runtimes', 'models', 'tasks'].some((key) => new Set(data[key].map((r) => r.id)).size !== data[key].length)) {
    throw new Error('The runner catalog is incomplete. Execution remains unavailable.')
  }
  return data
}
