// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { CARDS, RECOMMENDED_ID, blocksFromAnswers, RECOMMENDED_ANSWERS } from './shallow-data'

const scope = 'b'.repeat(24)
let Cards, Wizard, Blocks, Apply, views
let stored, failure, savedRows, requests, loaded
const json = (data, status = 200) => ({ ok: status === 200, status, json: async () => data })
const catalog = CARDS.map((row) => ({ ...row, hash: '123456789abc' }))
const warning = 'This prompt asks to edit files and run tests, and neither edit_file nor run_tests is mounted.'
function compiled(body) {
  const blocks = body.blocks || blocksFromAnswers(body.answers)
  const get = (type) => blocks.find((block) => block.type === type)
  return {
    ok: true, hash: RECOMMENDED_ID.slice(4),
    warnings: get('tools').names.includes('edit_file') ? [] : [warning],
    harness: {
      id: RECOMMENDED_ID, lane: 'minimal', prompt: get('prompt').text, tools: get('tools').names,
      policy: get('policy').mode, context_window: get('context').window, observation_chars: get('context').observation_chars,
      max_steps: get('stop').max_steps, max_total_tokens: get('stop').max_total_tokens,
      temperature: get('sampling').temperature, max_tokens_per_call: get('sampling').max_tokens_per_call,
      include_file_listing: get('listing').include,
    },
  }
}
beforeAll(async () => {
  window.__TRACEHARNESS_MEMBER__ = { version: 1, scope }
  window.__HARNESSLAB_DATA__ = { '/overview': { results: [] } }
  views = { ...(await import('./shallow-cards')).views, ...(await import('./shallow-wizard')).views,
    ...(await import('./blocks')).views, ...(await import('./shallow-apply')).views }
  Cards = views.shallowCards.render
  Wizard = views.shallowWizard.render
  Blocks = views.blocks.render
  Apply = views.shallowApply.render
})
beforeEach(() => {
  sessionStorage.clear()
  stored = true; failure = null; savedRows = []; requests = []; loaded = true
  vi.stubGlobal('fetch', vi.fn(async (url, opts) => {
    const body = opts.body ? JSON.parse(opts.body) : null
    requests.push({ url, ...opts, body })
    expect(opts.headers.get('x-traceharness-member-scope')).toBe(scope)
    expect(opts.credentials).toBe('same-origin')
    if (failure && opts.method === 'POST') return json({ error: failure }, 409)
    if (url === '/api/shallow/catalog') return json({ harnesses: catalog })
    if (url === '/api/shallow/harnesses' && opts.method === 'GET') return json({ harnesses: savedRows, unconfirmed: [], loaded })
    if (url === '/api/shallow/harnesses' && opts.method === 'POST') {
      const current = savedRows.find((row) => row.id === body.id)
      if ((body.if_absent && current) || (body.if_hash && current?.hash !== body.if_hash)) return json({ error: 'This prompt changed in your account. Reload and review it before saving.' }, 409)
      const harness = { ...catalog.find((row) => row.id === body.id), prompt: body.prompt, hash: 'abcdef123456' }
      if (stored) savedRows = [...savedRows.filter((row) => row.id !== harness.id), harness]
      return json({ harness, stored })
    }
    if (url.startsWith('/api/shallow/harnesses/')) {
      const harness = savedRows.find((row) => row.id === url.split('/').at(-1))
      return harness ? json({ harness }) : json({ error: 'Not found.' }, 404)
    }
    if (url === '/api/shallow/compile') return json(compiled(body))
    if (url === '/api/shallow/wizard') {
      const result = compiled(body)
      if (stored) savedRows = [...savedRows.filter((row) => row.id !== result.harness.id), result.harness]
      return json({ ...result, stored })
    }
    throw new Error(`Unexpected member request: ${url}`)
  }))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('member shallow screens use the existing React workbench', () => {
  it('loads the six real catalog cards, keeps failed saves as scoped drafts, and confirms only durable saves', async () => {
    const first = render(<Cards />)
    await screen.findAllByRole('button', { name: 'Save prompt' })
    expect(first.container.querySelectorAll('textarea')).toHaveLength(6)
    expect(first.container.querySelector('.rg-dh').textContent).toContain('TraceHarness lab choices, not verified vendor limits')
    expect(screen.getByRole('textbox', { name: 'Standing prompt for Claude Code' })).toBeTruthy()
    expect(screen.getByRole('textbox', { name: 'Standing prompt for Codex' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Preview one prompt across six shells' }).getAttribute('data-spec')).toBe('shallowApply')
    const card = first.container.querySelector('[data-agent="claude"]')
    fireEvent.change(within(card).getByRole('textbox'), { target: { value: 'Member prompt. verify; do not modify the tests.' } })
    stored = false
    fireEvent.click(within(card).getByRole('button', { name: 'Save prompt' }))
    await screen.findByText(/Account storage did not confirm/)
    expect(card.textContent).toContain('Unsaved draft')
    expect(card.textContent).not.toContain('Saved to your account.')
    const draftKey = `traceharness.shallow.member.${scope}.fixed`
    expect(JSON.parse(sessionStorage.getItem(draftKey)).claude.prompt).toContain('Member prompt')
    cleanup()
    const second = render(<Cards />)
    await screen.findAllByRole('button', { name: 'Save prompt' })
    const restored = second.container.querySelector('[data-agent="claude"]')
    expect(within(restored).getByRole('textbox').value).toContain('Member prompt')
    stored = true
    fireEvent.click(within(restored).getByRole('button', { name: 'Save prompt' }))
    await screen.findByText('Saved to your account.')
    expect(JSON.parse(sessionStorage.getItem(draftKey)).claude).toBeUndefined()
    expect(requests.filter((request) => request.method === 'POST').every((request) => request.body.if_absent === true && !request.body.if_hash)).toBe(true)
    fireEvent.change(within(restored).getByRole('textbox'), { target: { value: 'Second confirmed edit' } })
    fireEvent.click(within(restored).getByRole('button', { name: 'Save prompt' }))
    await screen.findByText('Saved to your account.')
    expect(requests.filter((request) => request.method === 'POST').at(-1).body).toMatchObject({ if_hash: 'abcdef123456' })
    expect(requests.filter((request) => request.method === 'POST').at(-1).body).not.toHaveProperty('if_absent')
  })

  it('keeps a first-save draft when another browser creates that prompt first', async () => {
    const view = render(<Cards />)
    await screen.findAllByRole('button', { name: 'Save prompt' })
    const card = view.container.querySelector('[data-agent="claude"]')
    fireEvent.change(within(card).getByRole('textbox'), { target: { value: 'My unsaved first prompt' } })
    savedRows = [{ ...catalog[0], lane: 'fixed', prompt: 'Other browser prompt', hash: 'abcdef123456' }]
    fireEvent.click(within(card).getByRole('button', { name: 'Save prompt' }))
    await screen.findByText(/This prompt changed in your account/)
    expect(within(card).getByRole('textbox').value).toBe('My unsaved first prompt')
    expect(savedRows[0].prompt).toBe('Other browser prompt')
  })

  it('retains a draft on account-change rejection and offers Account recovery', async () => {
    const view = render(<Cards />)
    await screen.findAllByRole('button', { name: 'Save prompt' })
    const card = view.container.querySelector('[data-agent="codex"]')
    fireEvent.change(within(card).getByRole('textbox'), { target: { value: 'Keep this draft' } })
    failure = 'The signed-in account changed. Your draft is still here.'
    fireEvent.click(within(card).getByRole('button', { name: 'Save prompt' }))
    await screen.findByText(/The signed-in account changed/)
    expect(within(card).getByRole('textbox').value).toBe('Keep this draft')
    expect(within(card).getByRole('link', { name: 'Account' }).getAttribute('href')).toBe('/login')
  })

  it('previews wrapper warnings without saving, restores wizard answers, and keeps custom edits when returning', async () => {
    render(<Wizard />)
    expect(screen.getByRole('radiogroup', { name: 'What may it touch?' })).toBeTruthy()
    expect(screen.getByRole('radiogroup', { name: 'MCP?' })).toBeTruthy()
    fireEvent.click(screen.getByRole('radio', { name: 'Read only.' }))
    await screen.findByText(warning)
    expect(requests.some((request) => request.url === '/api/shallow/wizard')).toBe(false)
    cleanup()
    render(<Wizard />)
    expect(screen.getByRole('radio', { name: 'Read only.' }).checked).toBe(true)
    cleanup()
    render(<Blocks args={['customize']} />)
    const prompt = await screen.findByRole('textbox', { name: 'Prompt' })
    fireEvent.change(prompt, { target: { value: 'CUSTOM DRAFT verify' } })
    await waitFor(() => expect(JSON.parse(sessionStorage.getItem(`traceharness.shallow.member.${scope}.customize-draft`))[0].text).toBe('CUSTOM DRAFT verify'))
    cleanup()
    render(<Wizard />)
    expect(screen.getByRole('radio', { name: 'Read only.' }).checked).toBe(true)
    cleanup()
    render(<Blocks args={['customize']} />)
    expect((await screen.findByRole('textbox', { name: 'Prompt' })).value).toBe('CUSTOM DRAFT verify')
    fireEvent.click(screen.getByRole('button', { name: 'Reset to Wizard Answers' }))
    expect(screen.getByRole('textbox', { name: 'Prompt' }).value).toBe(blocksFromAnswers({ ...RECOMMENDED_ANSWERS, touch: 'read_only' })[0].text)
    expect(screen.queryByLabelText('Your LLM key')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Run', exact: true })).toBeNull()
  })

  it('does not adopt another account or the local app draft', async () => {
    const other = blocksFromAnswers({ ...RECOMMENDED_ANSWERS, touch: 'read_only' })
    other[0].text = 'OTHER ACCOUNT DRAFT'
    sessionStorage.setItem('traceharness.shallow.customize-draft', JSON.stringify(other))
    sessionStorage.setItem(`traceharness.shallow.member.${'c'.repeat(24)}.customize-draft`, JSON.stringify(other))
    render(<Blocks args={['customize']} />)
    expect((await screen.findByRole('textbox', { name: 'Prompt' })).value).toBe(blocksFromAnswers(RECOMMENDED_ANSWERS)[0].text)
  })

  it('keeps every save disabled until account data is loaded while allowing wizard preview', async () => {
    loaded = false
    render(<Wizard />)
    await screen.findByText(`Cell ${RECOMMENDED_ID}`)
    expect(screen.getByRole('button', { name: 'Save minimal harness' }).disabled).toBe(true)
    expect(screen.getByRole('button', { name: 'Retry account data' })).toBeTruthy()
    cleanup()
    render(<Cards />)
    for (const save of await screen.findAllByRole('button', { name: 'Save prompt' })) expect(save.disabled).toBe(true)
    cleanup()
    render(<Blocks args={['customize']} />)
    await screen.findByText(`Cell ${RECOMMENDED_ID}`)
    expect(screen.getByRole('button', { name: 'Save minimal harness' }).disabled).toBe(true)
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull()
    expect(screen.queryByLabelText('Add a block')).toBeNull()
    expect(requests.some((request) => request.url === '/api/shallow/wizard')).toBe(false)
  })

  it('saves and reopens a minimal harness through account endpoints, with warnings outside its identity', async () => {
    render(<Blocks args={['customize']} />)
    await screen.findByRole('textbox', { name: 'Prompt' })
    const save = screen.getByRole('button', { name: 'Save minimal harness' })
    await waitFor(() => expect(save.disabled).toBe(false))
    stored = false
    fireEvent.click(save)
    await screen.findByText(/Account storage did not confirm/)
    expect(screen.queryByText(`Saved ${RECOMMENDED_ID} to your account.`)).toBeNull()
    stored = true
    fireEvent.click(save)
    await screen.findByText(`Saved ${RECOMMENDED_ID} to your account.`)
    fireEvent.change(screen.getByRole('searchbox', { name: 'Find a saved harness' }), { target: { value: 'no-match' } })
    expect(screen.getByText('Showing 0 of 1 saved minimal harnesses.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Open selected harness' }).disabled).toBe(true)
    fireEvent.change(screen.getByRole('searchbox', { name: 'Find a saved harness' }), { target: { value: 'minimal' } })
    expect(screen.getByText('Showing 1 of 1 saved minimal harnesses.')).toBeTruthy()
    fireEvent.change(screen.getByRole('combobox', { name: 'Saved minimal harnesses' }), { target: { value: RECOMMENDED_ID } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Prompt' }), { target: { value: 'Unsaved edit' } })
    fireEvent.click(screen.getByRole('button', { name: 'Open selected harness' }))
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Prompt' }).value).toBe(savedRows[0].prompt))
    expect(savedRows[0]).not.toHaveProperty('warnings')
    expect(requests.every((request) => /^\/api\/shallow\/(catalog|harnesses|compile|wizard)/.test(request.url))).toBe(true)
  })

  it('applies one prompt to six previews without saving', async () => {
    render(<Apply />)
    const prompt = await screen.findByRole('textbox')
    fireEvent.change(prompt, { target: { value: 'Preview only' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply to all six' }))
    expect(screen.getAllByText('Preview only')).toHaveLength(7)
    expect(screen.getByText(/Applying it here does not save/)).toBeTruthy()
    expect(requests.every((request) => request.method === 'GET')).toBe(true)
  })

  it('keeps keyboard focus in a moved block and preserves the editor DOM while typing', async () => {
    const { container } = render(<Blocks args={['customize']} />)
    const prompt = await screen.findByRole('textbox', { name: 'Prompt' })
    prompt.focus()
    fireEvent.change(prompt, { target: { value: 'Typed edit' } })
    expect(document.activeElement).toBe(prompt)
    const tools = container.querySelectorAll('[data-el="harness-block"]')[1]
    const up = within(tools).getByRole('button', { name: 'Move block up' })
    up.focus()
    fireEvent.click(up)
    expect(container.querySelectorAll('[data-el="harness-block"]')[0]).toBe(tools)
    expect(document.activeElement).toBe(within(tools).getByRole('button', { name: 'Move block down' }))
    fireEvent.click(document.activeElement)
    expect(container.querySelectorAll('[data-el="harness-block"]')[1]).toBe(tools)
    expect(tools.contains(document.activeElement)).toBe(true)
  })

  it('distinguishes harness locations in titles and breadcrumbs', () => {
    expect(views.blocks.title(['customize'])).toBe('Customize minimal harness')
    expect(views.shallowCards.crumbs([]).map(([label]) => label)).toEqual(['Harnesses', 'Fixed'])
    expect(views.shallowApply.crumbs([]).map(([label]) => label)).toEqual(['Harnesses', 'Same prompt'])
    expect(views.shallowWizard.crumbs([]).map(([label]) => label)).toEqual(['Harnesses', 'Minimal'])
    expect(views.blocks.crumbs(['customize']).map(([label]) => label)).toEqual(['Harnesses', 'Minimal', 'Customize'])
  })
})
