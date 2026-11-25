// @vitest-environment jsdom
/* Each question's Asking line states the runs its answer is of: the leak and the report
   answers pool every model under one harness, so their Asking line says so instead of the model in focus; an answer
   of one cell that is not the cell in focus names that cell. Made-up data (test/rig-testing). */
import { afterEach, describe, expect, it } from 'vitest'
import { renderRig, resetRig, rigFixture, MINI } from '../../../test/rig-testing'

afterEach(resetRig)
const el = (c, name) => c.querySelector(`[data-el~="${name}"]`)
const asking = (c) => el(c, 'asking-sentence').textContent

describe('the Asking line says the scope the answer uses', () => {
  it('Is anything leaking: every model under the integrity harness, pooled', () => {
    const { container } = renderRig(`#/rig/q:${MINI}:leak`)
    expect(el(container, 'answer-scope').textContent).toBe('one harness: baseline, all 2 models pooled')
    expect(asking(container)).toContain(`Asking ${MINI} about all 2 models under baseline, pooled`)
    expect(asking(container)).not.toContain('alpha-1 under baseline')
    expect(el(container, 'asking-sentence').querySelector('button')).toBeTruthy()      // the Change menu stays
  })
  it('What would I report: the report card pools every model under its harness, and the line says that', () => {
    const { container } = renderRig(`#/rig/q:${MINI}:report`)
    expect(el(container, 'answer-scope').textContent).toBe('one harness: baseline, all 2 models pooled')
    expect(asking(container)).toContain('about all 2 models under baseline, pooled')
    expect(asking(container)).not.toContain('alpha-1 under baseline')
  })
  it('a report card of one cell names that cell, even when another cell is in focus', () => {
    const data = rigFixture()
    const key = `/results/${MINI}/report?harness=baseline`
    data[key] = { card: { ...data[key].card, cell: { ...data[key].card.cell, pooled_models: false, runs: 4 } } }
    const { container } = renderRig(`#/rig/q:${MINI}:report?c=${MINI}:acme/beta-2:terse`, { data })
    expect(el(container, 'answer-scope').textContent).toBe('one cell: alpha-1 under baseline')
    expect(asking(container)).toContain('about alpha-1 under baseline')
    expect(asking(container)).not.toContain('beta-2')
  })
  it('the questions of the cell in focus keep it, and the pooled ones keep saying pooled', () => {
    for (const q of ['repeats', 'run']) expect(asking(renderRig(`#/rig/q:${MINI}:${q}`).container), q).toContain('about alpha-1 under baseline')
    for (const q of ['variable', 'grader', 'outcomes', 'next']) {
      resetRig()
      expect(asking(renderRig(`#/rig/q:${MINI}:${q}`).container), q).toContain('about all 2 models × 2 harnesses, pooled')
    }
  })
})
