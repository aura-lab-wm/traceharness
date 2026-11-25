// @vitest-environment jsdom
/* The figures of articles 11 to 14 on their pages: each control changes what the figure draws and says, a control
   with nothing to do says so, and Play goes through once. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, within } from '@testing-library/react'
import { renderRig, resetRig } from '../../../../test/rig-testing'

afterEach(() => { vi.useRealTimers(); resetRig() })
const fig = (kind) => document.querySelector(`[data-el="learn-figure"][data-kind="${kind}"]`)
const out = (f) => f.querySelector('[data-el="fig-readout"]').textContent
const slide = (f, el, v) => fireEvent.change(f.querySelector(`[data-el="${el}"] input`), { target: { value: String(v) } })
const tab = (f, name) => fireEvent.click(within(f.querySelector('[data-el="fig-tabs"]')).getByRole('button', { name }))

describe('Sentinel: the risk over two runs (article 11, figure 1)', () => {
  it('the threshold decides which run is warned, and when', () => {
    renderRig('#/rig/guide:sentinel-early-warning')
    const f = fig('risk_steps')
    expect(out(f)).toBe('Threshold 0.60: the run that failed is warned at step 4; the run that passed is warned at step 4.')
    slide(f, 'fig-thr', 0.8)
    expect(out(f)).toBe('Threshold 0.80: the run that failed is warned at step 4; the run that passed is never warned.')
    slide(f, 'fig-thr', 0.95)
    expect(out(f)).toBe('Threshold 0.95: the run that failed is never warned; the run that passed is never warned.')
    // the ring marks a warning once the line has reached it, and moves with the threshold
    const rings = () => f.querySelectorAll('[data-el="fig-warn"]').length
    for (let i = 0; i < 3; i++) fireEvent.click(f.querySelector('[data-el="fig-next"]'))
    expect(rings()).toBe(0)
    slide(f, 'fig-thr', 0.6)
    expect(rings()).toBe(2)
    slide(f, 'fig-thr', 0.8)
    expect(rings()).toBe(1)
  })
  it('Next and Back step through both runs; a run that has ended says so', () => {
    renderRig('#/rig/guide:sentinel-early-warning')
    const f = fig('risk_steps')
    const detail = () => f.querySelector('[data-el="fig-risk-detail"]').textContent
    expect(f.querySelector('[data-el="fig-step-pos"]').textContent).toBe('Step 1 of 7')
    expect(f.querySelector('[data-el="fig-back"]').getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(f.querySelector('[data-el="fig-back"]'))
    expect(f.querySelector('[data-el="fig-step-pos"]').textContent).toBe('Step 1 of 7')
    for (let i = 0; i < 3; i++) fireEvent.click(f.querySelector('[data-el="fig-next"]'))
    expect(detail()).toContain('0.917')
    expect(detail()).toContain('0.692')
    expect(detail()).toContain('the last test run failed')
    fireEvent.click(f.querySelector('[data-el="fig-next"]'))
    expect(detail()).toMatch(/Ended after step 4/)
    fireEvent.click(f.querySelector('[data-el="fig-back"]'))
    expect(f.querySelector('[data-el="fig-step-pos"]').textContent).toBe('Step 4 of 7')
  })
  it('Play draws the runs step by step once and stops on the last step', () => {
    vi.useFakeTimers()
    renderRig('#/rig/guide:sentinel-early-warning')
    const f = fig('risk_steps')
    fireEvent.click(f.querySelector('[data-el="fig-play"]'))
    for (let i = 0; i < 20; i++) act(() => { vi.advanceTimersByTime(3000) })
    expect(f.querySelector('[data-el="fig-step-pos"]').textContent).toBe('Step 7 of 7')
    expect(f.querySelector('[data-el="fig-play"]').textContent).toBe('Play again')
    expect(f.querySelector('[data-el="fig-next"]').getAttribute('data-hint')).toBe('This is the last step')
  })
})

describe('Sentinel: caught against blocked (article 11, figure 2)', () => {
  it('the threshold moves the risk model\'s counts; the rule stays where it is', () => {
    renderRig('#/rig/guide:sentinel-early-warning')
    const f = fig('catch_block')
    expect(out(f)).toBe('At 0.60 the risk model catches 37 of the 169 bad submits (22%) and blocks 88 of the 2,554 good ones (3%); the rule catches 21 (12%) and blocks 292 (11%).')
    expect(f.querySelector('[data-el="fig-cb-rule"]').textContent).toContain('292')
    slide(f, 'fig-thr', 0.3)
    expect(out(f)).toContain('catches 78 of the 169 bad submits (46%) and blocks 452 of the 2,554 good ones (18%)')
    expect(f.querySelector('[data-el="fig-cb-model"]').textContent).toContain('452')
    expect(f.querySelector('[data-el="fig-cb-rule"]').textContent).toContain('292')
  })
})

describe('paired against unpaired (article 12, figure 1)', () => {
  it('the tab throws the pairing away, and no interval separates any more', () => {
    renderRig('#/rig/guide:comparing-runs-fairly')
    const f = fig('paired_ci')
    expect(out(f)).toBe("Paired by task: 1 of the 8 intervals separates from 0, reprompt's [+5.8, +35.0].")
    tab(f, /Unpaired/)
    expect(out(f)).toBe("Unpaired: none of the 8 intervals separates from 0; reprompt's widens to [-4.2, +43.3].")
  })
  it('a harness shows its 24 tasks one by one; the one shown is inert', () => {
    renderRig('#/rig/guide:comparing-runs-fairly')
    const f = fig('paired_ci')
    const tasks = () => f.querySelector('[data-el="fig-ci-tasks"]').textContent
    expect(tasks()).toContain('reprompt: 6 tasks better, 18 the same, 0 worse')
    const row = (id) => f.querySelector(`[data-el="fig-ci-row"][data-id="${id}"]`)
    fireEvent.click(row('terse_prompt'))
    expect(tasks()).toContain('terse_prompt: 3 tasks better, 15 the same, 6 worse')
    expect(row('terse_prompt').getAttribute('aria-pressed')).toBe('true')
    expect(row('terse_prompt').getAttribute('data-hint')).toBe('terse_prompt · shown')
    fireEvent.keyDown(row('long_output'), { key: 'Enter' })
    expect(tasks()).toContain('long_output: 2 tasks better, 22 the same, 0 worse')
  })
})

describe('pooled against averaged (article 12, figure 2)', () => {
  it('the weighting tab moves the average from 50.2% to 49.2%', () => {
    renderRig('#/rig/guide:comparing-runs-fairly')
    const f = fig('pool_weights')
    expect(out(f)).toBe('Each run counts once: 1,092 of 2,174 runs pass, 50.2%. A task with 25 runs weighs 6.25 times as much as one with 4.')
    tab(f, /Each task counts once/)
    expect(out(f)).toBe('Each task counts once: the mean of the 200 task pass rates is 49.2%. A task with 25 runs weighs as much as one with 4.')
    expect(f.querySelector('[data-el="fig-avg"]').textContent).toBe('49.2%')
  })
})

describe('how many runs (article 13)', () => {
  it('the runs-per-arm slider says the detectable difference, and what four times the runs would give', () => {
    renderRig('#/rig/guide:how-many-runs')
    const f = fig('detect_n')
    expect(out(f)).toBe('120 runs per arm: about 18.1 points. Four times as many, 480, would detect about 9.0.')
    slide(f, 'fig-n', 3)
    expect(out(f)).toBe('72 runs per arm: about 23.3 points. Four times as many, 288, would detect about 11.7.')
    expect(f.querySelector('[data-el="fig-n"] output').textContent).toBe('72 per arm')
  })
  it('the repeats slider shrinks only the interval that counts runs', () => {
    renderRig('#/rig/guide:how-many-runs')
    const f = fig('task_interval')
    expect(out(f)).toBe('5 runs per task, 120 runs, pass rate 62.5%: about plus or minus 8.7 points counting runs, 18.9 counting the 24 tasks.')
    slide(f, 'fig-runs', 1)
    expect(out(f)).toBe('1 run per task, 24 runs, pass rate 62.5%: about plus or minus 19.4 points counting runs, 19.8 counting the 24 tasks.')
  })
})

describe('model or harness (article 14)', () => {
  it('a row reads across the harnesses, a column down the models; the one shown is inert', () => {
    renderRig('#/rig/guide:model-or-harness')
    const f = fig('heat_grid')
    expect(out(f)).toBe('gemini-2.5-flash-lite across the 9 harnesses: from 52.5% under terse_prompt to 81.7% under reprompt, a range of 29.2 points; 62.6% overall.')
    const head = (el, name) => within(f).getAllByRole('button').find((b) => b.getAttribute('data-el') === el && b.textContent.startsWith(name))
    fireEvent.click(head('fig-grid-row', 'gpt-5.6-luna'))
    expect(out(f)).toBe('gpt-5.6-luna across the 9 harnesses: from 94.2% under short_observations to 99.2% under tight_budget, a range of 5.0 points; 97.5% overall.')
    fireEvent.click(head('fig-grid-col', 'reprompt'))
    expect(out(f)).toMatch(/^reprompt down the 3 models: from 81\.7% for gemini-2\.5-flash-lite to .*; 93\.1% overall\.$/)
    const on = head('fig-grid-col', 'reprompt')
    expect(on.getAttribute('aria-pressed')).toBe('true')
    expect(on.getAttribute('data-hint')).toBe('reprompt · shown')
  })
  it('the design tabs refit the shares', () => {
    renderRig('#/rig/guide:model-or-harness')
    const f = fig('var_share')
    expect(out(f)).toBe('All 3 models, 3,240 runs: model 18.5%, harness 1.2%, model x harness 1.1%. The largest part is condition x task, 47.6%.')
    tab(f, /gpt-5\.6-luna and the third model/)
    expect(out(f)).toBe('gpt-5.6-luna and the third model, 2,160 runs: model 1.0%, harness 1.6%, model x harness 1.4%. The largest part is residual (repeats), 54.2%.')
    tab(f, /alone/)
    expect(out(f)).toBe('gemini-2.5-flash-lite alone, 1,080 runs: model 0.0% (one model), harness 2.7%, model x harness 0.0%. The largest part is task, 62.0%.')
  })
})
