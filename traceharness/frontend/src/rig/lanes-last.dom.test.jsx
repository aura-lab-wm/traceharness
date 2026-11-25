// @vitest-environment jsdom
/* The all-runs view: between 1024 and 1279 px an opened step docks beside the lanes as it does from 1280; below
   1024 it stacks under them. Every value here is invented. */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { act, fireEvent } from '@testing-library/react'
import { renderRig, resetRig } from '../../test/rig-testing'
import { tok3Data, rid, TOK } from '../../test/token-fixture'

afterEach(resetRig)

const T = 'proj__proj-101'
const LANES = `#/rig/lanes:${TOK}:coder-9b:agentic:${T}`
const R = [rid(T, 0), rid(T, 1), rid(T, 2)]
/** cmds[i] is step i+1; calls[i] its model call (a call repeated = one reply that asked for several tool calls) */
function ledger(id, cmds, calls) {
  const b = { run_id: id, task_id: T }
  return [{ ...b, seq: 0, span: 'invoke_agent', status: 'start', harness: { id: 'agentic' } },
    ...cmds.flatMap((c, i) => {
      const lead = calls[i] !== calls[i - 1]
      return [{ ...b, seq: 2 * i + 1, span: 'chat', phase: 'explore', call_index: calls[i], 'gen_ai.usage.input_tokens': lead ? 1000 : 0, 'gen_ai.usage.output_tokens': lead ? 10 : 0, text: `reply ${i + 1}`, tool_calls: [{ name: 'bash', arguments: { command: c } }] },
        { ...b, seq: 2 * i + 2, span: 'execute_tool', 'gen_ai.tool.name': 'bash', phase: 'explore', args: { command: c }, status: 'ok', result_preview: 'out' }]
    })]
}
const CMDS = [['ls', 'cat a.py', 'sed -i x a.py', 'pytest'], ['ls', 'cat a.py', 'sed -i x a.py', 'pytest'], ['ls', 'cat b.py', 'pytest', 'pytest']]
const CALLS = [[1, 1, 2, 3], [1, 2, 3, 4], [1, 2, 3, 4]]
const detail = (i) => ({ summary: {}, spans: ledger(R[i], CMDS[i], CALLS[i]), patch: '', messages: [], issue: '', replay: [], after_fix: { reason: 'no patch' }, first_lookup: { step: null, seq: null, rule: 'r' } })
const data = () => tok3Data(Object.fromEntries(R.map((id, i) => [`/results/${TOK}/runs/${id}`, detail(i)])))
const el = (id, root = document) => root.querySelector(`[data-el~="${id}"]`)
const cell = (lane, n) => document.querySelector(`.rg-ln-cell[data-lane="${lane}"][data-n="${n}"]`)

