// @vitest-environment jsdom
/* The shell prefix and the docked lanes.
   A run that starts every command with the same `cd <dir> && ` (mini-swe-agent: `cd /testbed && `) has it said once,
   "commands run in /testbed", in the run's or the lanes' header; the step lines (run page, lanes) drop it, the step's
   panel keeps the whole command. With a step docked beside the lanes, the lane of that step keeps a readable width and
   the other lanes fold to a compact one (letter, step, tokens) instead of every lane shrinking. */
import { afterEach, describe, expect, it } from 'vitest'
import { act, fireEvent } from '@testing-library/react'
import { renderRig, resetRig } from '../../test/rig-testing'
import { tok3Data, rid, TOK } from '../../test/token-fixture'
import { ledgerSteps, shellPrefix, stepAction, stripPrefix } from './views/steps'

afterEach(resetRig)

const T = 'proj__proj-101'
const R = [rid(T, 0), rid(T, 1), rid(T, 2)]
const PH = { ls: 'explore', cat: 'explore', grep: 'explore', sed: 'edit', python: 'test', echo: 'submit' }
function ledger(id, cmds) {
  const b = { run_id: id, task_id: T }
  return [{ ...b, seq: 0, span: 'invoke_agent', status: 'start', harness: { id: 'agentic' } },
    ...cmds.flatMap((c, i) => {
      const p = PH[c.replace(/^cd \S+ && /, '').split(' ')[0]] || 'explore'
      return [{ ...b, seq: 2 * i + 1, span: 'chat', phase: p, call_index: i + 1, 'gen_ai.usage.input_tokens': 1000, 'gen_ai.usage.output_tokens': 10, text: `reply ${i + 1}`, tool_calls: [{ name: 'bash', arguments: { command: c } }] },
        { ...b, seq: 2 * i + 2, span: 'execute_tool', 'gen_ai.tool.name': 'bash', phase: p, args: { command: c }, status: 'ok', result_preview: `out of ${c}` }]
    })]
}
const cd = (c) => `cd /testbed && ${c}`
const CMDS = [
  [cd('ls -la'), cd('grep -rn parse_expr sympy'), cd('sed -i s/a/b/ a.py'), cd('python -m pytest -q'), 'echo COMPLETE_TASK_AND_SUBMIT_FINAL_OUTPUT'],
  [cd('ls'), cd('cat a.py'), cd('sed -i s/a/b/ a.py'), cd('python -m pytest -q'), 'echo COMPLETE_TASK_AND_SUBMIT_FINAL_OUTPUT'],
  [cd('ls'), cd('cat b.py'), cd('python -m pytest -q'), 'echo COMPLETE_TASK_AND_SUBMIT_FINAL_OUTPUT'],
]
const detail = (i) => ({ summary: {}, spans: ledger(R[i], CMDS[i]), patch: '', messages: [], issue: '', replay: [], after_fix: { reason: 'no patch' }, first_lookup: { step: null, seq: null, rule: 'r' } })
const data = () => tok3Data(Object.fromEntries(R.map((id, i) => [`/results/${TOK}/runs/${id}`, detail(i)])))
const el = (id, root = document) => root.querySelector(`[data-el~="${id}"]`)
const LANES = `#/rig/lanes:${TOK}:coder-9b:agentic:${T}`

describe('the shell prefix (pure)', () => {
  it('a cd most commands start with is the run\'s prefix; one cd or a minority is not', () => {
    expect(shellPrefix(ledgerSteps(ledger(R[0], CMDS[0])))).toBe('/testbed')
    expect(shellPrefix(ledgerSteps(ledger(R[0], ['cd /x && ls', 'ls', 'cat a', 'cat b'])))).toBeNull()
    expect(shellPrefix(ledgerSteps(ledger(R[0], ['cd /x && ls'])))).toBeNull()
    expect(shellPrefix(ledgerSteps(ledger(R[0], ['cd /x && ls', 'cd /x && pwd', 'ls', 'cat a', 'cat b'])))).toBeNull()   // 2 of 5
    expect(shellPrefix(ledgerSteps(ledger(R[0], ['cd /x && ls', 'cd /x && pwd', 'ls', 'cat a'])))).toBe('/x')              // 2 of 4
    expect(shellPrefix([])).toBeNull()
  })
  it('strips only that cd, at the start, and leaves any other command whole', () => {
    expect(stripPrefix('cd /testbed && python -c "x"', '/testbed')).toBe('python -c "x"')
    expect(stripPrefix('cd  /testbed  &&  ls', '/testbed')).toBe('ls')
    expect(stripPrefix('cd /testbed/sub && ls', '/testbed')).toBe('cd /testbed/sub && ls')
    expect(stripPrefix('ls && cd /testbed && ls', '/testbed')).toBe('ls && cd /testbed && ls')
    expect(stripPrefix('cd /testbed && ls', null)).toBe('cd /testbed && ls')
  })
  it('a step summary drops the prefix when given it', () => {
    const st = ledgerSteps(ledger(R[0], CMDS[0]))[1]
    expect(stepAction(st, '/testbed')).toBe('bash grep -rn parse_expr sympy')
    expect(stepAction(st)).toBe('bash cd /testbed && grep -rn parse_expr sympy')
  })
})

