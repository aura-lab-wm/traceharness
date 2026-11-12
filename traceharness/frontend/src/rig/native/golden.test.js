// Shared golden fixtures (plan 4.5): every case in test/native-golden/*.json, produced by the
// Python mirror (runner_service/native_prompt_tools.py), must be reproduced by the JavaScript
// implementation without editing the golden files. Skips cleanly when the directory is absent.
//
// File format: { "function": "<python name>", "cases": [{ "name", "args": [...], "expected" }] }; a case may
// name its own "function" when one file covers a family. A JSON file without "cases" is a
// reference document (an inventory, a profile) that cases point to.
// `expected` is the complete return value, or { "error": "<exact sentence>" }. Numbers that are
// not integers compare with a tolerance of 1e-9, everything else exactly. An argument that is a
// string "@<name>" refers to test/native-golden/<name>.json (for example "@inventory-claude"), and an
// argument { "@repeat": text, "times": n } stands for text repeated n times (large inputs).
import { webcrypto } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import * as contract from '../../native-prompts-contract'
import * as state from '../views/native-prompts-state'
import * as audit from './audit'
import * as budget from './budget'
import * as diff from './diff'
import * as stats from './experiment-stats'
import * as interchange from './interchange'
import * as library from './library'
import * as macros from './macros'
import * as model from './profile-model'
import * as search from './search'
import * as metrics from './text-metrics'

const DIRECTORY = fileURLToPath(new URL('../../../test/native-golden/', import.meta.url))
const TOLERANCE = 1e-9

/** Python functions that have no JavaScript twin on purpose (plan 4.5: CLI only). */
const PYTHON_ONLY = new Set(['search_inventory_regex'])

const mapToObject = (value) => value instanceof Map ? Object.fromEntries(value) : value
const orEmpty = (value) => value === null || value === undefined ? {} : value
const withDate = (input) => {
  if (!input || typeof input !== 'object' || typeof input.now !== 'string') return input
  return { ...input, now: new Date(input.now) }
}

