import { describe, it, expect } from 'vitest'
import { QUESTIONS, QMAP, answerQuestion, sentinelFor, repeatsPlan } from './answers'
import { normRuns, joinOutcomes, normOverview } from './data'
import { rigFixture, miniRuns, miniOutcomes, MINI } from '../../test/rig-testing'

const F = rigFixture()
const row = normOverview(F['/overview']).results[0]
const runs = joinOutcomes(normRuns(miniRuns(), MINI), { ...miniOutcomes(), byId: Object.fromEntries(miniOutcomes().modes.map((m) => [m.id, m])) })
const outcomes = { ...F[`/outcomes/${MINI}`], byId: Object.fromEntries(F[`/outcomes/${MINI}`].modes.map((m) => [m.id, m])) }
const input = (o = {}) => ({ dir: MINI, row, cond: { dir: MINI, model: 'acme/alpha-1', harness: 'baseline' }, oracle: 'hidden', runs,
  metrics: F[`/results/${MINI}/metrics`], experiment: F[`/results/${MINI}/experiment`], oracleData: F[`/results/${MINI}/oracle`],
  integrity: F[`/results/${MINI}/integrity?harness=baseline`], sentinel: F['/sentinel'], report: F[`/results/${MINI}/report?harness=baseline`], outcomes, ...o })
const text = (a) => a.sentence.map((p) => (typeof p === 'string' ? p : p.mark)).join('')
const ask = (id, o) => answerQuestion(QMAP[id], input(o))

describe('the nine questions answer from payloads, never invent', () => {
  it('has the nine questions in order, outcomes included', () => {
    expect(QUESTIONS.map((q) => q.id)).toEqual(['variable', 'grader', 'repeats', 'outcomes', 'leak', 'run', 'sentinel', 'report', 'next'])
  })
  it('variable → experiment fit', () => {
    const r = ask('variable'); expect(r.state).toBe('answered')
    expect(r.answer.num).toBe('20.0%'); expect(text(r.answer)).toContain('model')
    expect(text(r.answer)).not.toContain('additive')
    expect(r.answer.runs.test(runs[8])).toBe(true)
    expect(ask('variable', { experiment: { fit: { status: 'insufficient_data', reason: 'fewer_than_2_balanced_levels_b' } } }).state).toBe('unanswered')
  })
  it('grader → oracle delta and kappa; undefined kappa stays unanswered', () => {
    const r = ask('grader')
    expect(r.answer.num).toBe('−6.7pp'); expect(text(r.answer)).toContain('κ 0.87')
    expect(ask('grader', { oracleData: { n_excluded: 500, kappa: null, kappa_undefined_reason: 'no_eligible_pairs', rate_a: { rate: null }, rate_b: { rate: null } } }))
      .toMatchObject({ state: 'unanswered' })
  })
  it('repeats → flip rate from /metrics, mixed task from runs', () => {
    const r = ask('repeats')
    expect(r.answer.num).toBe('50%'); expect(text(r.answer)).toContain('1 of 2 tasks'); expect(text(r.answer)).toContain('t2')
  })
  it('outcomes → how runs fail, ungraded is not a failure', () => {
    const r = ask('outcomes')
    // 4 failures, one each: cut off, wrong patch, no patch, step limit
    expect(r.answer.numLabel).toContain('4 failures of 16 runs')
    expect(r.answer.note).toContain('1 ungraded runs are unknown, not failures')
  })
  it('leak → highest patch↔issue overlap, probe named', () => {
    const r = ask('leak'); expect(r.answer.num).toBe('40%'); expect(text(r.answer)).toContain('solution leak probe')
  })
  it('run → a failing run with its mode', () => {
    const r = ask('run'); expect(text(r.answer)).toContain('a00003'); expect(text(r.answer)).toContain('cut off · no patch')
  })
  it('sentinel → only a model trained on this dataset answers', () => {
    expect(ask('sentinel').answer.num).toBe('50%')
    expect(ask('sentinel').answer.note).toBe('Replay measures detection on these recorded trajectories. A live intervention can change later actions; its effect on outcomes requires separate measurement.')
    expect(sentinelFor(F['/sentinel'], 'other')).toBeNull()
    expect(ask('sentinel', { dir: 'other' }).state).toBe('unanswered')
  })
  it('report → the pooled card is labelled pooled with its n', () => {
    const r = ask('report')
    expect(r.answer.numLabel).toBe('all 2 models · baseline (pooled) · n = 8')
    expect(r.answer.note).toContain('pools 8 runs across 2 models')
    expect(ask('report', { report: { error: 'no runs' } })).toMatchObject({ state: 'unanswered' })
  })
  it('next → repeats plan', () => {
    expect(repeatsPlan(runs)).toMatchObject({ max: 2, even: true })
    expect(ask('next').answer.num).toBe('2×')
  })
  it('loading until the payload arrives, unanswered when it failed', () => {
    expect(answerQuestion(QMAP.grader, input({ oracleData: null }), { oracle: true })).toEqual({ state: 'loading' })
    expect(answerQuestion(QMAP.grader, input({ oracleData: null }), { oracle: 'error' }).state).toBe('unanswered')
  })
})

// The transition counts, not the net change, determine how many passes were lost.
it('distinguishes gross lost/gained passes from net oracle change, even when net is zero', () => {
  const oracleData = { n_eligible: 500, n_excluded: 0, cells: { only_a_true: 30, only_b_true: 10, both_true: 300, both_false: 160 }, rate_a: { rate: 0.66 }, rate_b: { rate: 0.62 }, kappa: 0.8 }
  const answer = ask('grader', { oracleData }).answer
  expect(text(answer)).toContain('6.0 percentage points lost')
  expect(text(answer)).toContain('2.0 gained')
  expect(answer.num).toBe('−4.0pp')
  oracleData.cells.only_b_true = 30; oracleData.rate_b.rate = 0.66
  const equal = ask('grader', { oracleData }).answer
  expect(text(equal)).toContain('6.0 percentage points lost')
  expect(text(equal)).not.toContain('no pass is lost')
})
