// Pure draft/manifest tests: these do not prove a connected runner or a model run.
import { describe, expect, it, vi } from 'vitest'
import { CARDS, RECOMMENDED_ANSWERS, blocksFromAnswers } from './shallow-data'
import { CONFIGURATION_MAX_BYTES, DEFAULT_LIMITS, NATIVE_DRAFTS, applyConfiguration, configurationFor, configurationText, forkAsCustom, guidanceFor, initialComposer, parseConfiguration, safeBlocks } from './harness-composer-state'

const state = (changes = {}) => ({
  selection: 'custom', model_id: 'openai/gpt-example', task_id: 'real-repository-task',
  blocks: blocksFromAnswers(), native_prompts: { 'native-claude-code': 'Claude instructions', 'native-codex': 'Codex instructions' },
  harness_drafts: {}, answers: { ...RECOMMENDED_ANSWERS }, limits: { ...DEFAULT_LIMITS }, edit_mode: 'prompt', preserve_prompt: false,
  ...changes,
})
const config = () => configurationFor(state(), {})
const clone = (value) => JSON.parse(JSON.stringify(value))
const parse = (value) => parseConfiguration(JSON.stringify(value))

describe('portable harness configurations', () => {
  it('round-trips custom configuration, Unicode, exact numeric settings and block order', () => {
    const original = state()
    original.blocks[0].text = 'Investigate the réel repository. 日本語 🧪\nReturn evidence.'
    original.blocks[5].temperature = -0
    original.blocks.reverse()
    const configuration = configurationFor(original, {})
    const text = configurationText(configuration)
    expect(text).toContain('"temperature":-0.0')
    expect(parseConfiguration(text)).toEqual(configuration)
    expect(Object.is(parseConfiguration(text).harness.blocks.find((b) => b.type === 'sampling').temperature, -0)).toBe(true)
  })

  it('exports and imports incomplete selections as a draft without claiming run readiness', () => {
    const original = configurationFor(state({ model_id: '', task_id: '' }), {})
    original.prompt = ''; original.harness.blocks[0].text = ''
    expect(parseConfiguration(configurationText(original))).toEqual(original)
    const result = applyConfiguration(state(), original)
    expect(result.state.model_id).toBe('')
    expect(result.state.task_id).toBe('')
    expect(result.state.selection).toBe('custom')
    expect(result.state).not.toHaveProperty('reviewed')
  })

  it.each(CARDS.map((card) => [card.id, card]))('forks the %s fixed preset without changing or aliasing its prompt/tools/settings', (_, card) => {
    const original = state({ selection: 'fixed:' + card.id, harness_drafts: { custom: blocksFromAnswers({ stop: 'steps_6' }) } })
    const before = clone(original)
    const result = forkAsCustom(original, { card, fixedPrompt: 'Member edited prompt.' })
    expect(original).toEqual(before)
    expect(result.previousState).toEqual(before)
    expect(result.state.selection).toBe('custom')
    expect(result.state.model_id).toBe(original.model_id)
    expect(result.state.task_id).toBe(original.task_id)
    expect(result.state.blocks.find((b) => b.type === 'tools').names).toEqual(card.tools)
    expect(result.state.blocks.find((b) => b.type === 'prompt').text).toBe('Member edited prompt.')
    expect(result.state.blocks.find((b) => b.type === 'policy').mode).toBe(card.policy)
    expect(result.state.limits).toEqual({ ...DEFAULT_LIMITS, max_steps: card.max_steps })
    result.state.blocks.find((b) => b.type === 'tools').names.pop()
    expect(card.tools).toContain('submit')
    expect(result.state.harness_drafts.custom.find((b) => b.type === 'tools').names).toContain('submit')
    result.previousState.harness_drafts.custom[0].text = 'Changed undo snapshot.'
    expect(original).toEqual(before)
  })

  it('forks a saved draft with its current settings and retains the saved draft for return', () => {
    const original = state({ selection: 'saved:min_099dc52e693e' })
    original.blocks[2].mode = 'permissive'
    original.blocks[3].window = 7
    original.blocks[5].temperature = 0.75
    const result = forkAsCustom(original, {})
    expect(result.state.blocks).toEqual(original.blocks)
    expect(result.state.harness_drafts[original.selection]).toEqual(original.blocks)
    expect(result.state.blocks).not.toBe(original.blocks)
  })

  it('imports fixed exports as editable copies instead of overwriting account presets', () => {
    const original = configurationFor(state({ selection: 'fixed:claude' }), { card: { ...CARDS[0], hash: 'abcdef012345' }, fixedPrompt: 'Saved prompt.' })
    const imported = applyConfiguration(state(), parseConfiguration(configurationText(original)))
    expect(imported.state.selection).toBe('custom')
    expect(configurationFor(imported.state, {}).harness).not.toHaveProperty('id')
    expect(imported.notice).toContain('original preset and account saves are unchanged')
    expect(imported.state.blocks).toEqual(original.harness.blocks)
  })

  it.each(NATIVE_DRAFTS)('round-trips $id and preserves the other native prompt', (runtime) => {
    const original = state({ selection: 'native:' + runtime.id })
    const configuration = configurationFor(original, { runtime })
    const imported = applyConfiguration(state({ native_prompts: { 'native-claude-code': 'Other Claude draft', 'native-codex': 'Other Codex draft' } }), parseConfiguration(configurationText(configuration)))
    const other = NATIVE_DRAFTS.find((row) => row.id !== runtime.id).id
    expect(imported.state.selection).toBe(original.selection)
    expect(imported.state.native_prompts[runtime.id]).toBe(original.native_prompts[runtime.id])
    expect(imported.state.native_prompts[other]).toBe(other === 'native-codex' ? 'Other Codex draft' : 'Other Claude draft')
    expect(configurationFor(imported.state, { runtime })).toEqual(configuration)
    expect(() => forkAsCustom(original, { runtime })).toThrow('Native runtimes cannot be converted')
  })

  it('does not fetch, persist or invoke a provider while copying a configuration', () => {
    const fetch = vi.fn(); const storage = { setItem: vi.fn(), getItem: vi.fn() }
    vi.stubGlobal('fetch', fetch); vi.stubGlobal('sessionStorage', storage)
    try {
      applyConfiguration(state(), parseConfiguration(configurationText(config())))
      expect(fetch).not.toHaveBeenCalled()
      expect(storage.setItem).not.toHaveBeenCalled()
    } finally { vi.unstubAllGlobals() }
  })

  it('restores the explicit carry-prompt preference and rejects truthy non-booleans', () => {
    vi.stubGlobal('sessionStorage', { getItem: () => JSON.stringify({ preserve_prompt: true }) })
    try {
      expect(initialComposer().preserve_prompt).toBe(true)
      sessionStorage.getItem = () => JSON.stringify({ preserve_prompt: 'true' })
      expect(initialComposer().preserve_prompt).toBe(false)
    } finally { vi.unstubAllGlobals() }
  })

  it('copies allowed tool arrays when recovering persisted blocks', () => {
    const original = blocksFromAnswers()
    const copied = safeBlocks(original)
    copied.find((b) => b.type === 'tools').names.pop()
    expect(original.find((b) => b.type === 'tools').names).toContain('submit')
  })
})

