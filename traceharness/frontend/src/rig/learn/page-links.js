/* Rig · learn/page-links.js — which Learn articles explain which page. PURE.

   The page header shows them as one visible line, "Learn: <title> · <title>" (primitives.jsx PageHelp), so
   no view has to list its own. An id that is not an article yet is left out when the line is drawn: articles.js decides. */
import { parseSpec } from '../route'
import { articleById } from './articles'

/** Origins whose runs were brought in from elsewhere (datasetInfo KINDS): their pages explain grading and import. */
export const IMPORTED = new Set(['imported', 'public', 'demo', 'captured'])

/** page key -> article ids, most useful first */
export const PAGE_ARTICLES = Object.freeze({
  run: ['reading-a-trajectory', 'outcome-labels', 'run-cost-steps-vs-tokens', 'phases-and-wasted-work'],
  'run:imported': ['reading-a-trajectory', 'how-swe-bench-grades', 'outcome-labels'],
  task: ['reading-a-trajectory', 'why-runs-differ', 'run-cost-steps-vs-tokens', 'phases-and-wasted-work'],
  lanes: ['reading-a-trajectory', 'phases-and-wasted-work'],
  field: ['outcome-labels', 'reading-a-trajectory'],
  tasks: ['why-runs-differ'],
  cmp: ['why-runs-differ'],
  ds: ['why-runs-differ', 'outcome-labels'],
  'ds:imported': ['how-swe-bench-grades', 'outcome-labels', 'where-runs-come-from'],
  'an:family': ['what-a-harness-is', 'comparing-runs-fairly', 'model-or-harness'],
  'an:outcomes': ['why-runs-differ', 'outcome-labels', 'how-many-runs'],
  'an:tokens': ['run-cost-steps-vs-tokens', 'phases-and-wasted-work'],
  'an:delta': ['comparing-runs-fairly', 'what-a-harness-is', 'how-many-runs'],
  'an:fit': ['what-a-harness-is', 'comparing-runs-fairly', 'model-or-harness'],
  'an:report': ['comparing-runs-fairly', 'why-runs-differ'],
  'an:judge': ['how-swe-bench-grades', 'traps-in-the-task'],
  harnesses: ['what-a-harness-is', 'make-and-run-a-harness'],
  sources: ['where-runs-come-from'],
  sentinel: ['sentinel-early-warning'],
})

/** The key of PAGE_ARTICLES a spec reads. `originOf(dir)` names a dataset's origin, `runDir(id)` the dataset of a
 *  run; both may answer null while the index loads (the line then waits for them). */
export function pageLinkKey(spec, { originOf = () => null, runDir = () => null } = {}) {
  const { kind, args } = parseSpec(spec)
  const imported = (dir) => !!dir && IMPORTED.has(originOf(dir))
  if (kind === 'run') return imported(runDir(args[0])) ? 'run:imported' : 'run'
  if (kind === 'ds') return imported(args[0]) ? 'ds:imported' : 'ds'
  if (kind === 'an') return `an:${args[1] || 'family'}`
  if (kind === 'sources' || kind === 'capture') return 'sources'
  return kind
}

/** The articles a page links, as { id, title }: only ids that are articles now, at most four. */
export function pageArticles(spec, opts) {
  const ids = PAGE_ARTICLES[pageLinkKey(spec, opts)] || []
  return ids.map(articleById).filter(Boolean).slice(0, 4).map((a) => ({ id: a.id, title: a.title }))
}
