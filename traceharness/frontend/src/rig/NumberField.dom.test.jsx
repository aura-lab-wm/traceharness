// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { NumberField, SAID_MS, changedLine, checkNumber } from './NumberField.jsx'

afterEach(() => { cleanup(); vi.useRealTimers() })

function Box({ start = 3, onValue = () => {}, ...props }) {
  const [v, setV] = useState(start)
  return <NumberField label="Runs per task" min={1} max={20} noun="runs per task" value={v} onChange={(x) => { setV(x); onValue(x) }} el="reps" {...props} />
}
const box = () => screen.getByRole('spinbutton', { name: 'Runs per task' })
const line = () => document.getElementById(box().getAttribute('aria-describedby'))

describe('checkNumber', () => {
  it('takes a number in range as typed, holds the rest to the nearest limit and keeps the old value for text that is no number', () => {
    expect(checkNumber('7', { min: 1, max: 20, prev: 3 })).toEqual({ value: 7, why: null })
    expect(checkNumber('30', { min: 1, max: 20, prev: 3 })).toEqual({ value: 20, why: 'max' })
    expect(checkNumber('-4', { min: 1, max: 20, prev: 3 })).toEqual({ value: 1, why: 'min' })
    expect(checkNumber('2.5', { min: 1, max: 20, prev: 3 })).toEqual({ value: 3, why: 'whole' })
    expect(checkNumber('0.7', { min: 0, max: 2, whole: false, prev: 1 })).toEqual({ value: 0.7, why: null })
    expect(checkNumber('1,000', { min: 1, max: 5000, prev: 3 })).toEqual({ value: 1000, why: null })
    expect(checkNumber('abc', { min: 1, max: 20, prev: 3 })).toEqual({ value: 3, why: 'nan' })
    expect(checkNumber('', { min: 1, max: 20, prev: 3 })).toEqual({ value: 3, why: 'empty' })
    expect(checkNumber('', { min: 1, max: 20, prev: 3, allowEmpty: true })).toEqual({ value: '', why: null })
  })
  it('says in one short line why a value changed', () => {
    expect(changedLine('max', { value: 20, min: 1, max: 20, noun: 'runs per task' })).toBe('Up to 20 runs per task, so this is set to 20.')
    expect(changedLine('min', { value: 30, min: 30, max: 3600, noun: 'seconds' })).toBe('At least 30 seconds, so this is set to 30.')
    expect(changedLine('whole', { value: 3, min: 1, max: 20, typed: '2.5' })).toBe('Whole numbers only, so 2.5 is set to 3.')
    expect(changedLine('nan', { value: 3, min: 1, max: 20 })).toBe('Enter a number from 1 to 20; this is back to 3.')
    expect(changedLine(null, { value: 3, min: 1, max: 20 })).toBe('')
  })
})