describe('configuration import boundary', () => {
  it.each([
    ['wrong version', (c) => { c.version = 2 }, 'version 1'],
    ['unknown top-level option', (c) => { c.runner_url = 'https://invalid.test' }, 'version 1'],
    ['unregistered runtime', (c) => { c.runtime_id = 'native-other' }, 'unsupported runtime'],
    ['mismatched prompt mode', (c) => { c.prompt_mode = 'append' }, 'prompt mode'],
    ['invalid model ID', (c) => { c.model_id = '../bad model' }, 'model ID'],
    ['invalid task ID', (c) => { c.task_id = '../repository' }, 'task ID'],
    ['unknown lane', (c) => { c.harness.lane = 'executable' }, 'seven blocks'],
    ['unknown fixed preset', (c) => { c.harness.lane = 'fixed'; c.harness.id = 'unknown' }, 'recognized preset'],
    ['coerced saved ID', (c) => { c.harness.id = ['min_099dc52e693e'] }, 'recognized preset'],
    ['invalid fixed hash', (c) => { c.harness.hash = 'wrong' }, 'hash'],
    ['unknown block option', (c) => { c.harness.blocks[0].execute = true }, 'extra fields'],
    ['unknown tool', (c) => { c.harness.blocks[1].names.push('network_execute') }, 'unsupported or repeated tool'],
    ['duplicate tool', (c) => { c.harness.blocks[1].names.push('submit') }, 'unsupported or repeated tool'],
    ['duplicate block', (c) => { c.harness.blocks[1] = c.harness.blocks[0] }, 'extra fields'],
    ['prompt mismatch', (c) => { c.harness.blocks[0].text = 'Other text' }, 'prompt block disagree'],
    ['step mismatch', (c) => { c.limits.max_steps = 15 }, 'step limit and stop block disagree'],
    ['cleared numeric input', (c) => { c.limits.wall_time_seconds = '' }, 'Enter a value'],
    ['excessive budget', (c) => { c.limits.max_cost_usd = 1000 }, 'Model budget'],
    ['invalid block numeric input', (c) => { c.harness.blocks[3].observation_chars = -2 }, 'Observation characters'],
    ['invalid policy', (c) => { c.harness.blocks[2].mode = 'unrestricted' }, 'extra fields'],
    ['native block contamination', (c) => { c.runtime_id = 'native-codex'; c.prompt_mode = 'append' }, 'Native runtimes cannot'],
  ])('rejects %s with actionable feedback', (_, mutate, message) => {
    const value = config(); mutate(value)
    expect(() => parse(value)).toThrow(message)
  })

  it.each(['api_key', 'OpenRouter-API-Key', 'credential_id', 'authorization', 'password', 'accessToken'])('refuses %s without echoing its value', (key) => {
    const value = config(); value.harness.blocks[0][key] = 'private-value-never-echo'
    try { parse(value); throw new Error('Expected refusal') } catch (error) {
      expect(error.message).toContain('credential fields')
      expect(error.message).not.toContain('private-value-never-echo')
    }
  })

  it('refuses OpenRouter keys embedded in prompt text without echoing them', () => {
    const value = config(); value.prompt = 'sk-or-v1-' + 'x'.repeat(30); value.harness.blocks[0].text = value.prompt
    expect(() => parse(value)).toThrow('Remove provider credentials')
  })

  it('rejects oversized UTF-8 text and invalid Unicode without changing existing state', () => {
    const original = state(); const before = clone(original)
    const value = config(); value.prompt = '🧪'.repeat(62501); value.harness.blocks[0].text = value.prompt
    expect(() => applyConfiguration(original, value)).toThrow('250,000 UTF-8 bytes')
    expect(original).toEqual(before)
    value.prompt = '\ud800'; value.harness.blocks[0].text = value.prompt
    expect(() => parse(value)).toThrow('invalid Unicode')
    expect(() => parseConfiguration(' '.repeat(CONFIGURATION_MAX_BYTES + 1))).toThrow('1 MiB')
    expect(() => parseConfiguration('{')).toThrow('not valid JSON')
  })

  it('rejects hostile object keys, deep structures and object getters without invoking them', () => {
    const hostile = JSON.stringify(config()).replace('"harness":{', '"harness":{"__proto__":{"polluted":true},')
    expect(() => parseConfiguration(hostile)).toThrow('unsafe object field')
    expect(Object.prototype.polluted).toBeUndefined()
    const value = config(); let nested = value
    for (let i = 0; i < 10; i++) { nested.extra = {}; nested = nested.extra }
    expect(() => configurationText(value)).toThrow('too complex')
    const getter = vi.fn(() => 'never invoke')
    Object.defineProperty(value, 'secretGetter', { enumerable: true, get: getter })
    delete value.extra
    expect(() => configurationText(value)).toThrow('executable properties')
    expect(getter).not.toHaveBeenCalled()
    const arrayExtra = config(); arrayExtra.harness.blocks.extra = true
    expect(() => configurationText(arrayExtra)).toThrow('arrays cannot contain extra fields')
  })
})


