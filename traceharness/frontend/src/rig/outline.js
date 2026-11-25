/* Rig · outline.js — the pages of one dataset, in reading order. PURE.
   The left pane lists them ("In this study"); each analysis page uses the label as its H1 and the
   question as its subtitle (at most 12 words). */
import { makeSpec } from './route'
import { short } from './data'

export const OUTLINE = [
  { id: 'overview', label: 'Overview', q: 'What stands out in this dataset?', kinds: ['ds', 'q'] },
  { id: 'tasks', label: 'Tasks', q: 'Which tasks are hard?', kinds: ['tasks', 'task'], el: 'nav-tasks' },
  { id: 'runs', label: 'Runs', q: 'What did each run do?', kinds: ['field', 'run', 'span', 'cmp', 'fork', 'paused'], el: 'nav-runs' },
  { id: 'family', label: 'Family matrix', q: 'Which model and harness pass most often?', el: 'nav-analysis', rule: true },
  { id: 'outcomes', label: 'Outcomes', q: 'How reliable is a pass?' },
  { id: 'tokens', label: 'Tokens', q: 'Where do the tokens go?' },
  { id: 'delta', label: 'Comparison', q: 'What did the harness change?' },
  { id: 'features', label: 'Trajectory features', q: 'Which habits go with failure?', more: true },
  { id: 'judge', label: 'Judge & integrity', q: 'Do the oracles agree?', more: true },
  { id: 'fit', label: 'Experiment', q: 'How much is the model, how much the harness?', more: true },
  { id: 'report', label: 'Report', q: 'What would I report?', more: true },
  { id: 'setup', label: 'Run setup', q: 'What should run next?', more: true },
]
export const OUTLINE_BY_ID = Object.fromEntries(OUTLINE.map((o) => [o.id, o]))

/** The outline row a page belongs to, or null (tool pages, settings, help). */
export function outlineOf(kind, args = []) {
  if (kind === 'an') return OUTLINE_BY_ID[args[1] || 'family'] ? args[1] || 'family' : null
  const row = OUTLINE.find((o) => o.kinds && o.kinds.includes(kind))
  return row ? row.id : null
}

/** Where a row leads for `dir`, carrying the condition in focus when it is about the same dataset. */
export function outlineSpec(id, dir, condition) {
  const mine = condition && condition.dir === dir && condition.model
  const cs = mine ? [short(condition.model), condition.harness] : []
  if (id === 'overview') return makeSpec('ds', dir, ...cs)
  if (id === 'tasks') return makeSpec('tasks', dir, ...cs)
  if (id === 'runs') return makeSpec('field', dir, ...(mine ? [condition.model, condition.harness] : []))
  return makeSpec('an', dir, id, ...cs)
}

/** "01" … "12". */
export const outlineNumber = (i) => String(i + 1).padStart(2, '0')
