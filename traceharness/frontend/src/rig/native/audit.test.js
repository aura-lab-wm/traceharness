import { describe, expect, it } from 'vitest'
import { baselineProfile } from '../../native-prompts-contract'
import { codexInventoryFixture, nativeInventoryFixture, testDigest } from '../../../test/native-prompts-fixture'
import { AUDIT_RULES, auditProfile, auditReplacement, gatewayCredentialMatches, runnerRedactionMatches } from './audit'
import { canonicalProfile } from './profile-model'

const inventory = nativeInventoryFixture()
const block = (id, source = inventory) => source.blocks.find((entry) => entry.id === id)
const row = (id, action, text, source = inventory) => ({ block_id: id, baseline_sha256: block(id, source).baseline_sha256, action,
  ...(action === 'replace' ? { replacement_utf8: text, replacement_sha256: testDigest(text) } : {}) })
const profile = (overrides = [], defaultAction = 'keep', source = inventory) => ({ ...baselineProfile(source), default_action: defaultAction, overrides })
const rules = (findings) => findings.map((entry) => entry.rule)
const base64url = (text) => Buffer.from(text).toString('base64url')
const jwt = `${base64url('{"alg":"HS256","typ":"JWT"}')}.${base64url('{"sub":"fixture"}')}.${base64url('0123456789abcdef-signature')}`
const long = 'A fabricated replacement that is comfortably longer than sixteen bytes.'

describe('audit rule table', () => {
  it('lists every rule once with a severity, a scope and whether it mirrors a deployed check', () => {
    expect(new Set(AUDIT_RULES.map((entry) => entry.id)).size).toBe(AUDIT_RULES.length)
    for (const entry of AUDIT_RULES) {
      expect(['error', 'warning', 'info']).toContain(entry.severity)
      expect(['block', 'profile', 'plan']).toContain(entry.scope)
      expect(entry.contract).toBe(entry.severity === 'error')
      expect(entry.title.length).toBeGreaterThan(8)
    }
    for (const id of ['pins.mismatch', 'override.unknown-block', 'override.baseline-changed', 'override.not-patchable', 'override.duplicate', 'replacement.empty',
      'replacement.invalid-unicode', 'replacement.too-large', 'placeholder.sequence', 'placeholder.stray', 'codex.over-capacity', 'profile.too-many-overrides', 'profile.too-large',
      'leak.runner-redaction', 'leak.credential-shape', 'leak.local-path', 'leak.email', 'escape.poisoning', 'unicode.invisible', 'replacement.whitespace-only', 'replacement.noop',
      'observer.templated', 'observer.short-literal', 'class.security-disabled', 'manifest.size-estimate', 'plan.size-estimate']) expect(AUDIT_RULES.some((entry) => entry.id === id)).toBe(true)
  })
})

