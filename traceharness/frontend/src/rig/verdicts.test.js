/* The verdict line of an analysis answer: one plain-words sentence first, from the same numbers as the answer, the
   harness named first; κ, comparisons and variance are glossary words. Every number here is made up. */
import { describe, expect, it } from 'vitest'
import { variableVerdict, graderVerdict, plainParts } from './answers'

const fit = (lead, m, h) => ({ leading_factor: lead, model: { share: m }, harness: { share: h } })
const words = (parts) => plainParts(parts)

describe('which variable moves success: the verdict', () => {
  it('the harness changes some comparisons and the model matters more', () => {
    const v = variableVerdict(fit('model', 0.2, 0.02), 9, 40)
    expect(words(v)).toBe('Yes, the harness changes the pass rate: in 9 of 40 comparisons. The model matters more: 20% of the variance against the harness’s 2%.')
    expect(v.filter((p) => p.term).map((p) => p.term)).toEqual(['contrast', 'share-of-variance'])
  })
  it('the harness leads', () => {
    expect(words(variableVerdict(fit('harness', 0.05, 0.3), 12, 40))).toBe('Yes, the harness changes the pass rate: in 12 of 40 comparisons, and it matters more than the model: 30% of the variance against the model’s 5%.')
  })
  it('the harness leads but no comparison separates', () => {
    expect(words(variableVerdict(fit('harness', 0.05, 0.3), 0, 40))).toBe('No clear harness effect: none of 40 comparisons separates from zero. The harness still carries more of the variance: 30% against the model\u2019s 5%.')
  })
  it('no more comparisons separate than chance would give: not clearly', () => {
    expect(words(variableVerdict(fit('model', 0.2, 0.02), 3, 40))).toBe('Not clearly: 3 of 40 comparisons separate from zero, and about 2.0 would by chance alone. The model matters more: 20% of the variance against the harness\u2019s 2%.')
    // the expected count from /experiment when it is given
    expect(words(variableVerdict(fit('model', 0.2, 0.02), 3, 40, 1))).toMatch(/^Yes, the harness changes the pass rate: in 3 of 40/)
    expect(words(variableVerdict(fit('model', 0.2, 0.02), 2, 40, 1))).toMatch(/^Not clearly: 2 of 40/)
  })
  it('no comparison at all: too few shared tasks, not evidence of no effect', () => {
    expect(words(variableVerdict(fit('model', 0.2, 0.02), 0, 0))).toMatch(/^Too few shared tasks to compare harnesses/)
  })
  it('no comparison separates', () => {
    expect(words(variableVerdict(fit('model', 0.2, 0.02), 0, 40))).toBe('No clear harness effect: none of 40 comparisons separates from zero. The model matters more: 20% of the variance against the harness’s 2%.')
  })
})

describe('can I trust the oracle: the verdict', () => {
  const o = (kappa, a, b) => ({ kappa, rate_a: { rate: a }, rate_b: { rate: b } })
  it('mostly, when κ is substantial; lowers and never raises', () => {
    expect(words(graderVerdict(o(0.72, 0.6, 0.53), { loss: 0.07, gain: 0, net: -0.07 }))).toBe('Mostly: the stricter grader lowers the pass rate by 7.0 points and never raises it (κ 0.72: the two grades agree well beyond chance).')
  })
  it('yes, partly and not on its own, by κ; raises as well as lowers', () => {
    expect(words(graderVerdict(o(0.92, 0.8, 0.79), { loss: 0.02, gain: 0.01, net: -0.01 }))).toMatch(/^Yes: the stricter grader lowers the pass rate by 2\.0 points and raises it by 1\.0/)
    expect(words(graderVerdict(o(0.5, 0.8, 0.7), { loss: 0.1, gain: 0, net: -0.1 }))).toMatch(/^Partly: /)
    expect(words(graderVerdict(o(0.2, 0.8, 0.5), { loss: 0.3, gain: 0, net: -0.3 }))).toMatch(/^Not on its own: /)
  })
  it('the κ bounds: 0.8 is Yes, 0.6 Mostly, 0.4 Partly', () => {
    const at = (k) => words(graderVerdict(o(k, 0.8, 0.8), { loss: 0, gain: 0, net: 0 })).split(':')[0]
    expect([0.8, 0.7999, 0.6, 0.5999, 0.4, 0.3999].map(at)).toEqual(['Yes', 'Mostly', 'Mostly', 'Partly', 'Partly', 'Not on its own'])
  })
  it('no change at all, and no paired counts', () => {
    expect(words(graderVerdict(o(1, 0.8, 0.8), { loss: 0, gain: 0, net: 0 }))).toMatch(/^Yes: the stricter grader never changes a grade/)
    expect(words(graderVerdict(o(0.7, 0.8, 0.75), null))).toMatch(/^Mostly: the stricter grader changes the pass rate by -5\.0 points/)
  })
  it('κ is a glossary word', () => {
    expect(graderVerdict(o(0.72, 0.6, 0.53), { loss: 0.07, gain: 0, net: -0.07 }).some((p) => p.term === 'kappa')).toBe(true)
  })
})
