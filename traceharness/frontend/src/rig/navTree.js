/* Rig · navTree.js — the left list: Home, then the seven places. PURE.

   Home · Datasets · Overview · Tasks · Runs · Analysis · Harnesses · Add data. Overview, Tasks, Runs and
   Analysis are about the dataset in focus; the others are shared. A section with children (Datasets,
   Analysis, Harnesses, Add data) shows them while one of its pages is open, or while the reader keeps it
   open. Every route kind has one home here or in the frame (Settings in More actions; Learn in Help),
   and every address keeps working: the rows only point at the routes that already exist. */
import { makeSpec } from './route'
import { short } from './data'
import { OUTLINE_BY_ID } from './outline'
import { harnessView, harnessSpec } from './harnessViews'
import { LABELS } from '../shared/index.js'

const an = (id, group) => ({ id, group, label: OUTLINE_BY_ID[id].label, an: id, el: `outline-${id}` })

/** The seven sections. `kinds` are the route kinds whose pages live in the section. */
export const NAV = [
  // Home: what TraceHarness is for and where to start; the app opens on it (App.jsx)
  { id: 'start', label: 'Home', icon: 'home', el: 'nav-start', kinds: ['start'], children: [] },
  { id: 'datasets', label: 'Datasets', icon: 'database', el: 'nav-home', kinds: ['home', 'canvas'],
    children: [{ id: 'map', label: 'Map', spec: 'canvas', kinds: ['canvas'], el: 'nav-canvas' }] },
  { id: 'overview', label: 'Overview', icon: 'layout', el: 'outline-overview', kinds: ['ds'], dataset: true, children: [] },
  { id: 'tasks', label: 'Tasks', icon: 'tasks', el: 'outline-tasks nav-tasks', tour: 'nav-tasks', kinds: ['tasks', 'task', 'lanes'], dataset: true, children: [] },
  { id: 'runs', label: 'Runs', icon: 'pulse', el: 'outline-runs nav-runs', tour: 'nav-runs', kinds: ['field', 'run', 'span', 'cmp', 'fork', 'paused'], dataset: true, children: [] },
  { id: 'analysis', label: 'Analysis', icon: 'chart', el: 'nav-analysis', tour: 'nav-analysis', kinds: ['q', 'an', 'sentinel'], dataset: true,
    children: [
      { id: 'questions', label: 'Questions', kinds: ['q'], el: 'outline-questions', needs: true },
      an('family', 'Which setup wins'), an('delta', 'Which setup wins'), an('fit', 'Which setup wins'),
      an('outcomes', 'Can I trust it'), an('judge', 'Can I trust it'),
      an('tokens', 'How runs behave'), an('features', 'How runs behave'),
      { id: 'sentinel', group: 'How runs behave', label: 'Sentinel', spec: 'sentinel', kinds: ['sentinel'], el: 'nav-sentinel' },
      an('report', 'Write it up'), an('setup', 'Write it up'),
    ] },
  { id: 'harnesses', label: 'Harnesses', icon: 'sliders', el: 'nav-harnesses', kinds: ['harnesses', 'shallowCards', 'shallowWizard', 'shallowApply', 'blocks'], rule: true,
    children: [
      { id: 'one', group: 'Run', label: 'One run', view: 'setup', el: 'nav-one-run' },
      { id: 'setup', group: 'Run', label: 'Run setup', link: true, el: 'nav-run-setup', needs: true },
      { id: 'experiments', group: 'Run', label: 'Experiments', view: 'experiments', el: 'nav-experiments' },
      { id: 'runs', group: 'Run', label: 'Recent runs', view: 'runs', el: 'nav-recent-runs' },
      { id: 'minimal', group: 'Make a harness', label: 'Minimal harness', spec: 'shallowWizard', kinds: ['shallowWizard'], el: 'nav-minimal' },
      { id: 'fixed', group: 'Make a harness', label: 'Fixed harnesses', spec: 'shallowCards', kinds: ['shallowCards'], el: 'nav-fixed' },
      { id: 'build', group: 'Make a harness', label: 'Build a harness', spec: 'blocks', el: 'nav-build' },
      { id: 'six', group: 'Make a harness', label: 'One prompt, six shells', spec: 'shallowApply', kinds: ['shallowApply'], el: 'nav-six' },
      { id: 'file', group: 'Make a harness', label: 'Configuration file', view: 'file', el: 'nav-config-file' },
      { id: 'versions', group: 'Make a harness', label: 'Saved versions', view: 'versions', el: 'nav-saved-versions' },
    ] },
  { id: 'adddata', label: 'Add data', icon: 'plus', el: 'nav-sources', tour: 'add-data', kinds: ['sources', 'capture', 'recommend'], add: true,
    children: [
      { id: 'import', label: 'Import files', spec: 'sources', el: 'nav-import' },
      { id: 'sample', label: 'Public sample', spec: makeSpec('sources', 'sample'), el: 'nav-sample' },
      // the contract's word (shared/contract.py LABELS.capture_local)
      { id: 'capture', label: LABELS.capture_local, spec: 'capture', kinds: ['capture'], el: 'nav-capture' },
      { id: 'disk', label: 'Results on disk', spec: makeSpec('sources', 'disk'), el: 'nav-disk' },
      { id: 'recommend', label: 'Which benchmark?', spec: 'recommend', kinds: ['recommend'], el: 'nav-recommend' },
    ] },
]
export const NAV_BY_ID = Object.fromEntries(NAV.map((s) => [s.id, s]))