describe('runner redaction mirror', () => {
  it('flags the letters Python folds onto [A-Za-z] in the Bearer token, as execution._redacted does (review M1)', () => {
    for (const text of ['Bearer \u017f\u017f\u017f\u017f\u017f\u017f\u017f\u017f', 'Bearer ' + '\u0130'.repeat(8), 'Bearer ' + '\u212a'.repeat(8), 'bearer ' + '\u0131'.repeat(8), 'BEARER\u3000' + '\u017f'.repeat(8)]) {
      expect(runnerRedactionMatches(text).map((row) => row.pattern)).toEqual(['bearer'])
    }
    for (const text of ['Bearer\u00a0' + '\u0131'.repeat(7), 'Bearer ' + '\ufb00'.repeat(8)]) expect(runnerRedactionMatches(text)).toEqual([])
    expect(runnerRedactionMatches('Bearer ' + '\u017f'.repeat(20))[0].match).toBe('Bearer ' + '\u017f'.repeat(6) + '…')
  })
  it('flags the three shapes execution._redacted changes and nothing else', () => {
    expect(runnerRedactionMatches('Use Bearer authentication for the sample endpoint.')).toEqual([{ pattern: 'bearer', match: 'Bearer authentication', count: 1 }])
    expect(runnerRedactionMatches('BEARER   abcdefgh')).toHaveLength(1)
    expect(runnerRedactionMatches('Bearer token')).toEqual([])
    expect(runnerRedactionMatches('Bearer\nauthentication')).toEqual([])
    expect(runnerRedactionMatches('aBearer authentication')).toEqual([])
    expect(runnerRedactionMatches('Bearer\u00a0authentication')).toHaveLength(1)
    expect(runnerRedactionMatches('requests.exceptions.JSONDecodeError')).toEqual([])
    expect(runnerRedactionMatches('module.submodule_name.function_with_a_long_name_here')).toEqual([])
    expect(runnerRedactionMatches('token ' + jwt)).toEqual([{ pattern: 'jwt', match: jwt.slice(0, 6) + '…', count: 1 }])
    expect(runnerRedactionMatches('key sk-abcdefghij')).toEqual([{ pattern: 'sk-token', match: 'sk-abc…', count: 1 }])
    expect(runnerRedactionMatches('sk-or-v1-0123456789abcdef and sk-0123456789')).toMatchObject([{ pattern: 'sk-token', count: 2 }])
    expect(runnerRedactionMatches('sk-short')).toEqual([])
    expect(runnerRedactionMatches('task-abcdefghijkl')).toEqual([])
  })

  it('follows the manifest text, where a line feed is two characters and Unicode letters are word characters', () => {
    // In the JSON artifact "\n" is a backslash and an n, so no word boundary precedes "sk-".
    expect(runnerRedactionMatches('line\nsk-abcdefghij')).toEqual([])
    expect(gatewayCredentialMatches('line\nsk-abcdefghij')).toEqual([{ pattern: 'gateway-sk-token', match: 'sk-abc…', count: 1 }])
    expect(runnerRedactionMatches('ésk-abcdefghij')).toEqual([])
    expect(gatewayCredentialMatches('ésk-abcdefghij')).toHaveLength(1)
    expect(runnerRedactionMatches('"sk-abcdefghij"')).toHaveLength(1)
    expect(gatewayCredentialMatches('xsk-or-v1-0123456789abcdef')).toEqual([{ pattern: 'runner-provider-key', match: 'sk-or-…', count: 1 }])
    expect(gatewayCredentialMatches('nothing here')).toEqual([])
  })

  it('stays linear on hostile 250,000-byte inputs', () => {
    const inputs = ['sk-' + '-'.repeat(250000), 'sk-'.repeat(80000), 'a'.repeat(250000), ('aaaaaaaa.aaa.' + 'a'.repeat(21) + ' ').repeat(5800), 'Bearer' + ' '.repeat(250000),
      'Bearer '.repeat(35000), 'x@'.repeat(125000), '/Users/'.repeat(35000), ('a'.repeat(64) + '@').repeat(3800), '\\u00'.repeat(60000), 'AKIA'.repeat(60000), '-----BEGIN ' + 'A '.repeat(120000)]
    const started = performance.now()
    for (const input of inputs) auditReplacement(block('first'), input, 'native-claude-code')
    expect(performance.now() - started).toBeLessThan(4000)
  })
})

