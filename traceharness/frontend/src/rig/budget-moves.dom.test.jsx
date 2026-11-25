// @vitest-environment jsdom
/* Items kept off a first screen are still on their page, one click away (a disclosure, a tab, a menu or an
   (i) card). This lists each one and where it lives. Every value here is invented. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, screen, within } from '@testing-library/react'
import { renderRig, resetRig, rigFixture, miniRuns } from '../../test/rig-testing'
import { tok3Data, TOK } from '../../test/token-fixture'

afterEach(() => resetRig())
const el = (c, name) => c.querySelector(`[data-el~="${name}"]`)
/** The words of an (i) card: the card the button points at (aria-describedby), or the card in its HoverCard. */
const cardOf = (button) => document.getElementById(button.getAttribute('aria-describedby')) || button.closest('.rg-hc').querySelector('.rg-hc-card')

describe('Outcomes', () => {
  it('the counting lines live in "How these numbers are counted", closed until asked for', () => {
    const { container } = renderRig('#/rig/an:mini:outcomes:alpha-1:baseline', { data: rigFixture() })
    const box = el(container, 'outcomes-counted')
    expect(box.tagName).toBe('DETAILS')
    expect(box.open).toBe(false)
    for (const name of ['pass1-pooled', 'pooled-vs-task', 'outcomes-scope', 'flip-coverage']) expect(box.querySelector(`[data-el="${name}"]`), name).toBeTruthy()
    expect(el(container, 'flip-coverage').textContent).toMatch(/^Flip rate: \d+ of \d+ tasks eligible/)
    expect(el(container, 'outcomes-headline').querySelector('[data-el="pass1-pooled"]')).toBeNull()
    // the flip word is defined on its figure; the answer keeps at most two glossary words (pass@1 and
    // "eligible", which the glossary defines)
    expect(el(container, 'flip-rate').querySelector('a.rg-term[data-term="flip"]')).toBeTruthy()
    expect(el(container, 'outcomes-answer').querySelectorAll('a.rg-term').length).toBeLessThanOrEqual(2)
  })
})

