// @vitest-environment jsdom
/* Logos beside names, page by page. The fixture is the usual "mini" dataset with its first model renamed
   qwen/qwen9-1b and its second harness claude-code-terse (invented names in real shapes); acme/beta-2, baseline and
   mock keep no logo. Every logo is decorative: hidden from screen readers, no text of its own. */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { fireEvent, render, waitFor, within } from '@testing-library/react'
import { renderRig, resetRig, rigFixture } from '../../../test/rig-testing'
import { DatasetOption } from '../DatasetOption'
import { FigureCard } from '../learn/figures/FigureCard'
import { brandOf } from './brands'

afterEach(resetRig)

const QWEN = 'qwen/qwen9-1b'
const CC = 'claude-code-terse'
function branded(extra = {}) {
  const data = JSON.parse(JSON.stringify(rigFixture()).replaceAll('acme/alpha-1', QWEN).replaceAll('"terse"', `"${CC}"`))
  return { ...data, ...extra }
}
const el = (c, id) => c.querySelector(`[data-el~="${id}"]`)
const logos = (node) => [...node.querySelectorAll('.rg-logo')]
const brands = (node) => logos(node).map((i) => i.dataset.brand)
/** Every logo in `node` is decoration only. */
function decorative(node) {
  for (const i of logos(node)) {
    expect(i.getAttribute('aria-hidden') === 'true' || !!i.closest('[aria-hidden="true"]'), i.outerHTML).toBe(true)
    expect(i.textContent).toBe('')
    expect(i.getAttribute('role')).toBeNull()
    expect(i.getAttribute('aria-label')).toBeNull()
  }
}

describe('model and harness names in tables and headers', () => {
  it('Overview, Model performance: each model with its dot, then its logo where it has one; the link still reads the name', () => {
    const { container } = renderRig('#/rig/ds:mini:qwen9-1b:baseline', { data: branded() })
    const table = el(container, 'model-performance-table')
    const rows = [...table.querySelectorAll('tbody tr')]
    const qwen = rows.find((r) => r.textContent.includes('qwen9-1b'))
    const beta = rows.find((r) => r.textContent.includes('beta-2'))
    expect(brands(qwen)).toEqual(['qwen'])
    expect(qwen.querySelector('.rg-ent.m')).not.toBeNull()
    expect(brands(beta)).toEqual([])
    expect(qwen.querySelector('td.rg-ds-mname .rg-tlink').textContent).toBe('qwen9-1b')
    decorative(table)
  })

  it('the Change menu (the model and harness filter of Overview, Tasks and Runs) marks each model and harness choice', () => {
    const { container } = renderRig('#/rig/tasks:mini:qwen9-1b:baseline', { data: branded() })
    fireEvent.click(within(container).getByRole('button', { name: 'Change model, harness or oracle' }))
    const opts = [...container.querySelectorAll('.rg-pop-opt button')]
    const by = (t) => opts.find((b) => b.textContent === t)
    expect(brands(by(QWEN))).toEqual(['qwen'])
    expect(brands(by('acme/beta-2'))).toEqual([])
    expect(brands(by(CC))).toEqual(['claudecode'])
    expect(brands(by('baseline'))).toEqual([])
    expect(by(QWEN).querySelector('.rg-ent.m')).not.toBeNull()
    // the button lays its children out in a row: the name with its marks is one child, so its parts keep no gap
    // between them
    for (const b of opts) expect(b.children.length, b.textContent).toBe(1)
    // and a long one wraps at its hyphens with lines that do not touch
    for (const b of opts) expect(b.firstElementChild.className).toBe('rg-ent-line')
    expect(readFileSync(join(__dirname, 'brand.css'), 'utf8')).toMatch(/\.rig \.rg-ent-line\{white-space:normal;line-height:var\(--rig-lead-sm\)\}/)
    decorative(container)
  })

  it('the all-runs view names its model and harness once, above the lanes, with their marks', async () => {
    const { container } = renderRig('#/rig/lanes:mini:qwen9-1b:claude-code-terse:t1', { data: branded() })
    const head = await waitFor(() => { const h = el(container, 'lanes-condition'); expect(h).not.toBeNull(); return h })
    expect(head.textContent).toBe('qwen9-1b under claude-code-terse')
    expect(brands(head)).toEqual(['qwen', 'claudecode'])
    expect(head.querySelectorAll('.rg-ent').length).toBe(2)
    // the lane heads themselves stay "Run 1", "Run 2": the name is said once, not once per lane
    for (const h of container.querySelectorAll('[data-el="lane-head"]')) expect(brands(h)).toEqual([])
    decorative(container)
  })

  it('Compare: the line under the title marks the model and the harness, as the run page does', async () => {
    const { container } = renderRig('#/rig/run:20260101-000000-a00004+!cmp:20260101-000000-a00004:20260101-000000-a00005', { data: branded() })
    const head = await waitFor(() => { const h = el(container, 'cmp-heading'); expect(h).not.toBeNull(); return h })
    const line = el(head, 'run-line')
    expect(line.textContent).toContain('Model qwen9-1b')
    expect(line.textContent).toContain(`Harness ${CC}`)
    expect(brands(line)).toEqual(['qwen', 'claudecode'])
    decorative(container)
  })

  it('a step page: the run line under its title marks the model and the harness', async () => {
    const ledger = { spans: [{ seq: 0, span: 'invoke_agent', status: 'start' }, { seq: 1, span: 'chat', step: 0, tool_calls: [{ name: 'bash', arguments: { command: 'ls' } }] },
      { seq: 2, span: 'execute_tool', 'gen_ai.tool.name': 'bash', status: 'ok' }, { seq: 3, span: 'grade', visible: true, hidden: true, strong: true }], summary: {} }
    const id = '20260101-000000-a00004'
    const { container } = renderRig(`#/rig/span:${id}:1`, { data: branded({ [`/results/mini/runs/${id}`]: ledger }) })
    const line = await waitFor(() => { const l = el(el(container, 'span-heading') || container, 'run-line'); expect(l).not.toBeNull(); return l })
    expect(line.textContent).toContain('Model qwen9-1b')
    expect(brands(line)).toEqual(['qwen', 'claudecode'])
    decorative(container)
  })
})