describe('the run page', () => {
  it('says once where commands run, drops it from every step line, keeps it in the step panel', () => {
    renderRig(`#/rig/run:${R[0]}:s2`, { data: data() })
    expect(el('shell-dir').textContent).toBe('commands run in /testbed')
    const lines = [...document.querySelectorAll('.rg-cx-st .rg-sl-what')].map((w) => w.textContent)
    expect(lines.some((t) => t.includes('cd /testbed'))).toBe(false)
    expect(lines[1]).toBe('bashgrep -rn parse_expr sympy')
    expect(el('step-detail').textContent).toContain('cd /testbed && grep -rn parse_expr sympy')
  })
})

describe('the lanes', () => {
  it('say once where commands run when every lane runs in the same place, and drop it from the lines', () => {
    renderRig(LANES, { data: data() })
    expect(el('shell-dir').textContent).toBe('commands run in /testbed')
    expect(document.querySelectorAll('[data-el~="shell-dir"]')).toHaveLength(1)
    expect(el('shell-dir').closest('[data-el="lanes-rule"]')).toBeTruthy()
    const lines = [...document.querySelectorAll('.rg-ln-cell .rg-sl-what')].map((w) => w.textContent)
    expect(lines.some((t) => t.includes('cd /testbed'))).toBe(false)
  })
  it('with a step docked, its lane keeps its width and the other lanes fold to a compact one', () => {
    renderRig(LANES, { data: data() })
    expect(document.querySelectorAll('.rg-ln-cell.compact')).toHaveLength(0)
    act(() => { fireEvent.click(document.querySelector('.rg-ln-cell[data-lane="2"][data-n="2"] a')) })
    expect(el('step-detail')).toBeTruthy()
    expect(el('run-lanes').style.getPropertyValue('--rig-ln-cols')).toBe('var(--rig-ln-compact) minmax(280px, 1fr) var(--rig-ln-compact)')
    expect(document.querySelectorAll('.rg-ln-cell.compact[data-lane="2"]')).toHaveLength(0)
    expect(document.querySelectorAll('.rg-ln-head.compact')).toHaveLength(2)
    // a compact lane still says its step and its tokens (the unit is in its head); its full line is in the step's card
    const c = document.querySelector('.rg-ln-cell.compact[data-lane="1"][data-n="2"]')
    expect(c.querySelector('.rg-cx-sn').textContent).toBe('2')
    expect(c.querySelector('.rg-cx-stm').textContent).toBe('1,010')
    // Esc closes the step and the lanes open again
    act(() => { window.dispatchEvent(new Event('rig:escape')) })
    expect(document.querySelectorAll('.rg-ln-cell.compact')).toHaveLength(0)
    expect(el('run-lanes').style.getPropertyValue('--rig-ln-cols')).toBe('')
  })
})

describe('the step card on touch and scroll', () => {
  it('a scroll of the lanes closes an open step card', () => {
    renderRig(LANES, { data: data() })
    const a = document.querySelector('.rg-ln-cell[data-lane="1"][data-n="2"] a')
    act(() => { a.focus() })
    act(() => { fireEvent.focusIn(a) })
    expect(el('step-card').getAttribute('data-open')).toBe('true')
    act(() => { fireEvent.scroll(el('run-lanes')) })
    expect(el('step-card').getAttribute('data-open')).toBe('false')
  })
  it('a scroll of the page around the lanes closes it too', () => {
    renderRig(LANES, { data: data() })
    const a = document.querySelector('.rg-ln-cell[data-lane="1"][data-n="2"] a')
    act(() => { a.focus() })
    act(() => { fireEvent.focusIn(a) })
    expect(el('step-card').getAttribute('data-open')).toBe('true')
    act(() => { fireEvent.scroll(document.getElementById('rig-doc-main')) })
    expect(el('step-card').getAttribute('data-open')).toBe('false')
  })
})
