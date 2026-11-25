// @vitest-environment jsdom
/* A layer with nothing to mark in this run (Repeats 0, Cut outputs 0, After the fix 0) does not look like a button
   that does nothing: it is shown disabled, says "none in this run", and a press changes nothing. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, cleanup } from '@testing-library/react'
import { LayerToggles } from './StepRows'

afterEach(() => cleanup())

describe('the layer chips', () => {
  it('an empty layer is disabled with a hint; the others keep their count and toggle', () => {
    const onChange = vi.fn()
    const { container } = render(<LayerToggles layers={new Set(['p'])} onChange={onChange} counts={{ r: 0, c: 3, f: 0 }} />)
    const b = Object.fromEntries([...container.querySelectorAll('button')].map((x) => [x.textContent.replace(/\d+$/, ''), x]))
    for (const name of ['Repeats', 'After the fix']) {
      expect(b[name].getAttribute('aria-disabled')).toBe('true')
      expect(b[name].getAttribute('data-hint')).toBe('None in this run')
      expect(b[name].classList.contains('none')).toBe(true)
      expect(b[name].hasAttribute('aria-pressed')).toBe(false)
      fireEvent.click(b[name])
    }
    expect(onChange).not.toHaveBeenCalled()
    expect(b['Cut outputs'].getAttribute('aria-disabled')).toBeNull()
    expect(b['Cut outputs'].querySelector('.n').textContent).toBe('3')
    fireEvent.click(b['Cut outputs'])
    expect([...onChange.mock.calls[0][0]].sort()).toEqual(['c', 'p'])
    // Phase has no count: it is never empty
    expect(b.Phase.getAttribute('aria-disabled')).toBeNull()
  })
})