/** Kinds that live in the frame, not the left list: Settings (More actions) and Learn (Help). */
export const FRAME_KINDS = { settings: 'More actions › Settings', guide: 'Help › Learn', package: 'Help › Learn' }

/** The section a page belongs to, or null for a frame page (Settings, Learn). */
export function sectionOf(kind) {
  const s = NAV.find((x) => x.kinds.includes(kind))
  return s ? s.id : null
}

/** The child row a page is, inside its section, or null when the section row itself is the page. */
export function childOf(kind, args = []) {
  if (kind === 'canvas') return 'map'
  if (kind === 'q') return 'questions'
  if (kind === 'an') return OUTLINE_BY_ID[args[1] || 'family'] ? args[1] || 'family' : null
  if (kind === 'sentinel') return 'sentinel'
  if (kind === 'harnesses') { const v = harnessView(args); return v === 'setup' ? 'one' : v }
  if (kind === 'blocks') return args[0] === 'customize' ? 'one' : 'build'
  if (kind === 'shallowWizard') return 'minimal'
  if (kind === 'shallowCards') return 'fixed'
  if (kind === 'shallowApply') return 'six'
  if (kind === 'sources') return ['sample', 'disk', 'capture'].includes(args[0]) ? args[0] : 'import'
  if (kind === 'capture') return 'capture'
  if (kind === 'recommend') return 'recommend'
  return null
}

/** Where a page lives: { section, child } in the left list, { frame } for Settings and Learn, or null. */
export function homeOf(kind, args = []) {
  const section = sectionOf(kind)
  if (section) return { section, child: childOf(kind, args) }
  return FRAME_KINDS[kind] ? { frame: FRAME_KINDS[kind] } : null
}

/** A page that both its section's row and one of its child rows open (Analysis and Questions; Harnesses and its
 *  views; Add data and its tabs) names both in its title, so either row lands on a page that says its name:
 *  [section label, child label], e.g. ['Harnesses', 'Experiments']. null for a page outside such a section. */
const SHARED_PAGES = new Set(['q', 'harnesses', 'sources', 'capture'])
export function pagePath(kind, args = []) {
  if (!SHARED_PAGES.has(kind)) return null
  const home = homeOf(kind, args)
  const s = home && home.section ? NAV_BY_ID[home.section] : null
  const row = s && home.child ? s.children.find((c) => c.id === home.child) : null
  return row ? [s.label, row.label] : null
}

/** The spec a row opens for `dir`, carrying the condition in focus when it is about the same dataset. A
 *  Harnesses view row on a Harnesses page keeps that page's own args (its directive and evidence origin), so
 *  it switches the view of the page in place, and the view in view is that page itself. */