describe('NumberField', () => {
  it('never changes the value under the cursor while typing; nothing is sent until the box is left', () => {
    const onValue = vi.fn()
    render(<Box onValue={onValue} />)
    for (const t of ['3', '30', '300', '']) {
      fireEvent.change(box(), { target: { value: t } })
      expect(box().value).toBe(t)
    }
    fireEvent.change(box(), { target: { value: '12' } })
    expect(onValue).not.toHaveBeenCalled()
    fireEvent.blur(box())
    expect(onValue).toHaveBeenCalledWith(12)
    expect(box().value).toBe('12')
  })

  it('on leaving, holds an out-of-range value to the nearest limit and says so under the box, then fades back to the range', () => {
    vi.useFakeTimers()
    const { container } = render(<Box />)
    expect(line().textContent).toBe('1–20')
    fireEvent.change(box(), { target: { value: '30' } })
    fireEvent.blur(box())
    expect(box().value).toBe('20')
    const said = container.querySelector('[data-el="reps-clamped"]')
    expect(said.textContent).toBe('Up to 20 runs per task, so this is set to 20.')
    expect(said.getAttribute('role')).toBe('status')
    act(() => { vi.advanceTimersByTime(SAID_MS) })
    expect(container.querySelector('[data-el="reps-clamped"]').className).toContain('fade')
    act(() => { vi.advanceTimersByTime(400) })
    expect(container.querySelector('[data-el="reps-clamped"]')).toBeNull()
    expect(line().textContent).toBe('1–20')
  })

  it('Enter checks the value like leaving the box does; Escape puts back the value before typing', () => {
    render(<Box />)
    fireEvent.change(box(), { target: { value: '0' } })
    fireEvent.keyDown(box(), { key: 'Enter' })
    expect(box().value).toBe('1')
    fireEvent.change(box(), { target: { value: '9' } })
    fireEvent.keyDown(box(), { key: 'Escape' })
    expect(box().value).toBe('1')
  })

  it('steps with − and +, which stop at the limits and are not tab stops', () => {
    render(<Box start={19} />)
    const plus = screen.getByRole('button', { name: 'Increase Runs per task' })
    const minus = screen.getByRole('button', { name: 'Decrease Runs per task' })
    expect(plus.tabIndex).toBe(-1)
    expect(minus.tabIndex).toBe(-1)
    fireEvent.click(plus)
    expect(box().value).toBe('20')
    expect(plus.disabled).toBe(true)
    expect(minus.disabled).toBe(false)
    fireEvent.click(minus)
    expect(box().value).toBe('19')
    expect(plus.disabled).toBe(false)
  })

  it('steps from the keyboard: arrows by one, Shift+arrow and Page keys by ten, Home and End to the limits', () => {
    render(<Box start={5} />)
    fireEvent.keyDown(box(), { key: 'ArrowUp' })
    expect(box().value).toBe('6')
    fireEvent.keyDown(box(), { key: 'ArrowDown' })
    expect(box().value).toBe('5')
    fireEvent.keyDown(box(), { key: 'ArrowUp', shiftKey: true })
    expect(box().value).toBe('15')
    fireEvent.keyDown(box(), { key: 'ArrowUp', shiftKey: true })
    expect(box().value).toBe('20')                                       // held at the limit
    fireEvent.keyDown(box(), { key: 'PageDown' })
    expect(box().value).toBe('10')
    fireEvent.keyDown(box(), { key: 'Home' })
    expect(box().value).toBe('1')
    expect(screen.getByRole('button', { name: 'Decrease Runs per task' }).disabled).toBe(true)
    fireEvent.keyDown(box(), { key: 'End' })
    expect(box().value).toBe('20')
    expect(box().getAttribute('aria-valuenow')).toBe('20')
  })

  it('a decimal box steps by its nudge without floating-point noise', () => {
    function T() { const [v, setV] = useState(0.2); return <NumberField label="Temperature" min={0} max={2} step="any" value={v} onChange={setV} /> }
    render(<T />)
    const t = screen.getByRole('spinbutton', { name: 'Temperature' })
    fireEvent.keyDown(t, { key: 'ArrowUp' })
    expect(t.value).toBe('0.3')
    fireEvent.change(t, { target: { value: '0.75' } })
    fireEvent.blur(t)
    expect(t.value).toBe('0.75')
  })

  it('a box that may be empty stays empty when cleared, and a standing problem is shown in the error style', () => {
    function T() { const [v, setV] = useState(60); return <NumberField label="Time limit" min={30} max={3600} allowEmpty value={v} onChange={setV} issue={v === '' ? 'Enter a value.' : undefined} /> }
    render(<T />)
    const t = screen.getByRole('spinbutton', { name: 'Time limit' })
    fireEvent.change(t, { target: { value: '' } })
    fireEvent.blur(t)
    expect(t.value).toBe('')
    expect(t.getAttribute('aria-invalid')).toBe('true')
    expect(document.getElementById(t.getAttribute('aria-describedby')).textContent).toBe('Enter a value.')
  })

  it('has no browser spinner: a text box with the spinbutton role, right-aligned figures in the stylesheet', async () => {
    render(<Box />)
    expect(box().getAttribute('type')).toBe('text')
    expect(box().getAttribute('inputmode')).toBe('numeric')
    const { readFileSync } = await import('node:fs')
    const css = readFileSync(`${process.cwd()}/src/rig/NumberField.css`, 'utf8')
    expect(css).toMatch(/\.rg-numf-in\{[^}]*text-align:right[^}]*tabular-nums/)
  })
})
