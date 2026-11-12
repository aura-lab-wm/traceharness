// @vitest-environment jsdom
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ConfigurationEditor, PARSE_PAUSE_MS } from './ConfigurationEditor'
import { CARDS } from './views/shallow-data'
import { applyConfiguration, configurationFor, initialComposer } from './views/harness-composer-state'

afterEach(cleanup)

function draftConfig({ fixed = false, temperature = 0, modelId = 'openai/gpt-5', taskId = 'swe-task-1', prompt = 'Inspect, edit, verify, do not modify the tests.' } = {}) {
  const base = initialComposer(fixed ? ['fixed', CARDS[0].id] : ['custom'])
  const blocks = base.blocks.map((b) => b.type === 'prompt' ? { ...b, text: prompt } : b.type === 'sampling' ? { ...b, temperature } : b)
  const state = { ...base, model_id: modelId, task_id: taskId, blocks }
  const card = fixed ? CARDS[0] : null
  return { state, card, config: configurationFor(state, { card, fixedPrompt: prompt }) }
}

const replacePrompt = (jsonText, oldPrompt, nextPrompt) => jsonText.split(JSON.stringify(oldPrompt)).join(JSON.stringify(nextPrompt))

describe('ConfigurationEditor adversarial regressions', () => {
  it('preserves canonical -0.0 in textarea, diff preview, and Apply JSON roundtrip', () => {
    const applied = []
    const onPendingChange = vi.fn()
    function Host() {
      const [cfg, setCfg] = useState(() => draftConfig({ temperature: -0 }).config)
      return <ConfigurationEditor configuration={cfg} onPendingChange={onPendingChange} onApply={(next) => { applied.push(next); setCfg(next) }} />
    }
    const { container } = render(<Host />)
    const input = screen.getByLabelText('Configuration JSON')
    expect(input.value).toContain('"temperature": -0.0')
    expect(onPendingChange).toHaveBeenLastCalledWith(false)

    fireEvent.change(input, { target: { value: input.value.replace('"temperature": -0.0', '"temperature": 0') } })
    expect(onPendingChange).toHaveBeenLastCalledWith(true)
    const pres = [...container.querySelectorAll('.rg-json-editor-diff pre')].map((node) => node.textContent.trim())
    expect(pres.length).toBeGreaterThanOrEqual(2)
    expect(pres[0]).not.toBe(pres[1])
    expect(pres[0]).toMatch(/-0(?:\.0)?|−0/)
    expect(applied).toHaveLength(0)

    fireEvent.click(screen.getByRole('button', { name: 'Apply JSON' }))
    expect(Object.is(applied[0].harness.blocks.find((b) => b.type === 'sampling').temperature, 0)).toBe(true)
    fireEvent.change(input, { target: { value: input.value.replace('"temperature": 0', '"temperature": -0.0') } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply JSON' }))
    expect(Object.is(applied[1].harness.blocks.find((b) => b.type === 'sampling').temperature, -0)).toBe(true)
  })

  it('rejects malformed JSON, unknown fields, mismatched caps, and credentials without data loss', () => {
    const onApply = vi.fn()
    const onPendingChange = vi.fn()
    const { config } = draftConfig()
    render(<ConfigurationEditor configuration={config} onApply={onApply} onPendingChange={onPendingChange} />)
    const input = screen.getByLabelText('Configuration JSON')
    const baseText = input.value
    for (const candidate of [
      '{ broken json',
      baseText.replace('"version": 1,', '"version": 1,\n  "extra_unknown": true,'),
      baseText.replace('"max_steps": 12,', '"max_steps": 12,\n    "extra_limit": 5,'),
      baseText.replace('"prompt": ' + JSON.stringify(config.prompt), '"prompt": "divergent top prompt"'),
      replacePrompt(baseText, config.prompt, 'Leak sk-or-v1-abcdefghijklmnopqrstuvwxyz123456'),
    ]) {
      fireEvent.change(input, { target: { value: candidate } })
      expect(screen.getByRole('alert')).toBeTruthy()
      expect(screen.getByRole('button', { name: 'Apply JSON' }).disabled).toBe(true)
      fireEvent.click(screen.getByRole('button', { name: 'Apply JSON' }))
      expect(onApply).not.toHaveBeenCalled()
      expect(input.value).toBe(candidate)
      expect(onPendingChange).toHaveBeenLastCalledWith(true)
    }
  })

  it('handles parent conflicts without clobbering pending text, supports discard and fixed-preset normalization', () => {
    function HarnessHost() {
      const [state, setState] = useState(() => draftConfig({ fixed: true }).state)
      const [pending, setPending] = useState(false)
      const card = state.selection.startsWith('fixed:') ? CARDS[0] : null
      const current = configurationFor(state, { card, fixedPrompt: state.blocks.find((b) => b.type === 'prompt').text })
      return <div>
        <span data-testid="state">{`${pending}:${current.harness.lane}`}</span>
        <button type="button" onClick={() => setState((s) => ({ ...s, model_id: 'anthropic/claude-sonnet-4' }))}>Parent model change</button>
        <ConfigurationEditor configuration={current} onPendingChange={setPending} onApply={(next) => setState((s) => applyConfiguration(s, next).state)} />
      </div>
    }
    render(<HarnessHost />)
    const input = screen.getByLabelText('Configuration JSON')
    fireEvent.change(input, { target: { value: replacePrompt(input.value, 'Inspect, edit, verify, do not modify the tests.', 'Edited JSON prompt while fixed.') } })
    fireEvent.click(screen.getByRole('button', { name: 'Parent model change' }))
    expect(screen.getByText(/fields changed while these JSON edits were pending/i)).toBeTruthy()
    expect(input.value).toContain('Edited JSON prompt while fixed.')
    expect(screen.getByTestId('state').textContent).toBe('true:fixed')

    fireEvent.click(screen.getByRole('button', { name: 'Discard JSON edits' }))
    expect(screen.queryByText(/fields changed while these JSON edits were pending/i)).toBeNull()
    expect(input.value).toContain('"anthropic/claude-sonnet-4"')
    expect(screen.getByTestId('state').textContent).toBe('false:fixed')

    fireEvent.change(input, { target: { value: replacePrompt(input.value, 'Inspect, edit, verify, do not modify the tests.', 'Applied from fixed preset.') } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply JSON' }))
    expect(screen.queryByText(/fields changed while these JSON edits were pending/i)).toBeNull()
    expect(screen.getByTestId('state').textContent).toBe('false:minimal')
  })

  it('preserves edits on failed apply, clears conflict if edited to match parent, and avoids spurious unmount pulses', () => {
    const events = []
    const { config: c1 } = draftConfig({ modelId: 'openai/gpt-5' })
    const { config: c2 } = draftConfig({ modelId: 'google/gemini-2.5-pro' })
    const { rerender, unmount } = render(<ConfigurationEditor configuration={c1} onApply={() => false} onPendingChange={(flag) => events.push(flag)} />)
    const input = screen.getByLabelText('Configuration JSON')
    const baseC1 = input.value
    const dirtyC1 = baseC1.replace('"openai/gpt-5"', '"x-ai/grok-3"')
    fireEvent.change(input, { target: { value: dirtyC1 } })
    events.length = 0

    rerender(<ConfigurationEditor configuration={c2} onApply={() => false} onPendingChange={(flag) => events.push(flag)} />)
    expect(events).not.toContain(false)
    fireEvent.click(screen.getByRole('button', { name: 'Apply JSON' }))
    expect(screen.getByRole('alert')).toBeTruthy()
    expect(input.value).toBe(dirtyC1)

    fireEvent.change(input, { target: { value: baseC1.replace('"openai/gpt-5"', '"google/gemini-2.5-pro"') } })
    expect(screen.queryByText(/fields changed while these JSON edits were pending/i)).toBeNull()
    expect(events.at(-1)).toBe(false)
    fireEvent.change(input, { target: { value: dirtyC1 } })
    unmount()
    expect(events.at(-1)).toBe(false)
  })

  it('refuses an over-1 MiB or prototype-polluting JSON after the pause, keeping the text and blocking Apply', () => {
    vi.useFakeTimers()
    try {
      const onApply = vi.fn(), onPendingChange = vi.fn()
      const { config } = draftConfig()
      render(<ConfigurationEditor configuration={config} onApply={onApply} onPendingChange={onPendingChange} />)
      const input = screen.getByLabelText('Configuration JSON')
      const huge = input.value.replace('"version": 1,', '"version": 1,\n  "padding": "' + 'p'.repeat(1024 * 1024) + '",')
      fireEvent.change(input, { target: { value: huge } })
      expect(screen.getByRole('button', { name: 'Apply JSON' }).disabled).toBe(true)
      expect(onPendingChange).toHaveBeenLastCalledWith(true)
      act(() => { vi.advanceTimersByTime(PARSE_PAUSE_MS) })
      expect(screen.getByRole('alert').textContent).toBe('Choose a JSON configuration file of at most 1 MiB.')
      fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true })
      expect(onApply).not.toHaveBeenCalled()
      const polluted = input.value.replace('"padding": "' + 'p'.repeat(1024 * 1024) + '",', '"__proto__": { "admin": true },')
      fireEvent.change(input, { target: { value: polluted } })
      expect(screen.getByRole('alert')).toBeTruthy()
      expect(({}).admin).toBeUndefined()
      expect(input.value).toBe(polluted)
    } finally { vi.useRealTimers() }
  })

  it('renders markup in a long changed string as inert text in the word diff', () => {
    const long = 'Plain instructions for the agent. '.repeat(8)
    const { config } = draftConfig({ prompt: long })
    const { container } = render(<ConfigurationEditor configuration={config} onApply={vi.fn()} />)
    const input = screen.getByLabelText('Configuration JSON')
    fireEvent.change(input, { target: { value: replacePrompt(input.value, long, long + '<img src=x onerror=alert(1)><script>alert(2)</script>') } })
    expect(container.querySelector('.rg-json-editor-strdiff img, .rg-json-editor-strdiff script')).toBeNull()
    expect(container.querySelector('.rg-json-editor-strdiff ins').textContent).toContain('<script>alert(2)</script>')
  })
})