describe('Tasks', () => {
  it('the key sits inside the task table; the eligibility line under it', () => {
    const { container } = renderRig('#/rig/tasks:mini:alpha-1:baseline', { data: rigFixture() })
    const table = el(container, 'task-outcome-table')
    expect(table.contains(el(container, 'task-legend'))).toBe(true)
    const cov = el(container, 'repeat-coverage')
    expect(table.compareDocumentPosition(cov) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(el(container, 'tasks-answer').textContent).not.toContain('graded by the hidden oracle')
  })
})

describe('Tokens', () => {
  it('growth and spread are tabs beside By phase; the phase sentence and the scope are in (i) cards', () => {
    const { container } = renderRig(`#/rig/an:${TOK}:tokens`, { data: tok3Data() })
    const tabs = within(el(container, 'token-views')).getAllByRole('tab')
    expect(tabs.map((t) => t.textContent)).toEqual(['By phase', 'Context growth', 'Token spread'])
    expect(el(container, 'context-growth').closest('[role="tabpanel"]').hidden).toBe(true)
    act(() => { fireEvent.click(tabs[1]) })
    expect(el(container, 'context-growth').closest('[role="tabpanel"]').hidden).toBe(false)
    expect(location.hash).toContain('sec.growth')
    // the phase line is in the section's (i), with how the bars read
    const phaseInfo = cardOf(el(container, 'tokens-by-phase').querySelector('button[aria-label^="How Tokens by phase"]'))
    expect(phaseInfo.querySelector('[data-el="phase-line"]')).toBeTruthy()
    expect(phaseInfo.textContent).toContain('bars are scaled within each column')
  })
})

describe('Overview', () => {
  it('"All nine questions" is in the More menu; the questions it cannot answer follow Where to look next', () => {
    const data = rigFixture()
    const { container } = renderRig('#/rig/ds:mini:alpha-1:baseline', { data })
    expect(container.querySelector('.rg-ds-all')).toBeNull()
    act(() => { fireEvent.click(within(el(container, 'dataset-head')).getByRole('button', { name: /More/ })) })
    const item = screen.getByRole('menuitem', { name: 'All nine questions as a page' })
    act(() => { fireEvent.click(item) })
    expect(document.querySelector('.rg-doc').dataset.spec).toBe('q:mini')
  })
  it('the unanswered questions, when there are any, come after the next tasks', () => {
    const { container } = renderRig('#/rig/ds:mini:alpha-1:baseline', { data: rigFixture() })
    const open = el(container, 'unanswered')
    if (open) expect(el(container, 'where-to-look-next').compareDocumentPosition(open) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    const findings = el(container, 'findings')
    expect(findings.querySelector('[data-el~="unanswered"]')).toBeNull()
  })
})

describe('Questions', () => {
  it('the answer sentences are one switch away; the question pages keep them', () => {
    const { container } = renderRig('#/rig/q:mini', { data: rigFixture() })
    const list = el(container, 'question-stack')
    expect(list.classList.contains('brief')).toBe(true)
    const sw = screen.getByRole('button', { name: 'Show answers' })
    expect(sw.getAttribute('aria-pressed')).toBe('false')
    act(() => { fireEvent.click(sw) })
    expect(el(container, 'question-stack').classList.contains('brief')).toBe(false)
    expect(screen.getByRole('button', { name: 'Hide answers' }).getAttribute('aria-pressed')).toBe('true')
  })
})

describe('Run setup', () => {
  it('Estimate and Launch lead; the choices are in "Change the plan", open while nothing is chosen', () => {
    const data = { ...rigFixture(), '/models': { models: [{ id: 'acme/alpha-1', price_in: 1, price_out: 2 }], observed: {} } }
    const { container } = renderRig('#/rig/an:mini:setup:alpha-1:baseline', { data })
    const plan = el(container, 'setup-plan')
    expect(plan.tagName).toBe('DETAILS')
    expect(plan.open).toBe(false)
    expect(plan.querySelector('summary').textContent).toMatch(/^Change the plan · 1 model · 1 harness · 2 tasks × 3 → mini_new$/)
    for (const label of ['Models', 'Harnesses · the variable', 'Tasks · runs per task']) expect(plan.textContent, label).toContain(label)
    const setup = el(container, 'run-setup')
    expect(setup.firstElementChild.getAttribute('data-el')).toBe('run-estimate')
    // nothing chosen: the plan opens so the reader can choose
    act(() => { fireEvent.click(within(plan).getByRole('checkbox', { name: /alpha-1/ })) })
    expect(el(container, 'setup-plan').open).toBe(true)
  })
})

describe('One run (a run page)', () => {
  it('copying the id is in More actions; the run navigation and the oracle form one toolbar; the step tools another', () => {
    const write = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: write }, configurable: true })
    const r = miniRuns()[3]
    const spans = [
      { run_id: r.run_id, seq: 0, span: 'invoke_agent', status: 'start', harness: { id: 'baseline' } },
      { run_id: r.run_id, seq: 1, span: 'chat', 'gen_ai.usage.input_tokens': 10, 'gen_ai.usage.output_tokens': 2, tool_calls: [{ name: 'read_file', arguments: { path: 'a.py' } }] },
      { run_id: r.run_id, seq: 2, span: 'execute_tool', 'gen_ai.tool.name': 'read_file', args: { path: 'a.py' }, status: 'ok' },
      { run_id: r.run_id, seq: 3, span: 'invoke_agent', status: 'end', exit_reason: 'submitted' },
    ]
    const data = { ...rigFixture(), [`/results/mini/runs/${r.run_id}`]: { summary: r, spans, patch: '', messages: [], issue: '', replay: [] } }
    const { container } = renderRig(`#/rig/run:${r.run_id}`, { data })
    expect(el(container, 'run-id').tagName).toBe('SPAN')
    act(() => { fireEvent.click(within(el(container, 'run-more')).getByRole('button', { name: /More/ })) })
    act(() => { fireEvent.click(screen.getByRole('menuitem', { name: 'Copy run id' })) })
    expect(write).toHaveBeenCalledWith(r.run_id)
    const meta = el(container, 'run-meta')
    expect(meta.getAttribute('role')).toBe('toolbar')
    for (const name of [/Previous run/, /Next run/, /Change the oracle/]) expect(within(meta).getByRole('button', { name }), String(name)).toBeTruthy()
    const tools = el(container, 'steps-toolbar')
    expect(tools.getAttribute('role')).toBe('toolbar')
    expect(tools.contains(el(container, 'console-replay'))).toBe(true)
    expect(within(tools).getByRole('button', { name: 'What the step, model call and event counts count' })).toBeTruthy()
    const keys = within(tools).getByRole('button', { name: 'Keys on this page' })
    expect(cardOf(keys).textContent).toContain('next / previous step')
  })
})

describe('Harnesses › One run', () => {
  it('Keep prompt is in the prompt tools, its sentence in an (i); Save, Review and Run form one toolbar', async () => {
    renderRig('#/rig/harnesses')
    const tools = await screen.findByRole('toolbar', { name: 'Prompt tools' })
    expect(within(tools).getByRole('checkbox', { name: 'Keep prompt when switching harnesses' })).toBeTruthy()
    const info = within(tools).getByRole('button', { name: 'What keeping the prompt does' })
    expect(cardOf(info).textContent).toContain('Each harness keeps its own draft.')
    const run = screen.getByRole('toolbar', { name: 'Save, review and run' })
    expect(within(run).getAllByRole('button').map((b) => b.textContent)).toEqual(['Review run', 'Run', 'Save harness'])
  })
})