/** Python name -> (args) => JavaScript result. Arguments arrive in the Python order. */
const TWINS = {
  // text-metrics
  utf8_bytes: (text) => metrics.utf8Bytes(text),
  code_points: (text) => metrics.codePoints(text),
  line_count: (text) => metrics.lineCount(text),
  strip_ascii_whitespace: (text) => metrics.stripAsciiWhitespace(text),
  estimate_tokens: (text) => metrics.estimateTokens(text),
  text_metrics: (text) => metrics.textMetrics(text),
  // profile-model
  canonical_json: (value) => model.canonicalJSON(value),
  sha256_hex: (text) => model.sha256Hex(text),
  canonical_profile: (profile, inventory) => model.canonicalProfile(profile, inventory),
  profile_sha256: (profile) => model.profileSha256(profile),
  profile_bytes: (profile) => model.profileBytes(profile),
  override_bytes: (override) => model.overrideBytes(override),
  placeholder_sequence: (text) => model.placeholderSequence(text),
  ordered_profile: (profile) => model.orderedProfile(profile),
  resolve_actions: (profile, inventory) => mapToObject(model.resolveActions(profile, inventory)),
  effective_text: (block, profile) => model.effectiveText(block, profile),
  profile_counts: (profile, inventory) => model.profileCounts(profile, inventory),
  rebase_profile: (profile, inventory) => model.rebaseProfile(profile, inventory),
  // contract mirrors
  baseline_profile: (inventory) => contract.baselineProfile(inventory),
  checked_native_profile: (value, runtimeId) => contract.checkedNativeProfile(value, runtimeId ?? undefined),
  replacement_issue: (value, placeholders) => contract.replacementIssue(value, placeholders ?? null),
  native_profile_issue: (profile, inventory) => contract.nativeProfileIssue(profile, inventory),
  profile_name_issue: (name) => state.profileNameIssue(name),
  library_note_issue: (note) => library.libraryNoteIssue(note),
  // search
  ascii_lower: (text) => search.asciiLower(text),
  parse_query: (text) => search.parseQuery(text),
  baseline_metrics: (inventory) => search.baselineMetrics(inventory),
  search_inventory: (inventory, options) => search.searchInventory(inventory, orEmpty(options)),
  // diff
  diff_text: (before, after, limits) => diff.diffText(before, after, limits ?? diff.DIFF_LIMITS),
  diff_profiles: (a, b, inventory) => diff.diffProfiles(a, b, inventory),
  // audit
  runner_redaction_matches: (text) => audit.runnerRedactionMatches(text),
  gateway_credential_matches: (text) => audit.gatewayCredentialMatches(text),
  audit_replacement: (block, text, runtimeId) => audit.auditReplacement(block, text, runtimeId),
  audit_profile: (profile, inventory, context) => audit.auditProfile(profile, inventory, orEmpty(context)),
  // budget
  limit_state: (used, max) => budget.limitState(used, max),
  manifest_bytes_estimate: (size, prompt) => budget.manifestBytesEstimate(size, prompt ?? ''),
  paired_plan_bytes_estimate: (size, prompt) => budget.pairedPlanBytesEstimate(size, prompt ?? ''),
  profile_budget: (profile, inventory, context) => budget.profileBudget(profile, inventory, orEmpty(context)),
  plan_budget: (plan) => budget.planBudget(plan),
  // macros
  apply_macro: (text, macroId) => macros.applyMacro(text, macroId),
  generate_macro_edits: (inventory, profile, blockIds, macroIds) => macros.generateMacroEdits(inventory, profile, blockIds, macroIds),
  fit_macro_edits: (inventory, profile, edits) => macros.fitMacroEdits(inventory, profile, edits),
  // interchange
  make_bundle: (input) => interchange.makeBundle(withDate(input)),
  profile_file_name: (profile, profileSha, kind) => interchange.profileFileName(profile, profileSha, kind ?? 'profile'),
  serialize_profile_file: (value) => interchange.serializeProfileFile(value),
  parse_profile_document: (text) => interchange.parseProfileFile(text),
  profile_from_agent_patcher_blocks: (blocks, inventory) => interchange.profileFromAgentPatcherBlocks(blocks, inventory),
  agent_patcher_blocks_from_profile: (profile, inventory) => interchange.agentPatcherBlocksFromProfile(profile, inventory),
  // experiment-stats
  wilson_interval: (successes, n) => stats.wilsonInterval(successes, n),
  mcnemar_exact_p: (b, c) => stats.mcnemarExactP(b, c),
  smallest_reachable_p: (discordant) => stats.smallestReachableP(discordant),
  trial_outcome: (trial) => stats.trialOutcome(trial),
  fixed_decimals: (value, digits) => stats.fixedDecimals(value, digits),
  experiment_outcomes: (experiment) => stats.experimentOutcomes(experiment),
  experiment_csv: (experiment) => stats.experimentCsv(experiment),
  experiment_markdown: (experiment) => stats.experimentMarkdown(experiment),
}

const documents = new Map()
for (const name of existsSync(DIRECTORY) ? readdirSync(DIRECTORY).filter((entry) => entry.endsWith('.json')).sort() : []) {
  documents.set(name, JSON.parse(readFileSync(DIRECTORY + name, 'utf8')))
}
const isGolden = (value) => value && typeof value === 'object' && !Array.isArray(value) && Object.hasOwn(value, 'cases')
const goldenFiles = [...documents.keys()].filter((name) => isGolden(documents.get(name)))
const references = new Map()

function reference(name) {
  if (!references.has(name)) references.set(name, documents.get(name + '.json') ?? JSON.parse(readFileSync(DIRECTORY + name + '.json', 'utf8')))
  return structuredClone(references.get(name))
}

/**
 * Arguments only, as the Python checker expands them: a string "@name" that names a reference
 * document becomes a copy of it, and { "@repeat": text, "times": n } becomes text repeated n times.
 */
function resolved(value) {
  if (typeof value === 'string' && /^@[a-z0-9-]+$/.test(value) && documents.has(value.slice(1) + '.json')) return reference(value.slice(1))
  if (Array.isArray(value)) return value.map(resolved)
  if (value && typeof value === 'object') {
    const keys = Object.keys(value)
    if (keys.length === 2 && keys.includes('@repeat') && keys.includes('times')) return String(value['@repeat']).repeat(value.times)
    return Object.fromEntries(keys.map((key) => [key, resolved(value[key])]))
  }
  return value
}

