// Audit of a native prompt profile before runner review. It PREDICTS what the deployed
// service refuses and names what run evidence will not be able to show. It never marks
// a profile as verified: runner review stays authoritative.
//
// A rule with `contract: true` mirrors a deployed check:
//   native_prompts.py canonical_profile, native_prompts_codex.py canonical_profile,
//   execution.py _redacted (through configuration.py preflight), configuration.py
//   has_secret, and the gateway's noSecrets (auth/worker/src/runner.js).
// Every other rule is advice and must never block an edit.
//
// The Python mirror is runner_service/native_prompt_tools.py; test/native-golden/audit.json
// holds both to one answer, and tests_agentlab/test_native_prompt_tools.py holds the
// contract rules to the deployed functions themselves.
import { PROFILE_PINS } from '../../native-prompts-contract'
import { manifestBytesEstimate, pairedPlanBytesEstimate } from './budget'
import { LIMITS, PLACEHOLDER_PATTERN, placeholderSequence, profileBytes, sha256HexSync } from './profile-model'
import { codePoints, utf8Bytes } from './text-metrics'

const rule = (id, severity, contract, scope, title) => Object.freeze({ id, severity, contract, scope, title })

/** Every rule the audit can report. A near-limit finding reuses its rule id as a warning. */
export const AUDIT_RULES = Object.freeze([
  rule('profile.invalid-shape', 'error', true, 'profile', 'The profile is not a schema-1 native prompt profile'),
  rule('pins.mismatch', 'error', true, 'profile', 'Profile pins differ from the inventory'),
  rule('override.unknown-block', 'error', true, 'block', 'Override targets a block that is not in the inventory'),
  rule('override.duplicate', 'error', true, 'block', 'Two overrides target one block'),
  rule('override.baseline-changed', 'error', true, 'block', 'Override was written for a different baseline text'),
  rule('override.not-patchable', 'error', true, 'block', 'Override changes a block that cannot be edited'),
  rule('override.digest-mismatch', 'error', true, 'block', 'Replacement text does not match its SHA-256 digest'),
  rule('replacement.empty', 'error', true, 'block', 'Replacement is empty'),
  rule('replacement.invalid-unicode', 'error', true, 'block', 'Replacement has a NUL or an unpaired surrogate'),
  rule('replacement.too-large', 'error', true, 'block', 'Replacement exceeds 250,000 UTF-8 bytes'),
  rule('placeholder.sequence', 'error', true, 'block', 'Placeholders differ in order or number'),
  rule('placeholder.stray', 'error', true, 'block', 'Malformed native placeholder'),
  rule('codex.over-capacity', 'error', true, 'block', 'Codex replacement is longer than the native span'),
  rule('profile.too-many-overrides', 'error', true, 'profile', 'More than 4,096 overrides'),
  rule('profile.too-large', 'error', true, 'profile', 'Canonical profile exceeds 768 KiB'),
  rule('leak.runner-redaction', 'error', true, 'block', 'Text the runner treats as a credential'),
  rule('leak.gateway-credential', 'error', true, 'block', 'Text the gateway treats as a provider key'),
  rule('leak.credential-shape', 'warning', false, 'block', 'Text shaped like a credential'),
  rule('leak.local-path', 'warning', false, 'block', 'Home-directory path'),
  rule('leak.email', 'warning', false, 'block', 'E-mail address'),
  rule('escape.poisoning', 'warning', false, 'block', 'Literal escape sequences'),
  rule('unicode.invisible', 'warning', false, 'block', 'Invisible or control characters'),
  rule('replacement.whitespace-only', 'warning', false, 'block', 'Replacement is only whitespace'),
  rule('manifest.size-estimate', 'warning', false, 'profile', 'Estimated manifest exceeds 1 MiB'),
  rule('plan.size-estimate', 'warning', false, 'plan', 'Estimated two-arm plan exceeds 768 KiB'),
  rule('replacement.noop', 'info', false, 'block', 'Replacement equals the baseline'),
  rule('observer.templated', 'info', false, 'block', 'Templated fragment: no literal-match evidence'),
  rule('observer.short-literal', 'info', false, 'block', 'Short literal: no literal-match evidence'),
  rule('class.security-disabled', 'info', false, 'profile', 'Fragments labelled Security & Safety are changed'),
])