/** runlanes.css as { media query (or '' for none): { selector: declarations } }, whitespace squeezed. */
function cssBlocks() {
  const src = readFileSync(join(process.cwd(), 'src/rig/runlanes.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ')
  const out = {}
  const rules = (body, media) => {
    for (const m of body.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const at = (out[media] = out[media] || {})
      for (const sel of m[1].split(',').map((x) => x.trim())) at[sel] = ((at[sel] || '') + ';' + m[2].trim()).replace(/^;/, '')
    }
  }
  let i = 0, top = ''
  while (i < src.length) {
    const at = src.indexOf('@media', i)
    if (at < 0) { top += src.slice(i); break }
    top += src.slice(i, at)
    const open = src.indexOf('{', at)
    let depth = 1, j = open + 1
    while (depth && j < src.length) { if (src[j] === '{') depth++; else if (src[j] === '}') depth--; j++ }
    rules(src.slice(open + 1, j - 1), src.slice(at + 6, open).trim())
    i = j
  }
  rules(top, '')
  return out
}

describe('a step docked between 1024 and 1279 px', () => {
  it('the page says it has a step docked, and stops saying so when the step closes', () => {
    renderRig(LANES, { data: data() })
    const page = document.querySelector('.rg-ln-page')
    expect(page.classList.contains('docked')).toBe(false)
    act(() => { fireEvent.click(cell(2, 2).querySelector('a')) })
    expect(el('step-detail')).toBeTruthy()
    expect(document.querySelector('.rg-ln-page').classList.contains('docked')).toBe(true)
    act(() => { window.dispatchEvent(new Event('rig:escape')) })
    expect(document.querySelector('.rg-ln-page').classList.contains('docked')).toBe(false)
  })
  it('sits beside the lanes as from 1280: the page fills the pane, the lanes and the step scroll on their own', () => {
    const mid = cssBlocks()['(min-width:1024px) and (max-width:1279px)']
    expect(mid, 'a 1024–1279 block').toBeTruthy()
    expect(mid['.rig .rg-ln-page.docked']).toMatch(/height:100%/)
    expect(mid['.rig .rg-ln-page.docked .rg-ln-body']).toMatch(/flex:1 1 0/)
    // the same share as the docked step from 1280 (lanes-fit: minmax(340px,33%))
    expect(mid['.rig .rg-ln-page.docked .rg-ln-body']).toMatch(/grid-template-columns:minmax\(0,1fr\) minmax\(340px,33%\)/)
    expect(mid['.rig .rg-ln-page.docked .rg-ln-scroll']).toMatch(/max-height:none/)
    expect(mid['.rig .rg-ln-page.docked .rg-ln-scroll']).toMatch(/scroll-snap-type:none/)
    // its lane keeps a readable width, the others fold (the --rig-ln-cols the lanes set when a step is docked)
    expect(mid['.rig .rg-ln-page.docked .rg-ln-grid']).toMatch(/grid-template-columns:var\(--rig-ln-cols\)/)
    expect(mid['.rig .rg-ln-page.docked .rg-ln-body>.rg-cx-detail']).toMatch(/overflow:auto/)
    expect(mid['.rig .rg-ln-page.docked .rg-ln-body>.rg-cx-detail']).toMatch(/border-left:1px solid var\(--rig-line\)/)
  })
  it('a folded lane shows letter, step and tokens from 1024, as from 1280', () => {
    const b = cssBlocks()
    expect(b['(min-width:1024px)']['.rig .rg-ln-cell.compact :is(.rg-sl-what']).toBeTruthy()
    expect(b['(min-width:1280px)']).toBeUndefined()
  })
  it('below 1024 (a tablet, a phone) the step still stacks under the lanes', () => {
    const narrow = cssBlocks()['(max-width:1279px)']
    expect(narrow['.rig .rg-ln-body.with-panel']).toMatch(/grid-template-columns:minmax\(0,1fr\)/)
    expect(narrow['.rig .rg-ln-page']).toMatch(/height:auto/)
    expect(narrow['.rig .rg-ln-body>.rg-cx-detail']).toMatch(/overflow:visible/)
    expect(Object.keys(cssBlocks()).filter((q) => /docked/.test(JSON.stringify(cssBlocks()[q])))).toEqual(['(min-width:1024px) and (max-width:1279px)'])
  })
})

describe('closing the step takes it out of the link', () => {
  const focusOf = () => (location.hash.match(/:(r\d+s\d+)/) || [])[1]
  it('Esc closes the step and rewrites the link without it, adding no history entry', () => {
    renderRig(`${LANES}:r2s3`, { data: data() })
    expect(el('step-detail')).toBeTruthy()
    expect(focusOf()).toBe('r2s3')
    const before = history.length
    act(() => { window.dispatchEvent(new Event('rig:escape')) })
    expect(el('step-detail')).toBeNull()
    expect(location.hash).toContain(`lanes:${TOK}:coder-9b:agentic:${T}`)
    expect(focusOf()).toBeUndefined()
    expect(history.length).toBe(before)
    // a second Esc still returns to the task
    act(() => { window.dispatchEvent(new Event('rig:escape')) })
    expect(location.hash).not.toContain('lanes:')
  })
  it('the close button does the same, and a step opened again puts it back', () => {
    renderRig(`${LANES}:r1s2`, { data: data() })
    const before = history.length
    act(() => { fireEvent.click(el('step-close')) })
    expect(el('step-detail')).toBeNull()
    expect(focusOf()).toBeUndefined()
    expect(history.length).toBe(before)
    act(() => { fireEvent.click(cell(3, 2).querySelector('a')) })
    expect(el('step-detail')).toBeTruthy()
    expect(focusOf()).toBe('r3s2')
  })
  it('with every run shown, the link keeps "all" when the step leaves it', () => {
    renderRig(`${LANES}:r2s3:all`, { data: data() })
    act(() => { window.dispatchEvent(new Event('rig:escape')) })
    expect(focusOf()).toBeUndefined()
    expect(location.hash).toMatch(/::all$/)
  })
})

describe('the step panel\'s code blocks scroll by keyboard (axe scrollable-region-focusable)', () => {
  // run 1 with a conversation: step 2 was sent the output of step 1 as a tool message
  const MSGS = [{ role: 'system', content: 'You fix bugs.' }, { role: 'user', content: 'Fix a.py' },
    { role: 'assistant', content: 'reply 1', tool_calls: [{ id: 'c1', function: { name: 'bash', arguments: '{"command":"ls"}' } }] },
    { role: 'tool', tool_call_id: 'c1', content: 'a.py\nb.py\n'.repeat(40) },
    { role: 'assistant', content: 'reply 2' }]
  const withMsgs = () => { const d = data(); d[`/results/${TOK}/runs/${R[0]}`] = { ...detail(0), messages: MSGS }; return d }
  const codeBlocks = () => [...el('step-detail').querySelectorAll('pre.code, pre.rg-cx-raw')]
  it('every code block in the panel takes the keyboard focus and has a name', () => {
    renderRig(`${LANES}:r1s2`, { data: withMsgs() })
    const sent = el('step-sent')
    expect(sent.querySelector('.rg-cx-mb > pre.code')).toBeTruthy()
    const blocks = codeBlocks()
    expect(blocks.length).toBeGreaterThanOrEqual(3)                           // the tool message, arguments, output
    for (const b of blocks) {
      expect(b.getAttribute('tabindex'), b.textContent.slice(0, 20)).toBe('0')
      expect(b.getAttribute('aria-label') || '', b.textContent.slice(0, 20)).not.toBe('')
    }
    expect(sent.querySelector('.rg-cx-mb > pre.code').getAttribute('aria-label')).toBe('Tool message')
    expect(el('tool-call').querySelector('pre.code').getAttribute('aria-label')).toBe('Arguments')
  })
  it('the Raw view\'s blocks too', () => {
    renderRig(`${LANES}:r1s2`, { data: withMsgs() })
    act(() => { fireEvent.click(el('step-detail').querySelector('[role="radiogroup"] button:last-child, .rg-seg button:last-child')) })
    const raw = [...el('step-detail').querySelectorAll('pre.rg-cx-raw')]
    expect(raw).toHaveLength(2)
    expect(raw.map((b) => [b.getAttribute('tabindex'), b.getAttribute('aria-label')])).toEqual([['0', 'messages.json for this step'], ['0', 'Ledger events of this step']])
  })
})

describe('a folded lane names a shared model call so it cannot be read as a step', () => {
  const words = (e) => e.textContent.replace(/ /g, ' ')
  it('says "model call N", never a bare "call N", and keeps the full words for a screen reader', () => {
    renderRig(`${LANES}:r2s1`, { data: data() })
    const c = cell(1, 2)
    expect(c.classList.contains('compact')).toBe(true)
    expect(c.classList.contains('shared')).toBe(true)
    expect(words(c.querySelector('.rg-cx-stm'))).toBe('model call 1')
    expect(c.querySelector('.rg-cx-sn').textContent).toBe('2')                      // the step number stays beside it
    expect(c.querySelector('a').getAttribute('aria-label')).toContain('also in model call 1')
    for (const m of document.querySelectorAll('.rg-ln-cell .rg-cx-stm')) expect(words(m)).not.toMatch(/^call \d/)
    // a step that leads its call keeps its tokens; an unfolded lane keeps "also in model call N"
    expect(cell(1, 3).classList.contains('shared')).toBe(false)
    act(() => { window.dispatchEvent(new Event('rig:escape')) })
    expect(words(cell(1, 2).querySelector('.rg-cx-stm'))).toBe('also in model call 1')
  })
  it('fits the folded lane on two lines, "model" over "call N", which never split', () => {
    const wide = cssBlocks()['(min-width:1024px)']['.rig .rg-ln-cell.compact.shared .rg-cx-stm']
    expect(wide).toMatch(/white-space:normal/)
    expect(wide).toMatch(/width:min-content/)
    renderRig(`${LANES}:r2s1`, { data: data() })
    expect(cell(1, 2).querySelector('.rg-cx-stm').textContent).toBe('model call 1')
  })
})
