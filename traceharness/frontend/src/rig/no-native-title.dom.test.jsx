// @vitest-environment jsdom
/* No native title in the drawn rig either: the pages a reader moves through most are
   drawn from the fixtures and searched for a title attribute; their hover help is data-hint, which the
   one hint layer turns into a hover card. The source rule is no-native-title.test.js. */
import { afterEach, describe, expect, it } from 'vitest'
import { act } from '@testing-library/react'
import { renderRig, resetRig } from '../../test/rig-testing'
import { tok3Data, rid, TOK } from '../../test/token-fixture'

afterEach(resetRig)

const ID = rid('proj__proj-101', 0)
const b = { run_id: ID, task_id: 'proj__proj-101' }
const spans = [
  { ...b, seq: 0, span: 'invoke_agent', status: 'start', harness: { id: 'agentic' }, repeat_index: 0 },
  { ...b, seq: 1, span: 'chat', 'gen_ai.usage.input_tokens': 1500, 'gen_ai.usage.output_tokens': 400, 'gen_ai.usage.cache_read_input_tokens': 1455, text: 'list', duration_ms: 3200, tool_calls: [{ name: 'bash', arguments: { command: 'ls src' } }] },
  { ...b, seq: 2, span: 'execute_tool', 'gen_ai.tool.name': 'bash', args: { command: 'ls src' }, status: 'ok', phase: 'explore', duration_ms: 400, result_preview: 'a.py' },
  { ...b, seq: 3, span: 'invoke_agent', status: 'end', exit_reason: 'submitted', total_tokens: 1900 },
]
const data = () => tok3Data({ [`/results/${TOK}/runs/${ID}`]: { summary: {}, spans, patch: '', messages: [], issue: '', replay: [] } })
const titled = () => [...document.querySelectorAll('[title]')].filter((e) => e.tagName !== 'IFRAME').map((e) => `${e.tagName.toLowerCase()}.${e.className}: ${e.getAttribute('title')}`)

describe('the drawn pages carry no title attribute', () => {
  it.each([
    ['Datasets', '#/rig/home'],
    ['Overview', '#/rig/ds:mini:alpha-1:baseline'],
    ['Tasks', '#/rig/tasks:mini:alpha-1:baseline'],
    ['Task', '#/rig/task:mini:alpha-1:baseline:t2:1'],
    ['Family matrix', '#/rig/an:mini:family'],
    ['Outcomes', '#/rig/an:mini:outcomes'],
    ['Tokens', `#/rig/an:${TOK}:tokens`],
    ['Run', `#/rig/run:${ID}`],
    ['Learn glossary', '#/rig/guide:glossary'],
  ])('%s', async (_, hash) => {
    renderRig(hash, { data: data() })
    await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
    expect(document.querySelector('#rig-doc-main').textContent.length).toBeGreaterThan(40)
    expect(titled()).toEqual([])
    expect(document.querySelectorAll('[data-hint]').length + document.querySelectorAll('.rg-hc').length).toBeGreaterThan(0)
  })
})