const RULES = new Map(AUDIT_RULES.map((entry) => [entry.id, entry]))
const SEVERITY_RANK = { error: 0, warning: 1, info: 2 }
const PROFILE_KEYS = ['schema_version', ...PROFILE_PINS, 'default_action', 'overrides']
const NUL = String.fromCharCode(0)
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const exactKeys = (value, keys) => Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key))

function finding(id, blockId, message, data = {}, severity = null) {
  const entry = RULES.get(id)
  return { rule: id, severity: severity || entry.severity, contract: severity ? false : entry.contract, scope: entry.scope, block_id: blockId, message, data }
}

// --- credential shapes the deployed services refuse -------------------------------------------------
// execution.py _redacted runs three substitutions over the manifest artifact, which is JSON
// text. Python's \b, \w and \s are Unicode-aware there; these patterns spell that out.
const WORD = '[\\p{L}\\p{N}_]'
const EDGE = `(?:(?<=${WORD})(?!${WORD})|(?<!${WORD})(?=${WORD}))`
const PY_SPACE = '[ \\u0085\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000]'
const RUNNER_SK = new RegExp(`${EDGE}sk-(?:or-)?[A-Za-z0-9_-]{10,}${EDGE}`, 'gu')
const RUNNER_JWT = /(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{8,2048}\.[A-Za-z0-9_-]{3,8192}\.[A-Za-z0-9_-]{22,1366}(?![A-Za-z0-9_-])/g
// Python's (?i) also folds U+0130, U+0131, U+017F and U+212A onto [A-Za-z] in the token class (a
// sweep of every code point finds exactly these four); no character folds onto the letters of "Bearer".
const RUNNER_BEARER = new RegExp(`${EDGE}[Bb][Ee][Aa][Rr][Ee][Rr]${PY_SPACE}+[A-Za-z0-9._~+/=\\u0130\\u0131\\u017f\\u212a-]{8,}`, 'gu')
const BEARER_PREFIX = new RegExp(`^[A-Za-z]{6}${PY_SPACE}+`, 'u')
// Gateway noSecrets (JavaScript \b, on the raw string) and runner has_secret (Python \d).
const GATEWAY_SK = /\bsk-(?:or-)?[A-Za-z0-9_-]{10,}\b/g
const RUNNER_PROVIDER_KEY = /sk-or-v\p{Nd}+-[A-Za-z0-9_-]{16,}/gu
const BASE64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'

function base64UrlBytes(part) {
  if (part.length % 4 === 1) return null
  const out = new Uint8Array(Math.floor(part.length * 3 / 4))
  let pending = 0, bits = 0, at = 0
  for (let index = 0; index < part.length; index++) {
    const value = BASE64URL.indexOf(part[index])
    if (value < 0) return null
    pending = (pending << 6 | value) & 0xffff
    bits += 6
    if (bits >= 8) { bits -= 8; out[at++] = pending >> bits & 255 }
  }
  return pending & (1 << bits) - 1 ? null : out
}

/** execution.py jwt_candidate: structure only, never authenticity. */
function looksLikeJwt(candidate) {
  try {
    const parts = candidate.split('.').map(base64UrlBytes)
    if (parts.length !== 3 || parts.some((part) => part === null)) return false
    const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })
    const [header, payload] = parts.slice(0, 2).map((part) => JSON.parse(decoder.decode(part)))
    return isObject(header) && isObject(payload) && Object.hasOwn(header, 'alg') && typeof header.alg === 'string'
      && codePoints(header.alg) >= 1 && codePoints(header.alg) <= 128 && parts[2].length >= 16 && parts[2].length <= 1024
  } catch { return false }
}

const masked = (span, keep = 6) => {
  const points = [...span]
  return points.length <= keep + 2 ? span : points.slice(0, keep).join('') + '…'
}

/**
 * Spans of `text` that make the runner refuse a manifest: `execution._redacted` would
 * change them. `text` is checked as it is written into the manifest (as a JSON string).
 * @returns {{ pattern: 'sk-token'|'jwt'|'bearer', match: string, count: number }[]}
 */
