// @vitest-environment jsdom
/* Feel and speed: the run page stays mounted while the reader moves through its steps; a run
   is looked up in the dataset in focus before every dataset's run list is downloaded; an idle poll that
   says nothing new redraws nothing; a toast appears beside the control that set it off; the page list
   keeps its shape while the library loads; re-ordered rows glide by transform from where they were. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { renderRig, resetRig, rigFixture, miniRuns, MINI } from '../../test/rig-testing'
import { prime, resetCache, useApi, useCacheVersion, useFindRun } from './data'
import { Toaster, toast } from './ui'
import Collection from './Collection'
import { flipOffsets } from './flip'

afterEach(() => { resetRig(); vi.useRealTimers() })

const ID = '20260101-000000-a00002'
const base = { run_id: ID, task_id: 't2', harness_id: 'baseline' }
const chat = (seq, step, name) => ({ ...base, seq, span: 'chat', step, text: '', 'gen_ai.response.finish_reasons': ['tool_calls'], tool_calls: [{ name, arguments: {} }] })
const tool = (seq, name) => ({ ...base, seq, span: 'execute_tool', 'gen_ai.tool.name': name, args: {}, status: 'ok', result_preview: 'x' })
const spans = [{ ...base, seq: 0, span: 'invoke_agent', status: 'start', harness: { max_steps: 9 } },
  chat(1, 0, 'read_file'), tool(2, 'read_file'), chat(3, 1, 'list_dir'), tool(4, 'list_dir'), chat(5, 2, 'submit'), tool(6, 'submit')]
const runData = () => ({ ...rigFixture(), [`/results/${MINI}/runs/${ID}`]: { summary: miniRuns().find((x) => x.run_id === ID), spans, replay: [], patch: '', messages: [], issue: '' } })

describe('the run page while stepping', () => {
  it('stays mounted: a step change keeps the same step list and columns, and only the playhead moves', () => {
    const { container } = renderRig(`#/rig/run:${ID}`, { data: runData() })
    const list = container.querySelector('.rg-cx-steps')
    const cols = container.querySelector('[data-el="run-console"]')
    const rows = [...container.querySelectorAll('.rg-cx-st')]
    act(() => { fireEvent.click(rows[2].querySelector('.rg-cx-rowb')) })
    expect(location.hash).toBe(`#/rig/run:${ID}:s3`)
    expect(container.querySelector('.rg-cx-steps')).toBe(list)
    expect(container.querySelector('[data-el="run-console"]')).toBe(cols)
    expect([...container.querySelectorAll('.rg-cx-st')]).toEqual(rows)     // the same row nodes
    expect(rows[2].className).toContain('cur')
    expect(container.querySelector('[data-el="step-detail"]').getAttribute('aria-label')).toBe('Step 3 of 3')
  })

  it('a step changed by the link itself (Back, a pasted link) moves the playhead on the same page', () => {
    const { container } = renderRig(`#/rig/run:${ID}`, { data: runData() })
    const cols = container.querySelector('[data-el="run-console"]')
    act(() => { history.replaceState(null, '', `#/rig/run:${ID}:s2`); window.dispatchEvent(new HashChangeEvent('hashchange')) })
    expect(container.querySelector('[data-el="run-console"]')).toBe(cols)
    expect(container.querySelector('.rg-cx-st.cur').getAttribute('data-n')).toBe('2')
  })

  it('holds the place of max steps with a dash while the ledger is read, so the figures beside it do not move', () => {
    const data = runData()
    delete data[`/results/${MINI}/runs/${ID}`]
    const { container } = renderRig(`#/rig/run:${ID}`, { data })
    expect(container.querySelector('[data-el="run-numbers"] .rg-kstat-u').textContent).toBe('/ —')
  })
})

describe('finding a run', () => {
  function Probe({ k, hint }) {
    const f = useFindRun(k, hint)
    return <p data-testid="found">{f.loading ? 'looking' : f.data ? f.data.dir : f.missing ? 'missing' : '?'}</p>
  }
  const stubFetch = () => {
    const urls = []
    vi.stubGlobal('fetch', vi.fn(async (url) => { urls.push(String(url)); return { ok: false, status: 404, statusText: 'Not Found', headers: { get: () => 'application/json' }, json: async () => ({ detail: 'not primed' }) } }))
    return urls
  }

  it('finds a full run id in the dataset in focus without downloading any other dataset’s runs', async () => {
    resetCache()
    const f = rigFixture()
    prime({ '/overview': f['/overview'], [`/results/${MINI}/runs`]: f[`/results/${MINI}/runs`] })
    const urls = stubFetch()
    render(<Probe k={ID} hint={MINI} />)
    expect(screen.getByTestId('found').textContent).toBe(MINI)
    await act(async () => {})
    expect(urls.filter((u) => u.includes('/runs'))).toEqual([])
  })

  it('when the dataset in focus is not loaded yet, every dataset is searched at once (a hint never adds a wait)', async () => {
    resetCache()
    const f = rigFixture()
    prime({ '/overview': f['/overview'] })
    const urls = stubFetch()
    render(<Probe k={ID} hint={MINI} />)
    await act(async () => {})
    // both dataset lists are asked for together, not one after the other
    expect(urls.filter((u) => u.includes('/runs')).slice(0, 2).sort()).toEqual([`/api/results/${MINI}/runs`, '/api/results/mock_ctl/runs'])
  })

  it('a miss in the dataset in focus, or a suffix, still searches every dataset', async () => {
    resetCache()
    const f = rigFixture()
    prime({ '/overview': f['/overview'], [`/results/${MINI}/runs`]: f[`/results/${MINI}/runs`], '/results/mock_ctl/runs': f['/results/mock_ctl/runs'] })
    stubFetch()
    const other = f['/results/mock_ctl/runs'][0].run_id
    const { unmount } = render(<Probe k={other} hint={MINI} />)
    await act(async () => {})
    expect(screen.getByTestId('found').textContent).toBe('mock_ctl')
    unmount()
    render(<Probe k="a00002" hint={MINI} />)
    await act(async () => {})
    expect(screen.getByTestId('found').textContent).toBe(MINI)
  })
})

describe('an idle poll', () => {
  it('that answers the same as before changes nothing, so nothing redraws', async () => {
    resetCache()
    vi.useFakeTimers()
    let body = [{ id: 'j1', status: 'done' }]
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, statusText: 'OK', headers: { get: () => 'application/json' }, json: async () => body })))
    let renders = 0
    function Jobs() { useApi('/jobs', { poll: 1000 }); renders++; return <span data-testid="v">{useCacheVersion()}</span> }
    render(<Jobs />)
    await act(async () => { await vi.advanceTimersByTimeAsync(10) })
    const settled = renders
    const v = screen.getByTestId('v').textContent
    await act(async () => { await vi.advanceTimersByTimeAsync(3100) })
    expect(screen.getByTestId('v').textContent).toBe(v)
    expect(renders).toBe(settled)
    body = [{ id: 'j1', status: 'done' }, { id: 'j2', status: 'running' }]
    await act(async () => { await vi.advanceTimersByTimeAsync(1100) })
    expect(Number(screen.getByTestId('v').textContent)).toBeGreaterThan(Number(v))
  })
})

describe('a toast', () => {
  it('appears under the control that set it off', () => {
    render(<div className="rig"><button type="button">Copy</button><Toaster /></div>)
    const b = screen.getByRole('button', { name: 'Copy' })
    b.getBoundingClientRect = () => ({ left: 120, top: 200, bottom: 228, right: 200, width: 80, height: 28 })
    fireEvent.pointerDown(b)
    act(() => { toast('Run id copied') })
    const t = document.querySelector('.rg-toast')
    expect(t.textContent).toBe('Run id copied')
    expect(t.className).toContain('at')
    expect(t.style.getPropertyValue('--rig-toast-x')).toBe('120px')
    expect(t.style.getPropertyValue('--rig-toast-y')).toBe('236px')
  })
  it('with nothing pressed or focused, sits above the status bar', () => {
    render(<div className="rig"><Toaster /></div>)
    act(() => { toast('Reconnected') })
    expect(document.querySelector('.rg-toast').className).not.toContain('at')
  })
})

describe('the page list while the library loads', () => {
  const props = { kind: 'home', args: [], condition: null, datasets: [], navOpen: true, setNavOpen: () => {}, navOverlay: false, onGo: vi.fn() }
  it('draws the dataset’s pages in their places, not yet pressable, and the switch at its size', () => {
    const { container } = render(<Collection {...props} waiting />)
    const pages = container.querySelectorAll('[data-el~="outline-overview"], [data-el~="nav-analysis"]')
    expect(pages).toHaveLength(2)
    for (const p of pages) expect(p.disabled).toBe(true)
    expect(container.querySelector('.rg-dsw-wait')).not.toBeNull()
    cleanup()
    const done = render(<Collection {...props} />)
    expect(done.container.querySelector('[data-el~="outline-overview"]')).toBeNull()   // loaded, no dataset: no pages
  })
})

describe('re-ordered rows', () => {
  it('start from where they were: the offset is old place minus new place, for rows that moved', () => {
    const before = new Map([['a', 0], ['b', 40], ['c', 80]])
    const after = new Map([['c', 0], ['a', 40], ['b', 80], ['d', 120]])
    expect(flipOffsets(before, after)).toEqual({ c: 80, a: -40, b: -40 })
  })
})

describe('nothing drawn later is lost: each is on the page once the page has loaded', () => {
  it('the provenance note is held back only while a loading placeholder is in the analysis page', async () => {
    const { readFileSync } = await import('node:fs')
    const css = readFileSync(`${process.cwd()}/src/rig/feel.css`, 'utf8')
    expect(css.split('\n').filter((l) => l.includes('.rg-prov{display:none}'))).toEqual(['.rig .rg-an-main:has(.rg-loading,.rg-skel-stack,.rg-pstate[aria-busy="true"])>.rg-prov{display:none}'])
    const { container } = renderRig('#/rig/an:mini:outcomes')
    expect(container.querySelector('.rg-an-main')).not.toBeNull()
    expect(container.querySelector('.rg-an-main .rg-loading, .rg-an-main .rg-skel-stack, .rg-an-main .rg-pstate[aria-busy="true"]')).toBeNull()
  })
  it('every Outcomes row is in the page: rows are skipped for layout off screen, never left out', () => {
    const { container } = renderRig('#/rig/an:mini:outcomes')
    expect(container.querySelectorAll('.rg-an-trep').length).toBeGreaterThanOrEqual(2)
  })
  it('the overview shows the findings summary lines once its answers are in, and no placeholder is left', () => {
    const { container } = renderRig('#/rig/ds:mini')
    expect(container.querySelector('.rg-ds-find-wait, .rg-ds-more-wait')).toBeNull()
    expect(container.querySelector('[data-el="findings"] [data-el="collapsed-line"] summary').textContent).toMatch(/^All findings \(\d\) · show \d more$/)
  })
})

describe('the Sentinel cut line', () => {
  it('is clipped sideways by its histogram, so moving it never makes the page scroll sideways', async () => {
    // the line rides a full-width layer moved by transform; without the clip that layer reaches past the page
    const { readFileSync } = await import('node:fs')
    const css = readFileSync(`${process.cwd()}/src/rig/views/workspace.css`, 'utf8')
    const rule = css.match(/\.rg-ws-hist\{[^}]*\}/)[0]
    expect(rule).toContain('overflow-x:clip')
    expect(rule).not.toMatch(/overflow(-y)?:hidden/)                 // the line still reaches above and below the bars
    expect(css).toMatch(/\.rg-ws-thrw\{[^}]*transform:translateX\(calc\(var\(--rig-ws-thr\) \* 100%\)\)/)
  })
})

describe('first paint', () => {
  it('the boot screen paints the theme the workbench opens in itself, whatever ground the stylesheet after it sets', async () => {
    const { readFileSync } = await import('node:fs')
    const html = readFileSync(`${process.cwd()}/index.html`, 'utf8')
    expect(html).toMatch(/\.hl-boot\{position:fixed;inset:0;/)
    for (const theme of ['', 'html.hl-dark ', 'html.hl-hc ', 'html.hl-hcl ']) expect(html).toContain(`${theme}.hl-boot{background:`)
  })
})

describe('a page asks for its own answer first', () => {
  it('Comparison asks for the two-factor fit only once its comparisons are in', async () => {
    const data = rigFixture()
    for (const k of Object.keys(data)) if (k.includes('/comparisons') || k.includes('/experiment')) delete data[k]
    const urls = []
    let answer
    const fetchImpl = vi.fn((url) => {
      urls.push(String(url))
      if (String(url).includes('/comparisons')) return new Promise((resolve) => { answer = resolve })
      return Promise.resolve({ ok: false, status: 404, statusText: 'Not Found', headers: { get: () => 'application/json' }, json: async () => ({ detail: 'not primed' }) })
    })
    renderRig(`#/rig/an:${MINI}:delta`, { data, fetchImpl })
    await act(async () => {})
    expect(urls.some((u) => u.includes('/comparisons'))).toBe(true)
    expect(urls.some((u) => u.includes('/experiment'))).toBe(false)
    await act(async () => { answer({ ok: true, status: 200, statusText: 'OK', headers: { get: () => 'application/json' }, json: async () => ({ baseline: 'baseline', comparisons: {} }) }) })
    await act(async () => {})
    expect(urls.some((u) => u.includes('/experiment'))).toBe(true)
  })
})

