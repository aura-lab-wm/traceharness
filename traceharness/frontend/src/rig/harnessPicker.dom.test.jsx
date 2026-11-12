// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { HarnessPicker } from './harnessPicker'

const options = [
  { value: 'custom', label: 'Custom harness', group: 'TraceHarness', description: 'Edit tools and limits', meta: '7 configuration blocks' },
  { value: 'fixed:codex', label: 'Codex stand-in', group: 'Presets', description: 'TraceHarness shell' },
  { value: 'native:codex', label: 'Native Codex', group: 'Native agents', status: 'Not connected', description: 'Prepare native instructions' },
  { value: 'unavailable', label: 'Unavailable choice', disabled: true, group: 'Native agents' },
]
function TestPicker({ onChange = () => {}, ...props }) {
  const [value, setValue] = useState('custom')
  return <HarnessPicker label="Harness" options={options} value={value} onChange={(next) => { setValue(next); onChange(next) }} {...props} />
}
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('searchable harness workspace picker', () => {
  it('opens a grouped list and chooses a stable ID without conflating availability with editability', () => {
    const changed = vi.fn(); render(<TestPicker onChange={changed} hint="Pick an engine" />)
    const input = screen.getByRole('combobox', { name: 'Harness' })
    expect(input.value).toBe('Custom harness')
    fireEvent.click(input)
    expect(screen.getByRole('group', { name: 'Presets' })).toBeTruthy()
    fireEvent.click(screen.getByRole('option', { name: 'Native Codex' }))
    expect(changed).toHaveBeenCalledWith('native:codex')
    expect(input.value).toBe('Native Codex')
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(document.activeElement).toBe(input)
  })
  it('searches labels, identifiers and metadata and handles an empty result without changing selection', () => {
    const changed = vi.fn(); render(<TestPicker onChange={changed} />)
    const input = screen.getByRole('combobox', { name: 'Harness' })
    fireEvent.click(input); fireEvent.change(input, { target: { value: '7 configuration' } })
    expect(screen.getAllByRole('option')).toHaveLength(1)
    expect(screen.getByRole('option', { name: 'Custom harness' })).toBeTruthy()
    fireEvent.change(input, { target: { value: 'native:codex' } })
    expect(screen.getAllByRole('option')).toHaveLength(1)
    expect(screen.getByRole('option', { name: 'Native Codex' })).toBeTruthy()
    fireEvent.change(input, { target: { value: 'no such runtime' } })
    expect(screen.getByText('No matching options')).toBeTruthy()
    expect(input.getAttribute('aria-activedescendant')).toBeNull()
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(changed).not.toHaveBeenCalled()
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(input.value).toBe('Custom harness')
  })
  it('supports arrow/Home/End selection and skips disabled choices', () => {
    const changed = vi.fn(); render(<TestPicker onChange={changed} />)
    const input = screen.getByRole('combobox', { name: 'Harness' })
    input.focus(); fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'End' })
    expect(document.getElementById(input.getAttribute('aria-activedescendant')).textContent).toContain('Native Codex')
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(document.getElementById(input.getAttribute('aria-activedescendant')).textContent).toContain('Custom harness')
    fireEvent.keyDown(input, { key: 'ArrowUp' }); fireEvent.keyDown(input, { key: 'Home' }); fireEvent.keyDown(input, { key: 'ArrowDown' }); fireEvent.keyDown(input, { key: 'Enter' })
    expect(changed).toHaveBeenCalledExactlyOnceWith('fixed:codex')
    expect(input.value).toBe('Codex stand-in')
  })
  it('does not select disabled options, and disabled controls cannot open', () => {
    const changed = vi.fn(); const { rerender } = render(<TestPicker onChange={changed} />)
    fireEvent.click(screen.getByRole('combobox', { name: 'Harness' }))
    fireEvent.click(screen.getByRole('option', { name: 'Unavailable choice' }))
    expect(changed).not.toHaveBeenCalled()
    rerender(<TestPicker onChange={changed} disabled />)
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(screen.getByRole('combobox', { name: 'Harness' }).disabled).toBe(true)
  })
  it('closes on outside pointer and Tab without committing typed text', () => {
    const changed = vi.fn(); render(<TestPicker onChange={changed} />)
    const input = screen.getByRole('combobox', { name: 'Harness' })
    fireEvent.click(input); fireEvent.change(input, { target: { value: 'native' } }); fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('listbox')).toBeNull(); expect(input.value).toBe('Custom harness')
    fireEvent.click(input); fireEvent.keyDown(input, { key: 'Tab' })
    expect(screen.queryByRole('listbox')).toBeNull(); expect(changed).not.toHaveBeenCalled()
  })
  it('uses unique IDs across controls and retains a missing selection as an explicit identifier', () => {
    render(<><TestPicker /><HarnessPicker label="Model" value="missing/model" options={[]} onChange={() => {}} /></>)
    const first = screen.getByRole('combobox', { name: 'Harness' }); const second = screen.getByRole('combobox', { name: 'Model' })
    expect(first.id).not.toBe(second.id); expect(second.value).toBe('missing/model')
    fireEvent.click(second); expect(screen.getByText('No matching options')).toBeTruthy()
  })
  it('keeps choices above a low mobile control and repositions when the visible viewport grows', () => {
    const viewport = new EventTarget()
    Object.assign(viewport, { offsetTop: 0, height: 340 })
    vi.stubGlobal('visualViewport', viewport)
    const original = HTMLElement.prototype.getBoundingClientRect
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
      if (this.classList.contains('rg-harness-picker-control')) return { top: 240, bottom: 288, height: 48, left: 16, right: 304, width: 288 }
      if (this.classList.contains('rg-harness-picker')) return { top: 216, bottom: 312, height: 96, left: 16, right: 304, width: 288 }
      return original.call(this)
    })
    const changed = vi.fn(); render(<TestPicker onChange={changed} />)
    const input = screen.getByRole('combobox', { name: 'Harness' })
    fireEvent.click(input)
    const panel = screen.getByRole('listbox').parentElement
    expect(panel.dataset.placement).toBe('above')
    expect(parseFloat(panel.style.maxHeight)).toBeLessThan(240)
    expect(panel.style.top).toBe('auto')
    viewport.height = 800; fireEvent(viewport, new Event('resize'))
    expect(panel.dataset.placement).toBe('below')
    expect(parseFloat(panel.style.maxHeight)).toBeGreaterThan(300)
    fireEvent.keyDown(input, { key: 'ArrowDown' }); fireEvent.keyDown(input, { key: 'Enter' })
    expect(changed).toHaveBeenCalledWith('fixed:codex')
    expect(document.activeElement).toBe(input)
  })
  it('does not scroll a partially visible option away from the pointer before selection', () => {
    const original = HTMLElement.prototype.getBoundingClientRect
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
      if (this.classList.contains('rg-harness-picker-list')) return { top: 100, bottom: 200, height: 100 }
      if (this.getAttribute('role') === 'option') return this.getAttribute('aria-label') === 'Native Codex'
        ? { top: 190, bottom: 250, height: 60 } : { top: 110, bottom: 160, height: 50 }
      return original.call(this)
    })
    const changed = vi.fn(); render(<TestPicker onChange={changed} />)
    const input = screen.getByRole('combobox', { name: 'Harness' })
    input.focus(); fireEvent.click(screen.getByRole('button', { name: 'Show harness options' }))
    const list = screen.getByRole('listbox')
    const option = screen.getByRole('option', { name: 'Native Codex' })
    fireEvent.mouseMove(option)
    // Pointer movement precedes browser hit testing for the subsequent click.
    // Scrolling here moves a partially visible row away from that pointer.
    expect(list.scrollTop).toBe(0)
    fireEvent.pointerDown(option); fireEvent.mouseDown(option)
    fireEvent.mouseUp(option); fireEvent.click(option)
    expect(changed).toHaveBeenCalledExactlyOnceWith('native:codex')
    expect(input.value).toBe('Native Codex')
    expect(screen.queryByRole('listbox')).toBeNull()

    fireEvent.click(input)
    const reopenedList = screen.getByRole('listbox')
    reopenedList.scrollTop = 0
    fireEvent.mouseMove(screen.getByRole('option', { name: 'Native Codex' }))
    fireEvent.keyDown(input, { key: 'End' })
    expect(reopenedList.scrollTop).toBe(50)
    expect(document.getElementById(input.getAttribute('aria-activedescendant')).getAttribute('aria-label')).toBe('Native Codex')
  })
  it('keeps a pressed row stationary through pointerup when choices arrive before click', () => {
    const changed = vi.fn(); const { rerender } = render(<TestPicker onChange={changed} />)
    fireEvent.click(screen.getByRole('combobox', { name: 'Harness' }))
    const option = screen.getByRole('option', { name: 'Codex stand-in' })
    fireEvent.pointerDown(option, { pointerId: 1, button: 0, pointerType: 'mouse', isPrimary: true })
    expect(changed).not.toHaveBeenCalled()
    const updated = [options[0], { value: 'saved:new', label: 'New saved harness', group: 'Saved' },
      { ...options[1], description: 'A longer catalog description that would move lower rows' }, ...options.slice(2)]
    rerender(<TestPicker onChange={changed} options={updated} />)
    // Inserting the saved group here previously moved the pressed row before native hit testing.
    expect(screen.queryByRole('option', { name: 'New saved harness' })).toBeNull()
    expect(option.textContent).toContain('TraceHarness shell')
    fireEvent.pointerUp(option, { pointerId: 1, pointerType: 'mouse' })
    expect(screen.queryByRole('option', { name: 'New saved harness' })).toBeNull()
    fireEvent.click(option)
    expect(changed).toHaveBeenCalledExactlyOnceWith('fixed:codex')
    expect(screen.getByRole('combobox', { name: 'Harness' }).value).toBe('Codex stand-in')
    fireEvent.click(screen.getByRole('combobox', { name: 'Harness' }))
    expect(screen.getByRole('option', { name: 'New saved harness' })).toBeTruthy()
    expect(screen.getByRole('option', { name: 'Codex stand-in' }).textContent).toContain('A longer catalog description')
  })
  it.each(['disabled', 'removed'])('rejects a pressed choice that becomes %s before release', (change) => {
    const changed = vi.fn(); const { rerender } = render(<TestPicker onChange={changed} />)
    fireEvent.click(screen.getByRole('combobox', { name: 'Harness' }))
    const option = screen.getByRole('option', { name: 'Native Codex' })
    fireEvent.pointerDown(option, { pointerId: 2, button: 0, pointerType: 'touch', isPrimary: true })
    const updated = change === 'removed' ? options.filter((row) => row.value !== 'native:codex')
      : options.map((row) => row.value === 'native:codex' ? { ...row, disabled: true } : row)
    rerender(<TestPicker onChange={changed} options={updated} />)
    expect(screen.getByRole('option', { name: 'Native Codex' })).toBe(option)
    fireEvent.pointerUp(option, { pointerId: 2, pointerType: 'touch' }); fireEvent.click(option)
    expect(changed).not.toHaveBeenCalled()
    expect(screen.getByRole('combobox', { name: 'Harness' }).getAttribute('aria-expanded')).toBe('true')
    if (change === 'removed') expect(screen.queryByRole('option', { name: 'Native Codex' })).toBeNull()
    else expect(screen.getByRole('option', { name: 'Native Codex' }).getAttribute('aria-disabled')).toBe('true')
  })
  it('releases delayed choices on touch cancellation without preventing scrolling or selecting', () => {
    const changed = vi.fn(); const { rerender } = render(<TestPicker onChange={changed} />)
    const input = screen.getByRole('combobox', { name: 'Harness' })
    fireEvent.click(input)
    const option = screen.getByRole('option', { name: 'Native Codex' })
    const down = new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 3, button: 0, pointerType: 'touch', isPrimary: true })
    fireEvent(option, down)
    expect(down.defaultPrevented).toBe(false)
    rerender(<TestPicker onChange={changed} options={[...options, { value: 'new', label: 'New choice' }]} />)
    expect(screen.queryByRole('option', { name: 'New choice' })).toBeNull()
    fireEvent.pointerCancel(option, { pointerId: 3, pointerType: 'touch' })
    expect(screen.getByRole('option', { name: 'New choice' })).toBeTruthy()
    expect(changed).not.toHaveBeenCalled()
    fireEvent.keyDown(input, { key: 'End' }); fireEvent.keyDown(input, { key: 'Enter' })
    expect(changed).toHaveBeenCalledExactlyOnceWith('new')
  })
  it('releases choices after an outside release, window blur, or dismissal without selecting', () => {
    const changed = vi.fn(); const { rerender, unmount } = render(<TestPicker onChange={changed} />)
    const input = screen.getByRole('combobox', { name: 'Harness' })
    fireEvent.click(input)
    fireEvent.pointerDown(screen.getByRole('option', { name: 'Native Codex' }), { pointerId: 4, button: 0, isPrimary: true })
    rerender(<TestPicker onChange={changed} options={[...options, { value: 'new', label: 'New choice' }]} />)
    fireEvent.pointerUp(document.body, { pointerId: 4 })
    expect(screen.getByRole('option', { name: 'New choice' })).toBeTruthy()
    fireEvent.pointerDown(screen.getByRole('option', { name: 'Native Codex' }), { pointerId: 5, button: 0, isPrimary: true })
    rerender(<TestPicker onChange={changed} options={[...options, { value: 'latest', label: 'Latest choice' }]} />)
    fireEvent.blur(window)
    expect(screen.getByRole('option', { name: 'Latest choice' })).toBeTruthy()
    fireEvent.pointerDown(screen.getByRole('option', { name: 'Native Codex' }), { pointerId: 6, button: 0, isPrimary: true })
    rerender(<TestPicker onChange={changed} options={options} />)
    fireEvent.keyDown(input, { key: 'Escape' }); fireEvent.click(input)
    expect(screen.queryByRole('option', { name: 'Latest choice' })).toBeNull()
    expect(changed).not.toHaveBeenCalled()
    unmount()
    fireEvent.pointerCancel(document.body, { pointerId: 6 })
  })
  it('repositions for a scrollport-only resize and disconnects observation on close', () => {
    const observers = []
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback) { this.callback = callback; this.targets = new Set(); this.disconnect = vi.fn(); observers.push(this) }
      observe(target) { this.targets.add(target) }
    })
    vi.stubGlobal('innerHeight', 900)
    let scrollportBottom = 700
    const original = HTMLElement.prototype.getBoundingClientRect
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
      if (this.dataset.testScrollport) return { top: 60, bottom: scrollportBottom, height: scrollportBottom - 60, left: 0, right: 400, width: 400 }
      if (this.classList.contains('rg-harness-picker-control')) return { top: 280, bottom: 324, height: 44, left: 16, right: 384, width: 368 }
      if (this.classList.contains('rg-harness-picker')) return { top: 256, bottom: 352, height: 96, left: 16, right: 384, width: 368 }
      return original.call(this)
    })
    const { unmount } = render(<div data-test-scrollport="yes" style={{ overflowY: 'auto' }}><TestPicker /></div>)
    const input = screen.getByRole('combobox', { name: 'Harness' })
    fireEvent.click(input)
    const panel = screen.getByRole('listbox').parentElement
    expect(panel.dataset.placement).toBe('below'); expect(parseFloat(panel.style.maxHeight)).toBe(360)
    scrollportBottom = 600
    act(() => observers.forEach((observer) => observer.callback([])))
    expect(parseFloat(panel.style.maxHeight)).toBe(260)
    expect(input.getAttribute('aria-expanded')).toBe('true')
    scrollportBottom = 700
    act(() => observers.forEach((observer) => observer.callback([])))
    expect(parseFloat(panel.style.maxHeight)).toBe(360)
    const observed = observers.find((observer) => observer.targets.has(input.closest('[data-test-scrollport]')))
    expect([...observed.targets].some((target) => panel.contains(target))).toBe(false)
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(observed.disconnect).toHaveBeenCalledOnce()
    unmount()
  })
  it('respects the workbench scrollport even when the browser has more room', () => {
    vi.stubGlobal('innerHeight', 900)
    const original = HTMLElement.prototype.getBoundingClientRect
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
      if (this.dataset.testScrollport) return { top: 60, bottom: 360, height: 300, left: 0, right: 400, width: 400 }
      if (this.classList.contains('rg-harness-picker-control')) return { top: 280, bottom: 324, height: 44, left: 16, right: 384, width: 368 }
      if (this.classList.contains('rg-harness-picker')) return { top: 256, bottom: 352, height: 96, left: 16, right: 384, width: 368 }
      return original.call(this)
    })
    render(<div data-test-scrollport="yes" style={{ overflowY: 'auto' }}><TestPicker /></div>)
    fireEvent.click(screen.getByRole('combobox', { name: 'Harness' }))
    const panel = screen.getByRole('listbox').parentElement
    expect(panel.dataset.placement).toBe('above')
    expect(parseFloat(panel.style.maxHeight)).toBeLessThan(220)
    expect(parseFloat(panel.style.maxHeight)).toBeGreaterThan(100)
  })
})
