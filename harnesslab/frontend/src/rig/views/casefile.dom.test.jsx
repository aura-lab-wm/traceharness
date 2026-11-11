// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, screen, within } from '@testing-library/react'
import { browserStores, writeKey, forgetKey, setCaptured } from '../../matekey'
import { renderRig, resetRig } from '../../../test/rig-testing'

afterEach(resetRig)
const pins = (xs) => ({ 'rig.case': JSON.stringify(xs) })
const run = (id) => ({ id: `run:${id}`, kind: 'run', label: `run ${id.slice(-6)}`, spec: `run:${id}`, run: id, dir: 'mini', model: 'acme/alpha-1', harness: 'baseline', task: 't2' })

describe('case file dock', () => {
  it('empty state explains pinning', () => {
    renderRig('#/rig/?dock=case')
    expect(screen.getByText('Nothing pinned yet.')).toBeTruthy()
  })
  it('an empty case file offers ways to pin: the focused dataset’s questions and its runs', () => {
    renderRig('#/rig/ds:mini?dock=case')
    const empty = document.querySelector('[data-el="case-file"] [data-el~="empty-state"]')
    expect(within(empty).getByRole('button', { name: 'Browse mini runs' })).toBeTruthy()
    // nothing disabled without a reason: with no pins the Export/Compare/Fork bar is not drawn at all
    expect(document.querySelectorAll('[data-el="case-file"] button:disabled')).toHaveLength(0)
    act(() => { fireEvent.click(within(empty).getByRole('button', { name: 'Answer questions about mini' })) })
    expect(location.hash).toContain('q:mini')
  })
  it('with a run in focus, the empty case file pins that run in one click, with everything Buddy needs', () => {
    renderRig('#/rig/run:a00003?dock=case')
    fireEvent.click(screen.getByRole('button', { name: 'Pin run a00003 (in focus)' }))
    const saved = JSON.parse(localStorage.getItem('rig.case'))
    expect(saved).toHaveLength(1)
    expect(saved[0]).toMatchObject({ kind: 'run', run: '20260101-000000-a00003', dir: 'mini', model: 'acme/alpha-1', harness: 'baseline', task: 't2' })
    expect(screen.getByRole('button', { name: /Ask Buddy about it/ })).toBeTruthy()   // the flow ends in a next step
  })
  it('disabled Compare and Fork say what enables them, visibly', () => {
    renderRig('#/rig/?dock=case', { storage: pins([run('20260101-000000-a00003')]) })
    const cmp = screen.getByRole('button', { name: /Compare/ })
    expect(cmp.disabled).toBe(true)
    expect(document.getElementById(cmp.getAttribute('aria-describedby')).textContent).toBe('Pin a second run to compare')
    expect(screen.getByRole('button', { name: /Export review/ }).disabled).toBe(false)
    expect(screen.getByRole('button', { name: /Fork/ }).disabled).toBe(false)
  })
  it('compare acts on two pinned runs; fork on one', () => {
    renderRig('#/rig/?dock=case', { storage: pins([run('20260101-000000-a00002'), run('20260101-000000-a00003')]) })
    const cmp = screen.getByRole('button', { name: /Compare/ })
    expect(cmp.disabled).toBe(false)
    act(() => { fireEvent.click(cmp) })
    expect(location.hash).toContain('cmp:20260101-000000-a00002:20260101-000000-a00003')
    expect(screen.getByRole('button', { name: /Fork/ }).disabled).toBe(true)
    fireEvent.click(screen.getByRole('checkbox', { name: /a00003/ }))
    expect(screen.getByRole('button', { name: /Fork/ }).disabled).toBe(false)
  })
  it('export review downloads Markdown through a Blob', () => {
    const blobs = []
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn((b) => { blobs.push(b); return 'blob:x' }), revokeObjectURL: vi.fn() }))
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    renderRig('#/rig/?dock=case', { storage: pins([run('20260101-000000-a00003')]) })
    fireEvent.click(screen.getByRole('button', { name: /Export review/ }))
    expect(click).toHaveBeenCalled()
    expect(blobs[0].type).toBe('text/markdown')
    click.mockRestore()
  })
  it('clear needs a confirm step', () => {
    renderRig('#/rig/?dock=case', { storage: pins([run('20260101-000000-a00003')]) })
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    expect(screen.getByText(/run a00003/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Clear all pins' }))
    expect(screen.getByText('Nothing pinned yet.')).toBeTruthy()
  })
})