export function runnerRedactionMatches(text) {
  const escaped = JSON.stringify(text)
  const out = []
  const record = (pattern, spans, shown) => { if (spans.length) out.push({ pattern, match: shown(spans[0]), count: spans.length }) }
  record('sk-token', escaped.match(RUNNER_SK) || [], (span) => masked(span))
  record('jwt', (escaped.match(RUNNER_JWT) || []).filter(looksLikeJwt), (span) => masked(span))
  record('bearer', escaped.match(RUNNER_BEARER) || [], (span) => {
    const token = span.replace(BEARER_PREFIX, '')
    return token.length > 16 ? span.slice(0, span.length - token.length) + masked(token) : span
  })
  return out
}

/** Spans the gateway (any "sk-" key shape) or the runner (provider key) refuses outright. */
export function gatewayCredentialMatches(text) {
  const out = []
  const gateway = text.match(GATEWAY_SK) || [], provider = text.match(RUNNER_PROVIDER_KEY) || []
  if (gateway.length) out.push({ pattern: 'gateway-sk-token', match: masked(gateway[0]), count: gateway.length })
  if (provider.length) out.push({ pattern: 'runner-provider-key', match: masked(provider[0]), count: provider.length })
  return out
}

// --- advice patterns: ASCII classes only, bounded quantifiers, linear on long inputs ---------------
const CREDENTIAL_SHAPES = [
  ['github-token', /(?<![A-Za-z0-9_])gh[pousr]_[A-Za-z0-9]{36,255}/g],
  ['github-fine-grained-token', /(?<![A-Za-z0-9_])github_pat_[A-Za-z0-9_]{22,255}/g],
  ['aws-access-key-id', /(?<![A-Z0-9])AKIA[0-9A-Z]{16}(?![A-Z0-9])/g],
  ['slack-token', /(?<![A-Za-z0-9_])xox[abprs]-[A-Za-z0-9-]{10,255}/g],
  ['private-key', /-----BEGIN [A-Z ]{0,40}PRIVATE KEY-----/g],
]
const LOCAL_PATH = /\/(?:Users|home)\/[A-Za-z0-9._-]{1,64}\/|[A-Za-z]:\\Users\\[A-Za-z0-9._ -]{1,64}\\/g
const EMAIL = /(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]{1,64}@(?:[A-Za-z0-9-]{1,63}\.){1,8}[A-Za-z]{2,24}(?![A-Za-z0-9-])/g
const ESCAPES = /\\u[0-9a-fA-F]{4}|\\\\|\\n/g
// Control characters are what this rule looks for.
// eslint-disable-next-line no-control-regex
const INVISIBLE = /[\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f­؜᠎​-‏‪-‮⁠-⁤⁦-⁩﻿]/g
const ONLY_ASCII_SPACE = /^[ \t\n\r\f\v]+$/
const firstNew = (text, baseline, pattern) => [...new Set(text.match(pattern) || [])].filter((span) => !baseline.includes(span))
const codePointName = (character) => 'U+' + character.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')

/**
 * Findings for one replacement text, for live typing. Block rules only.
 * Order: severity (error, warning, info), then rule id.
 */
