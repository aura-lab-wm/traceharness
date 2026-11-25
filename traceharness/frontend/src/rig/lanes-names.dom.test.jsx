// @vitest-environment jsdom
/* The all-runs view never cuts a tool name. The name keeps its whole width; when the line is too narrow, the step's
   marks and tokens move to a second line of the cell, and the row of every lane grows with it, so step k is still on
   one row. Only the arguments give way (the step card has them whole). */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { renderRig, resetRig, rigFixture } from '../../test/rig-testing'

/** Every declaration block whose selector list names `sel` exactly (as laptop-design.dom.test.jsx reads them). */
function rulesFor(text, sel) {
  const out = []
  for (const m of text.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)) if (m[1].split(',').map((s) => s.trim()).includes(sel)) out.push(m[2])
  return out.join(';')
}

afterEach(resetRig)
const css = readFileSync(join(__dirname, 'runlanes.css'), 'utf8')

describe('tool names in the all-runs view', () => {
  it('a lane\'s step line wraps instead of cutting its tool name', () => {
    const name = rulesFor(css, '.rig .rg-ln-cell .rg-sl-what .t')
    expect(name).toMatch(/overflow:visible/)
    expect(name).toMatch(/text-overflow:clip/)
    expect(name).not.toMatch(/ellipsis/)
    // the arguments take no room of their own: what is left after the name, cut, never the name
    expect(rulesFor(css, '.rig .rg-ln-cell .rg-sl-what .a')).toMatch(/contain:inline-size/)
    // the line may take two lines, the cell grows with it, the marks and tokens keep to the right
    expect(rulesFor(css, '.rig .rg-ln-cell .rg-sl-row')).toMatch(/flex-wrap:wrap/)
    expect(rulesFor(css, '.rig .rg-ln-cell .rg-sl-row')).toMatch(/justify-content:flex-end/)
    expect(rulesFor(css, '.rig .rg-ln-cell')).toMatch(/min-height:40px/)
    expect(rulesFor(css, '.rig .rg-ln-cell')).not.toMatch(/(^|;)height:40px/)
  })
  it('a long tool name may break after an underscore, never inside a word', () => {
    const f = rigFixture()
    const id = '20260101-000000-a00000', b = { run_id: id, task_id: 't1' }
    f[`/results/mini/runs/${id}`] = { summary: {}, patch: '', messages: [], issue: '', replay: [], spans: [{ ...b, seq: 0, span: 'invoke_agent', status: 'start' },
      { ...b, seq: 1, span: 'chat', phase: 'edit', call_index: 1, text: 'r', tool_calls: [{ name: 'str_replace_editor', arguments: { path: 'a.py' } }] },
      { ...b, seq: 2, span: 'execute_tool', 'gen_ai.tool.name': 'str_replace_editor', phase: 'edit', args: { path: 'a.py' }, status: 'ok', result_preview: 'x' }] }
    const { container } = renderRig('#/rig/lanes:mini:alpha-1:baseline:t1', { data: f })
    const t = [...container.querySelectorAll('.rg-ln-cell .rg-sl-what .t')].find((n) => n.textContent === 'str_replace_editor')
    expect(t, 'the step line of run 1').toBeTruthy()
    expect(t.innerHTML).toBe('str_<wbr>replace_<wbr>editor')
  })
  it('elsewhere a step line stays one line: the run page\'s tool names carry no break marks', () => {
    const f = rigFixture()
    const id = '20260101-000000-a00000', b = { run_id: id, task_id: 't1' }
    f[`/results/mini/runs/${id}`] = { summary: {}, patch: '', messages: [], issue: '', replay: [], spans: [{ ...b, seq: 0, span: 'invoke_agent', status: 'start' },
      { ...b, seq: 1, span: 'chat', phase: 'edit', call_index: 1, text: 'r', tool_calls: [{ name: 'str_replace_editor', arguments: { path: 'a.py' } }] },
      { ...b, seq: 2, span: 'execute_tool', 'gen_ai.tool.name': 'str_replace_editor', phase: 'edit', args: { path: 'a.py' }, status: 'ok', result_preview: 'x' }] }
    const { container } = renderRig(`#/rig/run:${id}`, { data: f })
    const t = [...container.querySelectorAll('.rg-sl-row .rg-sl-what .t')].find((n) => n.textContent === 'str_replace_editor')
    expect(t, 'the step line on the run page').toBeTruthy()
    expect(t.innerHTML).toBe('str_replace_editor')
  })
})
