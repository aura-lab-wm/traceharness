// @vitest-environment jsdom
/* Harnesses is the home of every harness editor:
   Customize folds into One run › Advanced settings with its search, count, reopen-by-ID check and
   restored-draft notice; one "Save harness" saves everywhere; Saved versions names the four places a
   harness is kept. Build stays its own editor. */
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderRig, resetRig } from '../../../test/rig-testing'
import { CARDS, RECOMMENDED_ID, blocksFromAnswers } from './shallow-data'
import { SHARED } from '../../shared/index.js'

afterEach(resetRig)
const draftKey = (name) => SHARED.drafts.prefix_local + name
const json = (data, status = 200) => ({ ok: status >= 200 && status < 300, status, statusText: status === 200 ? 'OK' : 'Error', headers: { get: () => 'application/json' }, json: async () => data })
const SAVED = (id, prompt, tools = ['list_files', 'read_file', 'submit']) => ({ id, lane: 'minimal', prompt, system_prompt: prompt, tools, policy: 'strict', context_window: 0, observation_chars: 6000,
  max_steps: 9, max_total_tokens: 400000, temperature: 0, max_tokens_per_call: 2048, include_file_listing: true })
const A = SAVED('min_aaaaaaaaaaaa', 'Alpha prompt reads only.'), B = SAVED('min_bbbbbbbbbbbb', 'Beta prompt with a shell.', ['list_files', 'bash', 'submit'])

function local({ library = [A, B], one = (id) => library.find((r) => r.id === id) } = {}) {
  const requests = []
  const fetchImpl = vi.fn(async (url, opts = {}) => {
    const method = opts.method || 'GET'
    const body = opts.body ? JSON.parse(opts.body) : null
    requests.push({ url: String(url), method, body })
    if (url === '/api/shallow/catalog') return json({ harnesses: CARDS.map((r) => ({ ...r, hash: '123456789abc' })) })
    if (url === '/api/shallow/harnesses' && method === 'GET') return json({ harnesses: library, loaded: true, unconfirmed: [] })
    if (String(url).startsWith('/api/shallow/harnesses/')) {
      const row = one(decodeURIComponent(String(url).split('/').pop()))
      return row ? json({ harness: row }) : json({ detail: 'No saved harness with that ID on this computer.' }, 404)
    }
    if (url === '/api/shallow/compile') return json({ ok: true, hash: RECOMMENDED_ID.slice(4), warnings: [], harness: { id: RECOMMENDED_ID } })
    if (url === '/api/blocks/palette') return json({ tools: ['list_files', 'read_file', 'edit_file', 'run_tests', 'bash', 'submit'], types: ['prompt', 'tools', 'policy', 'context', 'stop', 'sampling', 'listing'], blank: blocksFromAnswers() })
    if (url === '/api/blocks/catalog') return json({ harnesses: [{ id: 'claude_code', name: 'Claude Code', default_model: 'mock', default_basis: 'x', blocks: blocksFromAnswers() }] })
    if (url === '/api/blocks/compile') return json({ ok: true, hash: 'abc', warnings: [], harness: { id: 'blk_abc' } })
    return json({ detail: 'Not found.' }, 404)
  })
  return { fetchImpl, requests }
}
const advanced = () => screen.getByRole('region', { name: 'Advanced harness settings' })

