// @vitest-environment jsdom
/* Harnesses home (One run) on a calm first screen, every control one click away: Save harness sits with Review
   run and Run in one toolbar (on the other views it stays in the header);
   the prompt editor is behind "Edit prompt", whose summary shows the prompt's first line, and opens by itself where
   the reader came to edit (Guide me, Advanced settings, an empty prompt); the model and task hints that only say
   how to choose live inside their pickers until a choice gives them facts to show; the run facts are a data list. */
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderRig, resetRig } from '../../../test/rig-testing'
import { CARDS, RECOMMENDED_ID, blocksFromAnswers } from './shallow-data'

afterEach(resetRig)
const json = (data, status = 200) => ({ ok: status >= 200 && status < 300, status, statusText: status === 200 ? 'OK' : 'Error', headers: { get: () => 'application/json' }, json: async () => data })
function local() {
  const fetchImpl = vi.fn(async (url, opts = {}) => {
    const method = opts.method || 'GET'
    if (url === '/api/shallow/catalog') return json({ harnesses: CARDS.map((r) => ({ ...r, hash: '123456789abc' })) })
    if (url === '/api/shallow/harnesses' && method === 'GET') return json({ harnesses: [], loaded: true, unconfirmed: [] })
    if (url === '/api/shallow/compile') return json({ ok: true, hash: RECOMMENDED_ID.slice(4), warnings: [], harness: { id: RECOMMENDED_ID } })
    if (url === '/api/blocks/palette') return json({ tools: ['list_files', 'read_file', 'submit'], types: ['prompt', 'tools', 'policy', 'context', 'stop', 'sampling', 'listing'], blank: blocksFromAnswers() })
    return json({ detail: 'Not found.' }, 404)
  })
  return { fetchImpl }
}
const box = () => document.querySelector('[data-el~="prompt-editor"]')

describe('Harnesses home: one toolbar for the end actions', () => {
  it('on One run, Review run, Run and Save harness are one toolbar; the header holds no second Save', async () => {
    renderRig('#/rig/harnesses', local())
    const run = await screen.findByRole('toolbar', { name: 'Save, review and run' })
    await waitFor(() => expect(within(run).getAllByRole('button').map((b) => b.textContent)).toEqual(['Review run', 'Run', 'Save harness']))
    expect(screen.getAllByRole('button', { name: 'Save harness' })).toHaveLength(1)
    expect(document.querySelector('.rg-composer-head-actions')).toBeNull()
  })
  it('on another view Save harness stays in the header', async () => {
    renderRig('#/rig/harnesses:view:versions', local())
    await waitFor(() => expect(document.querySelector('.rg-composer-head-actions')).toBeTruthy())
    expect(within(document.querySelector('.rg-composer-head-actions')).getByRole('button', { name: 'Save harness' })).toBeTruthy()
    expect(screen.getAllByRole('button', { name: 'Save harness' })).toHaveLength(1)
  })
})

describe('Harnesses home: the prompt behind "Edit prompt"', () => {
  it('closed at first, its summary shows the first line; the tools and the editor are inside', async () => {
    renderRig('#/rig/harnesses', local())
    await waitFor(() => expect(box()).toBeTruthy())
    expect(box().tagName).toBe('DETAILS')
    expect(box().open).toBe(false)
    const summary = box().querySelector('summary')
    const first = blocksFromAnswers().find((x) => x.type === 'prompt').text.split('\n')[0]
    expect(summary.querySelector('[data-el~="prompt-preview"]').textContent).toBe(first)
    expect(summary.textContent).toContain('Edit prompt')
    expect(within(box()).getByRole('toolbar', { name: 'Prompt tools' })).toBeTruthy()
    expect(within(box()).getByRole('textbox', { name: 'Prompt' })).toBeTruthy()
    act(() => { box().open = true; fireEvent(box(), new Event('toggle')) })
    expect(box().open).toBe(true)
    expect(box().querySelector('summary').textContent).toContain('Close the editor')
  })
  it('opens by itself in Advanced settings', async () => {
    renderRig('#/rig/blocks:customize', local())
    await waitFor(() => expect(box()).toBeTruthy())
    expect(box().open).toBe(true)
  })
  it('opens by itself when Guide me is chosen, and when the prompt is emptied', async () => {
    renderRig('#/rig/harnesses', local())
    await waitFor(() => expect(box()).toBeTruthy())
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Guide me' })) })
    expect(box().open).toBe(true)
    resetRig()
    renderRig('#/rig/harnesses', local())
    await waitFor(() => expect(box()).toBeTruthy())
    act(() => { fireEvent.change(screen.getByRole('textbox', { name: 'Prompt' }), { target: { value: '' } }) })
    expect(box().open).toBe(true)
    expect(box().querySelector('[data-el~="prompt-preview"]').textContent).toBe('No prompt yet')
    act(() => { fireEvent.change(screen.getByRole('textbox', { name: 'Prompt' }), { target: { value: '  First line.\nSecond line.' } }) })
    expect(box().querySelector('[data-el~="prompt-preview"]').textContent).toBe('First line.')
  })
})

describe('Harnesses home: words that only say how to choose', () => {
  it('the model and task pickers carry no hint until a choice gives one; the run facts are a data list', async () => {
    renderRig('#/rig/harnesses', local())
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Model' })).toBeTruthy())
    expect(screen.getByRole('combobox', { name: 'Model' }).getAttribute('aria-describedby')).toBeNull()
    expect(screen.getByRole('combobox', { name: 'Task' }).getAttribute('aria-describedby')).toBeNull()
    expect(screen.getByRole('combobox', { name: 'Harness', exact: true }).getAttribute('aria-describedby')).toBeTruthy()
    expect(document.querySelector('[data-el~="run-facts"]').hasAttribute('data-data')).toBe(true)
  })
})
