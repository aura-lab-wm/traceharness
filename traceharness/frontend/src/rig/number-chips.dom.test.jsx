// @vitest-environment jsdom
/* Number chips under the page titles of Overview, Tasks, Runs and Harnesses: the page's key counts as chips. Every
   word of the summary sentence they stand for stays: a screen reader reads it, and the line shows it on hover. */
import { afterEach, describe, expect, it } from 'vitest'
import { renderRig, resetRig } from '../../test/rig-testing'

afterEach(resetRig)
const chipsOf = (line) => [...line.querySelectorAll('.rg-num-chip')].map((c) => c.textContent)
const line = (container, el) => container.querySelector(`[data-el~="${el}"]`)
/** The words a screen reader hears, and the hover hint: the summary sentence, whole. */
function keepsWords(l, sentence) {
  expect(l.querySelector('.sr-only').textContent).toBe(sentence)
  expect(l.getAttribute('data-hint')).toContain(sentence)
  // the chips are figures for the eye: the sentence above is what is read
  expect(l.querySelector('.rg-nums-in').getAttribute('aria-hidden')).toBe('true')
}

describe('number chips under the page titles', () => {
  it('Overview: runs, tasks, models, harnesses and the pooled pass rate, then the kind and the date', () => {
    const { container } = renderRig('#/rig/ds:mini')
    const l = line(container, 'dataset-stats')
    expect(l.closest('[data-el="dataset-head"]')).toBeTruthy()
    expect(chipsOf(l)).toEqual(['16 runs', '2 tasks', '2 models', '2 harnesses', '73.3% pass'])
    expect(l.querySelector('.rg-nums-t').textContent).toBe('Recorded · updated Jan 2')
    keepsWords(l, 'Recorded · 16 runs · 2 models · 2 harnesses · 2 tasks · updated Jan 2')
    expect(l.getAttribute('data-hint')).toMatch(/pooled over all 2 models and 2 harnesses/)
  })
  it('Tasks: the condition\'s runs and tasks and how the tasks went; the failures stay in the line under them', () => {
    const { container } = renderRig('#/rig/tasks:mini:alpha-1:baseline')
    const l = line(container, 'tasks-answer')
    expect(l.closest('[data-tour="page-header"]')).toBeTruthy()
    // alpha-1 under baseline: t1 passed both runs, t2 passed one and was cut off once
    expect(chipsOf(l)).toEqual(['4 runs', '2 tasks', '1 passed every run', '1 flips between Pass and Fail'])
    keepsWords(l, '4 runs over 2 tasks: 1 passed every run, 1 flip between Pass and Fail; 1 failed: 1 cut off.')
    expect(line(container, 'tasks-failed').textContent).toBe('1 failed: 1 cut off.')
  })
  it('Runs: the dataset\'s runs, tasks, models and harnesses', () => {
    const { container } = renderRig('#/rig/field:mini')
    const l = line(container, 'runs-stats')
    expect(chipsOf(l)).toEqual(['16 runs', '2 tasks', '2 models', '2 harnesses'])
    expect(l.querySelector('.rg-nums-t').textContent).toBe('in mini')
    keepsWords(l, '16 runs in mini. Open any run to follow its outcome into its steps.')
  })
  it('Harnesses: what there is to choose from, and the saved versions', () => {
    const { container } = renderRig('#/rig/harnesses')
    const l = line(container, 'harness-stats')
    const c = chipsOf(l)
    expect(c[0]).toMatch(/^\d+ harnesses to choose from$/)
    expect(c).toContain('0 saved versions')
    keepsWords(l, 'Choose a harness, model and task, then review and run.')
  })
})
