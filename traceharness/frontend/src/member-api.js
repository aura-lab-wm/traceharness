// The authenticated worker inserts this marker before the snapshot scripts. It
// carries no credential; the worker still checks the session, origin and scope.
const marker = typeof window === 'undefined' ? null : window.__TRACEHARNESS_MEMBER__
export const MEMBER = marker?.version === 1 && /^[a-f0-9]{24}$/.test(marker.scope)
  ? Object.freeze({ version: 1, scope: marker.scope }) : null
export const IS_MEMBER = !!MEMBER

// Match the member worker encoder: Python retains -0.0 in temperature identity.
export function encodeMemberJSON(value, key) {
  if (key === 'temperature' && Object.is(value, -0)) return '-0.0'
  if (Array.isArray(value)) return '[' + value.map((item) => encodeMemberJSON(item) ?? 'null').join(',') + ']'
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).filter((name) => value[name] !== undefined)
      .map((name) => JSON.stringify(name) + ':' + encodeMemberJSON(value[name], name)).join(',') + '}'
  }
  return JSON.stringify(value)
}

export function memberRoute(path, method = 'GET') {
  if (typeof path !== 'string') return false
  if (method === 'GET') return /^\/shallow\/(catalog|harnesses(?:\/[A-Za-z0-9_.@-]{1,80})?)$/.test(path)
  return method === 'POST' && ['/shallow/harnesses', '/shallow/wizard', '/shallow/compile'].includes(path)
}

export async function memberRequest(path, opts = {}) {
  const method = (opts.method || 'GET').toUpperCase()
  if (!MEMBER || !memberRoute(path, method)) throw new Error('This action needs the local app. Start it with python -m traceharness --host 127.0.0.1 --port 8742.')
  if (opts.signal?.aborted) throw new Error('The member request was cancelled. Your draft has been kept.')
  const headers = new Headers(opts.headers)
  headers.set('content-type', 'application/json')
  headers.set('x-traceharness-member-scope', MEMBER.scope)
  if (method === 'GET' && path === '/shallow/harnesses') headers.set('cache-control', 'no-cache')
  const controller = new AbortController()
  let timer
  let cancel
  const cancelled = new Promise((_, reject) => {
    cancel = () => {
      controller.abort()
      reject(new Error('The member request was cancelled. Your draft has been kept.'))
    }
    timer = setTimeout(() => {
      controller.abort()
      reject(new Error('The member request timed out. Its outcome could not be confirmed. Your draft has been kept; reload saved harnesses before retrying.'))
    }, 20_000)
  })
  opts.signal?.addEventListener('abort', cancel, { once: true })
  try {
    return await Promise.race([cancelled, (async () => {
      const response = await fetch('/api' + path, {
        method, headers, credentials: 'same-origin', mode: 'same-origin', redirect: 'error', cache: 'no-store',
        signal: controller.signal,
        body: opts.body === undefined ? undefined : encodeMemberJSON(opts.body),
      })
      let data
      try { data = await response.json() } catch { throw new Error('The member service returned an unreadable response. Your draft has been kept.') }
      if (!response.ok) {
        const error = new Error(data?.error || data?.detail || response.statusText || 'The member request failed.')
        error.status = response.status
        throw error
      }
      const harness = (row) => row && typeof row === 'object' && typeof row.id === 'string' && typeof row.prompt === 'string' && Array.isArray(row.tools) && row.tools.every((tool) => typeof tool === 'string')
      const valid = data && typeof data === 'object' && !Array.isArray(data) && (
        method === 'GET' && ['/shallow/catalog', '/shallow/harnesses'].includes(path)
          ? Array.isArray(data.harnesses) && data.harnesses.every(harness)
          : harness(data.harness)
      )
      const preview = ['/shallow/compile', '/shallow/wizard'].includes(path)
      if (!valid || (preview && (data.ok !== true || !Array.isArray(data.warnings) || data.warnings.some((warning) => typeof warning !== 'string')))) {
        throw new Error('The member service returned an incomplete harness response. Your draft has been kept.')
      }
      return data
    })()])
  } finally {
    clearTimeout(timer)
    opts.signal?.removeEventListener('abort', cancel)
  }
}

export function requireStored(result) {
  if (result?.stored !== true) throw new Error('Account storage did not confirm this save. Your draft has been kept; retry before leaving this tab.')
  if (!result.harness || typeof result.harness.id !== 'string' || typeof result.harness.prompt !== 'string') throw new Error('The save response was incomplete. Your draft has been kept; reload before retrying.')
  return result
}
