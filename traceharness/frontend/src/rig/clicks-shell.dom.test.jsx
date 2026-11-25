// @vitest-environment jsdom
/* The shell's controls: no click lands on the page already in view, and no click does nothing visible. A control
   with nothing to do in the current state looks inert and says why ("you are here"). */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { renderRig, resetRig, rigFixture, miniRuns, MINI } from '../../test/rig-testing'
import { PhaseBand } from './StepRows'
import { FilterChips } from './primitives'
import { HarnessJson } from './HarnessJson'

afterEach(() => { resetRig(); vi.useRealTimers() })
const tick = (ms = 30) => act(() => new Promise((r) => setTimeout(r, ms)))
const tabsOf = () => decodeURIComponent(location.hash.replace(/^#\/rig\//, '').split('?')[0]).split('|').map((p) => p.split('+').map((t) => t.replace(/^!/, '')))
const nTabs = () => tabsOf().flat().length
const el = (name) => document.querySelector(`[data-el~="${name}"]`)
const mouse = { pointerType: 'mouse' }

const chainStep = (word) => [...document.querySelectorAll('[data-el="evidence-chain"] button')].find((b) => b.textContent.includes(word))
describe('evidence chain: "2 Figure" on its own answer page is a jump in the page', () => {
  it('answered: it stays in this tab, scrolls to the figure and focuses it', async () => {
    renderRig('#/rig/q:mini:outcomes')
    await tick()
    const fig = chainStep('Figure')
    expect(fig.getAttribute('aria-disabled')).toBeNull()
    expect(fig.getAttribute('aria-label')).toBe('2 Figure: jump to the figure on this page')
    const seen = []
    const orig = Element.prototype.scrollIntoView
    Element.prototype.scrollIntoView = function () { seen.push(this.id) }
    try {
      const h0 = location.hash, n0 = history.length
      act(() => { fireEvent.click(fig) })
      await tick()
      expect(location.hash).toBe(h0)
      expect(history.length).toBe(n0)
      expect(nTabs()).toBe(1)
      expect(seen).toEqual(['rg-q-figure'])
      expect(document.activeElement.id).toBe('rg-q-figure')
      expect(document.getElementById('rg-q-figure').getAttribute('data-state')).toBe('jumped')   // seen even when already in view
    } finally { Element.prototype.scrollIntoView = orig }
  })
  it('unanswered: there is no figure, so the step is inert and says why', async () => {
    renderRig('#/rig/q:mock_ctl:sentinel')
    await tick()
    const fig = chainStep('Figure')
    expect(fig.getAttribute('aria-disabled')).toBe('true')
    expect(fig.getAttribute('data-hint')).toBe('No figure: this question is not answered here')
    const h0 = location.hash
    act(() => { fireEvent.click(fig) })
    await tick()
    expect(location.hash).toBe(h0)
    expect(nTabs()).toBe(1)
  })
  it('on a page that is neither an answer nor a loading one (a dataset that is not there), Figure keeps its link', async () => {
    renderRig('#/rig/q:nosuch:outcomes')
    await tick(60)
    const fig = chainStep('Figure')
    expect(el('not-found')).toBeTruthy()
    expect(fig.getAttribute('aria-disabled')).toBeNull()
    act(() => { fireEvent.click(fig) })
    await tick()
    expect(tabsOf().flat()).toContain('q:nosuch:outcomes:figure')
  })
  it('from the runs behind the answer, Figure still opens the answer at its figure', async () => {
    renderRig('#/rig/q:mini:outcomes:runs')
    await tick()
    act(() => { fireEvent.click(chainStep('Figure')) })
    await tick()
    expect(tabsOf().flat()).toContain('q:mini:outcomes:figure')
  })
})

describe('harness names: a click pins the card the hover shows, and the name is not drawn as a link', () => {
  it('the name is a button; a click keeps its card open after the pointer leaves; Esc closes it', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const data = rigFixture()
    data['/overview'] = { ...data['/overview'], harnesses: [{ id: 'baseline', notes: 'The default prompt and tools.', max_steps: 6 }, { id: 'terse' }] }
    renderRig('#/rig/ds:mini', { data })
    await act(async () => { vi.advanceTimersByTime(50) })
    const name = document.querySelector('[data-el~="asking-sentence"] .rg-hn')
    expect(name.getAttribute('role')).toBe('button')
    const hc = name.closest('.rg-hc')
    const card = document.getElementById(name.getAttribute('aria-describedby').split(' ')[0])
    fireEvent.pointerEnter(hc, mouse)
    act(() => { vi.advanceTimersByTime(200) })
    expect(card.getAttribute('data-open')).toBe('true')
    fireEvent.pointerDown(name, mouse)
    fireEvent.click(name)
    fireEvent.pointerLeave(hc, mouse)
    act(() => { vi.advanceTimersByTime(1000) })
    expect(card.getAttribute('data-open')).toBe('true')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(card.getAttribute('data-open')).toBe('false')
    // the keyboard pins it too
    act(() => { name.focus() })
    fireEvent.keyDown(name, { key: 'Enter' })
    expect(card.getAttribute('data-open')).toBe('true')
  })
  it('the name carries no link underline', () => {
    const css = readFileSync(`${process.cwd()}/src/rig/rig.css`, 'utf8')
    const rule = css.match(/\.rig \.rg-hn\{[^}]*\}/)[0]
    expect(rule).not.toMatch(/underline/)
    expect(rule).toMatch(/background/)
  })
})

