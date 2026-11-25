/* Rig · pageTours.js — the page tours (Tour at the top right of the top bar, Help › Guide me through this page, ⌘K).
   PURE. Every page type has one (pageTourKey); the tours themselves live in tours/*.js by place.

   A tour walks its page top to bottom in at most six steps and about 120 words (titles included). Each step says
   what a part of the page is and what you can do there. A step is { id, title, spots, body, reveal?, loaded? }:
     spots   a list of spots; each spot is a list of alternatives, and the first that matches something shown is
             lit (a comma list lights one box around all its matches). The first choice is the part itself;
             no step falls back to the page title.
     body    a string, or body(c) with c.q, a reader of the page in view (Tour.pageQuery), so a clause about a
             mark or a button is said only where the page draws it.
     reveal  a closed <details> to open, or a tab to select, before the step (put back when it ends).
     loaded  a selector: once it is shown and the step's part is not, the page has no such part and the step is
             skipped at once instead of after the 3-second wait.
   While a tour runs, clicks and keys stay with it (the wheel still scrolls the page), so a step that asks for a
   click, a key or a hover says "After the tour, …" (tours.dom.test.jsx holds every step to that). */
import { parseSpec } from './route'
import { harnessView } from './harnessViews'
import { HEAD } from './tours/words'
import { PLACE_TOURS } from './tours/places'
import { RUN_TOURS } from './tours/runs'
import { ANALYSIS_TOURS } from './tours/analysis'
import { HARNESS_TOURS } from './tours/harnesses'
import { FRAME_TOURS } from './tours/frame'

export const PAGE_TOURS = { ...PLACE_TOURS, ...RUN_TOURS, ...ANALYSIS_TOURS, ...HARNESS_TOURS, ...FRAME_TOURS }

/** A page with no tour of its own gets this one: the page, the page list and Help. */
export const GENERAL_PAGE_TOUR = [
  { id: 'head', title: 'This page', spots: [[HEAD, '#rig-doc-main h1']], body: 'The title says what the page is for; the line under it says which data it reads.' },
  { id: 'list', title: 'The page list', spots: [['[data-tour="sidebar"]']], body: 'Every place of the console; the one this page belongs to is marked, with its pages under it.' },
  { id: 'help', title: 'Help', spots: [['[data-tour="help"]']], body: 'The site tour, the guides and the keyboard shortcuts are here.' },
]

/** Which page tour fits a spec: every page type has its own; null only for an address no page answers (that page gets
 *  GENERAL_PAGE_TOUR). */
const AN_VIEWS = ['family', 'delta', 'fit', 'outcomes', 'judge', 'tokens', 'features', 'report', 'setup']
const HARNESS_KEYS = { setup: 'harnesses', experiments: 'hExperiments', runs: 'hRuns', file: 'hFile', versions: 'hVersions' }
const ADD_KEYS = { sample: 'sample', disk: 'disk', capture: 'capture' }
const LEARN_KEYS = { learn: 'learn', glossary: 'glossary' }
export function pageTourKey(spec) {
  const { kind, args } = parseSpec(spec)
  if (['start', 'home', 'canvas', 'ds', 'task', 'run', 'span', 'fork', 'paused', 'lanes', 'tasks', 'field', 'sentinel', 'recommend', 'package', 'settings'].includes(kind)) return kind
  if (kind === 'harnesses') return HARNESS_KEYS[harnessView(args)] || 'harnesses'
  if (kind === 'shallowWizard') return 'minimal'
  if (kind === 'shallowCards') return 'fixed'
  if (kind === 'shallowApply') return 'six'
  if (kind === 'blocks') return args[0] === 'customize' ? 'customize' : 'build'
  if (kind === 'sources') return ADD_KEYS[args[0]] || 'import'
  if (kind === 'capture') return 'capture'
  if (kind === 'guide') return !args[0] ? 'readingGuide' : LEARN_KEYS[args[0]] || 'article'
  if (kind === 'cmp') return args[0] && args[1] ? 'cmp' : 'cmpPick'
  if (kind === 'q') return !args[1] ? 'questions' : args[2] === 'runs' ? 'answerRuns' : 'question'
  if (kind === 'an') { const v = args[1] || 'family'; return AN_VIEWS.includes(v) ? v : null }
  return null
}

/** How many args name the page itself (the rest are selections inside it: a step, a run of the task, a view state). */
const ID_ARGS = { run: 1, span: 2, task: 4, lanes: 4, ds: 1, tasks: 1, field: 1, cmp: 2, an: 2, q: 3, fork: 1 }
/** The page a spec shows, without the selections inside it: a page tour ends when this changes. */
export function tourPageId(spec) {
  const { kind, args } = parseSpec(spec)
  if (kind === 'harnesses') return `harnesses:${harnessView(args)}`
  const n = ID_ARGS[kind]
  return n == null ? String(spec || '') : [kind, ...args.slice(0, n)].join(':')
}
