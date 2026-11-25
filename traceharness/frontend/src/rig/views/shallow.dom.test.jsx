// @vitest-environment jsdom
import { fireEvent, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderRig, resetRig, rigFixture } from '../../../test/rig-testing'

afterEach(resetRig)

describe('shallow doors', () => {
  it('measures UTF-8 prompt bytes, exposes over-cap text, and resets the editor and meter together', () => {
    const { container } = renderRig('#/rig/shallowCards', { data: { '/overview': { results: [] } } })
    const card = within(container.querySelector('[data-agent="grok"]'))
    const editor = card.getByRole('textbox', { name: 'Standing prompt for Grok' })
    const original = editor.value
    fireEvent.change(editor, { target: { value: '🙂'.repeat(2501) } })
    const meter = card.getByRole('meter', { name: 'Grok prompt bytes' })
    expect(meter.getAttribute('aria-valuetext')).toBe('10004 of 10000 bytes, over cap')
    expect(meter.value).toBe(10000)
    expect(card.getByText('4 bytes over the shell cap')).toBeTruthy()
    fireEvent.click(card.getByRole('button', { name: 'Reset prompt' }))
    expect(editor.value).toBe(original)
    expect(meter.value).toBe(new TextEncoder().encode(original).length)
    expect(card.queryByText('4 bytes over the shell cap')).toBeNull()
  })

  it('keeps the visible configuration summary in sync with wizard choices', () => {
    renderRig('#/rig/shallowWizard', { data: { '/overview': { results: [] } } })
    const summary = within(screen.getByRole('complementary', { name: 'Your configuration' }))
    expect(summary.getByText('run_tests')).toBeTruthy()
    fireEvent.click(screen.getByRole('radio', { name: 'Read only.' }))
    expect(summary.queryByText('run_tests')).toBeNull()
    fireEvent.click(screen.getByRole('radio', { name: 'Only the last two observations.' }))
    expect(summary.getByText('2 observations')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Reset to recommended' }))
    expect(summary.getByText('run_tests')).toBeTruthy()
    expect(summary.getByText('Full history')).toBeTruthy()
  })

  it('the empty library and the filled library both offer the two doors', () => {
    const empty = renderRig('#/rig/home', { data: { '/overview': { results: [] } } })
    expect(empty.container.textContent).toContain('Fixed harnesses')
    expect(empty.container.textContent).toContain('Minimal harness')
    expect(empty.container.textContent).not.toContain('Waiting for the machine')
    resetRig()
    const filled = renderRig('#/rig/home', { data: rigFixture() })
    expect(filled.container.querySelector('[data-el="fixed-harnesses-cta"]')).toBeTruthy()
    expect(filled.container.querySelector('[data-el="minimal-harness-cta"]')).toBeTruthy()
  })

  it('the six cards show the Claude cap and do not call a model', () => {
    const { container } = renderRig('#/rig/shallowCards', { data: { '/overview': { results: [] } } })
    const root = container.querySelector('[data-el="shallow-cards"]')
    expect(root).toBeTruthy()
    expect(root.textContent).toContain('250000')
    expect(root.textContent).toContain('Claude Code')
    expect(root.textContent).toContain('Nothing on this screen is saved')
    expect(root.querySelectorAll('textarea')).toHaveLength(6)
    expect(container.textContent).not.toContain('Waiting for the machine')
  })

  it('the same prompt keeps each shell on the apply screen', () => {
    const { container } = renderRig('#/rig/shallowApply', { data: { '/overview': { results: [] } } })
    const root = container.querySelector('[data-el="shallow-apply"]')
    expect(root).toBeTruthy()
    expect(root.querySelectorAll('[data-el="apply-shell"]')).toHaveLength(6)
    expect(root.textContent).toContain('10000')
    expect(root.textContent).toContain('Grok')
  })

  it('the wizard preselects the recommended answers and keeps MCP off', () => {
    const { container } = renderRig('#/rig/shallowWizard', { data: { '/overview': { results: [] } } })
    const root = container.querySelector('[data-el="shallow-wizard"]')
    expect(root).toBeTruthy()
    expect(root.textContent).toContain('Recommended')
    expect(root.textContent).toContain('off the vendor ladder')
    expect(root.querySelector('[data-mcp="none"]')).toBeTruthy()
    expect(root.querySelector('[data-el="customize-spec"]').getAttribute('data-spec')).toBe('blocks:customize')
    const checked = [...root.querySelectorAll('input:checked')].map((node) => node.value)
    expect(checked).toEqual(['read_edit_test', 'strict', 'yes', 'full', 'steps_12', 'none'])
    const stored = JSON.parse(sessionStorage.getItem('traceharness.shallow.customize'))
    expect(Array.isArray(stored)).toBe(true)
    expect(stored.find((block) => block.type === 'tools').names).toEqual(['list_files', 'read_file', 'edit_file', 'run_tests', 'submit'])
  })

  it('customize can return to the wizard and reload the stored answers', async () => {
    const stored = [
      { type: 'prompt', text: 'WIZARD-PROMPT' },
      { type: 'tools', names: ['list_files', 'read_file', 'submit'] },
      { type: 'policy', mode: 'strict' },
      { type: 'context', window: 0, observation_chars: 6000 },
      { type: 'stop', max_steps: 12, max_total_tokens: 400000 },
      { type: 'sampling', temperature: 0, max_tokens_per_call: 2048 },
      { type: 'listing', include: true },
    ]
    sessionStorage.setItem('traceharness.shallow.customize', JSON.stringify(stored))
    const palette = {
      tools: ['list_files', 'read_file', 'edit_file', 'run_tests', 'bash', 'submit'],
      types: ['prompt', 'tools', 'policy', 'context', 'stop', 'sampling', 'listing'],
      blank: [],
    }
    const json = (body, ok = true) => ({
      ok,
      status: ok ? 200 : 404,
      statusText: ok ? 'OK' : 'Not Found',
      headers: { get: () => 'application/json' },
      json: async () => body,
    })
    const fetchImpl = vi.fn(async (url) => {
      const path = String(url)
      if (path.endsWith('/blocks/palette')) return json(palette)
      if (path.endsWith('/blocks/catalog')) return json({ harnesses: [] })
      if (path.endsWith('/blocks/compile')) return json({ ok: true, hash: 'abc', warnings: [], harness: { id: 'min_abc' } })
      return json({ detail: 'not primed' }, false)
    })
    const { container } = renderRig('#/rig/blocks:customize', {
      data: { '/overview': { results: [] } },
      fetchImpl,
    })
    const back = await screen.findByRole('button', { name: 'Back to Minimal Wizard' })
    expect(back.getAttribute('data-spec')).toBe('shallowWizard')
    const root = container.querySelector('[data-el="minimal-customize-nav"]')
    expect(root).toBeTruthy()
    const tool = (name) => [...container.querySelectorAll('label')].find((node) => node.textContent.trim() === name).querySelector('input')
    expect(tool('edit_file').checked).toBe(false)
    fireEvent.click(tool('edit_file'))
    expect(tool('edit_file').checked).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Reset to Wizard Answers' }))
    expect(tool('edit_file').checked).toBe(false)
    expect(JSON.parse(sessionStorage.getItem('traceharness.shallow.customize'))).toEqual(stored)
    resetRig()
    const plain = renderRig('#/rig/blocks', { data: { '/overview': { results: [] } }, fetchImpl })
    await screen.findByRole('heading', { name: 'Build a harness' })
    expect(plain.container.textContent).not.toContain('Back to Minimal Wizard')
    expect(plain.container.querySelector('[data-el="reset-wizard-answers"]')).toBeNull()
  })
})

describe('Build a harness and the six-shell preview say what they just did', () => {
  afterEach(() => resetRig())
  const json = (body) => ({ ok: true, status: 200, statusText: 'OK', headers: { get: () => 'application/json' }, json: async () => body })
  const blank = [
    { type: 'prompt', text: 'Blank stack prompt.' }, { type: 'tools', names: ['read_file', 'submit'] }, { type: 'policy', mode: 'strict' },
    { type: 'context', window: 0, observation_chars: 6000 }, { type: 'stop', max_steps: 12, max_total_tokens: 400000 },
    { type: 'sampling', temperature: 0, max_tokens_per_call: 2048 }, { type: 'listing', include: true },
  ]
  const preset = { id: 'fixture_agent', name: 'Fixture agent', default_model: 'mock', default_basis: 'A fixture preset.', blocks: [{ type: 'prompt', text: 'Preset prompt.' }, { type: 'tools', names: ['bash', 'submit'] }] }
  const fetchImpl = vi.fn(async (url) => {
    const path = String(url)
    if (path.endsWith('/blocks/palette')) return json({ tools: ['list_files', 'read_file', 'edit_file', 'run_tests', 'bash', 'submit'], types: blank.map((b) => b.type), blank })
    if (path.endsWith('/blocks/catalog')) return json({ harnesses: [preset] })
    if (path.endsWith('/blocks/compile')) return json({ ok: true, hash: 'abc', warnings: [], harness: { id: 'min_abc' } })
    return { ok: false, status: 404, statusText: 'Not Found', headers: { get: () => 'application/json' }, json: async () => ({ detail: 'not primed' }) }
  })

  it('Blank stack really clears a preset back to the blank palette, and says so beside the button', async () => {
    const { container } = renderRig('#/rig/blocks', { data: { '/overview': { results: [] } }, fetchImpl })
    const presets = await screen.findByRole('group', { name: 'Start from a preset:' })
    const cards = () => container.querySelectorAll('[data-el="harness-block"]')
    expect(cards()).toHaveLength(7)
    fireEvent.click(within(presets).getByRole('button', { name: 'Fixture agent — TraceHarness copy' }))
    expect(cards()).toHaveLength(2)
    expect(within(presets).getByRole('button', { name: 'Fixture agent — TraceHarness copy' }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(within(presets).getByRole('button', { name: 'Blank stack' }))
    expect(cards()).toHaveLength(7)
    expect([...cards()].map((card) => card.getAttribute('data-block-type'))).toEqual(blank.map((b) => b.type))
    expect(within(presets).getByRole('status').textContent).toBe('Back to the blank stack: the 7 default blocks, no preset, model mock.')
    expect(within(presets).getByRole('button', { name: 'Fixture agent — TraceHarness copy' }).getAttribute('aria-pressed')).toBe('false')
    // the note describes that stack only: the next edit clears it
    fireEvent.click(within(presets).getByRole('button', { name: 'Fixture agent — TraceHarness copy' }))
    expect(within(presets).queryByRole('status')).toBeNull()
  })

  it('Apply to all six confirms beside the button: how many fit and how many were clipped', async () => {
    const { appliedSentence } = await import('./shallow-apply')
    renderRig('#/rig/shallowApply', { data: { '/overview': { results: [] } } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Prompt applied to all six' }), { target: { value: 'Read the code, fix the bug, run the tests.' } })
    expect(screen.getByText('Unapplied edits')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Apply to all six' }))
    const said = document.querySelector('[data-el="apply-result"]')
    expect(said.getAttribute('role')).toBe('status')
    expect(said.textContent).toBe('Applied to all 6 cards below: 6 fit. Preview only; saved prompts are unchanged.')
    expect(said.previousElementSibling.textContent).toBe('Apply to all six')
    expect(appliedSentence('x'.repeat(30), [{ cap_bytes: 10 }, { cap_bytes: 100 }])).toBe('Applied to all 2 cards below: 1 fit, 1 clipped to their byte cap. Preview only; saved prompts are unchanged.')
  })
})
