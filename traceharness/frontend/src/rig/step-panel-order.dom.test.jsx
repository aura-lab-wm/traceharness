// @vitest-environment jsdom
/* The step panel opens on the step's own reply and tool call with its output; what was sent to the model before it
   (the output of the step before, or the task for step 1) comes after, named so. */
import { afterEach, describe, expect, it } from 'vitest'
import { renderRig, resetRig } from '../../test/rig-testing'
import { tok3Data, rid, TOK } from '../../test/token-fixture'

afterEach(resetRig)

const T = 'proj__proj-101'
const R0 = rid(T, 0)
const b = { run_id: R0, task_id: T }
const CMDS = ['ls', 'cat a.py', 'python -m pytest -q']
const spans = [{ ...b, seq: 0, span: 'invoke_agent', status: 'start', harness: { id: 'agentic' } },
  ...CMDS.flatMap((c, i) => [
    { ...b, seq: 2 * i + 1, span: 'chat', phase: 'explore', 'gen_ai.usage.input_tokens': 1000, 'gen_ai.usage.output_tokens': 10, text: `reply ${i + 1}`, tool_calls: [{ name: 'bash', arguments: { command: c } }] },
    { ...b, seq: 2 * i + 2, span: 'execute_tool', 'gen_ai.tool.name': 'bash', phase: 'explore', args: { command: c }, status: 'ok', result_preview: `output of step ${i + 1}` },
  ])]
const messages = [{ role: 'system', content: 'You are an engineer.' }, { role: 'user', content: 'Fix the task.' },
  ...CMDS.flatMap((c, i) => [{ role: 'assistant', content: `reply ${i + 1}`, tool_calls: [{ name: 'bash', arguments: { command: c } }] }, { role: 'tool', content: `output of step ${i + 1}` }])]
const detail = { summary: {}, spans, patch: '', messages, issue: '', replay: [] }
const data = () => tok3Data({ [`/results/${TOK}/runs/${R0}`]: detail })
const sections = () => [...document.querySelectorAll('[data-el="step-detail"] .rg-cx-db > .rg-cx-h .t')].map((t) => t.textContent)

describe('the step panel', () => {
  it('opens on the step\'s own reply and tool call; what was sent, the output of the step before, follows', () => {
    renderRig(`#/rig/run:${R0}:s2`, { data: data() })
    expect(sections()).toEqual(['Reply', 'Tool call', 'Sent to the model (output of step 1)', 'Events of this step'])
    const panel = document.querySelector('[data-el="step-detail"]')
    // the step's own output sits in its tool call, before the step before's output
    const text = panel.textContent
    expect(text.indexOf('output of step 2')).toBeGreaterThan(-1)
    expect(text.indexOf('output of step 2')).toBeLessThan(text.indexOf('output of step 1'))
    expect(panel.querySelector('[data-el="step-sent"]').textContent).toContain('output of step 1')
  })
  it('step 1 was sent the task', () => {
    renderRig(`#/rig/run:${R0}:s1`, { data: data() })
    expect(sections()).toEqual(['Reply', 'Tool call', 'Sent to the model (the task)', 'Events of this step'])
  })
})