describe('the step strip: its bands are buttons a keyboard reaches', () => {
  const segments = [{ phase: 'explore', from: 1, to: 3, n: 3 }, { phase: 'edit', from: 4, to: 5, n: 2 }, { phase: 'test', from: 6, to: 6, n: 1 }]
  it('each band is a button "Open step N"; one is in the tab order and the arrows move between them', () => {
    const pick = vi.fn()
    render(<PhaseBand segments={segments} steps={6} onPick={pick} label="6 steps by phase" current={4} />)
    const band = document.querySelector('[data-el="phase-band"]')
    expect(band.getAttribute('role')).toBe('group')
    expect(band.getAttribute('aria-label')).toBe('6 steps by phase')
    const bs = within(band).getAllByRole('button')
    expect(bs.map((b) => b.getAttribute('aria-label'))).toEqual(['Open step 1', 'Open step 4', 'Open step 6'])
    expect(bs.map((b) => b.tabIndex)).toEqual([-1, 0, -1])            // the band holding the current step
    act(() => { bs[1].focus() })
    fireEvent.keyDown(bs[1], { key: 'ArrowRight' })
    expect(document.activeElement).toBe(bs[2])
    fireEvent.keyDown(bs[2], { key: 'Home' })
    expect(document.activeElement).toBe(bs[0])
    fireEvent.click(bs[1])                                          // Enter or Space clicks with detail 0: the band's first step
    expect(pick).toHaveBeenLastCalledWith(4)
  })
  it('once the focus leaves the strip, its tab stop follows the current step again', () => {
    const { rerender } = render(<PhaseBand segments={segments} steps={6} onPick={() => {}} label="6 steps by phase" current={1} />)
    const bs = () => within(document.querySelector('[data-el="phase-band"]')).getAllByRole('button')
    act(() => { bs()[2].focus() })
    expect(bs().map((b) => b.tabIndex)).toEqual([-1, -1, 0])
    act(() => { bs()[2].blur() })
    rerender(<PhaseBand segments={segments} steps={6} onPick={() => {}} label="6 steps by phase" current={4} />)
    expect(bs().map((b) => b.tabIndex)).toEqual([-1, 0, -1])
  })
  it('without onPick the strip stays a picture', () => {
    render(<PhaseBand segments={segments} steps={6} label="6 steps by phase" />)
    expect(document.querySelector('[data-el="phase-band"]').getAttribute('role')).toBe('img')
    expect(document.querySelectorAll('[data-el="phase-band"] button')).toHaveLength(0)
  })
})

