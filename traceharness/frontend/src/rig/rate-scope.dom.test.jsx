// @vitest-environment jsdom
/* Which runs a pass rate is of.
   Datasets: a dataset's rate is pooled over all its models and harnesses, and says so in its row ("all 2 models ·
   2 harnesses"); a hover card on the rate says what is pooled and links to the rates per model and harness. A count of
   models or harnesses is a number of its own, never glued to a cut-off name.
   Outcomes: the headline is one model under one harness, and says so beside the dataset's pooled rate. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent } from '@testing-library/react'
import { renderRig, resetRig, rigFixture } from '../../test/rig-testing'
import { OPEN_DELAY } from './hover-intent'

afterEach(() => { resetRig(); vi.useRealTimers() })

const el = (id, root = document) => root.querySelector(`[data-el~="${id}"]`)
const rowOf = (name) => document.querySelector(`tr[data-row="${name}"]`)

describe('the Datasets list', () => {
  it('says a pooled rate is pooled over every model and harness; a single condition needs no such words', () => {
    renderRig('#/rig/home', { data: rigFixture() })
    expect(el('dataset-rate-scope', rowOf('mini')).textContent).toBe('pooled · all 2 models · 2 harnesses')
    expect(el('dataset-rate-scope', rowOf('mock_ctl'))).toBeNull()
  })
  it('a hover card on the rate says what is pooled and links to the rates per model and harness', () => {
    vi.useFakeTimers()
    renderRig('#/rig/home', { data: rigFixture() })
    const rate = el('dataset-rate', rowOf('mini'))
    act(() => { fireEvent.pointerEnter(rate, { pointerType: 'mouse' }) })
    act(() => { vi.advanceTimersByTime(OPEN_DELAY + 20) })
    const card = el('dataset-rate-card', rowOf('mini'))
    expect(card.textContent).toContain('Pooled over all 2 models and 2 harnesses of mini')
    // one card: the interval's words are in it, and the rate inside carries no hint of its own
    expect(card.textContent).toMatch(/73\.3%.*interval/)
    expect(el('dataset-pass-rate', rowOf('mini')).hasAttribute('data-hint')).toBe(false)
    const a = [...card.querySelectorAll('a')].find((x) => /per model and harness/.test(x.textContent))
    expect(a.getAttribute('href')).toBe('#/rig/an:mini:family')
    // a single condition links to its Outcomes
    const one = el('dataset-rate-card', rowOf('mock_ctl'))
    expect([...one.querySelectorAll('a')].some((x) => x.getAttribute('href') === '#/rig/an:mock_ctl:outcomes')).toBe(true)
  })
  it('a count of models or harnesses stands apart from the names it counts', () => {
    renderRig('#/rig/home', { data: rigFixture() })
    const models = rowOf('mini').querySelector('.rg-home-mcell')
    const n = models.querySelector('.rg-home-mn')
    expect(n.textContent).toBe('2')
    expect(n.getAttribute('aria-label') || n.nextElementSibling.textContent).toBeTruthy()
    // the names sit after a separator, not straight after the digit
    expect(models.textContent).toMatch(/^2 · /)
    expect(rowOf('mini').querySelector('[data-el="dataset-harnesses"]').parentElement.textContent).toMatch(/^2 · /)
  })
})

describe('Outcomes', () => {
  it('the headline says it is one model under one harness, beside the dataset\'s pooled rate', () => {
    renderRig('#/rig/an:mini:outcomes:alpha-1:baseline', { data: rigFixture() })
    const s = el('outcomes-scope')
    expect(s.textContent).toBe('alpha-1 under baseline only · all of mini pooled (2 models · 2 harnesses): 73.3%')
    expect(s.querySelector('a').getAttribute('href')).toBe('#/rig/an:mini:family:alpha-1:baseline')
  })
})