describe('guided settings reflect the actual configuration', () => {
  it('reconciles imported permissive, 20-step and short-history reset answers', () => {
    const blocks = blocksFromAnswers({ dangerous: 'permissive', stop: 'steps_20', history: 'last2' })
    const imported = applyConfiguration(state(), configurationFor(state({ blocks }), {})).state
    expect(imported.answers).toMatchObject({ dangerous: 'permissive', stop: 'steps_20', history: 'last2' })
    expect(guidanceFor(imported.blocks, imported.answers).resetDifferences).toEqual([])
  })

  it('leaves unrepresentable tool sets and step caps explicitly custom', () => {
    const original = state()
    original.blocks.find((b) => b.type === 'tools').names = ['list_files', 'submit']
    original.blocks.find((b) => b.type === 'stop').max_steps = 37
    const guidance = guidanceFor(original.blocks, original.answers)
    expect(guidance.selections).toMatchObject({ touch: null, stop: null })
    expect(guidance.custom).toEqual(['touch', 'stop'])
  })

  it('reports advanced changes without overwriting remembered reset answers', () => {
    const original = state({ blocks: blocksFromAnswers({ dangerous: 'permissive', stop: 'steps_6' }) })
    const before = clone(original.answers)
    const guidance = guidanceFor(original.blocks, original.answers)
    expect(guidance.selections).toMatchObject({ dangerous: 'permissive', stop: 'steps_6' })
    expect(guidance.resetDifferences).toEqual(['dangerous', 'stop'])
    expect(original.answers).toEqual(before)
  })

  it('compares tool sets without ordering and recognizes an exact prompt template', () => {
    const blocks = blocksFromAnswers({ verify: 'no' })
    blocks.find((b) => b.type === 'tools').names.reverse()
    expect(guidanceFor(blocks, RECOMMENDED_ANSWERS).selections.touch).toBe('read_edit_test')
    const imported = applyConfiguration(state(), configurationFor(state({ blocks }), {})).state
    expect(imported.answers.verify).toBe('no')
  })
})
