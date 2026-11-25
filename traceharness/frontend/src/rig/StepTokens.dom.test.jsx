// @vitest-environment jsdom
/* Run page and step views: cached tokens, thinking kept apart from the reply, per-step duration
   ("unknown" when the source has no timing) and a phase chip per step. Run page = RunPage.jsx and
   the steps console (views/console.jsx). */
import { afterEach, describe, expect, it } from 'vitest'
import { render, within } from '@testing-library/react'
import { renderRig, resetRig, MINI } from '../../test/rig-testing'
import { tok3Data, rid, TOK } from '../../test/token-fixture'
import { PhaseChip, ConsolePhase, ThinkingBlock, stepRows, cachedText } from './StepTokens'

afterEach(resetRig)

const el = (c, id) => c.querySelector(`[data-el~="${id}"]`)
const ID = rid('proj__proj-101', 0)
const THINK = 'Look at the parser before editing.'
const b = { run_id: ID, task_id: 'proj__proj-101' }
const spans = (dur = (x) => x) => [
  { ...b, seq: 0, span: 'invoke_agent', status: 'start', harness: { id: 'agentic' }, repeat_index: 0 },
  { ...b, seq: 1, span: 'chat', 'gen_ai.usage.input_tokens': 1500, 'gen_ai.usage.output_tokens': 400, 'gen_ai.usage.cache_read_input_tokens': 1455, reasoning: THINK, reasoning_chars: 1200,
    text: 'I will list the files.', duration_ms: dur(3200), tool_calls: [{ name: 'bash', arguments: { command: 'ls src' } }], 'gen_ai.response.finish_reasons': ['tool_calls'] },
  { ...b, seq: 2, span: 'execute_tool', 'gen_ai.tool.name': 'bash', args: { command: 'ls src' }, status: 'ok', phase: 'explore', duration_ms: dur(null), result_preview: 'a.py' },
  { ...b, seq: 3, span: 'chat', 'gen_ai.usage.input_tokens': 2450, 'gen_ai.usage.output_tokens': 300, 'gen_ai.usage.cache_read_input_tokens': 2400, reasoning: 'ok', reasoning_chars: 2,
    text: 'run tests', duration_ms: dur(2100), tool_calls: [{ name: 'bash', arguments: { command: 'pytest -q' } }], 'gen_ai.response.finish_reasons': ['tool_calls'] },
  { ...b, seq: 4, span: 'execute_tool', 'gen_ai.tool.name': 'bash', args: { command: 'pytest -q' }, status: 'ok', phase: 'test', duration_ms: dur(900), result_preview: '3 passed' },
  { ...b, seq: 5, span: 'invoke_agent', status: 'end', exit_reason: 'submitted', total_tokens: 4650 },
]
const detail = (sp) => ({ summary: {}, spans: sp, patch: '', messages: [], issue: '', replay: [] })
const data = (sp = spans()) => tok3Data({ [`/results/${TOK}/runs/${ID}`]: detail(sp) })

/* an older run: the mini fixture's a00002 has no cache count, no thinking and no phases */
const OLD = '20260101-000000-a00002'
const oldSpans = [
  { run_id: OLD, seq: 0, span: 'invoke_agent', status: 'start', harness: { id: 'baseline' } },
  { run_id: OLD, seq: 1, span: 'chat', 'gen_ai.usage.input_tokens': 800, 'gen_ai.usage.output_tokens': 90, duration_ms: 0, text: 'reading', tool_calls: [{ name: 'read_file', arguments: { path: 'a.py' } }] },
  { run_id: OLD, seq: 2, span: 'execute_tool', 'gen_ai.tool.name': 'read_file', args: { path: 'a.py' }, status: 'ok', duration_ms: 0 },
]
const oldData = () => tok3Data({ [`/results/${MINI}/runs/${OLD}`]: detail(oldSpans) })

