import { describe, expect, it, vi } from 'vitest'

vi.mock('./api', () => ({ api: vi.fn(async () => ({ status: 'running' })) }))
const { api } = await import('./api')
const H = await import('./hf-api.js')

describe('hf-api', () => {
  it('accepts only owner/name ids in the Hub alphabet', () => {
    for (const ok of ['nebius/SWE-agent-trajectories', 'a/b', 'a.b/c_d-e']) expect(H.isDatasetId(ok)).toBe(true)
    for (const bad of ['https://huggingface.co/a/b', 'a/b/c', 'a/../b', '../a/b', 'a@rev/b', 'a/b?x=1', 'a/b#f', 'a/b\n', '', 'a', null, 5, 'x'.repeat(97) + '/b'])
      expect(H.isDatasetId(bad), String(bad)).toBe(false)
  })
  it('names a directory hf_<owner>_<name>', () => {
    expect(H.defaultName('nebius/SWE-agent-trajectories')).toBe('hf_nebius_SWE_agent_trajectories')
    expect(H.defaultName('a.b/c_d')).toBe('hf_a_b_c_d')
    expect(H.isResultsName(H.defaultName('nebius/SWE-agent-trajectories'))).toBe(true)
  })
  it('keeps a typed name to the allowed characters and refuses path-like names', () => {
    expect(H.cleanName('../x/y z')).toBe('..xyz')
    for (const bad of ['../x', '/abs', 'a/b', '.hidden', 'a\\b', '', 'a..b', 'x\u0000y']) expect(H.isResultsName(bad), bad).toBe(false)
    expect(H.isResultsName('my-run_1.2')).toBe(true)
  })
  it('keeps the row count a whole number from 1 to 2000', () => {
    expect([H.clampRows(0), H.clampRows(-4), H.clampRows(5000), H.clampRows('12.7'), H.clampRows('abc')]).toEqual([200, 1, 2000, 12, 200])
  })
  it('says "license not stated" for a null license', () => {
    expect(H.licenseText(null)).toBe('license not stated')
    expect(H.licenseText('mit')).toBe('mit')
  })
  it('lists the trajectory datasets only', () => {
    expect(H.trajectoryDatasets({ datasets: [{ id: 'a/b', kind: 'benchmark' }, { id: 'c/d', kind: 'trajectories' }] }).map((d) => d.id)).toEqual(['c/d'])
    expect(H.trajectoryDatasets(null)).toEqual([])
  })
  it('sends nothing for a bad id or name, and posts the exact body otherwise', async () => {
    api.mockClear()
    await expect(H.hfPreview('a/../b')).rejects.toThrow(/dataset id/)
    await expect(H.hfImport({ dataset: 'a/b/c', n: 5 })).rejects.toThrow(/dataset id/)
    await expect(H.hfImport({ dataset: 'a/b', n: 5, name: '../x' })).rejects.toThrow(/name/)
    expect(api).not.toHaveBeenCalled()
    await H.hfImport({ dataset: 'a/b', n: 99999, seed: '3', name: 'mine' })
    expect(api).toHaveBeenCalledWith('/hf/import', { method: 'POST', body: { dataset: 'a/b', n: 2000, seed: 3, name: 'mine' } })
    await H.hfPreview('a/b')
    expect(api).toHaveBeenLastCalledWith('/hf/preview?dataset=a%2Fb')
  })
})