const ID3 = '20260101-000000-a00003'
const base3 = { run_id: ID3, task_id: 't2', harness_id: 'baseline', 'gen_ai.request.model': 'acme/alpha-1' }
const cutSpans = [
  { ...base3, seq: 0, span: 'invoke_agent', status: 'start', harness: { id: 'baseline', tools: ['read_file', 'submit'], max_steps: 20, max_tokens_per_call: 2048 } },
  { ...base3, seq: 1, span: 'chat', 'gen_ai.response.finish_reasons': ['tool_calls'], step: 0, text: '', tool_calls: [{ name: 'read_file', arguments: { path: 'src/a.py' } }] },
  { ...base3, seq: 2, span: 'execute_tool', 'gen_ai.tool.name': 'read_file', args: { path: 'src/a.py' }, status: 'ok', result_preview: '1| def a(): pass' },
  { ...base3, seq: 3, span: 'chat', 'gen_ai.usage.output_tokens': 2048, 'gen_ai.response.finish_reasons': ['length'], step: 1, text: '', tool_calls: [] },
  { ...base3, seq: 4, span: 'grade', visible: false, hidden: false, strong: false },
  { ...base3, seq: 5, span: 'invoke_agent', status: 'end', exit_reason: 'no_action', hidden_pass: false },
]
const runData = () => ({ ...rigFixture(), [`/results/${MINI}/runs/${ID3}`]: { summary: miniRuns().find((r) => r.run_id === ID3), spans: cutSpans, patch: '', messages: [], issue: '', replay: [] } })
const row = (n) => el('run-console').querySelector(`.rg-cx-st[data-n="${n}"] .rg-cx-rowb`)
describe('the open step: its own row and its landmarks say "you are here" and do nothing', () => {
  it('the row of the open step is inert; the other rows still open their step', async () => {
    renderRig(`#/rig/run:${ID3}:s2`, { data: runData() })
    await tick()
    expect(row(2).getAttribute('aria-current')).toBe('step')
    expect(row(2).getAttribute('aria-disabled')).toBe('true')
    expect(row(2).hasAttribute('data-here')).toBe(true)
    expect(row(2).getAttribute('aria-label')).toMatch(/^Step 2: .* · you are here$/)   // the row's own hover card says it too
    expect(row(1).getAttribute('aria-disabled')).toBeNull()
    const h0 = location.hash, n0 = history.length
    act(() => { fireEvent.click(row(2)) })
    act(() => { fireEvent.keyDown(row(2), { key: 'Enter' }) })
    expect(location.hash).toBe(h0)
    expect(history.length).toBe(n0)
    expect(el('step-detail').getAttribute('aria-label')).toBe('Step 2 of 2')
    act(() => { fireEvent.click(row(1)) })
    expect(location.hash).toBe(`#/rig/run:${ID3}:s1`)
  })
  it('with the step panel closed, the current row is live again: it opens the panel', async () => {
    renderRig(`#/rig/run:${ID3}:s2`, { data: runData() })
    await tick()
    act(() => { fireEvent.click(within(el('step-detail')).getByRole('button', { name: /^Close/ })) })
    expect(el('step-detail')).toBeNull()
    expect(row(2).getAttribute('aria-disabled')).toBeNull()
    act(() => { fireEvent.click(row(2)) })
    expect(el('step-detail').getAttribute('aria-label')).toBe('Step 2 of 2')
  })
  it('"step 2 · length" under How it failed is inert while step 2 is open, live from another step', async () => {
    renderRig(`#/rig/run:${ID3}:s2`, { data: runData() })
    await tick()
    const chip = () => [...el('failure-finding').querySelectorAll('.rg-traj-evl')].find((b) => b.textContent === 'step 2 · length')
    expect(chip().getAttribute('aria-disabled')).toBe('true')
    expect(chip().hasAttribute('data-here')).toBe(true)
    expect(chip().getAttribute('data-hint')).toMatch(/· you are here$/)
    const n0 = history.length
    act(() => { fireEvent.click(chip()) })
    expect(history.length).toBe(n0)
    act(() => { fireEvent.click(row(1)) })
    expect(chip().getAttribute('aria-disabled')).toBeNull()
    act(() => { fireEvent.click(chip()) })
    expect(location.hash).toBe(`#/rig/run:${ID3}:s2`)
  })
})