describe('Customize opens One run with Advanced settings open', () => {
  it('the old address keeps working and the left list marks One run', async () => {
    const { fetchImpl } = local()
    const { container } = renderRig('#/rig/blocks:customize', { fetchImpl, storage: { 'rig.nav': 'open' } })
    expect(container.querySelector('.rg-doc').dataset.spec).toBe('blocks:customize')
    expect(container.querySelector('[data-el="harness-composer"]')).toBeTruthy()
    expect(advanced()).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Advanced settings' }).getAttribute('aria-expanded')).toBe('true')
    expect([...document.querySelectorAll('.rg-rail [aria-current]')].map((b) => b.getAttribute('aria-label'))).toEqual(['One run'])
    // the wizard's way back and its reset are where Customize had them
    const nav = within(container.querySelector('[data-el="minimal-customize-nav"]'))
    expect(nav.getByRole('button', { name: 'Back to Minimal Wizard' }).getAttribute('data-spec')).toBe('shallowWizard')
    expect(nav.getByRole('button', { name: 'Reset to Wizard Answers' })).toBeTruthy()
  })
  it('opens the custom harness even when the tab was last on a fixed copy', async () => {
    const fixedTab = blocksFromAnswers().map((x) => (x.type === 'prompt' ? { ...x, text: 'Blocks left over from a fixed copy.' } : x))
    sessionStorage.setItem(draftKey('composer'), JSON.stringify({ selection: 'fixed:claude', edit_mode: 'prompt', blocks: fixedTab }))
    const { fetchImpl } = local()
    renderRig('#/rig/blocks:customize', { fetchImpl })
    expect(advanced()).toBeTruthy()
    expect(screen.getByRole('combobox', { name: 'Harness', exact: true }).value).toBe('Custom TraceHarness harness')
    expect(screen.getByRole('textbox', { name: 'Prompt' }).value).toBe(blocksFromAnswers().find((x) => x.type === 'prompt').text)   // the wizard's blocks, as Customize showed
  })
  it('Advanced settings has Customize\'s search over saved harnesses, with its "Showing X of Y" line', async () => {
    const { fetchImpl } = local()
    renderRig('#/rig/blocks:customize', { fetchImpl })
    const panel = within((await screen.findByRole('heading', { name: 'Your saved harnesses' })).parentElement)
    await waitFor(() => expect(panel.getByText('Showing 2 of 2 saved minimal harnesses.')).toBeTruthy())
    fireEvent.change(panel.getByRole('searchbox', { name: 'Find a saved harness' }), { target: { value: 'bash' } })
    expect(panel.getByText('Showing 1 of 2 saved minimal harnesses.')).toBeTruthy()
    expect(panel.getAllByRole('option').map((o) => o.value).filter(Boolean)).toEqual([B.id])
    fireEvent.change(panel.getByRole('searchbox', { name: 'Find a saved harness' }), { target: { value: 'nothing like it' } })
    expect(panel.getByRole('option', { name: 'No saved harness matches this search' })).toBeTruthy()
  })
  it('reopens a saved harness by its ID only after the server returns it', async () => {
    const { fetchImpl, requests } = local()
    renderRig('#/rig/blocks:customize', { fetchImpl })
    const panel = within((await screen.findByRole('heading', { name: 'Your saved harnesses' })).parentElement)
    await waitFor(() => expect(panel.getAllByRole('option')).toHaveLength(3))
    fireEvent.change(panel.getByRole('combobox', { name: 'Saved minimal harnesses' }), { target: { value: B.id } })
    await act(async () => { fireEvent.click(panel.getByRole('button', { name: 'Open selected harness' })) })
    expect(requests.some((r) => r.url === `/api/shallow/harnesses/${B.id}` && r.method === 'GET')).toBe(true)
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Prompt' }).value).toBe(B.prompt))
    expect(within(advanced()).getByRole('checkbox', { name: 'bash' }).checked).toBe(true)
  })
  it('nothing can be edited while a reopen waits for the server', async () => {
    let answer
    const gate = new Promise((resolve) => { answer = resolve })
    const { fetchImpl } = local({ one: (id) => [A, B].find((r) => r.id === id) })
    const slow = vi.fn(async (url, opts) => { if (String(url) === `/api/shallow/harnesses/${B.id}`) await gate; return fetchImpl(url, opts) })
    renderRig('#/rig/blocks:customize', { fetchImpl: slow })
    const panel = within((await screen.findByRole('heading', { name: 'Your saved harnesses' })).parentElement)
    await waitFor(() => expect(panel.getAllByRole('option')).toHaveLength(3))
    fireEvent.change(panel.getByRole('combobox', { name: 'Saved minimal harnesses' }), { target: { value: B.id } })
    fireEvent.click(panel.getByRole('button', { name: 'Open selected harness' }))
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Prompt' }).disabled).toBe(true))
    await act(async () => { answer() })
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Prompt' }).value).toBe(B.prompt))
    expect(screen.getByRole('textbox', { name: 'Prompt' }).disabled).toBe(false)
  })
  it('following the old Customize link keeps the custom harness edited in One run', async () => {
    const mine = blocksFromAnswers({ touch: 'with_shell' }).map((b) => (b.type === 'prompt' ? { ...b, text: 'My unsaved One run prompt.' } : b))
    sessionStorage.setItem(draftKey('composer'), JSON.stringify({ selection: 'custom', blocks: mine }))
    sessionStorage.setItem(draftKey('customize-draft'), JSON.stringify(blocksFromAnswers()))
    const { fetchImpl } = local()
    renderRig('#/rig/blocks:customize', { fetchImpl })
    expect(screen.getByRole('textbox', { name: 'Prompt' }).value).toBe('My unsaved One run prompt.')
    expect(document.querySelector('[data-el="restored-draft"]')).toBeTruthy()
  })
  it('a reopen the server refuses changes nothing and says why', async () => {
    const { fetchImpl } = local({ one: () => null })
    renderRig('#/rig/blocks:customize', { fetchImpl })
    const panel = within((await screen.findByRole('heading', { name: 'Your saved harnesses' })).parentElement)
    await waitFor(() => expect(panel.getAllByRole('option')).toHaveLength(3))
    const before = screen.getByRole('textbox', { name: 'Prompt' }).value
    fireEvent.change(panel.getByRole('combobox', { name: 'Saved minimal harnesses' }), { target: { value: A.id } })
    await act(async () => { fireEvent.click(panel.getByRole('button', { name: 'Open selected harness' })) })
    expect(await screen.findByText('No saved harness with that ID on this computer.')).toBeTruthy()
    expect(screen.getByRole('textbox', { name: 'Prompt' }).value).toBe(before)
  })
  it('says when the editor draft was restored from this tab, until a reset or a save', async () => {
    sessionStorage.setItem(draftKey('customize-draft'), JSON.stringify(blocksFromAnswers({ touch: 'with_shell' })))
    const { fetchImpl } = local()
    renderRig('#/rig/blocks:customize', { fetchImpl })
    const note = () => document.querySelector('[data-el="restored-draft"]')
    await screen.findByRole('heading', { name: 'Your saved harnesses' })
    expect(note().textContent).toBe('Restored the editor draft from this tab. Use Save harness to keep it on this computer, or Reset to Wizard Answers to discard these edits.')
    fireEvent.click(within(document.querySelector('[data-el="minimal-customize-nav"]')).getByRole('button', { name: 'Reset to Wizard Answers' }))
    expect(note()).toBeNull()
  })
  it('numbers nothing twice: the settings are named, not numbered after the three pickers', async () => {
    const { fetchImpl } = local()
    renderRig('#/rig/blocks:customize', { fetchImpl })
    const titles = [...advanced().querySelectorAll('[data-el="harness-block"] .rg-blk-t')].map((t) => t.textContent)
    expect(titles).toEqual(['Tools', 'Permission', 'Context', 'Stop', 'Sampling', 'File list'])
  })
})

