// @vitest-environment jsdom
/* Run status by shape and colour: pass a filled circle-check, fail a circle-x, cut off a circle-pause, ungraded a
   dashed circle, error a triangle; never a ticked box, which reads as a checkbox. */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { STATUSES, STATUS_WORD, statusOf } from './status'
import { StatusIcon } from './StatusIcon'
import { Verdict, VerdictText, OutcomePill } from './ui'
import { RigContext } from './context'

afterEach(cleanup)

describe('statusOf', () => {
  it('reads a verdict, an outcome word or a status name', () => {
    expect(statusOf(true)).toBe('pass')
    expect(statusOf(false)).toBe('fail')
    expect(statusOf(null)).toBe('ungraded')
    expect(statusOf(undefined)).toBe('ungraded')
    expect(statusOf('Pass')).toBe('pass')
    expect(statusOf('Fail')).toBe('fail')
    expect(statusOf('Cut off')).toBe('cutoff')
    expect(statusOf('cut_off')).toBe('cutoff')
    expect(statusOf('Ungraded')).toBe('ungraded')
    expect(statusOf('error')).toBe('error')
    expect(statusOf('harness_error')).toBe('error')
    expect(statusOf('something else')).toBe('ungraded')   // never a pass or a fail by accident
  })
  it('has one word per status', () => {
    expect(STATUSES).toEqual(['pass', 'fail', 'cutoff', 'ungraded', 'error'])
    expect(STATUSES.map((s) => STATUS_WORD[s])).toEqual(['Pass', 'Fail', 'Cut off', 'Ungraded', 'Error'])
  })
})

describe('StatusIcon', () => {
  it('draws five different shapes, named for a screen reader', () => {
    const { container } = render(<>{STATUSES.map((s) => <StatusIcon key={s} status={s} />)}</>)
    const svgs = [...container.querySelectorAll('svg')]
    expect(svgs.map((s) => s.getAttribute('aria-label'))).toEqual(['Pass', 'Fail', 'Cut off', 'Ungraded', 'Error'])
    expect(svgs.every((s) => s.getAttribute('role') === 'img')).toBe(true)
    expect(new Set(svgs.map((s) => s.innerHTML)).size).toBe(5)
    expect(svgs.map((s) => s.getAttribute('data-status'))).toEqual(STATUSES)
    // pass is the only filled one; ungraded the only dashed one; error the only one that is not a circle
    expect(svgs.map((s) => !!s.querySelector('.rg-st-fill'))).toEqual([true, false, false, false, false])
    expect(svgs.map((s) => !!s.querySelector('[stroke-dasharray]'))).toEqual([false, false, false, true, false])
    expect(svgs.map((s) => !!s.querySelector('circle'))).toEqual([true, true, true, true, false])
    expect(svgs.every((s) => s.textContent === '')).toBe(true)
  })
  it('beside its word it is decorative; a label replaces the word', () => {
    const { container } = render(<><StatusIcon status="fail" decorative /><StatusIcon status="pass" label="Run 2 passed" /></>)
    const [a, b] = container.querySelectorAll('svg')
    expect(a.getAttribute('aria-hidden')).toBe('true')
    expect(a.hasAttribute('role')).toBe(false)
    expect(b.getAttribute('aria-label')).toBe('Run 2 passed')
  })
  it('an unknown status draws as ungraded', () => {
    const { container } = render(<StatusIcon status="weird" />)
    expect(container.querySelector('svg').getAttribute('data-status')).toBe('ungraded')
  })
})

describe('the shared verdict pieces use it', () => {
  it('Verdict keeps its names and classes, and holds no glyph', () => {
    const { container } = render(<><Verdict v={true} /><Verdict v={false} /><Verdict v={null} /></>)
    const v = [...container.querySelectorAll('.rg-v')]
    expect(v.map((x) => x.getAttribute('aria-label'))).toEqual(['Pass', 'Fail', 'Ungraded'])
    expect(v.map((x) => x.getAttribute('class').split(' ').filter((c) => ['p', 'f', 'u'].includes(c))[0])).toEqual(['p', 'f', 'u'])
    expect(v.map((x) => x.getAttribute('data-status'))).toEqual(['pass', 'fail', 'ungraded'])
    expect(container.textContent).toBe('')
  })
  it('VerdictText is the icon and the word', () => {
    const { container } = render(<VerdictText v={false} />)
    expect(container.textContent).toBe('Fail')
    expect(container.querySelector('svg').getAttribute('data-status')).toBe('fail')
    expect(container.querySelector('svg').getAttribute('aria-hidden')).toBe('true')   // the word is read once
  })
  it('OutcomePill draws a cut-off run with the cut-off shape', () => {
    const run = { hid: false, mode: 'cutoff_no_patch' }
    const { container } = render(<RigContext.Provider value={{ oracle: 'hidden' }}><OutcomePill run={run} oracle="hidden" /></RigContext.Provider>)
    expect(container.textContent).toBe('Cut off')
    expect(container.querySelector('svg').getAttribute('data-status')).toBe('cutoff')
  })
})

describe('no box around a status', () => {
  it('the verdict mark has no fill, border or ring of its own', () => {
    const css = readFileSync(fileURLToPath(import.meta.url).replace(/[^/]+$/, 'rig.css'), 'utf8')
    const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(([, sel]) => /\.rg-v(\.[puf])?(?![\w-])/.test(sel) && !/rg-vt/.test(sel))
    expect(rules.length).toBeGreaterThan(0)
    for (const [, sel, body] of rules) expect(body, sel).not.toMatch(/(^|;)\s*(background|border|box-shadow)\s*:/)
  })
})
