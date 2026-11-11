// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ConfigurationEditor } from './ConfigurationEditor'
import { initialComposer, configurationFor } from './views/harness-composer-state'
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