describe('datasets: the table, the picker and where a dataset comes from', () => {
  const HF = { url: 'https://huggingface.co/datasets/acme/runs-9', dataset: 'acme/runs-9' }
  const withSource = () => { const d = branded(); d['/overview'].results[0].source = HF; return d }

  it('Datasets: a dataset fetched from Hugging Face says so under its kind, with the logo; the others do not', () => {
    const { container } = renderRig('#/rig/home', { data: withSource() })
    const rows = [...container.querySelectorAll('tbody tr')]
    const mini = rows.find((r) => r.textContent.includes('mini'))
    const mock = rows.find((r) => r.textContent.includes('mock_ctl'))
    const src = el(mini, 'dataset-source')
    expect(src.textContent).toBe('Hugging Face')
    expect(brands(src)).toEqual(['huggingface'])
    expect(el(mock, 'dataset-source')).toBeNull()
    // the Models column marks qwen9-1b beside its dot, and nothing beside beta-2 or mock
    expect(brands(el(mini, 'dataset-models'))).toEqual(['qwen'])
    expect(brands(el(mock, 'dataset-models'))).toEqual([])
    expect(brands(el(mini, 'dataset-harness-names'))).toEqual(['claudecode'])
    decorative(container)
  })

  it('the dataset picker: one logo per brand of its models before the counts, and its source', () => {
    const row = { name: 'runs_x', origin: 'public', models: [QWEN, 'qwen/qwen9-7b', 'google/gemini-9-flash', 'acme/beta-2'], harnesses: ['baseline'], tasks: ['t1'], runs: 4, pass_rate: null, source: HF }
    const { container } = render(<DatasetOption row={row} />)
    const facts = container.querySelector('.rg-dso-m')
    expect(brands(facts)).toEqual(['qwen', 'gemini'])
    expect(facts.textContent).toMatch(/^4 models · /)
    expect(el(container, 'dataset-source').textContent).toBe('Hugging Face')
    decorative(container)
    const plain = render(<DatasetOption row={{ ...row, models: ['mock', 'acme/beta-2'], source: {} }} />)
    expect(logos(plain.container)).toEqual([])
    // the logos make the line longer: "pass" stays on the line of its number when it wraps
    const rated = render(<DatasetOption row={{ ...row, pass_rate: 0.845, pass_ci95: [0.79, 0.9], graded: 100 }} />)
    const held = rated.container.querySelector('.rg-dso-m .rg-nw')
    expect(held && held.textContent).toMatch(/^pass 84\.5%/)
  })
})