export function auditReplacement(block, text, runtimeId) {
  const out = []
  const add = (id, message, data, severity) => out.push(finding(id, block.id, message, data, severity))
  const baseline = block.baseline_utf8
  if (typeof text !== 'string' || /\p{Cs}/u.test(text) || text.includes(NUL)) {
    add('replacement.invalid-unicode', 'The replacement contains a NUL character or an unpaired surrogate. The runner accepts valid Unicode text only.')
    return out
  }
  if (!text.length) {
    add('replacement.empty', 'An empty replacement is refused. Use Disable to withhold this fragment.')
    return out
  }
  const bytes = utf8Bytes(text)
  if (bytes > LIMITS.replacement_bytes) add('replacement.too-large', `The replacement is ${bytes} UTF-8 bytes; the limit is ${LIMITS.replacement_bytes}.`, { bytes, max: LIMITS.replacement_bytes })
  const expected = block.required_placeholders, actual = placeholderSequence(text)
  if (actual.length !== expected.length || actual.some((token, index) => token !== expected[index])) {
    add('placeholder.sequence', `Keep the ${expected.length} native placeholder${expected.length === 1 ? '' : 's'} of this fragment exactly once each, in the original order. Found ${actual.length}.`, { expected: expected.length, found: actual.length })
  }
  if (text.replace(PLACEHOLDER_PATTERN, '').includes('${TH_PROMPT_EXPR')) add('placeholder.stray', 'The text "${TH_PROMPT_EXPR" appears outside a complete native placeholder.')
  if (runtimeId === 'native-codex') {
    const capacity = utf8Bytes(baseline)
    if (bytes > capacity) add('codex.over-capacity', `The replacement is ${bytes} UTF-8 bytes; this Codex fragment holds ${capacity}.`, { bytes, capacity })
  }
  const redactions = runnerRedactionMatches(text)
  for (const hit of redactions) {
    const kind = { 'sk-token': 'an "sk-" key', jwt: 'a JSON Web Token', bearer: 'a Bearer credential' }[hit.pattern]
    add('leak.runner-redaction', `The runner treats "${hit.match}" as ${kind} and refuses the run. Reword it; the check reads the shape, not the meaning.`, { pattern: hit.pattern, match: hit.match, count: hit.count })
  }
  if (!redactions.some((hit) => hit.pattern === 'sk-token')) {
    for (const hit of gatewayCredentialMatches(text)) {
      add('leak.gateway-credential', `"${hit.match}" has the shape of a provider key. The hosted service refuses the request.`, { pattern: hit.pattern, match: hit.match, count: hit.count })
    }
  }
  for (const [name, pattern] of CREDENTIAL_SHAPES) {
    const spans = firstNew(text, baseline, pattern)
    if (spans.length) add('leak.credential-shape', `"${masked(spans[0])}" has the shape of a credential (${name}) and is not in the baseline text.`, { pattern: name, match: masked(spans[0]), count: spans.length })
  }
  const paths = firstNew(text, baseline, LOCAL_PATH)
  if (paths.length) add('leak.local-path', `"${paths[0]}" is a home-directory path that is not in the baseline text. It will be stored with the run.`, { match: paths[0], count: paths.length })
  const emails = firstNew(text, baseline, EMAIL)
  if (emails.length) add('leak.email', `"${emails[0]}" is an e-mail address that is not in the baseline text. It will be stored with the run.`, { match: emails[0], count: emails.length })
  const escapes = (text.match(ESCAPES) || []).length, baselineEscapes = (baseline.match(ESCAPES) || []).length
  if (escapes > baselineEscapes) {
    add('escape.poisoning', `${escapes > 10 ? 'Excessive literal escaping' : 'Literal escape sequences'}: ${escapes} written out (such as \\n or \\u2014 typed as characters); the baseline has ${baselineEscapes}. The runtime would show them as typed.`,
      { count: escapes, baseline_count: baselineEscapes, excessive: escapes > 10 })
  }
  const invisible = firstNew(text, baseline, INVISIBLE)
  if (invisible.length) {
    const names = invisible.map(codePointName).sort()
    add('unicode.invisible', `Invisible or control characters that are not in the baseline text: ${names.slice(0, 8).join(', ')}${names.length > 8 ? ', …' : ''}.`, { count: names.length, code_points: names.slice(0, 8).join(', ') })
  }
  if (ONLY_ASCII_SPACE.test(text)) add('replacement.whitespace-only', 'The replacement is only whitespace. Use Disable so that the record says the fragment was withheld.')
  if (text === baseline) add('replacement.noop', 'The replacement equals the baseline. As a deliberate no-op control it still counts as a rewrite target.')
  if (expected.length) add('observer.templated', 'This fragment has native placeholders. The run observer skips templated fragments, so this change will have no literal-match evidence.')
  else if (bytes < LIMITS.observer_min_bytes || utf8Bytes(baseline) < LIMITS.observer_min_bytes) {
    add('observer.short-literal', `The run observer does not match literals under ${LIMITS.observer_min_bytes} bytes, so this change will have incomplete literal-match evidence.`, { bytes, baseline_bytes: utf8Bytes(baseline) })
  }
  return sorted(out, new Map())
}

function sorted(findings, order) {
  return findings.map((entry, index) => ({ entry, index })).sort((left, right) =>
    SEVERITY_RANK[left.entry.severity] - SEVERITY_RANK[right.entry.severity]
    || (order.get(left.entry.block_id) ?? -1) - (order.get(right.entry.block_id) ?? -1)
    || (left.entry.rule < right.entry.rule ? -1 : left.entry.rule > right.entry.rule ? 1 : 0)
    || left.index - right.index).map((item) => item.entry)
}

