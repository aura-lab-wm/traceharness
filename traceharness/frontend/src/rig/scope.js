/* Rig · scope.js — which runs a figure is of, in words next to the figure. PURE.

   A figure that is one model under one harness says "this cell: <model> under <harness>"; one pooled over the
   dataset says "pooled: all 3 models × 9 harnesses"; the others say what they are across. Where a cell figure and
   a pooled one sit together, scopeDiffers() gives the one sentence on why they differ. */
import { short, fmt } from './data'

const { plural, int } = fmt

/** The words for a scope: { kind: 'cell'|'one-cell'|'pooled'|'harness'|'conditions'|'contrasts'|'trained'|'runs', … }. */
export function scopeWords(s) {
  if (!s) return ''
  switch (s.kind) {
    case 'cell': return s.model ? `this cell: ${short(s.model)} under ${s.harness}` : 'this cell'
    case 'one-cell': return s.model ? `one cell: ${short(s.model)} under ${s.harness}` : 'one cell'
    case 'pooled': {
      if (!s.models && !s.harnesses) return 'pooled: every run'
      const parts = [s.models > 1 && plural(s.models, 'model'), s.harnesses > 1 && plural(s.harnesses, 'harness', 'harnesses')].filter(Boolean)
      return parts.length ? `pooled: all ${parts.join(' × ')}` : 'pooled: the one model and harness'
    }
    case 'harness': return `one harness: ${s.harness}${s.models > 1 ? `, all ${s.models} models pooled` : ''}`
    case 'conditions': return s.n === 1 ? 'across: the 1 condition' : `across: all ${plural(s.n, 'condition')}`
    case 'contrasts': return `across: ${plural(s.n, 'contrast')} vs ${s.base}`
    case 'trained': return `the Sentinel’s training runs: ${int(s.n)}`
    case 'runs': return `pooled: all ${int(s.n)} runs${s.what ? ` ${s.what}` : ''}`
    default: return ''
  }
}

/** One sentence on why this cell's figure and the pooled one differ, or null when the cell is the whole dataset. */
export function scopeDiffers({ cellRuns, allRuns, models, harnesses }) {
  if (allRuns === cellRuns || (models <= 1 && harnesses <= 1)) return null
  const more = (n, w, p) => (n === 2 ? w : `${n - 1} ${p}`)
  const adds = [models > 1 && more(models, 'model', 'models'), harnesses > 1 && more(harnesses, 'harness', 'harnesses')].filter(Boolean).join(' and ')
  return `They differ because pooled adds the other ${adds}: ${int(allRuns)} runs, not this cell’s ${int(cellRuns)}.`
}
