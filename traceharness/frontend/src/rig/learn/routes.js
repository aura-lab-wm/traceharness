/* Rig · learn/routes.js — Learn reuses the `guide` route kind (no new kind: modes.parity.test.jsx
   wants a spec for every registered kind). PURE.

     guide                    the Reading guide, as before (#/start lands here)
     guide:learn              Learn: the articles, the glossary and, with Student Lab on, the guides
     guide:<article id>       one article
     guide:glossary[:<slug>]  the glossary, scrolled to one term; an alias slug (flip-rate) opens its row (flip)
     package                  Reference materials, as before (#/package) */
import { makeSpec, parseSpec } from '../route'
import { sfx } from '../data'
import { OUTLINE_BY_ID } from '../outline'
import { articleById } from './articles'
import { resolveSlug } from './glossary'
import { HARNESS_VIEWS } from '../harnessViews'

/** The two public datasets every worked example and challenge is done on. */
export const EXAMPLE_DATASETS = Object.freeze(['study_v04', 'swe_rebench_openhands_qwen3coder'])

export const LEARN_HOME = makeSpec('guide', 'learn')
export const articleSpec = (id) => makeSpec('guide', id)
export const glossarySpec = (slug) => makeSpec('guide', 'glossary', slug)

/** What a guide tab shows, from its args. */
export function learnPage(args = []) {
  const [page, term] = args
  if (!page) return { page: 'guide' }
  if (page === 'learn') return { page: 'learn' }
  if (page === 'glossary') return { page: 'glossary', term: term ? resolveSlug(term) : null }
  const article = articleById(page)
  return article ? { page: 'article', article } : { page: 'missing', id: page }
}

const DATASET_KINDS = ['ds', 'tasks', 'task', 'an', 'field', 'q', 'lanes']
/** The tabs of Add data and the pages of Harnesses and Analysis a step may open, by the names they show. */
const ADD_TABS = { import: 'Import files', sample: 'Public sample', capture: 'Session capture', disk: 'Results on disk' }
const PAGE_NAMES = { shallowWizard: 'Minimal harness', shallowCards: 'Fixed harnesses', blocks: 'Build a harness', shallowApply: 'One prompt, six shells', sentinel: 'Sentinel', home: 'Datasets' }
/** The dataset a spec opens, or null when the spec does not say (a run, a comparison). */
export function specDataset(spec) {
  const { kind, args } = parseSpec(spec)
  return DATASET_KINDS.includes(kind) && args[0] ? args[0] : null
}

/** The dataset each step needs: the one its spec names, else the one an earlier step chose, else `first`. */
export function stepDatasets(links, first) {
  let cur = first
  return links.map((s) => { cur = (s && specDataset(s)) || cur; return cur })
}

/** The words on a step's link: "Open Tasks", "Open t24_ini_parser", "Open run 1d0cfa". */
export function linkLabel(spec) {
  const { kind, args } = parseSpec(spec)
  if (kind === 'ds') return `Open ${args[0]}`
  if (kind === 'tasks') return 'Open Tasks'
  if (kind === 'task') {
    const n = Number.parseInt(args[4], 10)
    return Number.isFinite(n) ? `Open ${args[3]}, Run ${n + 1}` : `Open ${args[3]}`
  }
  if (kind === 'run') return `Open run ${sfx(args[0])}`
  if (kind === 'cmp') return 'Open the comparison'
  if (kind === 'field') return 'Open Runs'
  if (kind === 'an') return `Open ${(OUTLINE_BY_ID[args[1]] || { label: 'the analysis' }).label}`
  if (kind === 'lanes') return `Open all runs of ${args[3]}`
  if (kind === 'sources') return `Open ${ADD_TABS[args[0] || 'import'] || 'Add data'}`
  if (kind === 'capture') return `Open ${ADD_TABS.capture}`
  if (kind === 'recommend') return 'Open Which benchmark?'
  if (kind === 'harnesses') return `Open ${(HARNESS_VIEWS.find((v) => v.id === (args[0] || 'setup')) || { label: 'Harnesses' }).label}`
  if (PAGE_NAMES[kind]) return `Open ${PAGE_NAMES[kind]}`
  return 'Open'
}