describe('pieces', () => {
  it('a phase chip names the phase and says what it means; no phase, no chip', () => {
    const { container } = render(<><PhaseChip phase="explore" /><PhaseChip phase={null} /><ConsolePhase phase="edit" /><ConsolePhase phase="" /></>)
    const chips = container.querySelectorAll('[data-el="phase-chip"]')
    expect([...chips].map((c) => c.textContent)).toEqual(['explore', 'edit'])
    expect(chips[0].getAttribute('data-hint')).toBe('reading, listing and searching the code')
    expect(chips[0].className).toContain('rg-tok-p0')
    // the run console's phase chip uses the one phase palette (edit = slot 2), with a swatch; its words stay in ink
    expect(chips[1].className).toContain('rg-tok-p2')
    expect(chips[1].className).not.toMatch(/\bk-[ietbs]\b/)
    expect(chips[1].querySelector('.rg-tok-sw')).toBeTruthy()
  })
  it('folds the thinking with its size and share, and says when the ledger kept only part of it', () => {
    const { container } = render(<ThinkingBlock span={spans()[1]} />)
    const d = el(container, 'thinking')
    expect(d.tagName).toBe('DETAILS')
    expect(d.open).toBe(false)
    expect(d.querySelector('summary').textContent).toBe("Thinking1,200 chars98% of what this reply wrote")
    expect(d.querySelector('pre').textContent).toBe(THINK)
    expect(d.textContent).toContain(`The ledger keeps the first ${THINK.length} of 1,200 characters.`)
  })
  it('draws nothing for a reply with no recorded thinking', () => {
    const { container } = render(<><ThinkingBlock span={{ span: 'chat', text: 'hi' }} /><ThinkingBlock span={{ span: 'chat', reasoning_chars: 0 }} /></>)
    expect(container.innerHTML).toBe('')
  })
  it('marks the share as an upper bound when the reply text was cut', () => {
    const { container } = render(<ThinkingBlock span={{ span: 'chat', reasoning: 'x', reasoning_chars: 5000, text: 'y'.repeat(2000) }} />)
    expect(container.textContent).toContain('at most 71%')
    expect(container.textContent).toContain('cut at 2,000 characters')
  })
  it('lists a step\'s token facts, unknown where the span is silent', () => {
    const rows = (s, p) => Object.fromEntries(stepRows(s, p).map(([k, v]) => [k, typeof v === 'string' ? v : 'node']))
    expect(rows(spans()[1], ['explore'])).toEqual({ 'cached tokens': '1,455 (97% of read)', thinking: '1,200 chars · 98% of the reply', phase: 'node' })
    expect(rows({ span: 'chat', text: 'hi' }, [])).toEqual({ 'cached tokens': 'unknown', thinking: 'unknown', phase: 'unknown' })
    expect(rows({ span: 'chat', reasoning_chars: 0, text: 'hi' }, []).thinking).toBe('none')
    expect(rows({ span: 'execute_tool' }, [])).toEqual({ phase: 'unknown' })
    expect(cachedText(null, 10)).toBe('unknown')
  })
})

/* the value of one figure in the run header */
const stat = (c, id) => el(c, id).querySelector('dd').textContent
const fact = (c, k) => { const dt = [...el(c, 'run-facts').querySelectorAll('dt')].find((d) => d.textContent === k); return dt && dt.nextElementSibling.textContent }

