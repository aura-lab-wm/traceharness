import { describe, expect, it } from 'vitest'
import { nearestIndex, readoutAt, stepIndex, lastIndex, endLabelsFit, totalsAt, endLabelGroups } from './chart-readout'

const S = [
  { key: 'any', label: 'pass@k · any passes', values: [0.62, 0.65, 0.66, 0.67] },
  { key: 'all', label: 'pass^k · all pass', values: [0.62, 0.6, 0.59, 0.58] },
  { key: 'gap', label: 'short series', values: [0.1, null, null, null] },
]

describe('chart-readout · the crosshair', () => {
  it('snaps to the nearest x, ties to the left, clamped to the ends', () => {
    const xs = [1, 2, 3, 5]
    expect(nearestIndex(xs, 0)).toBe(0)
    expect(nearestIndex(xs, 1.4)).toBe(0)
    expect(nearestIndex(xs, 1.5)).toBe(0)
    expect(nearestIndex(xs, 1.6)).toBe(1)
    expect(nearestIndex(xs, 4.2)).toBe(3)
    expect(nearestIndex(xs, 99)).toBe(3)
    expect(nearestIndex([], 3)).toBe(-1)
  })
  it('lists every series that has a value at that x, biggest first', () => {
    expect(readoutAt(S, 2).map((r) => [r.key, r.value])).toEqual([['any', 0.66], ['all', 0.59]])
    expect(readoutAt(S, 0).map((r) => r.key)).toEqual(['any', 'all', 'gap'])   // a tie keeps the series order
    expect(readoutAt(S, 0)[2]).toEqual({ key: 'gap', label: 'short series', value: 0.1, slot: 2 })
  })
  it('a series with no value there is left out, not drawn as zero', () => {
    expect(readoutAt(S, 3).map((r) => r.key)).toEqual(['any', 'all'])
    expect(readoutAt(S, 9)).toEqual([])
  })
  it('the keys step through the points: arrows one, Home and End to the ends; other keys do nothing', () => {
    expect(stepIndex(1, 'ArrowRight', 4)).toBe(2)
    expect(stepIndex(3, 'ArrowRight', 4)).toBe(3)
    expect(stepIndex(1, 'ArrowLeft', 4)).toBe(0)
    expect(stepIndex(0, 'ArrowLeft', 4)).toBe(0)
    expect(stepIndex(2, 'Home', 4)).toBe(0)
    expect(stepIndex(0, 'End', 4)).toBe(3)
    expect(stepIndex(-1, 'ArrowRight', 4)).toBe(0)      // the first arrow lands on the first point
    expect(stepIndex(-1, 'ArrowLeft', 4)).toBe(3)       // or on the last
    expect(stepIndex(1, 'a', 4)).toBeNull()
  })
  it('the last point any series has', () => {
    expect(lastIndex(S)).toBe(3)
    expect(lastIndex([{ values: [1, null] }])).toBe(0)
    expect(lastIndex([])).toBe(-1)
  })
  it('end labels fit when the margin is wide enough and, spread apart, they stay inside the plot', () => {
    expect(endLabelsFit([40, 60], { top: 10, bottom: 200, room: 120, widest: 100 })).toBe(true)
    expect(endLabelsFit([40, 60], { top: 10, bottom: 200, room: 80, widest: 100 })).toBe(false)
    expect(endLabelsFit([195, 196, 197], { top: 10, bottom: 200, room: 120, widest: 60, gap: 12 })).toBe(false)
  })
})

describe('chart-readout · running totals', () => {
  const xs = [1, 2, 3, 4]
  const A = [[1, 100], [2, 300], [4, 900]]          // sparse at 3: it holds 300 there
  const B = [[1, 50], [2, 120]]                      // a run that ended at call 2
  it('a total holds its last point at or before each x, and has none before its first or after its last', () => {
    expect(totalsAt(A, xs)).toEqual([100, 300, 300, 900])
    expect(totalsAt(B, xs)).toEqual([50, 120, null, null])
    expect(totalsAt([[2, 10]], xs)).toEqual([null, 10, null, null])
    expect(totalsAt([], xs)).toEqual([null, null, null, null])
  })
  it('a run that has ended keeps its total in the readout, with the x it ended at; one not started is left out', () => {
    const series = [
      { key: 'a', label: 'Run 1', values: totalsAt(A, xs), carry: true },
      { key: 'b', label: 'Run 2', values: totalsAt(B, xs), carry: true },
      { key: 'c', label: 'Run 3', values: totalsAt([[2, 10], [3, 20]], xs), carry: true },
    ]
    expect(readoutAt(series, 0, xs)).toEqual([{ key: 'a', label: 'Run 1', value: 100, slot: 0 }, { key: 'b', label: 'Run 2', value: 50, slot: 1 }])
    expect(readoutAt(series, 3, xs).map((r) => [r.label, r.value, r.ended])).toEqual([['Run 1', 900, undefined], ['Run 2', 120, 2], ['Run 3', 20, 3]])
    // without carry an ended series is left out, as any series without a value there
    expect(readoutAt(series.map((x) => ({ ...x, carry: false })), 3, xs).map((r) => r.key)).toEqual(['a'])
  })
  it('a key held with Alt, Ctrl, Meta or Shift is the browser\'s, not the chart\'s', () => {
    expect(stepIndex(2, 'ArrowLeft', 4, { altKey: true })).toBeNull()
    expect(stepIndex(2, 'ArrowRight', 4, { metaKey: true })).toBeNull()
    expect(stepIndex(2, 'Home', 4, { shiftKey: true })).toBeNull()
    expect(stepIndex(2, 'End', 4, { ctrlKey: true })).toBeNull()
    expect(stepIndex(2, 'ArrowLeft', 4, {})).toBe(1)
  })
})

describe('chart-readout · end labels that would meet', () => {
  const e = (key, i, y, label) => ({ key, i, y, label })
  it('lines that end at the same point at nearly the same height share one label', () => {
    const g = endLabelGroups([e('r1', 12, 40, 'Run 1'), e('r4', 7, 100, 'Run 4'), e('r2', 7, 104, 'Run 2'), e('r3', 7, 106, 'Run 3'), e('r5', 8, 103, 'Run 5')])
    expect(g.map((x) => [x.label, x.keys])).toEqual([['Run 1', ['r1']], ['Runs 2, 3, 4', ['r4', 'r2', 'r3']], ['Run 5', ['r5']]])
    expect(g[1].y).toBe(100)
  })
  it('the same height at different points, or far apart at one point, stay apart', () => {
    expect(endLabelGroups([e('a', 7, 100, 'A'), e('b', 8, 101, 'B')]).map((x) => x.label)).toEqual(['A', 'B'])
    expect(endLabelGroups([e('a', 7, 100, 'A'), e('b', 7, 140, 'B')]).map((x) => x.label)).toEqual(['A', 'B'])
  })
  it('labels that are not "Run n" are joined as they are', () => {
    expect(endLabelGroups([e('a', 3, 50, 'median'), e('b', 3, 55, 'p75')]).map((x) => x.label)).toEqual(['median · p75'])
  })
})