describe('Add data', () => {
  const SOURCES = { sources: [
    { name: 'claude_code', description: 'Claude Code session JSONL (~/.claude/projects/<project>/<session>.jsonl)', patterns: ['*.jsonl'] },
    { name: 'codex', description: 'OpenAI Codex CLI rollout JSONL (~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl)', patterns: ['rollout-*.jsonl'] },
    { name: 'muse', description: 'Muse Code session log (~/.local/share/muse/sessions/YYYY/MM/DD/<session>/session.jsonl)', patterns: ['session.jsonl'] },
  ] }
  const IDLE = { status: 'idle', progress: null, error: null, result: null, history: [] }
  const CAT = { schema: 1, refreshed: '2026-11-16', datasets: [
    { id: 'acme/SWE-agent-trajectories', kind: 'trajectories', title: 't', summary: 'Recorded runs.', rows: 9, license: 'mit', gated: false },
    { id: 'SWE-bench/SWE-smith-trajectories', kind: 'trajectories', title: 't', summary: 'Recorded runs.', rows: 9, license: 'mit', gated: false },
    { id: 'acme/SWE-chat', kind: 'trajectories', title: 't', summary: 'Chats.', rows: 9, license: null, gated: true },
  ] }
  const add = () => branded({ '/import/sources': SOURCES, '/import/status': IDLE, '/real/status': IDLE, '/hf/catalog': CAT })

  it('Import files: each tool in the adapter list has its logo; a tool with no open mark keeps its plain name', () => {
    const { container } = renderRig('#/rig/sources', { data: add() })
    const chips = [...el(container, 'path-suggestions').querySelectorAll('button')]
    const chip = (t) => chips.find((b) => b.textContent.startsWith(t))
    expect(brands(chip('Claude Code'))).toEqual(['claudecode'])
    expect(brands(chip('Codex'))).toEqual(['codex'])
    expect(brands(chip('muse'))).toEqual([])
    // the adapter picked under Adapter is named with its logo in About importing
    fireEvent.change(within(container).getByLabelText('Adapter'), { target: { value: 'codex' } })
    expect([...el(container, 'import-about').querySelectorAll('p b')].map((b) => [b.textContent, brands(b)])).toContainEqual(['Codex', ['codex']])
    decorative(container)
  })

  it('Public sample: the Hugging Face heading has its logo once; a catalogue row has the agent or source its id names', () => {
    const { container } = renderRig('#/rig/sources:sample', { data: add() })
    const sec = el(container, 'hugging-face')
    expect(brands(sec.querySelector('h2'))).toEqual(['huggingface'])
    const rows = [...el(container, 'hf-catalog').querySelectorAll('tbody tr')]
    expect(rows.map((r) => brands(r.querySelector('td'))).flat()).toEqual(['sweagent', 'swebench'])
    expect(rows[0].querySelector('td b').textContent).toBe('acme/SWE-agent-trajectories')
    expect(brands(el(container, 'swe-agent-import').querySelector('h2'))).toEqual(['sweagent'])
    decorative(container)
  })

  it('Session capture: the sources it reads, each with its logo, and a captured run\'s model', () => {
    const status = { runs_indexed: 1, open_runs: 0, open: [], totals: { input_tokens: 1, output_tokens: 1, cost_usd: 0, unmeasured_runs: 0 },
      adapters: ['claude_code', 'codex', 'qwen_code', 'agy', 'cursor', 'muse'], sniffer: { state: 'idle', roots: 1, interval_s: 60, errors: 0, debris: 0, debris_checked_at: 0 },
      cursors: { sources: 1, seeded: 0 }, control: { paused: false } }
    const data = branded({ '/settings': { results_root: '/lab/data/runs', results: [] }, 'private:/capture/status': status,
      'private:/capture/runs?limit=25': { rows: [{ run_id: 'cap-1', task_id: 'a task', model: 'anthropic/claude-x-9', steps: 3, cost_usd: 0, exit_reason: 'submitted' }], total: 1 },
      'private:/capture/relations': { relations: {} } })
    const { container } = renderRig('#/rig/capture', { data })
    const list = el(container, 'capture-sources')
    expect(list.textContent).toBe('Claude Code, Codex, Qwen Code, agy, Cursor, muse')
    expect(brands(list)).toEqual(['claudecode', 'codex', 'qwen', 'antigravity', 'cursor'])
    expect(brands(el(container, 'captured-run'))).toEqual(['claude'])
    decorative(container)
  })
})