describe('Build a harness stays its own editor', () => {
  it('keeps its presets, Add a block and its own launcher, with no Customize controls', async () => {
    const { fetchImpl } = local()
    const { container } = renderRig('#/rig/blocks', { fetchImpl })
    await screen.findByRole('heading', { name: 'Build a harness' })
    expect(screen.getByRole('button', { name: 'Claude Code — TraceHarness copy' })).toBeTruthy()
    expect(screen.getByLabelText('Add a block')).toBeTruthy()
    expect(container.querySelector('[data-el="harness-run"]')).toBeTruthy()
    expect(container.querySelector('[data-el="minimal-customize-nav"], [data-el="member-harness-library"]')).toBeNull()
    expect([...container.querySelectorAll('[data-el="harness-block"] .rg-blk-t')][0].textContent).toBe('1 · Prompt')
    expect(container.querySelector('[data-el="copy-not-app"]').textContent).toContain('your installed app')
  })
})

describe('a TraceHarness copy is never just "Claude Code"', () => {
  it('the Fixed cards name the copy and say where the installed app runs', async () => {
    const { fetchImpl } = local()
    const { container } = renderRig('#/rig/shallowCards', { fetchImpl })
    await waitFor(() => expect(container.querySelectorAll('[data-el="shallow-cards"] h2').length).toBe(6))
    const heads = [...container.querySelectorAll('[data-el="shallow-cards"] h2')].map((h) => h.textContent)
    expect(heads.every((h) => h.endsWith(' — TraceHarness copy'))).toBe(true)
    expect(heads).toContain('Claude Code — TraceHarness copy')
    expect(container.querySelector('[data-el="copy-not-app"]').textContent).toContain('your installed app')
  })
})

describe('one Save harness', () => {
  it('Fixed harnesses, Minimal harness and One run all say Save harness', async () => {
    for (const spec of ['shallowCards', 'shallowWizard', 'harnesses']) {
      resetRig()
      const { fetchImpl } = local()
      renderRig('#/rig/' + spec, { fetchImpl })
      await waitFor(() => expect(screen.getAllByRole('button', { name: 'Save harness' }).length, spec).toBeGreaterThan(0))
      for (const old of ['Save prompt', 'Save minimal harness']) expect(screen.queryByRole('button', { name: old }), `${spec}: ${old}`).toBeNull()
    }
  })
  it('Saved versions names the four places a harness is kept', async () => {
    const { fetchImpl } = local()
    renderRig('#/rig/harnesses:view:versions', { fetchImpl })
    const places = await screen.findByRole('region', { name: 'Where harnesses are kept' })
    expect([...places.querySelectorAll('[data-el="storage-place"] h3')].map((h) => h.textContent)).toEqual(
      ['1 · Checkpoints in this tab', '2 · A file', '3 · This computer’s library', '4 · Minimal harnesses by ID'])
    expect([...places.querySelectorAll('[data-el="storage-place"] .rg-store-where')].map((p) => p.textContent)).toEqual(
      ['Kept while this tab is open.', 'Anywhere you choose; import it back here.', 'Saved harnesses on this computer, by Save harness.', 'Each saved minimal harness, reopened by its ID in Advanced settings.'])
    await waitFor(() => expect(within(places).getByText('2 minimal harnesses and 0 fixed prompts saved on this computer.')).toBeTruthy())
  })
})
