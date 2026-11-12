// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ConfigurationEditor, PARSE_IMMEDIATE_BYTES, PARSE_PAUSE_MS, differences } from './ConfigurationEditor'
import { initialComposer, configurationFor, parseConfiguration } from './views/harness-composer-state'
vi.mock('./views/harness-composer-state', async (original) => {
  const actual = await original()
  return { ...actual, parseConfiguration: vi.fn(actual.parseConfiguration) }
})
const parseSpy = parseConfiguration
afterEach(() => { cleanup(); sessionStorage.clear() })
const configuration = () => configurationFor(initialComposer(), {})
const input = () => screen.getByRole('textbox', { name: 'Configuration JSON' })

it('applies a complete valid JSON draft explicitly, preserving signed zero and nested settings', async () => {
  const value=configuration();value.harness.blocks.find(block=>block.type==='sampling').temperature=-0
  const apply=vi.fn(),pending=vi.fn()
  const {rerender}=render(<ConfigurationEditor configuration={value} onApply={apply} onPendingChange={pending} />)
  expect(input().value).toContain('-0.0')
  const edited=input().value.split(JSON.stringify(value.prompt)).join(JSON.stringify('A new prompt'))
  fireEvent.change(input(),{target:{value:edited}})
  expect(pending).toHaveBeenLastCalledWith(true)
  expect(apply).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button',{name:'Apply JSON',exact:true}))
  expect(apply).toHaveBeenCalledWith(expect.objectContaining({prompt:'A new prompt'}))
  expect(Object.is(apply.mock.calls[0][0].harness.blocks.find(block=>block.type==='sampling').temperature,-0)).toBe(true)
  rerender(<ConfigurationEditor configuration={apply.mock.calls[0][0]} onApply={apply} onPendingChange={pending} />)
  await waitFor(()=>expect(pending).toHaveBeenLastCalledWith(false))
})
it('keeps invalid or unknown JSON unapplied and blocks pending edits until explicitly discarded', () => {
  const value=configuration(),apply=vi.fn(),pending=vi.fn()
  render(<ConfigurationEditor configuration={value} onApply={apply} onPendingChange={pending} />)
  for(const text of ['{not JSON',JSON.stringify({...value,unsupported_loop:true})]){
    fireEvent.change(input(),{target:{value:text}})
    expect(screen.getByRole('button',{name:'Apply JSON',exact:true}).disabled).toBe(true)
    expect(pending).toHaveBeenLastCalledWith(true)
    expect(apply).not.toHaveBeenCalled()
  }
  fireEvent.click(screen.getByRole('button',{name:'Discard JSON edits',exact:true}))
  expect(JSON.parse(input().value)).toEqual(value)
  expect(pending).toHaveBeenLastCalledWith(false)
})
it('retains pending text across parent field changes and clearly identifies the conflict', () => {
  const value=configuration(),apply=vi.fn(),pending=vi.fn()
  const {rerender}=render(<ConfigurationEditor configuration={value} onApply={apply} onPendingChange={pending} />)
  const text=input().value.replace('"max_cost_usd": 1','"max_cost_usd": 2')
  fireEvent.change(input(),{target:{value:text}})
  const next={...value,limits:{...value.limits,wall_time_seconds:300}}
  rerender(<ConfigurationEditor configuration={next} onApply={apply} onPendingChange={pending} />)
  expect(input().value).toBe(text)
  expect(screen.getByText(/fields changed while/i)).toBeTruthy()
  fireEvent.click(screen.getByRole('button',{name:'Discard JSON edits',exact:true}))
  expect(JSON.parse(input().value).limits.wall_time_seconds).toBe(300)
  expect(apply).not.toHaveBeenCalled()
})