describe('Harnesses: the six TraceHarness copies of agents', () => {
  for (const [page, el] of [['shallowCards', 'shallow-cards'], ['shallowApply', 'shallow-apply']]) {
    it(`${page}: each card's heading has the logo of the agent it copies, once`, () => {
      const { container } = renderRig(`#/rig/${page}`, { data: { '/overview': { results: [] } } })
      const heads = [...container.querySelector(`[data-el="${el}"]`).querySelectorAll('.rg-harness-card-head h2')]
      expect(heads.map((h) => h.textContent)).toEqual(['Claude Code', 'Codex', 'Qwen', 'Kimi', 'Antigravity', 'Grok'].map((n) => `${n} — TraceHarness copy`))
      expect(heads.map((h) => brands(h))).toEqual([['claudecode'], ['codex'], ['qwen'], ['kimi'], ['antigravity'], ['grok']])
      decorative(container)
    })
  }
})

describe('Learn figure legends', () => {
  it('a legend entry that names a model has its logo after its swatch; others do not', () => {
    const fig = { kind: 'x', id: 'x', caption: 'A caption.' }
    const legend = [{ label: 'qwen9-1b · 4 runs', tone: 'fa-m0', brand: QWEN }, { label: 'beta-2 · 4 runs', tone: 'fa-m1', brand: 'acme/beta-2' }, { label: 'the plan', tone: 'dot' }]
    const { container } = render(<FigureCard fig={fig} n={1} legend={legend} chart={<svg />} />)
    const items = [...container.querySelectorAll('.rg-lfig-legend li')]
    expect(items.map((li) => brands(li))).toEqual([['qwen'], [], []])
    expect(items[0].querySelector('.rg-lfig-sw').nextElementSibling.dataset.brand).toBe('qwen')
    expect(items.map((li) => li.textContent)).toEqual(['qwen9-1b · 4 runs', 'beta-2 · 4 runs', 'the plan'])
    decorative(container)
  })

  /** [legend text, its logos] of each legend entry of the figure of this kind on this article. */
  async function legendOf(slug, kind) {
    const { container } = renderRig(`#/rig/guide:${slug}`)
    const f = await waitFor(() => { const x = container.querySelector(`[data-el="learn-figure"][data-kind="${kind}"]`); expect(x).not.toBeNull(); return x })
    return [...f.querySelectorAll('.rg-lfig-legend li')].map((li) => [li.textContent, brands(li)])
  }
  it('the articles\' figures that name a model in a legend entry draw its logo there (and only there)', async () => {
    const after = await legendOf('phases-and-wasted-work', 'after_hist')
    expect(after.length).toBeGreaterThan(1)
    // each entry starts with its model's name; the logo is the one that name's rule gives
    for (const [text, got] of after) expect(got, text).toEqual([brandOf('model', text.split(' · ')[0])].filter(Boolean))
    expect(after.some(([, got]) => got.length === 1)).toBe(true)
    const detect = await legendOf('how-many-runs', 'detect_n')
    const named = detect.filter(([text]) => text.endsWith('harness changes'))
    expect(named).toHaveLength(1)
    expect(named[0][1]).toEqual([brandOf('model', named[0][0].split("'s ")[0])].filter(Boolean))
    for (const [text, got] of detect.filter(([t]) => !t.endsWith('harness changes'))) expect(got, text).toEqual([])
  })
})
