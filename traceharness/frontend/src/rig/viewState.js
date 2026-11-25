/* ====================================================================================
   Rig · viewState.js — a page's own selections (its sort, its filter chip, chart or table, a picked
   model or cell) kept in its tab spec, so a link or Back reopens the page as it was. PURE.

   The state is one spec argument at a fixed place per kind (VS_ARG):
     home:sort.runs,dir.asc,kind.mock
     an:<dir>:<view>:<model>:<harness>:ladder.table
   Pairs are `key.value` joined by commas, written in key order; a value equal to its default is
   not written, so a page as it first opens has no state argument at all. A value may hold any
   character: `%` and `,` are escaped inside it, the rest is escaped by makeSpec like any argument.
   stripVS() is the page without its selections: what keys the mounted page and finds an open tab
   of the same page (harnessViews.docKey), so a new sort never remounts the table.
   ==================================================================================== */
import { makeSpec, parseSpec, withChain } from './route'

/** Where each kind keeps its state: the argument index. A kind not listed keeps none. */
export const VS_ARG = Object.freeze({ home: 0, an: 4 })

const KEY = /^[a-z][a-z0-9]*$/
const FORBIDDEN = new Set(['constructor', 'prototype'])
const encVal = (v) => String(v).replace(/%/g, '%25').replace(/,/g, '%2C')
const decVal = (v) => v.replace(/%2C/gi, ',').replace(/%25/g, '%')

/** `sort.runs,dir.asc` → { sort: 'runs', dir: 'asc' }. Unreadable pairs are dropped, never thrown. */
export function parseVS(str) {
  const out = {}
  for (const pair of String(str || '').split(',')) {
    const i = pair.indexOf('.')
    if (i < 1) continue
    const key = pair.slice(0, i), val = pair.slice(i + 1)
    if (!KEY.test(key) || FORBIDDEN.has(key) || !val) continue
    out[key] = decVal(val)
  }
  return out
}

/** The state as one argument, keys in order, defaults and empty values left out ('' when nothing is left). */
export function formatVS(state, defaults = {}) {
  return Object.keys(state || {}).sort()
    .filter((k) => KEY.test(k) && state[k] != null && state[k] !== '' && String(state[k]) !== String(defaults[k] ?? ''))
    .map((k) => `${k}.${encVal(state[k])}`)
    .join(',')
}

/** The state argument of a spec, '' when it has none or its kind keeps none. */
export function vsOf(spec) {
  const { kind, args } = parseSpec(spec)
  const at = VS_ARG[kind]
  return at == null ? '' : args[at] || ''
}

/** The spec with its state argument set to `vs` ('' removes it); the evidence chain is kept. */
export function withVS(spec, vs) {
  const { kind, args, chain } = parseSpec(spec)
  const at = VS_ARG[kind]
  if (at == null) return String(spec || '')
  const next = Array.from({ length: Math.max(args.length, at + 1) }, (_, i) => (i === at ? vs || '' : args[i] ?? ''))
  return withChain(makeSpec(kind, ...next), chain)
}

/** The page without its selections. */
export const stripVS = (spec) => (vsOf(spec) ? withVS(spec, '') : String(spec || ''))
