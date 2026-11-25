import { describe, expect, it } from 'vitest'
import { parseVS, formatVS, vsOf, withVS, stripVS, VS_ARG } from './viewState'
import { parseSpec, parseHash, toHash } from './route'

describe('viewState · the page selections kept in its tab spec', () => {
  it('reads key.value pairs separated by commas', () => {
    expect(parseVS('sort.runs,dir.asc,kind.mock')).toEqual({ sort: 'runs', dir: 'asc', kind: 'mock' })
    expect(parseVS('')).toEqual({})
    expect(parseVS(null)).toEqual({})
  })
  it('a value keeps its dots and slashes; only the first dot splits', () => {
    expect(parseVS('mf.acme/alpha-1.5')).toEqual({ mf: 'acme/alpha-1.5' })
  })
  it('drops pairs it cannot read and keys that are not plain words', () => {
    expect(parseVS('sort.runs,junk,__proto__.x,Bad.y,dir.')).toEqual({ sort: 'runs' })
    expect(Object.getPrototypeOf(parseVS('constructor.x'))).toBe(Object.prototype)
    expect(parseVS('constructor.x')).toEqual({})
  })
  it('writes pairs in key order and leaves out every value equal to its default', () => {
    expect(formatVS({ sort: 'runs', dir: 'asc', kind: 'all' }, { sort: 'updated', dir: 'desc', kind: 'all' })).toBe('dir.asc,sort.runs')
    expect(formatVS({ sort: 'updated', dir: 'desc', kind: 'all' }, { sort: 'updated', dir: 'desc', kind: 'all' })).toBe('')
    expect(formatVS({ a: null, b: '' })).toBe('')
  })
  it('a comma or a percent sign in a value survives the round trip', () => {
    const s = { mf: 'a,b%c', ch: 'x' }
    expect(parseVS(formatVS(s))).toEqual(s)
  })
  it('lives at a fixed argument: home has it first, an: after the condition', () => {
    expect(VS_ARG).toEqual({ home: 0, an: 4 })
    expect(vsOf('home:sort.runs')).toBe('sort.runs')
    expect(vsOf('an:mini:tokens:alpha-1:baseline:view.table')).toBe('view.table')
    expect(vsOf('an:mini:tokens')).toBe('')
    expect(vsOf('ds:mini:alpha-1:baseline:x')).toBe('')   // a kind without one never has one
  })
  it('withVS sets the argument, pads the condition when it is missing, and drops it when empty', () => {
    expect(withVS('home', 'sort.runs')).toBe('home:sort.runs')
    expect(withVS('home:sort.runs', '')).toBe('home')
    expect(withVS('an:mini:tokens', 'view.table')).toBe('an:mini:tokens:::view.table')
    expect(withVS('an:mini:tokens:alpha-1:baseline:view.table', 'view.chart')).toBe('an:mini:tokens:alpha-1:baseline:view.chart')
    expect(withVS('ds:mini', 'x.y')).toBe('ds:mini')
  })
  it('keeps the evidence chain and the escaping of the other arguments', () => {
    const s = withVS('an:mini:outcomes:acme/alpha-1:mini-swe-agent@2.4.x~q:mini:repeats', 'ladder.table')
    expect(s).toBe('an:mini:outcomes:acme/alpha-1:mini-swe-agent@2.4.x:ladder.table~q:mini:repeats')
    expect(parseSpec(s).chain).toEqual({ dir: 'mini', qid: 'repeats' })
    expect(parseSpec(s).args.slice(0, 4)).toEqual(['mini', 'outcomes', 'acme/alpha-1', 'mini-swe-agent@2.4.x'])
  })
  it('stripVS gives the page without its selections (what keys the mounted page)', () => {
    expect(stripVS('home:sort.runs,dir.asc')).toBe('home')
    expect(stripVS('an:mini:family:::mf.acme/alpha-1')).toBe('an:mini:family')
    expect(stripVS('run:abc:s3')).toBe('run:abc:s3')
  })
  it('a spec with a state survives the hash round trip', () => {
    const st = parseHash('#/rig/home:dir.asc,kind.mock,sort.runs+!' + withVS('an:mini:tokens', 'view.table'))
    expect(st.panes[0].tabs).toEqual(['home:dir.asc,kind.mock,sort.runs', 'an:mini:tokens:::view.table'])
    expect(parseHash(toHash(st))).toEqual(st)
  })
})