/** '' when `actual` equals `expected` under the golden rules, else the path and both values. */
function difference(actual, expected, path = '$') {
  if (typeof expected === 'number' && typeof actual === 'number') {
    if (Number.isInteger(expected) && Number.isInteger(actual)) return actual === expected ? '' : `${path}: ${actual} !== ${expected}`
    return Math.abs(actual - expected) <= TOLERANCE ? '' : `${path}: ${actual} differs from ${expected} by more than ${TOLERANCE}`
  }
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) return `${path}: expected an array, got ${JSON.stringify(actual)?.slice(0, 200)}`
    if (actual.length !== expected.length) return `${path}: length ${actual.length} !== ${expected.length}`
    for (let index = 0; index < expected.length; index++) {
      const found = difference(actual[index], expected[index], `${path}[${index}]`)
      if (found) return found
    }
    return ''
  }
  if (expected && typeof expected === 'object') {
    if (!actual || typeof actual !== 'object' || Array.isArray(actual)) return `${path}: expected an object, got ${JSON.stringify(actual)?.slice(0, 200)}`
    const keys = Object.keys(expected).sort(), got = Object.keys(actual).filter((key) => actual[key] !== undefined).sort()
    if (keys.join('\n') !== got.join('\n')) return `${path}: keys [${got.join(', ')}] !== [${keys.join(', ')}]`
    for (const key of keys) {
      const found = difference(actual[key], expected[key], `${path}.${key}`)
      if (found) return found
    }
    return ''
  }
  return Object.is(actual, expected) || actual === expected ? '' : `${path}: ${JSON.stringify(actual)?.slice(0, 300)} !== ${JSON.stringify(expected)?.slice(0, 300)}`
}

const isErrorCase = (expected) => expected && typeof expected === 'object' && !Array.isArray(expected) && Object.keys(expected).length === 1 && typeof expected.error === 'string'

async function outcome(twin, args) {
  try { return { value: await twin(...args) } } catch (failure) { return { error: failure instanceof Error ? failure.message : String(failure) } }
}

describe.skipIf(!goldenFiles.length)('golden fixtures shared with the Python mirror', () => {
  beforeAll(() => vi.stubGlobal('crypto', webcrypto))
  afterAll(() => vi.unstubAllGlobals())

  it('has a JavaScript twin for every golden function, and every file is well formed', () => {
    for (const file of goldenFiles) {
      const golden = documents.get(file)
      expect(typeof golden.function, file).toBe('string')
      expect(Array.isArray(golden.cases) && golden.cases.length > 0, file).toBe(true)
      for (const entry of golden.cases) {
        const name = entry.function ?? golden.function
        if (!PYTHON_ONLY.has(name)) expect(Object.hasOwn(TWINS, name), `${file}: no JavaScript twin for ${name}`).toBe(true)
        expect(typeof entry.name, file).toBe('string')
        expect(Array.isArray(entry.args), `${file} / ${entry.name}: args`).toBe(true)
        expect(Object.hasOwn(entry, 'expected'), `${file} / ${entry.name}: expected`).toBe(true)
      }
    }
  })

  for (const file of goldenFiles) {
    const golden = documents.get(file)
    if (!Array.isArray(golden.cases)) continue
    describe(file, () => {
      for (const entry of golden.cases) {
        const name = entry.function ?? golden.function
        if (PYTHON_ONLY.has(name)) continue
        it(`${name}: ${entry.name}`, async () => {
          const twin = TWINS[name]
          expect(twin, `no JavaScript twin for ${name}`).toBeTypeOf('function')
          const result = await outcome(twin, resolved(entry.args))
          if (isErrorCase(entry.expected)) {
            expect(result.error, `expected the error "${entry.expected.error}", got ${JSON.stringify(result.value)?.slice(0, 300)}`).toBe(entry.expected.error)
            return
          }
          expect(result.error, `unexpected error`).toBeUndefined()
          expect(difference(JSON.parse(JSON.stringify(mapToObject(result.value)) ?? 'null'), entry.expected)).toBe('')
        })
      }
    })
  }
})

describe('golden directory', () => {
  it.skipIf(goldenFiles.length)('is absent or empty, so the shared golden cases are skipped', () => {
    expect(goldenFiles).toEqual([])
  })
})
