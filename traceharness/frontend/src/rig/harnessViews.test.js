import { describe, expect, it } from 'vitest'
import { HARNESS_VIEWS, docKey, harnessSpec, harnessView, mountKey } from './harnessViews'
import { parseSpec } from './route'

describe('Harnesses views in the link', () => {
  it('has five views and One run is the default', () => {
    expect(HARNESS_VIEWS.map((v) => v.label)).toEqual(['One run', 'Experiments', 'Saved versions', 'Configuration file', 'Recent runs'])
    expect(harnessView([])).toBe('setup')
    expect(harnessView(['view', 'nonsense'])).toBe('setup')
    expect(harnessView(['view'])).toBe('setup')
  })

  it('reads and writes the view pair, keeping the other args', () => {
    expect(harnessSpec([], 'experiments')).toBe('harnesses:view:experiments')
    expect(harnessSpec(['view', 'experiments'], 'setup')).toBe('harnesses')
    expect(harnessSpec(['view', 'runs'], 'file')).toBe('harnesses:view:file')
    const fork = harnessSpec(['fork', 'r1'], 'versions')
    expect(fork).toBe('harnesses:fork:r1:view:versions')
    expect(harnessView(parseSpec(fork).args)).toBe('versions')
  })

  it('keeps an evidence origin intact', () => {
    const spec = harnessSpec(['custom', 'from', 'run:20260101-000000-a00000'], 'runs')
    const { args } = parseSpec(spec)
    expect(args.slice(0, 3)).toEqual(['custom', 'from', 'run:20260101-000000-a00000'])
    expect(harnessView(args)).toBe('runs')
  })

  it('keys the mounted page without the view, so switching views keeps its state', () => {
    expect(docKey('harnesses:view:experiments')).toBe('harnesses')
    expect(docKey('harnesses:fork:r1:view:runs')).toBe('harnesses:fork:r1')
    expect(docKey('harnesses')).toBe('harnesses')
    expect(docKey('an:mini:family')).toBe('an:mini:family')
    expect(docKey('ds:view:x')).toBe('ds:view:x')
  })

  it('keeps a run page mounted across its steps, and only across its own steps', () => {
    expect(mountKey('run:20260101-000000-a00000:s4')).toBe('run:20260101-000000-a00000')
    expect(mountKey('run:20260101-000000-a00000:17')).toBe('run:20260101-000000-a00000')
    expect(mountKey('run:20260101-000000-a00000')).toBe('run:20260101-000000-a00000')
    expect(mountKey('run:a00000:s2~q:mini:q3')).toBe('run:a00000~q:mini:q3')
    expect(mountKey('run:a00000:s2')).not.toBe(mountKey('run:b11111:s2'))
    expect(mountKey('span:a00000:17')).toBe('span:a00000')   // an event ledger stays mounted across its events
    expect(mountKey('harnesses:view:runs')).toBe('harnesses')
  })
})