describe('F18: keyed comparison, word diff, size, shortcut and pause-parsing', () => {
  const override = (id) => ({ block_id: id, baseline_sha256: id.repeat(64).slice(0, 64), action: 'disable' })
  it('compares profile overrides by block id, so inserting one override is one change', () => {
    const before = { native_prompt_profile: { overrides: [override('a'), override('c')] } }
    const after = { native_prompt_profile: { overrides: [override('a'), override('b'), override('c')] } }
    const rows = differences(before, after)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ path: '$.native_prompt_profile.overrides[block_id="b"]', before: undefined })
    expect(differences({ list: [1, 2] }, { list: [0, 1, 2] })).toHaveLength(3)
  })

  const withPrompt = (text) => { const state = initialComposer(); return configurationFor({ ...state, blocks: state.blocks.map((block) => block.type === 'prompt' ? { ...block, text } : block) }, {}) }
  const swap = (from, to) => input().value.split(JSON.stringify(from)).join(JSON.stringify(to))
  it('renders a changed long string as a word-level diff with text markers, and shows the exact size', () => {
    const long = 'Inspect the repository carefully. '.repeat(10), value = withPrompt(long)
    render(<ConfigurationEditor configuration={value} onApply={vi.fn()} />)
    expect(screen.getByText(/^As submitted [\d,]+ of 1,048,576 bytes \(exact, 1 MiB request limit\)$/)).toBeTruthy()
    fireEvent.change(input(), { target: { value: swap(long, long.replace('carefully', 'quickly')) } })
    expect(screen.getByText('2 changed configuration fields')).toBeTruthy()
    const diff = screen.getAllByLabelText('Word-level difference')[0]
    expect(diff.querySelector('del').textContent).toBe('[removed: carefully]')
    expect(diff.querySelector('ins').textContent).toBe('[added: quickly]')
  })

  it('applies with Ctrl+Enter or Cmd+Enter from the editor', () => {
    const value = configuration(), apply = vi.fn()
    render(<ConfigurationEditor configuration={value} onApply={apply} />)
    fireEvent.change(input(), { target: { value: input().value.split(JSON.stringify(value.prompt)).join(JSON.stringify('Shortcut prompt')) } })
    fireEvent.keyDown(input(), { key: 'Enter', metaKey: true })
    expect(apply).toHaveBeenCalledWith(expect.objectContaining({ prompt: 'Shortcut prompt' }))
  })

  it('parses a large configuration once per pause and never applies stale text', () => {
    vi.useFakeTimers()
    try {
      let prompt = 'x'.repeat(PARSE_IMMEDIATE_BYTES + 1000)
      const value = withPrompt(prompt), apply = vi.fn(), pending = vi.fn()
      const { rerender } = render(<ConfigurationEditor configuration={value} onApply={apply} onPendingChange={pending} />)
      expect(screen.queryByRole('alert')).toBeNull()
      const calls = parseSpy.mock.calls.length
      for (const word of ['a', 'b', 'c']) {
        fireEvent.change(input(), { target: { value: swap(prompt, word + prompt) } })
        prompt = word + prompt
        act(() => { vi.advanceTimersByTime(PARSE_PAUSE_MS - 50) })
      }
      expect(parseSpy.mock.calls.length).toBe(calls)
      expect(screen.getByText('Checking the JSON when you pause typing…')).toBeTruthy()
      expect(screen.getByRole('button', { name: 'Apply JSON' }).disabled).toBe(true)
      expect(pending).toHaveBeenLastCalledWith(true)
      act(() => { vi.advanceTimersByTime(PARSE_PAUSE_MS) })
      expect(parseSpy.mock.calls.length).toBe(calls + 1)
      expect(screen.getByText(/^Unapplied JSON edits/)).toBeTruthy()
      fireEvent.click(screen.getByRole('button', { name: 'Apply JSON' }))
      expect(apply.mock.calls[0][0].prompt.startsWith('cbax')).toBe(true)
      rerender(<ConfigurationEditor configuration={apply.mock.calls[0][0]} onApply={apply} onPendingChange={pending} />)
      // Ctrl+Enter during a pause parses the exact text in the box, not the last settled one
      fireEvent.change(input(), { target: { value: swap(apply.mock.calls[0][0].prompt, 'd' + apply.mock.calls[0][0].prompt.slice(1)) } })
      fireEvent.keyDown(input(), { key: 'Enter', ctrlKey: true })
      expect(apply.mock.calls[1][0].prompt.startsWith('dbax')).toBe(true)
    } finally { vi.useRealTimers() }
  })
})