describe('Buddy: "Open a dataset" on Datasets is where you are', () => {
  it('on Datasets it is inert and points at the list below', async () => {
    renderRig('#/rig/home?dock=buddy')
    await tick()
    const b = screen.getByRole('button', { name: 'Open a dataset' })
    expect(b.getAttribute('aria-disabled')).toBe('true')
    expect(b.hasAttribute('data-here')).toBe(true)
    expect(b.getAttribute('data-hint')).toBe('You are here: pick a dataset below')
    act(() => { fireEvent.click(b) })
    expect(nTabs()).toBe(1)
  })
  it('elsewhere it opens Datasets', async () => {
    renderRig('#/rig/settings?dock=buddy')
    await tick()
    const b = screen.getByRole('button', { name: 'Open a dataset' })
    expect(b.getAttribute('aria-disabled')).toBeNull()
    act(() => { fireEvent.click(b) })
    expect(tabsOf().flat()).toContain('home')
  })
})

describe('the Agent panel says a repeated error once', () => {
  const NOW = Date.now() / 1000
  const err = 'No experiments: they are recorded by the local runner, which is not set up here. (HTTP 404)'
  const calls = { total: 3, calls: [
    { tool: 'experiments_list', level: 'read', ok: false, ms: 2, targets: {}, error: err, at: NOW - 5 },
    { tool: 'runner_status', level: 'read', ok: true, ms: 3, targets: {}, at: NOW - 6 },
    { tool: 'experiments_list', level: 'read', ok: false, ms: 2, targets: {}, error: err, at: NOW - 60 },
  ] }
  it('the newest call shows the sentence; the earlier identical one points back to it', async () => {
    renderRig('#/rig/?dock=agent', { data: { ...rigFixture(), '/agent/status': { session: null, calls: 3, last_call_at: NOW - 5, active: false }, '/agent/calls?limit=60': calls } })
    await tick()
    const dock = el('agent-dock')
    expect([...dock.querySelectorAll('.rg-agent-error')].map((e) => e.textContent)).toEqual([err])
    const rows = [...dock.querySelectorAll('[data-el="agent-call"]')]
    expect(rows).toHaveLength(3)
    const again = rows[2].querySelector('[data-el="agent-error-again"]')
    expect(again.firstChild.textContent).toMatch(/^Same error as at \d\d:\d\d:\d\d$/)
    expect(again.getAttribute('data-hint')).toBe(err)
    expect(again.querySelector('.sr-only').textContent).toBe(`: ${err}`)          // a screen reader still hears it
    expect(rows[2].className).toContain('err')
  })
})

