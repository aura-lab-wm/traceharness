// @vitest-environment jsdom
import { fireEvent, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderRig, resetRig, rigFixture } from '../../../test/rig-testing'

afterEach(resetRig)

describe('shallow doors', () => {
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