function rowSpec(row, dir, condition, here = {}) {
  const mine = !!(condition && condition.dir === dir && condition.model)
  const cs = mine ? [short(condition.model), condition.harness] : []
  if (row.spec) return row.spec
  if (row.view) return harnessSpec(here.kind === 'harnesses' ? here.args || [] : [], row.view)
  if (row.an) return dir ? makeSpec('an', dir, row.an, ...cs) : 'home'
  if (row.id === 'setup' && row.link) return dir ? makeSpec('an', dir, 'setup', ...cs) : 'home'
  if (row.id === 'questions') return dir ? makeSpec('q', dir) : 'home'
  switch (row.id) {
    case 'start': return 'start'
    case 'datasets': return 'home'
    case 'overview': return dir ? makeSpec('ds', dir, ...cs) : 'home'
    case 'tasks': return dir ? makeSpec('tasks', dir, ...cs) : 'home'
    case 'runs': return dir ? makeSpec('field', dir, ...(mine ? [condition.model, condition.harness] : [])) : 'home'
    case 'analysis': return dir ? makeSpec('q', dir) : 'home'
    case 'harnesses': return 'harnesses'
    case 'adddata': return 'sources'
    default: return 'home'
  }
}

/** What the left list draws for the page in view. `expanded` holds the reader's own choices, by section
 *  (true open, false closed). A section is `open` (its children shown) by that choice, else while it
 *  holds the page; `has` when it holds the page; `on` when its own row is the page. A child is `on` when
 *  it is the page; a closed section still draws that one row, so the page in view is always marked. */
export function navModel({ kind, args = [], dir, condition, expanded = {}, waiting = false }) {
  const curSection = sectionOf(kind)
  const curChild = childOf(kind, args)
  const sections = NAV.map((s) => {
    const has = s.id === curSection
    // while the library loads (`waiting`) a dataset's pages are drawn in place, not yet pressable, so an open
    // section has its full height from the first paint and nothing below it moves when they arrive
    const children = s.children
      .filter((c) => !(c.needs || c.an) || dir || waiting)
      .map((c) => (!dir && (c.needs || c.an)
        ? { ...c, spec: null, wait: true, on: has && curChild === c.id }
        : { ...c, spec: rowSpec(c, dir, condition, { kind, args }), on: has && curChild === c.id }))
    const childOn = children.some((c) => c.on)
    return {
      ...s, spec: rowSpec(s, dir, condition), children, has,
      on: has && !childOn,
      // the reader's own choice wins; by default a section is open while one of its pages is
      open: children.length > 0 && (expanded[s.id] === undefined ? has : !!expanded[s.id]),
    }
  })
  return { sections }
}

/** Old and other names of pages, kept findable in ⌘K and the glossary (no word is retired).
 *  `now` is the page's name today; `spec(dir, cs)` opens it, or null when the name is of a control; `act`
 *  names a control ⌘K opens instead ('scope': the model, harness and oracle menu). The 0.6.0 names come from
 *  HANDOUT.md, docs/GUIDE.md and docs/STUDENT_GUIDE.md, which still use them. */
