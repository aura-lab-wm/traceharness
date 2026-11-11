// Inspection preserves all recorded fields. It never fills today's defaults,
// mutates a configuration, or changes what the runner executes.
const secretFields = new Set(['key', 'token', 'apikey', 'openrouterkey', 'openrouterapikey', 'password', 'passwd', 'authorization', 'accesstoken', 'refreshtoken', 'sessioncookie', 'clientsecret', 'servicerolekey', 'privatekey', 'credentialid', 'secret'])

export function prepareHarnessJSON(value) {
  if (value == null) return { json: null, redactions: 0 }
  let redactions = 0
  const seen = new Set()
  const scrub = (text) => text.replace(/\bsk-(?:or-v\d+-)?[A-Za-z0-9_-]{16,}\b|\beyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\b|\bBearer\s+[A-Za-z0-9._~+/-]{8,}=*/gi, () => { redactions++; return '[REDACTED]' })
  function encode(item, depth = 0) {
    if (depth > 80) throw new Error('This JSON is too deeply nested to inspect safely.')
    if (item === null) return 'null'
    if (typeof item === 'string') return JSON.stringify(scrub(item))
    if (typeof item === 'boolean') return String(item)
    if (typeof item === 'number' && Number.isFinite(item)) return Object.is(item, -0) ? '-0.0' : String(item)
    if (!item || typeof item !== 'object' || seen.has(item)) throw new Error('This configuration contains values that cannot be represented as JSON. Correct them before copying or downloading.')
    seen.add(item)
    const pad = '  '.repeat(depth), inner = pad + '  '
    let output
    if (Array.isArray(item)) {
      output = item.length ? '[\n' + item.map((child) => inner + encode(child, depth + 1)).join(',\n') + '\n' + pad + ']' : '[]'
    } else {
      const keys = Object.keys(item).filter((key) => item[key] !== undefined)
      output = keys.length ? '{\n' + keys.map((key) => {
        let child = item[key]
        if (secretFields.has(key.toLowerCase().replace(/[^a-z0-9]/g, '')) && child != null) { child = '[REDACTED]'; redactions++ }
        return inner + JSON.stringify(key) + ': ' + encode(child, depth + 1)
      }).join(',\n') + '\n' + pad + '}' : '{}'
    }
    seen.delete(item)
    return output
  }
  return { json: encode(value) + '\n', redactions }
}

export function recordedHarnessSnapshot(run, detail) {
  if (!detail) return { config: null, source: 'Recorded ledger', hash: null }
  const start = detail.spans?.find((span) => span?.span === 'invoke_agent' && span.status === 'start')
  if (detail.summary?.run_id && detail.summary.run_id !== run.id || start?.run_id && start.run_id !== run.id) {
    return { config: null, source: 'Recording identity mismatch', hash: null }
  }
  const config = start?.harness && typeof start.harness === 'object' && !Array.isArray(start.harness) ? start.harness : null
  const rawProvider = run.raw?.provider || detail.summary?.provider
  const provider = typeof rawProvider === 'string' ? rawProvider : ''
  const imported = provider.startsWith('import:') || ['imported', 'nebius', 'nebius/SWE-agent-trajectories', 'SWE-bench/experiments'].includes(provider) || !!start?.import_source
  return { config, hash: start?.harness_hash || run.raw?.harness_hash || null,
    source: config === null ? 'Source not recorded' : provider.startsWith('capture:') ? 'Captured session' : imported ? 'Importer reconstruction' : 'Recorded ledger' }
}
