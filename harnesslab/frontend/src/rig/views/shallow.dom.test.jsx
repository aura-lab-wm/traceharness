// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
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
})