export const NAV_ALIASES = [
  { old: 'Condition matrix', now: 'Family matrix', an: 'family', why: 'an earlier name for the model × harness grid; Family matrix is the handout\'s word' },
  { old: 'Matrix', now: 'Family matrix', an: 'family', why: 'short name for the model × harness grid' },
  { old: 'Change vs baseline', now: 'Comparison', an: 'delta', why: 'what the Comparison page shows: each harness against the baseline' },
  { old: 'Patterns', now: 'Trajectory features', an: 'features', why: 'the page lists step patterns that go with failure' },
  { old: 'Model vs harness', now: 'Experiment', an: 'fit', why: 'the two-factor fit: how much is the model, how much the harness' },
  { old: 'Many runs', now: 'Run setup', an: 'setup', why: 'plan many runs at once (models × harnesses × tasks)' },
  { old: 'Set up a run', now: 'One run', spec: 'harnesses', why: 'the Harnesses view that runs one harness, model and task' },
  { old: 'App copies', now: 'Fixed harnesses', spec: 'shallowCards', why: 'TraceHarness copies of six coding apps\' prompts and tools' },
  { old: 'Build from blocks', now: 'Build a harness', spec: 'blocks', why: 'stack the blocks of a harness yourself' },
  { old: 'Customize minimal harness', now: 'Advanced settings', spec: makeSpec('blocks', 'customize'), why: 'Customize is now inside One run › Advanced settings, with its search and saved harnesses' },
  { old: 'Customize', now: 'Advanced settings', spec: makeSpec('blocks', 'customize'), why: 'Customize is now inside One run › Advanced settings' },
  { old: 'Trajectories', now: 'Runs', ds: 'field', why: 'the list of every run' },
  { old: 'Trajectory explorer', now: 'Tasks', ds: 'tasks', why: 'every task with all its runs side by side' },
  { old: 'Canvas', now: 'Map', spec: 'canvas', why: 'the node map of datasets, models and conditions, under Datasets' },
  { old: 'Answer 6 questions', now: 'Guide me', spec: 'harnesses', why: 'the One run button that changes 4 settings of this harness from six answers' },
  { old: 'App menu', now: 'More actions', spec: null, why: 'the ⋯ button in the top bar: panels, view, Student Lab, Settings' },
  { old: 'Compare one prompt across the six TraceHarness shells', now: 'One prompt, six shells', spec: 'shallowApply', why: 'preview one prompt in each of the six fixed harnesses' },
  { old: 'Sources & capture', now: 'Add data', spec: 'sources', why: '0.6.0\'s page, as the handout and guide name it: import files, a public sample, session capture, results on disk' },
  { old: 'Download a public sample', now: 'Public sample', spec: makeSpec('sources', 'sample'), why: 'the handout\'s Sources & capture → Download a public sample: the Hugging Face catalog and the SWE-agent sample' },
  { old: 'Load trajectories', now: 'Add data', spec: 'sources', why: '0.6.0\'s button on Datasets, which opened Sources & capture' },
  { old: 'Capture sessions', now: LABELS.capture_local, spec: 'capture', why: 'an earlier name for Session capture, the contract\'s word' },
  { old: 'status bar', now: 'Change model, harness or oracle', act: 'scope', why: '0.6.0\'s bottom bar: the dataset, model, harness and oracle are now each page\'s Asking line and its Change menu, the panels are in More actions (⋯), the connection is the dot at the top right' },
  { old: 'stand-in', now: 'Fixed harnesses', spec: 'shallowCards', why: 'TraceHarness\'s own copies of coding apps\' prompts and tools; One run lists them as TraceHarness copies' },
  { old: 'native', now: 'Harnesses', spec: 'harnesses', why: 'a native agent is the installed app itself: One run lists it under Native agents' },
  { old: 'grader', now: 'Judge & integrity', an: 'judge', why: 'what grades a run: the oracle against a stronger one, and the LLM judge' },
  { old: 'family', now: 'Family matrix', an: 'family', why: 'every model × harness cell of the dataset, side by side' },
]

/** The names a page had in 0.6.0, said under its title ("also called"), because the handout and the guides
 *  still use them. The Map (0.6.0's Canvas) has no page header: it says so in its toolbar. */
const ALSO_CALLED = { field: ['Trajectories'], tasks: ['Trajectories'], sources: ['Sources & capture'], capture: ['Sources & capture'] }
export function alsoCalled(kind, args = []) {
  const names = ALSO_CALLED[kind] || []
  return kind === 'sources' && args[0] === 'sample' ? [...names, 'Download a public sample'] : names
}

/** The spec an alias opens for the dataset in focus, or null (a control, or a dataset page with no dataset). */
export function aliasSpec(a, dir, condition) {
  if (a.an) return dir ? rowSpec({ id: a.an, an: a.an }, dir, condition) : null
  if (a.ds) return dir ? rowSpec({ id: a.ds === 'field' ? 'runs' : 'tasks' }, dir, condition) : null
  return a.spec || null
}