describe('auditReplacement', () => {
  const audit = (text, id = 'first', runtime = 'native-claude-code', source = inventory) => auditReplacement(block(id, source), text, runtime)
  it('reports the contract errors the service refuses', () => {
    expect(rules(audit(''))).toEqual(['replacement.empty'])
    expect(rules(audit('a\u0000b'))).toEqual(['replacement.invalid-unicode'])
    expect(rules(audit('a\ud800'))).toEqual(['replacement.invalid-unicode'])
    expect(audit('é'.repeat(125001))[0]).toMatchObject({ rule: 'replacement.too-large', severity: 'error', contract: true, scope: 'block', block_id: 'first', data: { bytes: 250002, max: 250000 } })
    expect(rules(audit('é'.repeat(125000)))).toEqual([])
    expect(rules(audit('No placeholders at all, and long enough', 'third'))).toEqual(['placeholder.sequence', 'observer.templated'])
    expect(rules(audit('${TH_PROMPT_EXPR_1} then ${TH_PROMPT_EXPR_0}', 'third'))).toEqual(['placeholder.sequence', 'observer.templated'])
    expect(rules(audit('${TH_PROMPT_EXPR_0} ${TH_PROMPT_EXPR_1} ${TH_PROMPT_EXPR_x}', 'third'))).toEqual(['placeholder.stray', 'observer.templated'])
    expect(rules(audit('A ${TH_PROMPT_EXPR_0} b ${TH_PROMPT_EXPR_1} c', 'third'))).toEqual(['observer.templated'])
    const codex = codexInventoryFixture()
    const span = codex.blocks[0].baseline_utf8
    expect(auditReplacement(codex.blocks[0], span + ' more', 'native-codex')[0]).toMatchObject({ rule: 'codex.over-capacity', data: { bytes: span.length + 5, capacity: span.length } })
    expect(rules(auditReplacement(codex.blocks[0], span.slice(2) + '!!', 'native-codex'))).toEqual([])
    expect(rules(auditReplacement(codex.blocks[0], span + ' more', 'native-claude-code'))).toEqual([])
  })

  it('names the span the runner would refuse and quotes prose such as Bearer authentication', () => {
    const [finding] = audit('The sample service uses Bearer authentication for its endpoint.')
    expect(finding).toMatchObject({ rule: 'leak.runner-redaction', severity: 'error', contract: true, data: { pattern: 'bearer', match: 'Bearer authentication', count: 1 } })
    expect(finding.message).toContain('"Bearer authentication"')
    expect(rules(audit('See requests.exceptions.JSONDecodeError for the sample failure.'))).toEqual([])
    expect(rules(audit('A key such as sk-abcdefghij must never be pasted here.'))).toEqual(['leak.runner-redaction'])
    expect(audit('A long line first\nsk-abcdefghij is a key')[0]).toMatchObject({ rule: 'leak.gateway-credential', contract: true, data: { pattern: 'gateway-sk-token' } })
    expect(audit('Decode ' + jwt + ' and continue with the sample.')[0].data.pattern).toBe('jwt')
    expect(JSON.stringify(audit('A key such as sk-abcdefghijklmnopqrstuvwxyz stays out of findings'))).not.toContain('sk-abcdefghijklmnopqrstuvwxyz')
  })

  it('warns about other credential shapes, home paths, e-mail addresses, escapes and invisible characters only when new', () => {
    expect(rules(audit('Token ghp_' + 'a1B2'.repeat(9) + ' is fabricated for this test.'))).toEqual(['leak.credential-shape'])
    expect(rules(audit('Token github_pat_' + 'a1B2_'.repeat(5) + ' is fabricated for this test.'))).toEqual(['leak.credential-shape'])
    expect(rules(audit('Key AKIAABCDEFGHIJKLMNOP is fabricated for this test.'))).toEqual(['leak.credential-shape'])
    expect(rules(audit('Key XAKIAABCDEFGHIJKLMNOP is not that shape at all.'))).toEqual([])
    expect(rules(audit('Token xoxb-123456789012-abcdef is fabricated for this test.'))).toEqual(['leak.credential-shape'])
    expect(rules(audit('-----BEGIN RSA PRIVATE KEY----- fabricated header for this test'))).toEqual(['leak.credential-shape'])
    expect(audit('Open /Users/sample-person/project/notes.txt before you start.')[0]).toMatchObject({ rule: 'leak.local-path', severity: 'warning', contract: false, data: { match: '/Users/sample-person/', count: 1 } })
    expect(audit('Open /home/sample/project and C:\\Users\\Sample Person\\Docs.txt')[0]).toMatchObject({ rule: 'leak.local-path', data: { match: '/home/sample/', count: 2 } })
    // A Windows path that happens to contain backslash-n also reads as a typed escape: a warning, never a block.
    expect(rules(audit('Open C:\\Users\\Sample Person\\notes.txt'))).toEqual(['escape.poisoning', 'leak.local-path'])
    expect(audit('Write to person@example.org when the sample fails.')[0]).toMatchObject({ rule: 'leak.email', data: { match: 'person@example.org' } })
    expect(rules(audit('The handle @sample and the ratio 3@4 are not addresses.'))).toEqual([])
    const withEmail = { ...block('first'), baseline_utf8: 'Write to person@example.org about /Users/sample-person/ with\u200b care.' }
    expect(rules(auditReplacement(withEmail, 'Now write to person@example.org about /Users/sample-person/ with\u200b more care.', 'native-claude-code'))).toEqual([])
    expect(audit('A dash typed as \\u2014 and a break typed as \\n here.')[0]).toMatchObject({ rule: 'escape.poisoning', data: { count: 2, baseline_count: 0, excessive: false } })
    const excessive = audit('Escapes: ' + '\\\\'.repeat(11) + ' in a fabricated line.')[0]
    expect(excessive.data).toEqual({ count: 11, baseline_count: 0, excessive: true })
    expect(excessive.message).toContain('Excessive')
    expect(audit('Hidden\u200bjoin and a\u202eflip in fabricated text.')[0]).toMatchObject({ rule: 'unicode.invisible', data: { count: 2, code_points: 'U+200B, U+202E' } })
    expect(rules(audit('Tabs\tand\nline feeds are ordinary text here.'))).toEqual([])
  })

  it('adds the notes that explain what run evidence will not show', () => {
    expect(rules(audit(' \n\t '))).toEqual(['replacement.whitespace-only', 'observer.short-literal'])
    expect(rules(audit(block('first').baseline_utf8))).toEqual(['replacement.noop'])
    expect(audit('Short text')[0]).toMatchObject({ rule: 'observer.short-literal', severity: 'info', data: { bytes: 10 } })
    expect(rules(audit(long))).toEqual([])
  })

  it('orders findings by severity and then by rule id', () => {
    const found = audit('${TH_PROMPT_EXPR_9} mail person@example.org, Bearer authentication, sk-abcdefghij', 'third')
    expect(rules(found)).toEqual(['leak.runner-redaction', 'leak.runner-redaction', 'placeholder.sequence', 'leak.email', 'observer.templated'])
    expect(found.map((entry) => entry.severity)).toEqual(['error', 'error', 'error', 'warning', 'info'])
  })
})