describe('the chip already shown is inert and says so', () => {
  it('Datasets: "All" while every kind is shown', async () => {
    renderRig('#/rig/home')
    await tick()
    const all = within(el('dataset-filter')).getByRole('button', { name: /^All/ })
    expect(all.getAttribute('aria-pressed')).toBe('true')
    expect(all.getAttribute('aria-disabled')).toBe('true')
    expect(all.getAttribute('data-hint')).toBe('Showing all')
  })
  it('FilterChips: the pressed chip does not call onChange; the others do', () => {
    const on = vi.fn()
    render(<FilterChips label="Kind" value="a" onChange={on} options={[{ value: 'all', label: 'All' }, { value: 'a', label: 'Alpha' }]} />)
    const [all, a] = screen.getAllByRole('button')
    expect(a.getAttribute('aria-disabled')).toBe('true')
    expect(a.getAttribute('data-hint')).toBe('Showing Alpha only')
    fireEvent.click(a)
    expect(on).not.toHaveBeenCalled()
    expect(all.getAttribute('aria-disabled')).toBeNull()
    fireEvent.click(all)
    expect(on).toHaveBeenCalledWith('all')
  })
  it('⌘K: the "All" kind chip while every kind is shown', async () => {
    renderRig('#/rig/home?pal=1')
    await tick()
    act(() => { fireEvent.change(screen.getByRole('combobox', { name: /^Search datasets/ }), { target: { value: 'mini' } }) })
    const kinds = within(el('palette-kinds'))
    const all = kinds.getByRole('button', { name: /^All/ })
    expect(all.getAttribute('aria-disabled')).toBe('true')
    expect(all.getAttribute('data-hint')).toBe('Showing all')
    act(() => { all.focus(); fireEvent.click(all) })
    expect(document.activeElement).toBe(screen.getByRole('combobox', { name: /^Search datasets/ }))   // the keys still drive the list
    const other = kinds.getAllByRole('button').find((b) => b !== all)
    act(() => { fireEvent.click(other) })
    expect(all.getAttribute('aria-disabled')).toBeNull()
  })
})

