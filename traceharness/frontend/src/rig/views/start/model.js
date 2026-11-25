/* Rig · views/start/model.js — what Home draws, as plain data. PURE.
   * runPhase: one phase of the recorded run in start-run.json (written by scripts/learn_figures.py from study_v04).
   * learnStrip: Learn as one square per article, grouped by part.
   * sourceCount: how many sources the articles cite, and how many carry the date they were checked. */
import { PHASE_WORD } from '../../token-model'

/** The five phases Home walks through, in the order a run usually takes them. */
export const RUN_PHASES = Object.freeze(['explore', 'reproduce', 'edit', 'test', 'submit'])
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1)
/** "Explore", and its one plain line ("Reading, listing and searching the code"), as token-model words it. */
export const phaseTitle = (p) => cap(p)
export const phaseLine = (p) => cap(PHASE_WORD[p] || p)

/**
 * One phase of a run: its tool calls, each with its model call `k`; the model calls they were asked in; those calls'
 * tokens, once each; and which of those calls came after the fix and after the tests first passed.
 * @param {{ fix_call: number|null, first_pass_call: number|null, calls: Array<{ k: number, tokens: number, tools: Array<{ phase: string }> }> }} run
 * @param {string} phase
 */
export function runPhase(run, phase) {
  const tools = run.calls.flatMap((c) => c.tools.filter((t) => t.phase === phase).map((t) => ({ ...t, k: c.k })))
  const calls = [...new Set(tools.map((t) => t.k))]
  const tokens = run.calls.filter((c) => calls.includes(c.k)).reduce((s, c) => s + c.tokens, 0)
  const after = (at) => (at == null ? [] : calls.filter((k) => k > at))
  return { phase, tools, calls, tokens, afterFix: after(run.fix_call), afterPass: after(run.first_pass_call) }
}

/**
 * Learn as squares: per part, its articles as read, next (the first article not read, over all parts) or todo; how
 * many of the part are read; and the article the part opens (its first not read, else its first).
 * @param {Array<{ id: string, part: number }>} articles
 * @param {Array<{ id: number }>} parts
 * @param {string[]} read
 */
export function learnStrip(articles, parts, read) {
  const next = articles.find((a) => !read.includes(a.id)) || null
  return parts.map((part) => {
    const arts = articles.filter((a) => a.part === part.id)
    return {
      part,
      done: arts.filter((a) => read.includes(a.id)).length,
      opens: arts.find((a) => !read.includes(a.id)) || arts[0],
      items: arts.map((a) => ({ a, state: read.includes(a.id) ? 'read' : next && a.id === next.id ? 'next' : 'todo' })),
    }
  })
}

/** { n, checked }: the sources every article cites, and those that say when they were checked. */
export function sourceCount(articles) {
  const all = articles.flatMap((a) => a.sources || [])
  return { n: all.length, checked: all.filter((s) => typeof s.checked === 'string' && s.checked).length }
}
