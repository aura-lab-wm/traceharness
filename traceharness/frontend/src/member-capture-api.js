/* Capture computers for a signed-in member (SPEC §5 WP2): the console's client for the hosted
   capture routes the Worker already serves (auth/worker/src/capture.js), and nothing else.

     GET    /api/capture/tokens[?cursor=…]     the computers connected to this account
     DELETE /api/capture/tokens/<uuid>         revoke one
     GET    /api/capture/runs[?cursor=…]       sessions those computers uploaded
     GET    /api/capture/runs/<run id>         one session: summary and ledger
     DELETE /api/capture/runs/<run id>         delete one from the account

   Member mode only: in the local console and in an export every call is refused before any request
   (the local console has its own capture API, with its own {rows,total} profile, SPEC 4.9). A
   request is same-origin, never follows a redirect, is never cached, carries the member scope the
   Worker checks, and gives up after 20 s. Every answer is checked field by field against what the
   Worker sends; anything else is refused rather than shown. Nothing here keeps an answer: it is
   returned to the caller, which holds it in component state only. The Worker keeps every check of
   its own (session, origin, scope, ownership); this module only refuses to ask for more. */
import { MODE, why } from './environment.js'

export const CAPTURE_TIMEOUT_MS = 20_000

const SCOPE = /^[a-f0-9]{24}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
/** capture.js RUN_ID: no slash, no query, never "." or "..". */
const RUN_ID = /^(?!\.{1,2}$)[A-Za-z0-9_.@-]{1,120}$/
/** capture.js readListCursor: opaque base64url, at most 1024 characters. */
const CURSOR = /^[A-Za-z0-9_-]{1,1024}$/
const SOURCE = /^[a-z0-9_]{1,40}$/
const STAMP = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}(?::?\d{2})?)?$/
const MAX_TEXT = 200
const MAX_ERROR = 500
const PAGE = { tokens: 100, runs: 200 }

/** The member scope the Worker put in its marker, read once (the same check environment.js makes). */
const marker = typeof window === 'undefined' ? null : window.__TRACEHARNESS_MEMBER__
const MEMBER_SCOPE = MODE === 'member' && marker?.version === 1 && SCOPE.test(marker.scope) ? marker.scope : null

/** A refusal or a failed request. `code`: refused | aborted | timeout | network | http | shape. */
export class CaptureError extends Error {
  constructor(message, { status = 0, code = 'http' } = {}) {
    super(message)
    this.name = 'CaptureError'
    this.status = status
    this.code = code
  }
}

const refused = (message) => new CaptureError(message, { code: 'refused' })

/** The request for (method, path), or null when it is not one of the five routes.
 *  `path` is the API path without /api, e.g. "/capture/runs?cursor=…" or "/capture/runs/<id>". */
export function captureRoute(method, path) {
  if (typeof method !== 'string' || typeof path !== 'string' || !path.startsWith('/capture/') || path.includes('#')) return null
  const at = path.indexOf('?')
  const base = at < 0 ? path : path.slice(0, at)
  const query = at < 0 ? null : path.slice(at + 1)
  const parts = base.split('/')   // ['', 'capture', kind, id?]
  if (parts.length < 3 || parts.length > 4 || parts[1] !== 'capture') return null
  const [, , kind, id] = parts
  if (kind !== 'tokens' && kind !== 'runs') return null
  if (id === undefined) {
    if (method !== 'GET') return null
    if (query !== null) {
      const m = /^cursor=(.*)$/.exec(query)
      if (!m || !CURSOR.test(m[1])) return null
    }
    return { kind: `${kind}List`, url: `/api/capture/${kind}${query === null ? '' : '?' + query}`, method }
  }
  if (query !== null) return null
  if (kind === 'tokens') {
    if (method !== 'DELETE' || !UUID.test(id)) return null
    return { kind: 'tokenRevoke', url: `/api/capture/tokens/${id}`, method, id }
  }
  if ((method !== 'GET' && method !== 'DELETE') || !RUN_ID.test(id)) return null
  return { kind: method === 'GET' ? 'runGet' : 'runDelete', url: `/api/capture/runs/${encodeURIComponent(id)}`, method, id }
}

/* ------------------------------------------------------------------ answer shapes */
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const hasKeys = (o, keys) => isObject(o) && Object.keys(o).length === keys.length && keys.every((k) => Object.hasOwn(o, k))
const stamp = (v) => v === null || (typeof v === 'string' && v.length <= 40 && STAMP.test(v))
const text = (v) => typeof v === 'string' && v.length <= MAX_TEXT
const textOrNull = (v) => v === null || text(v)
const bytes = (v) => Number.isSafeInteger(v) && v >= 0