function shapeIssue(profile) {
  if (!isObject(profile) || !exactKeys(profile, PROFILE_KEYS)) return 'Invalid native prompt profile fields'
  if (profile.schema_version !== 1) return 'Unsupported native prompt profile schema'
  if (profile.default_action !== 'keep' && profile.default_action !== 'disable') return 'Invalid default native prompt action'
  if (!Array.isArray(profile.overrides)) return 'Too many native prompt overrides'
  for (const row of profile.overrides) {
    if (!isObject(row)) return 'Invalid native prompt override'
    const fields = row.action === 'replace' ? ['block_id', 'baseline_sha256', 'action', 'replacement_utf8', 'replacement_sha256'] : ['block_id', 'baseline_sha256', 'action']
    if (!exactKeys(row, fields) || !['keep', 'disable', 'replace'].includes(row.action)) return 'Invalid native prompt override fields'
    if (typeof row.block_id !== 'string') return 'Unknown or duplicate native prompt override'
  }
  return ''
}

/**
 * Audit a whole profile against its inventory.
 * `context.prompt` is the run's additional instructions: it shares the manifest with the
 * profile, so it is checked for runner-refused shapes and counted in the size estimates.
 * Order of findings: severity (error, warning, info), inventory order of the block
 * (profile and plan findings first), then rule id.
 * @returns {{ ok: boolean, counts: { error: number, warning: number, info: number }, findings: object[] }}
 */
