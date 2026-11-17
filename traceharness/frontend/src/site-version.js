/* The site's version stamp (SPEC 4.3), for a member's About this console: one GET of
   traceharness.dev/api/version, checked field by field. Only the listed fields pass, each with a
   strict pattern (a version, a hex digest, a fixed word, a dataset name); anything else, or any
   failure (the route is not deployed, a refusal, a redirect, a body that is not the schema), is
   null: "site version not reported". Member mode only: no request is made anywhere else. */
import { MODE } from './environment.js'

const HEX64 = /^[0-9a-f]{64}$/
const VERSION = /^\d+\.\d+\.\d+$/
const SNAPSHOT_VERSION = /^(?:\d+\.\d+\.\d+|rollback)$/
const COMMIT = /^(?:[0-9a-f]{40}|rollback)$/
const PUBLISHED = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\+00:00|Z)$/
const RESULT = /^[A-Za-z0-9_.-]{1,64}$/
const MAX_RESULTS = 32
const TIMEOUT_MS = 8000

const KEYS = ['schema', 'component', 'shared_sources_sha256', 'shared_sources_package_version', 'compiler_oracle_sha256', 'app_snapshot', 'runner']
const SNAPSHOT_KEYS = ['package_version', 'commit', 'published_at', 'results', 'sha256_html']

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const exactly = (o, keys) => isObject(o) && Object.keys(o).length === keys.length && keys.every((k) => Object.hasOwn(o, k))
const matches = (pattern, v) => typeof v === 'string' && pattern.test(v)

function snapshotOf(s) {
  if (s === null) return null
  if (!exactly(s, SNAPSHOT_KEYS)) return undefined
  if (!matches(SNAPSHOT_VERSION, s.package_version) || !matches(COMMIT, s.commit) || !matches(PUBLISHED, s.published_at) || !matches(HEX64, s.sha256_html)) return undefined
  if (!Array.isArray(s.results) || s.results.length > MAX_RESULTS || !s.results.every((r) => matches(RESULT, r))) return undefined
  return { package_version: s.package_version, commit: s.commit, published_at: s.published_at, results: [...s.results], sha256_html: s.sha256_html }
}

/** A checked copy of a site stamp, or null when any field is missing, extra or malformed. */
export function siteVersionOf(d) {
  if (!exactly(d, KEYS) || d.schema !== 1 || d.component !== 'site' || d.runner !== null) return null
  if (!matches(HEX64, d.shared_sources_sha256) || !matches(HEX64, d.compiler_oracle_sha256) || !matches(VERSION, d.shared_sources_package_version)) return null
  const snapshot = snapshotOf(d.app_snapshot)
  if (snapshot === undefined) return null
  return {
    schema: 1, component: 'site', shared_sources_sha256: d.shared_sources_sha256, shared_sources_package_version: d.shared_sources_package_version,
    compiler_oracle_sha256: d.compiler_oracle_sha256, app_snapshot: snapshot, runner: null,
  }
}

/** The site's stamp, or null. One same-origin, uncached request that refuses redirects. */
export async function fetchSiteVersion() {
  if (MODE !== 'member' || typeof fetch !== 'function') return null
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const response = await fetch('/api/version', { credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: controller.signal })
    if (!response || !response.ok || response.status !== 200) return null
    return siteVersionOf(await response.json())
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}