describe('controls whose label promises nothing new here are inert and say why', () => {
  it('Voice tour: the chapter in view', async () => {
    renderRig('#/rig/home')
    await tick()
    fireEvent.click(screen.getByRole('button', { name: 'Help' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Voice tour' }))
    const nav = screen.getByRole('navigation', { name: 'Tour chapters' })
    const [first, second] = within(nav).getAllByRole('button')
    expect(first.getAttribute('aria-disabled')).toBe('true')
    expect(first.getAttribute('data-hint')).toBe('Chapter 1 · you are here')
    act(() => { fireEvent.click(second) })
    expect(first.getAttribute('aria-disabled')).toBeNull()
    expect(second.getAttribute('aria-disabled')).toBe('true')
  })
  it('Map: "fit" when the tree already fits, "1:1" at actual size', async () => {
    renderRig('#/rig/canvas')
    await tick()
    const tools = within(screen.getByRole('toolbar', { name: 'Canvas tools' }))
    const fit = tools.getByRole('button', { name: 'fit' })
    const one = tools.getByRole('button', { name: 'Actual size' })
    expect(fit.getAttribute('aria-disabled')).toBe('true')
    expect(fit.getAttribute('data-hint')).toBe('The whole tree already fits in view')
    expect(one.getAttribute('aria-disabled')).toBe('true')
    act(() => { fireEvent.click(tools.getByRole('button', { name: 'Zoom in' })) })
    expect(fit.getAttribute('aria-disabled')).toBeNull()
    expect(one.getAttribute('aria-disabled')).toBeNull()
    act(() => { fireEvent.click(fit) })
    expect(fit.getAttribute('aria-disabled')).toBe('true')
  })
  it('View JSON: the document already shown', () => {
    render(<HarnessJson documents={[{ id: 'a', label: 'Configuration file', value: { a: 1 } }, { id: 'b', label: 'Runtime settings', value: { b: 2 } }]} />)
    fireEvent.click(screen.getByRole('button', { name: 'View JSON' }))
    const docs = within(screen.getByRole('group', { name: 'JSON documents' }))
    const file = docs.getByRole('button', { name: 'Configuration file' })
    expect(file.getAttribute('aria-disabled')).toBe('true')
    expect(file.getAttribute('data-hint')).toBe('Showing Configuration file')
    act(() => { fireEvent.click(docs.getByRole('button', { name: 'Runtime settings' })) })
    expect(file.getAttribute('aria-disabled')).toBeNull()
    expect(screen.getByRole('textbox', { name: 'Harness JSON source' }).textContent).toContain('"b"')
  })
})

describe('Minimal harness: "Review configuration" shows the configuration it jumps to', () => {
  it('the jump focuses Your configuration and marks it, so the press is seen even when it is already in view', async () => {
    renderRig('#/rig/shallowWizard')
    await tick()
    const b = screen.getByRole('button', { name: 'Review configuration' })
    expect(b.getAttribute('data-hint')).toBe('Jump to Your configuration, below the six questions')
    const summary = screen.getByRole('complementary', { name: 'Your configuration' })
    expect(summary.getAttribute('data-state')).toBeNull()
    const orig = Element.prototype.scrollIntoView
    Element.prototype.scrollIntoView = () => {}                    // jsdom draws nothing to scroll
    try { act(() => { fireEvent.click(b) }) } finally { Element.prototype.scrollIntoView = orig }
    expect(summary.getAttribute('data-state')).toBe('jumped')
    expect(document.activeElement.textContent).toBe('Your configuration')
  })
})

describe('Add data draws nothing that depends on the adapters before they answer', () => {
  it('while /import/sources is pending a placeholder holds the place; the suggestions and the form come together', async () => {
    let answer
    const pending = new Promise((r) => { answer = r })
    const json = (data) => ({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => data })
    const fetchImpl = vi.fn(async (url) => {
      if (String(url).startsWith('/api/import/sources')) return pending
      return { ok: false, status: 404, statusText: 'Not Found', headers: { get: () => 'application/json' }, json: async () => ({ detail: 'not primed' }) }
    })
    renderRig('#/rig/sources', { fetchImpl })
    await tick()
    expect(el('path-suggestions')).toBeNull()
    expect(screen.queryByRole('combobox', { name: 'Adapter' })).toBeNull()
    expect(el('import-form-wait').getAttribute('aria-busy')).toBe('true')
    expect(screen.getByRole('textbox', { name: /^Path to a session file or folder/ })).toBeTruthy()   // typing can start at once
    await act(async () => { answer(json({ sources: [{ name: 'codex', description: 'Codex CLI sessions', patterns: ['~/.codex/sessions/**/*.jsonl'] }] })); await new Promise((r) => setTimeout(r, 30)) })
    expect(el('import-form-wait')).toBeNull()
    expect(el('path-suggestions')).toBeTruthy()
    expect(screen.getByRole('combobox', { name: 'Adapter' })).toBeTruthy()
  })
})

describe('Add data keeps two lines for its header line on a phone', () => {
  it('the results folder arrives with /settings and takes a second line there: the space is held from the start', () => {
    const css = readFileSync(`${process.cwd()}/src/rig/views/workspace.css`, 'utf8')
    const rule = css.match(/@container \(max-width:640px\)\{[^@]*\[data-el~="add-data-head"\] \.rg-ph-meta\{min-height:calc\(2 \* var\(--rig-lead-md\)\)\}/)
    expect(rule).not.toBeNull()
  })
})

describe('Datasets: the open dataset\'s tag is a status, and the row\'s mouse target is its link', () => {
  it('says "open now" as a status, not "· open"', async () => {
    renderRig('#/rig/home')
    await tick()
    const tag = el('dataset-open-now')
    expect(tag.textContent).toBe('open now')
    expect(document.body.textContent).not.toContain('· open')
    expect(tag.closest('tr').dataset.row).toBe('mini')
  })
  it('a click anywhere on a row is a click on its dataset link', async () => {
    renderRig('#/rig/home')
    await tick()
    const tr = document.querySelector('tr[data-row="mock_ctl"]')
    const link = within(tr).getByRole('link', { name: /^Open/ })
    const spy = vi.fn()
    link.addEventListener('click', spy)
    act(() => { fireEvent.click(tr.querySelector('[data-el="dataset-stats"]')) })
    expect(spy).toHaveBeenCalledTimes(1)
    expect(location.hash).toBe('#/rig/home+!ds:mock_ctl')
  })
})