export function auditProfile(profile, inventory, context = {}) {
  const out = []
  const order = new Map(inventory.blocks.map((block, index) => [block.id, index]))
  const done = () => {
    const findings = sorted(out, order)
    const counts = { error: 0, warning: 0, info: 0 }
    for (const entry of findings) counts[entry.severity]++
    return { ok: counts.error === 0, counts, findings }
  }
  const shape = shapeIssue(profile)
  if (shape) {
    out.push(finding('profile.invalid-shape', null, `${shape}. The runner refuses a profile that is not an exact schema-1 object.`, { reason: shape }))
    return done()
  }
  const mismatched = PROFILE_PINS.filter((key) => profile[key] !== inventory[key])
  if (mismatched.length) {
    out.push(finding('pins.mismatch', null, `This profile belongs to a different runtime or inventory revision (${mismatched[0]} differs). The runner refuses it; rebase it onto this inventory or start a new profile.`,
      { pin: mismatched[0], mismatched: mismatched.length }))
    return done()
  }
  const blocks = new Map(inventory.blocks.map((block) => [block.id, block]))
  const overrides = new Map()
  for (const row of profile.overrides) {
    const block = blocks.get(row.block_id)
    if (!block) { out.push(finding('override.unknown-block', row.block_id, `No block "${masked(row.block_id, 60)}" exists in this inventory.`)); continue }
    if (overrides.has(row.block_id)) { out.push(finding('override.duplicate', row.block_id, 'This block has more than one override. The runner accepts one per block.')); continue }
    overrides.set(row.block_id, row)
    if (row.baseline_sha256 !== block.baseline_sha256) { out.push(finding('override.baseline-changed', row.block_id, 'This override was written for a different baseline text of the block.')); continue }
    if (row.action !== 'keep' && block.capability !== 'patchable') { out.push(finding('override.not-patchable', row.block_id, `This block is ${block.capability}: it can be kept, not disabled or replaced.`, { capability: block.capability })); continue }
    if (row.action === 'replace') {
      const found = auditReplacement(block, row.replacement_utf8, inventory.runtime_id)
      out.push(...found)
      if (typeof row.replacement_utf8 === 'string' && !found.some((entry) => entry.rule === 'replacement.invalid-unicode') && sha256HexSync(row.replacement_utf8) !== row.replacement_sha256) {
        out.push(finding('override.digest-mismatch', row.block_id, 'The replacement text does not match its recorded SHA-256 digest. The text or the digest was changed after the edit.'))
      }
    } else if (row.action === 'disable') {
      if (block.required_placeholders.length) out.push(finding('observer.templated', block.id, 'This fragment has native placeholders. The run observer skips templated fragments, so disabling it will have no literal-match evidence.'))
      else if (utf8Bytes(block.baseline_utf8) < LIMITS.observer_min_bytes) {
        out.push(finding('observer.short-literal', block.id, `The run observer does not match literals under ${LIMITS.observer_min_bytes} bytes, so disabling this fragment will have no literal-match evidence.`, { bytes: 0, baseline_bytes: utf8Bytes(block.baseline_utf8) }))
      }
    }
  }
  let security = 0
  for (const block of inventory.blocks) {
    if (block.capability !== 'patchable') continue
    const row = overrides.get(block.id)
    const action = row?.action || profile.default_action
    if (action !== 'keep' && block.class_name === 'Security & Safety') security++
    if (!row && action === 'disable') {
      if (block.required_placeholders.length) out.push(finding('observer.templated', block.id, 'This fragment has native placeholders. The run observer skips templated fragments, so disabling it will have no literal-match evidence.'))
      else if (utf8Bytes(block.baseline_utf8) < LIMITS.observer_min_bytes) {
        out.push(finding('observer.short-literal', block.id, `The run observer does not match literals under ${LIMITS.observer_min_bytes} bytes, so disabling this fragment will have no literal-match evidence.`, { bytes: 0, baseline_bytes: utf8Bytes(block.baseline_utf8) }))
      }
    }
  }
  const count = profile.overrides.length
  if (count > LIMITS.overrides) out.push(finding('profile.too-many-overrides', null, `The profile has ${count} overrides; the runner accepts at most ${LIMITS.overrides}.`, { used: count, max: LIMITS.overrides, state: 'over' }))
  else if (count * 5 >= LIMITS.overrides * 4) out.push(finding('profile.too-many-overrides', null, `The profile has ${count} of ${LIMITS.overrides} overrides.`, { used: count, max: LIMITS.overrides, state: 'near' }, 'warning'))
  const size = profileBytes(profile)
  if (size > LIMITS.profile_bytes) out.push(finding('profile.too-large', null, `The canonical profile is ${size} bytes; the runner accepts at most ${LIMITS.profile_bytes} (768 KiB).`, { used: size, max: LIMITS.profile_bytes, state: 'over' }))
  else if (size * 5 >= LIMITS.profile_bytes * 4) out.push(finding('profile.too-large', null, `The canonical profile is ${size} of ${LIMITS.profile_bytes} bytes (768 KiB).`, { used: size, max: LIMITS.profile_bytes, state: 'near' }, 'warning'))
  const prompt = typeof context.prompt === 'string' ? context.prompt : ''
  if (prompt) {
    const redactions = runnerRedactionMatches(prompt)
    for (const hit of redactions) {
      out.push({ ...finding('leak.runner-redaction', null, `The additional instructions contain "${hit.match}", which the runner treats as a credential. It refuses the run.`, { pattern: hit.pattern, match: hit.match, count: hit.count, field: 'prompt' }), scope: 'profile' })
    }
    if (!redactions.some((hit) => hit.pattern === 'sk-token')) {
      for (const hit of gatewayCredentialMatches(prompt)) {
        out.push({ ...finding('leak.gateway-credential', null, `The additional instructions contain "${hit.match}", which has the shape of a provider key. The hosted service refuses the request.`, { pattern: hit.pattern, match: hit.match, count: hit.count, field: 'prompt' }), scope: 'profile' })
      }
    }
  }
  const manifest = manifestBytesEstimate(size, prompt), plan = pairedPlanBytesEstimate(size, prompt)
  if (manifest > LIMITS.manifest_bytes) out.push(finding('manifest.size-estimate', null, `Estimate: the run manifest would be about ${manifest} bytes; the runner retains at most ${LIMITS.manifest_bytes} (1 MiB).`, { used: manifest, max: LIMITS.manifest_bytes, estimate: true }))
  if (plan > LIMITS.plan_bytes) out.push(finding('plan.size-estimate', null, `Estimate: a two-arm plan with this profile would freeze at about ${plan} bytes; the runner retains at most ${LIMITS.plan_bytes} (768 KiB).`, { used: plan, max: LIMITS.plan_bytes, estimate: true }))
  if (security) out.push(finding('class.security-disabled', null, `${security} fragment${security === 1 ? '' : 's'} labelled Security & Safety ${security === 1 ? 'is' : 'are'} disabled or replaced. The label is a keyword heuristic over block names; runner isolation is unchanged.`, { count: security }))
  return done()
}