describe('Buddy dock', () => {
  it('shows the not-connected state with no key and sends nothing', () => {
    const { requests } = renderRig('#/rig/ds:mini?dock=buddy')
    expect(document.querySelector('[data-el="buddy-key-state"]').textContent).toContain('Not connected.')
    const send = within(document.querySelector('[data-el="buddy-panel"]')).getByRole('button', { name: 'Send question' })
    expect(send.disabled).toBe(true)
    expect(document.getElementById(send.getAttribute('aria-describedby')).textContent).toContain('Connect a key first')
    // the titlebar toggle keeps the “Ask Buddy” label; the dock's own action is labelled for what it does
    expect(within(document.querySelector('[data-el="buddy-panel"]')).queryByRole('button', { name: 'Ask Buddy' })).toBeNull()
    // the selection shows only what is known — no row of dashes
    const dds = [...document.querySelectorAll('[data-el="buddy-panel"] dd')].map((d) => d.textContent.trim())
    expect(dds).toEqual(['mini', 'alpha-1 · baseline'])
    expect(requests.filter((r) => /openrouter/.test(r.url))).toEqual([])
  })
  it('evidence to be sent is the case file, packed by the real client', async () => {
    const detail = { summary: { run_id: '20260101-000000-a00003', model: 'acme/alpha-1', harness_id: 'baseline', task_id: 't2' }, spans: [{ seq: 0, span: 'chat' }], patch: '', issue: 'x' }
    renderRig('#/rig/?dock=buddy', { storage: { ...pins([run('20260101-000000-a00003')]), 'hs.mate.key': 'sk-or-test-key-000000' } })
    const { prime } = await import('../data')
    act(() => prime({ '/results/mini/runs/20260101-000000-a00003': detail }))
    const ev = document.querySelector('[data-el="buddy-evidence"]')
    expect(ev.textContent).toContain('1 pinned item')
    expect(ev.textContent).toContain('1 recording')
    expect(document.querySelector('[data-el="buddy-key-state"]').textContent).toContain('Connected')
  })
})

it('Buddy blocks private pin metadata until the per-session captured permission is enabled and tracks same-tab key changes', () => {
 const privatePin={id:'cell:captured',kind:'cell',dir:'./captured/.',label:'private task slug',value:'private value'}
 const {requests}=renderRig('#/rig/ds:mini?dock=buddy',{storage:pins([privatePin])})
 const panel=document.querySelector('[data-el="buddy-panel"]')
 expect(within(panel).getByText(/Not connected/)).toBeTruthy()
 act(()=>writeKey(browserStores(),'fixture-not-a-real-provider-key'))
 expect(within(panel).getByText('Connected')).toBeTruthy()
 expect(panel.querySelector('[data-el="buddy-evidence"]').textContent).toContain('per-session opt-in is off')
 expect(within(panel).queryByText('Preview the exact payload')).toBeNull()
 const input=within(panel).getByRole('textbox',{name:'Ask Buddy about the case file'})
 fireEvent.change(input,{target:{value:'Explain this evidence'}})
 const checkbox=within(panel).getByRole('checkbox',{name:/Send this evidence/})
 fireEvent.click(checkbox)
 expect(within(panel).getByRole('button',{name:'Send question'}).disabled).toBe(true)
 act(()=>setCaptured(browserStores(),true))
 expect(within(panel).getByText('Preview the exact payload')).toBeTruthy()
 expect(checkbox.checked).toBe(false)
 fireEvent.click(checkbox)
 expect(within(panel).getByRole('button',{name:'Send question'}).disabled).toBe(false)
 act(()=>setCaptured(browserStores(),false))
 expect(within(panel).queryByText('Preview the exact payload')).toBeNull()
 expect(within(panel).getByRole('button',{name:'Send question'}).disabled).toBe(true)
 act(()=>forgetKey(browserStores()))
 expect(within(panel).getByText(/Not connected/)).toBeTruthy()
 expect(requests.filter(r=>/openrouter/.test(r.url))).toEqual([])
})