const TOKEN_KEYS = ['id', 'label', 'created_at', 'last_used_at', 'revoked_at']
const RUN_KEYS = ['run_id', 'source', 'bytes', 'truncated', 'machine', 'captured_at', 'uploaded_at']
const DETAIL_KEYS = [...RUN_KEYS, 'user_id', 'summary', 'ledger', 'patch']

const tokenRow = (t) => hasKeys(t, TOKEN_KEYS) && UUID.test(t.id) && text(t.label)
  && stamp(t.created_at) && stamp(t.last_used_at) && stamp(t.revoked_at)
const runFields = (r) => typeof r.run_id === 'string' && RUN_ID.test(r.run_id) && typeof r.source === 'string' && SOURCE.test(r.source)
  && bytes(r.bytes) && typeof r.truncated === 'boolean' && textOrNull(r.machine) && stamp(r.captured_at) && stamp(r.uploaded_at)
const runRow = (r) => hasKeys(r, RUN_KEYS) && runFields(r)
const detail = (r, id) => hasKeys(r, DETAIL_KEYS) && runFields(r) && r.run_id === id && typeof r.user_id === 'string' && UUID.test(r.user_id)
  && (r.summary === null || isObject(r.summary)) && (r.ledger === null || Array.isArray(r.ledger)) && (r.patch === null || typeof r.patch === 'string')
const page = (d, key, row) => hasKeys(d, [key, 'next_cursor', 'has_more']) && Array.isArray(d[key]) && d[key].length <= PAGE[key]
  && d[key].every(row) && typeof d.has_more === 'boolean' && (d.next_cursor === null || (typeof d.next_cursor === 'string' && CURSOR.test(d.next_cursor)))
  && d.has_more === (d.next_cursor !== null)

const SHAPES = {
  tokensList: (d) => page(d, 'tokens', tokenRow),
  runsList: (d) => page(d, 'runs', runRow),
  tokenRevoke: (d, id) => hasKeys(d, ['revoked']) && d.revoked === id,
  runGet: (d, id) => hasKeys(d, ['run']) && detail(d.run, id),
  runDelete: (d, id) => hasKeys(d, ['deleted']) && d.deleted === id,
}

/* ------------------------------------------------------------------ the request */
/** One of the five routes; resolves with the checked answer or rejects with a CaptureError. */
export async function captureRequest(method, path, { signal } = {}) {
  if (MODE !== 'member' || !MEMBER_SCOPE) throw refused(why('capture.computers', 'Managing capture computers') || 'Managing capture computers is not available here.')
  const route = captureRoute(method, path)
  if (!route) throw refused('This console does not send that capture request.')
  if (signal?.aborted) throw new CaptureError('The request was cancelled.', { code: 'aborted' })
  const controller = new AbortController()
  let stop
  const stopped = new Promise((_, reject) => { stop = reject })
  stopped.catch(() => {})
  const end = (message, code) => { controller.abort(); stop(new CaptureError(message, { code })) }
  const onAbort = () => end('The request was cancelled.', 'aborted')
  const timer = setTimeout(() => end('traceharness.dev did not answer in time. Try again.', 'timeout'), CAPTURE_TIMEOUT_MS)
  signal?.addEventListener('abort', onAbort, { once: true })
  const work = async () => {
    let response
    try {
      response = await fetch(route.url, {
        method: route.method,
        headers: { accept: 'application/json', 'x-traceharness-member-scope': MEMBER_SCOPE },
        credentials: 'same-origin', mode: 'same-origin', redirect: 'error', cache: 'no-store',
        signal: controller.signal,
      })
    } catch {
      throw new CaptureError('Could not reach traceharness.dev. Try again.', { code: 'network' })
    }
    let data
    try { data = await response.json() } catch { data = undefined }
    if (!response.ok || response.status !== 200) {
      const said = isObject(data) && typeof data.error === 'string' && data.error.trim() ? data.error.slice(0, MAX_ERROR) : `traceharness.dev answered ${response.status}.`
      throw new CaptureError(said, { status: response.status, code: 'http' })
    }
    if (!SHAPES[route.kind](data, route.id)) throw new CaptureError('traceharness.dev sent an answer this console does not accept. Nothing was shown from it.', { status: 200, code: 'shape' })
    return data
  }
  try {
    return await Promise.race([stopped, work()])
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
}

/* ------------------------------------------------------------------ the five calls */
const withCursor = (base, cursor) => (cursor ? `${base}?cursor=${cursor}` : base)
export const listTokens = (cursor, opts) => captureRequest('GET', withCursor('/capture/tokens', cursor), opts)
export const revokeToken = (id, opts) => captureRequest('DELETE', `/capture/tokens/${id}`, opts)
export const listRuns = (cursor, opts) => captureRequest('GET', withCursor('/capture/runs', cursor), opts)
export const getRun = (id, opts) => captureRequest('GET', `/capture/runs/${id}`, opts)
export const deleteRun = (id, opts) => captureRequest('DELETE', `/capture/runs/${id}`, opts)