describe('auditProfile', () => {
  it('is clean for the baseline and for a valid edit, and counts by severity', () => {
    expect(auditProfile(profile(), inventory)).toEqual({ ok: true, counts: { error: 0, warning: 0, info: 0 }, findings: [] })
    expect(auditProfile(profile([row('first', 'replace', long), row('second', 'disable')]), inventory)).toEqual({ ok: true, counts: { error: 0, warning: 0, info: 0 }, findings: [] })
  })

  it('agrees with canonicalProfile on what is refused', () => {
    const cases = [
      [{ ...profile(), extra: true }, 'profile.invalid-shape'],
      [{ ...profile(), schema_version: 3 }, 'profile.invalid-shape'],
      [{ ...profile(), default_action: 'replace' }, 'profile.invalid-shape'],
      [profile([{ ...row('first', 'keep'), note: 1 }]), 'profile.invalid-shape'],
      [{ ...profile(), inventory_sha256: 'f'.repeat(64) }, 'pins.mismatch'],
      [profile([{ ...row('first', 'keep'), block_id: 'absent' }]), 'override.unknown-block'],
      [profile([row('first', 'keep'), row('first', 'disable')]), 'override.duplicate'],
      [profile([{ ...row('first', 'disable'), baseline_sha256: '0'.repeat(64) }]), 'override.baseline-changed'],
      [profile([row('observed', 'disable')]), 'override.not-patchable'],
      [profile([{ ...row('first', 'replace', long), replacement_sha256: testDigest('other') }]), 'override.digest-mismatch'],
      [profile([row('first', 'replace', '')]), 'replacement.empty'],
      [profile([row('third', 'replace', 'no placeholders in this long replacement')]), 'placeholder.sequence'],
    ]
    for (const [value, expected] of cases) {
      const result = auditProfile(value, inventory)
      expect(result.ok).toBe(false)
      expect(result.findings[0]).toMatchObject({ rule: expected, severity: 'error', contract: true })
      expect(() => canonicalProfile(value, inventory)).toThrow()
    }
    expect(auditProfile(profile([row('observed', 'keep')]), inventory).ok).toBe(true)
    expect(auditProfile({ ...profile(), inventory_sha256: 'f'.repeat(64) }, inventory).findings[0].data).toEqual({ pin: 'inventory_sha256', mismatched: 1 })
  })

  it('warns from 80 % of a contract limit and refuses above it', () => {
    const many = { ...inventory, blocks: Array.from({ length: 4100 }, (_, index) => ({ ...block('first'), id: 'b' + index })) }
    const disable = (count) => profile(many.blocks.slice(0, count).map((entry) => ({ block_id: entry.id, baseline_sha256: entry.baseline_sha256, action: 'disable' })), 'keep', many)
    const limit = (count) => auditProfile(disable(count), many).findings.find((entry) => entry.rule === 'profile.too-many-overrides')
    expect(limit(3276)).toBeUndefined()
    expect(limit(3277)).toMatchObject({ severity: 'warning', contract: false, data: { used: 3277, max: 4096, state: 'near' } })
    expect(limit(4096)).toMatchObject({ severity: 'warning' })
    expect(limit(4097)).toMatchObject({ severity: 'error', contract: true, data: { state: 'over' } })
    const text = (size) => 'y'.repeat(size)
    const big = (sizes) => profile(sizes.map((size, index) => ({ block_id: many.blocks[index].id, baseline_sha256: many.blocks[index].baseline_sha256, action: 'replace', replacement_utf8: text(size), replacement_sha256: testDigest(text(size)) })), 'keep', many)
    const size = (sizes) => auditProfile(big(sizes), many).findings.filter((entry) => ['profile.too-large', 'manifest.size-estimate', 'plan.size-estimate'].includes(entry.rule)).map((entry) => [entry.rule, entry.severity])
    expect(size([150000, 150000])).toEqual([])
    // Two arms store the profile twice each, so the plan estimate is the first limit a large profile meets.
    expect(size([200000, 200000])).toEqual([['plan.size-estimate', 'warning']])
    expect(size([200000, 200000, 200000, 30000])).toEqual([['plan.size-estimate', 'warning'], ['profile.too-large', 'warning']])
    expect(size([200000, 200000, 200000, 200000])).toEqual([['profile.too-large', 'error'], ['plan.size-estimate', 'warning']])
    expect(size([250000, 250000, 250000, 250000, 60000])).toEqual([['profile.too-large', 'error'], ['manifest.size-estimate', 'warning'], ['plan.size-estimate', 'warning']])
  })

  it('checks the additional instructions that share the manifest', () => {
    const result = auditProfile(profile(), inventory, { prompt: 'Call the service with Bearer authentication.' })
    expect(result.findings).toHaveLength(1)
    expect(result.findings[0]).toMatchObject({ rule: 'leak.runner-redaction', scope: 'profile', block_id: null, data: { field: 'prompt', pattern: 'bearer' } })
    expect(auditProfile(profile(), inventory, { prompt: 'first line\nsk-abcdefghij' }).findings[0]).toMatchObject({ rule: 'leak.gateway-credential', scope: 'profile' })
    expect(auditProfile(profile(), inventory, { prompt: 'Plain additional instructions.' }).ok).toBe(true)
  })

  it('notes disabled fragments the observer cannot verify and Security & Safety changes', () => {
    const secure = { ...inventory, blocks: [{ ...block('first'), class_name: 'Security & Safety' }, { ...block('second'), baseline_utf8: 'tiny', baseline_sha256: testDigest('tiny') }, block('third'), block('observed')] }
    const result = auditProfile(profile([], 'disable', secure), secure)
    expect(result.findings.map((entry) => [entry.rule, entry.block_id])).toEqual([['class.security-disabled', null], ['observer.short-literal', 'second'], ['observer.templated', 'third']])
    expect(result.findings[0]).toMatchObject({ severity: 'info', contract: false, scope: 'profile', data: { count: 1 } })
    expect(result.ok).toBe(true)
    expect(auditProfile(profile([row('third', 'disable')]), inventory).findings.map((entry) => entry.rule)).toEqual(['observer.templated'])
  })

  it('orders findings by severity, then inventory order, then rule id, and links each to its block', () => {
    const value = profile([row('second', 'replace', 'Mail person@example.org and use Bearer authentication'), row('first', 'replace', 'tiny'), row('third', 'replace', 'none')])
    const result = auditProfile(value, inventory)
    expect(result.findings.map((entry) => [entry.severity, entry.block_id, entry.rule])).toEqual([
      ['error', 'second', 'leak.runner-redaction'], ['error', 'third', 'placeholder.sequence'], ['warning', 'second', 'leak.email'],
      ['info', 'first', 'observer.short-literal'], ['info', 'third', 'observer.templated']])
    expect(result.counts).toEqual({ error: 2, warning: 1, info: 2 })
    expect(result.findings.every((entry) => typeof entry.message === 'string' && entry.message.length > 20)).toBe(true)
  })
})
