// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { ThresholdSlider, keyStep, nearestPoint } from './ThresholdSlider.jsx'

afterEach(cleanup)
const POINTS = [0.3, 0.5, 0.6, 0.7]

function Host({ onPreview = () => {}, onCommit = () => {} }) {
  const [i, setI] = useState(1)
  return <ThresholdSlider points={POINTS} index={i} format={(t) => t.toFixed(2)} label="Threshold" onPreview={onPreview} onCommit={(k) => { setI(k); onCommit(k) }} />
}
const range = () => screen.getByRole('slider', { name: 'Threshold' })

describe('ThresholdSlider', () => {
  it('runs in hundredths of a point, so the thumb follows the pointer between the points', () => {
    render(<Host />)
    expect(range().getAttribute('max')).toBe('300')
    expect(range().value).toBe('100')
    expect(range().getAttribute('aria-valuetext')).toBe('0.50')
    expect(nearestPoint(149, 4)).toBe(1)
    expect(nearestPoint(151, 4)).toBe(2)
    expect(nearestPoint(-20, 4)).toBe(0)
    expect(nearestPoint(999, 4)).toBe(3)
  })

  it('while dragging, only says which point is nearest (once per change); letting go commits and snaps to it', () => {
    const onPreview = vi.fn(), onCommit = vi.fn()
    const { container } = render(<Host onPreview={onPreview} onCommit={onCommit} />)
    for (const v of [110, 130, 160, 170, 240, 260]) fireEvent.change(range(), { target: { value: String(v) } })
    expect(onPreview.mock.calls.map((c) => c[0])).toEqual([2, 3])
    expect(onCommit).not.toHaveBeenCalled()
    expect(container.querySelector('.rg-thr').className).toContain('drag')
    expect(range().getAttribute('aria-valuetext')).toBe('0.70')
    expect(container.querySelector('.rg-thr-tip').textContent).toBe('0.70')   // the value rides beside the thumb
    fireEvent.pointerUp(window)
    expect(onCommit).toHaveBeenCalledTimes(1)
    expect(onCommit).toHaveBeenCalledWith(3)
    expect(range().value).toBe('300')                                          // snapped onto the point
    expect(container.querySelector('.rg-thr').className).not.toContain('drag')
  })

  it('arrow keys step one operating point, Home and End go to the ends, and nothing steps past them', () => {
    const onCommit = vi.fn()
    render(<Host onCommit={onCommit} />)
    fireEvent.keyDown(range(), { key: 'ArrowRight' })
    expect(range().value).toBe('200')
    fireEvent.keyDown(range(), { key: 'ArrowUp' })
    expect(range().value).toBe('300')
    fireEvent.keyDown(range(), { key: 'ArrowRight' })
    expect(range().value).toBe('300')
    fireEvent.keyDown(range(), { key: 'Home' })
    expect(range().value).toBe('0')
    fireEvent.keyDown(range(), { key: 'ArrowLeft' })
    expect(range().value).toBe('0')
    expect(onCommit.mock.calls.map((c) => c[0])).toEqual([2, 3, 0])
    expect(keyStep('Tab', 1, 4)).toBeNull()
    expect(keyStep('End', 1, 4)).toBe(3)
  })
})