describe('run page', () => {
  it('shows cached tokens and thinking with the header figures, and cached tokens in the facts', () => {
    const { container } = renderRig(`#/rig/run:${ID}`, { data: data() })
    expect(stat(container, 'run-cached')).toBe('244,87797% of tokens in')
    expect(stat(container, 'run-thinking')).toBe('1,202 chars97% of what it wrote')
    expect(fact(container, 'cached tokens')).toBe('244,877')
  })
  it('an older run says cached and thinking are unknown, never 0', () => {
    const { container } = renderRig(`#/rig/run:${OLD}`, { data: oldData() })
    expect(stat(container, 'run-cached')).toBe('unknown')
    expect(stat(container, 'run-thinking')).toBe('unknown')
    expect(fact(container, 'cached tokens')).toBe('unknown')
  })
  it('each step row carries its phase; the step shows thinking, cached tokens and its tool duration', () => {
    const { container } = renderRig(`#/rig/run:${ID}:2`, { data: data() })
    const rows = [...container.querySelectorAll('.rg-cx-st')]
    expect(rows.map((r) => [...r.querySelectorAll('[data-el="phase-chip"]')].map((p) => p.textContent))).toEqual([['explore'], ['test']])
    expect(rows[0].querySelector('.rg-cx-rowb').getAttribute('aria-label')).toContain('· explore')
    const step = el(container, 'step-detail')
    expect(el(step, 'thinking').querySelector('summary').textContent).toContain('1,200 chars')
    expect(el(step, 'thinking').open).toBe(false)
    expect(el(step, 'step-cached').textContent).toBe('cached 1,455 (97% of read)')
    expect(el(step, 'tool-call').querySelector('[data-el="phase-chip"]').textContent).toBe('explore')
    expect(el(step, 'tool-duration').textContent).toBe('unknown')      // this tool call has no duration
  })
  it('a timed step shows its duration', () => {
    const { container } = renderRig(`#/rig/run:${ID}:4`, { data: data() })
    expect(el(el(container, 'step-detail'), 'tool-duration').textContent).toBe('900 ms')
  })
  it('an imported run with no wall time still shows the step durations its ledger recorded', () => {
    const d = data()
    const runs = d[`/results/${TOK}/runs`].map((r) => (r.run_id === ID ? { ...r, wall_ms: 0 } : r))
    const { container } = renderRig(`#/rig/run:${ID}:4`, { data: { ...d, [`/results/${TOK}/runs`]: runs } })
    expect(el(el(container, 'step-detail'), 'tool-duration').textContent).toBe('900 ms')
    expect(container.querySelector('.rg-cx-st .rg-cx-stm').textContent).toContain('3.20 s')
    // the run's own clock was not recorded, so its wall time stays unknown
    expect(container.querySelector('.rg-cx-colh [data-hint="Wall time of the run"]').textContent).toBe('time unknown')
  })
  it('a run whose durations are all placeholder zeros shows unknown, not 0 ms', () => {
    const { container } = renderRig(`#/rig/run:${OLD}:2`, { data: oldData() })
    expect(el(el(container, 'step-detail'), 'tool-duration').textContent).toBe('unknown')
    expect(container.querySelector('[data-el="steps-untimed"]').textContent).toBe('step times not recorded')
    expect(container.querySelector('.rg-cx-st .rg-cx-stm').textContent).not.toContain('time not recorded')
    expect(container.querySelector('.rg-cx-st [data-el="phase-chip"]')).toBeNull()
  })
})

describe('span view', () => {
  const field = (c, k) => { const dt = [...c.querySelectorAll('.rg-kv dt')].find((d) => d.textContent === k); return dt && dt.nextElementSibling.textContent }
  it('a model call lists cached tokens, thinking, duration and the phase of the calls it made, with the thinking apart from the text', () => {
    const { container } = renderRig(`#/rig/span:${ID}:1`, { data: data() })
    const d = el(container, 'span-detail')
    expect(field(d, 'cached tokens')).toBe('1,455 (97% of read)')
    expect(field(d, 'thinking')).toBe('1,200 chars · 98% of the reply')
    expect(field(d, 'duration')).toBe('3.20 s')
    expect(field(d, 'phase')).toBe('explore')
    expect(el(d, 'thinking').querySelector('pre').textContent).toBe(THINK)
    expect(within(d).getByLabelText('Model text').textContent).toBe('I will list the files.')
  })
  it('a tool call shows unknown for a missing duration and its own phase', () => {
    const { container } = renderRig(`#/rig/span:${ID}:2`, { data: data() })
    const d = el(container, 'span-detail')
    expect(field(d, 'duration')).toBe('unknown')
    expect(field(d, 'phase')).toBe('explore')
  })
  it('a step of an imported run with no wall time keeps its recorded duration', () => {
    const d = data()
    const runs = d[`/results/${TOK}/runs`].map((r) => (r.run_id === ID ? { ...r, wall_ms: 0 } : r))
    const { container } = renderRig(`#/rig/span:${ID}:1`, { data: { ...d, [`/results/${TOK}/runs`]: runs } })
    expect(field(el(container, 'span-detail'), 'duration')).toBe('3.20 s')
  })
  it('an older run says unknown for everything its source does not record', () => {
    const { container } = renderRig(`#/rig/span:${OLD}:1`, { data: oldData() })
    const d = el(container, 'span-detail')
    expect([field(d, 'cached tokens'), field(d, 'thinking'), field(d, 'phase'), field(d, 'duration')]).toEqual(['unknown', 'unknown', 'unknown', 'unknown'])
    expect(el(d, 'thinking')).toBeNull()
  })
})
