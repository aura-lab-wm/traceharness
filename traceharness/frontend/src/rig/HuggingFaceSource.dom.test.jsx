// @vitest-environment jsdom
/* The Hugging Face panel in the local console: catalog rows, a preview (cells as text), the import form, its
   progress and the provenance after it. fetch is a stub that answers exact paths and records every call. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, waitFor, within } from '@testing-library/react'
import { renderRig, resetRig, rigFixture } from '../../test/rig-testing'

afterEach(resetRig)

const CAT = {
  schema: 1, refreshed: '2026-11-16',
  datasets: [
    { id: 'nebius/SWE-agent-trajectories', kind: 'trajectories', title: 'SWE-agent trajectories', summary: 'Recorded SWE-agent runs.', rows: 80036, license: 'cc-by-4.0', gated: false },
    { id: 'SALT-NLP/SWE-chat', kind: 'trajectories', title: 'SWE-chat', summary: 'Chats.', rows: 6000, license: null, gated: true },
    { id: 'acme/no-license', kind: 'trajectories', title: 'No license', summary: 'No license stated.', rows: null, license: null, gated: false },
    { id: 'princeton-nlp/SWE-bench_Verified', kind: 'benchmark', title: 'SWE-bench Verified', summary: 'Tasks.', rows: 500, license: 'mit', gated: false },
  ],
}
const EVIL = '<img src=x onerror="window.__pwned=1"><script>window.__pwned=2</script>'
const PREVIEW = {
  dataset: 'nebius/SWE-agent-trajectories', revision: 'a'.repeat(40), license: 'cc-by-4.0', gated: false, rows: 80036, parquet_bytes: 1,
  splits: [{ config: 'default', split: 'train', rows: 80036 }], config: 'default', split: 'train',
  columns: [{ name: 'instance_id', type: 'string' }, { name: 'trajectory', type: 'string' }],
  first_rows: [{ instance_id: 'a__b-1', trajectory: EVIL }],
}
const PROV = { source: 'huggingface', dataset: 'nebius/SWE-agent-trajectories', revision: 'b'.repeat(40), config: 'default', split: 'train', offsets: [1, 2, 3], seed: 4, n: 3, n_imported: 3, total_rows: 80036, license: 'cc-by-4.0', redistributable: true, fetched_at: '2026-11-17T10:00:00Z', skipped: [] }
const IDLE = { status: 'idle', progress: null, error: null, result: null, source: '', history: [] }
const el = (c, id) => c.querySelector(`[data-el~="${id}"]`)

function stub(statuses) {
  const calls = []
  let k = 0
  const impl = vi.fn(async (url, opts = {}) => {
    const u = String(url)
    calls.push({ url: u, method: opts.method || 'GET', body: opts.body ? JSON.parse(opts.body) : undefined })
    const ok = (body) => ({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => body })
    if (u.startsWith('/api/hf/preview')) return ok(PREVIEW)
    if (u === '/api/hf/import') return ok({ status: 'running', results_dir: 'hf_nebius_SWE_agent_trajectories', source: 'huggingface' })
    if (u === '/api/overview') return ok(rigFixture()['/overview'])      // a finished import refreshes the dataset list
    if (u === '/api/import/status') return ok(statuses[Math.min(k++, statuses.length - 1)])
    return { ok: false, status: 404, statusText: 'Not Found', headers: { get: () => 'application/json' }, json: async () => ({ detail: 'nope' }) }
  })
  return { calls, fetchImpl: impl }
}
const data = () => ({ ...rigFixture(), '/hf/catalog': CAT, '/import/status': IDLE, '/import/sources': { sources: [] }, '/real/status': IDLE })

describe('Hugging Face panel (local)', () => {
  it('lists only the trajectory datasets: id, rows, license or "license not stated", gated', () => {
    const { container } = renderRig('#/rig/sources', { data: data() })
    const box = el(container, 'hf-catalog')
    const rows = [...box.querySelectorAll('tbody tr')]
    expect(rows.map((r) => r.getAttribute('data-id'))).toEqual(['nebius/SWE-agent-trajectories', 'SALT-NLP/SWE-chat', 'acme/no-license'])
    expect(rows[0].textContent).toContain('80,036')
    expect(rows[0].textContent).toContain('cc-by-4.0')
    expect(rows[1].textContent).toContain('license not stated')
    expect(rows[1].textContent).toContain('gated')
    expect(rows[2].textContent).toContain('license not stated')
    expect(box.textContent).not.toContain('SWE-bench_Verified')
    expect(within(rows[1]).queryByRole('button', { name: /Preview/ })).toBeNull()
  })

  it('previews a dataset: columns and first rows, a cell with markup shown as text and never run', async () => {
    const { calls, fetchImpl } = stub([IDLE])
    const { container } = renderRig('#/rig/sources', { data: data(), fetchImpl })
    fireEvent.click(within(el(container, 'hf-catalog')).getByRole('button', { name: 'Preview nebius/SWE-agent-trajectories' }))
    const prev = await waitFor(() => { const x = el(container, 'hf-preview'); expect(x).not.toBeNull(); return x })
    expect(calls.some((c) => c.url === '/api/hf/preview?dataset=nebius%2FSWE-agent-trajectories')).toBe(true)
    expect([...el(prev, 'hf-columns').querySelectorAll('tbody td.rg-mono:first-child')].map((t) => t.textContent)).toEqual(['instance_id', 'trajectory'])
    const cell = el(prev, 'hf-first-rows').querySelectorAll('tbody td')[1]
    expect(cell.textContent).toBe(EVIL)
    expect(cell.querySelector('img,script')).toBeNull()
    expect(prev.querySelector('img,script')).toBeNull()
    expect(window.__pwned).toBeUndefined()
    expect(prev.textContent).toContain('cc-by-4.0')
  })

  it('imports a sample, follows its progress and shows the provenance afterwards', async () => {
    const { calls, fetchImpl } = stub([
      { ...IDLE, status: 'running', progress: [1, 3], source: 'huggingface' },
      { ...IDLE, status: 'done', source: 'huggingface', result: { source: 'huggingface', results_dir: 'mine', imported: 3, skipped: 0, harness_ids: ['swe-agent'], n_tasks: 3, outcomes_known: 3, outcomes_unknown: 0, provenance: PROV } },
    ])
    const { container } = renderRig('#/rig/sources', { data: data(), fetchImpl })
    fireEvent.click(within(el(container, 'hf-catalog')).getByRole('button', { name: 'Preview nebius/SWE-agent-trajectories' }))
    const form = await waitFor(() => { const x = el(container, 'hf-import'); expect(x).not.toBeNull(); return x })
    const [rows, seed, name] = form.querySelectorAll('input')
    fireEvent.change(rows, { target: { value: '3' } })
    fireEvent.change(seed, { target: { value: '4' } })
    fireEvent.change(name, { target: { value: '../mine' } })
    expect(name.value).toBe('..mine')                                   // path characters never stay in the field
    fireEvent.change(name, { target: { value: 'mine' } })
    fireEvent.click(el(form, 'hf-import-start'))
    fireEvent.click(within(form).getByRole('button', { name: 'Import' }))
    await waitFor(() => expect(calls.some((c) => c.url === '/api/hf/import')).toBe(true))
    expect(calls.find((c) => c.url === '/api/hf/import').body).toEqual({ dataset: 'nebius/SWE-agent-trajectories', n: 3, seed: 4, name: 'mine' })
    await waitFor(() => expect(el(container, 'hf-progress').textContent).toContain('1 of 3'))
    await waitFor(() => expect(el(container, 'hf-result')).not.toBeNull(), { timeout: 6000 })
    const prov = el(container, 'hf-provenance').textContent
    for (const bit of ['huggingface', 'nebius/SWE-agent-trajectories', 'b'.repeat(40), 'default · train', 'seed 4', 'cc-by-4.0', '2026-11-17T10:00:00Z', 'may carry it'])
      expect(prov).toContain(bit)
    expect(within(el(container, 'hf-result')).getByRole('button', { name: 'Open mine' })).not.toBeNull()
  }, 15000)

  it('says a license that is not permissive keeps the data out of a default export', async () => {
    const { fetchImpl } = stub([IDLE])
    const { container } = renderRig('#/rig/sources', { fetchImpl, data: { ...data(), '/import/status': { ...IDLE, status: 'done', source: 'huggingface', result: { results_dir: 'x', imported: 1, skipped: 0, provenance: { ...PROV, license: null, redistributable: false } } } } })
    fireEvent.click(within(el(container, 'hf-catalog')).getByRole('button', { name: 'Preview nebius/SWE-agent-trajectories' }))
    const prov = await waitFor(() => { const x = el(container, 'hf-provenance'); expect(x).not.toBeNull(); return x })
    expect(prov.textContent).toContain('license not stated')
    expect(prov.textContent).toContain('leave it out')
  })

  it('shows the server\'s refusal in words', async () => {
    const fetchImpl = vi.fn(async (url) => {
      const u = String(url)
      if (u.startsWith('/api/hf/preview')) return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => PREVIEW }
      if (u === '/api/hf/import') return { ok: false, status: 409, statusText: 'Conflict', headers: { get: () => 'application/json' }, json: async () => ({ detail: 'data/runs/hf_x already exists; choose another name' }) }
      return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => IDLE }
    })
    const { container } = renderRig('#/rig/sources', { data: data(), fetchImpl })
    fireEvent.click(within(el(container, 'hf-catalog')).getByRole('button', { name: 'Preview nebius/SWE-agent-trajectories' }))
    const form = await waitFor(() => { const x = el(container, 'hf-import'); expect(x).not.toBeNull(); return x })
    fireEvent.click(el(form, 'hf-import-start'))
    fireEvent.click(within(form).getByRole('button', { name: 'Import' }))
    await waitFor(() => expect(el(container, 'hf-import-refused').textContent).toContain('already exists'))
  })

  it('uses no retired phrase', () => {
    const { container } = renderRig('#/rig/sources', { data: data() })
    expect(el(container, 'hugging-face').textContent).not.toMatch(/workbench/i)
  })
})
