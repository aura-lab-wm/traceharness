import { describe, expect, it } from 'vitest'
import { NAV, NAV_ALIASES, FRAME_KINDS, homeOf, navModel, sectionOf } from './navTree'
import { listViews } from './registry'
import { parseSpec } from './route'

const ids = (m) => m.sections.map((s) => s.id)
const kids = (m, id) => m.sections.find((s) => s.id === id).children.map((c) => c.id)
const cond = { dir: 'mini', model: 'acme/beta-2', harness: 'terse' }

describe('the left list: Home and the seven places', () => {
  it('lists Home, then the seven places in order', () => {
    expect(NAV.map((s) => s.label)).toEqual(['Home', 'Datasets', 'Overview', 'Tasks', 'Runs', 'Analysis', 'Harnesses', 'Add data'])
  })
  it('Analysis holds its question groups, Harnesses its Run and Make a harness groups', () => {
    const an = NAV.find((s) => s.id === 'analysis')
    expect(an.children.map((c) => [c.group || '', c.label])).toEqual([
      ['', 'Questions'],
      ['Which setup wins', 'Family matrix'], ['Which setup wins', 'Comparison'], ['Which setup wins', 'Experiment'],
      ['Can I trust it', 'Outcomes'], ['Can I trust it', 'Judge & integrity'],
      ['How runs behave', 'Tokens'], ['How runs behave', 'Trajectory features'], ['How runs behave', 'Sentinel'],
      ['Write it up', 'Report'], ['Write it up', 'Run setup'],
    ])
    const h = NAV.find((s) => s.id === 'harnesses')
    expect(h.children.map((c) => [c.group, c.label])).toEqual([
      ['Run', 'One run'], ['Run', 'Run setup'], ['Run', 'Experiments'], ['Run', 'Recent runs'],
      ['Make a harness', 'Minimal harness'], ['Make a harness', 'Fixed harnesses'], ['Make a harness', 'Build a harness'],
      ['Make a harness', 'One prompt, six shells'], ['Make a harness', 'Configuration file'], ['Make a harness', 'Saved versions'],
    ])
  })
  it('keeps the old data-el ids so tours, tests and the handout still find the rows', () => {
    const m = navModel({ kind: 'an', args: ['mini', 'outcomes'], dir: 'mini', condition: cond })
    const el = (id) => m.sections.find((s) => s.id === id).el
    expect(el('overview')).toBe('outline-overview')
    expect(el('tasks')).toBe('outline-tasks nav-tasks')
    expect(el('runs')).toBe('outline-runs nav-runs')
    expect(el('analysis')).toBe('nav-analysis')
    expect(el('harnesses')).toBe('nav-harnesses')
    expect(el('adddata')).toBe('nav-sources')
    const an = m.sections.find((s) => s.id === 'analysis').children
    expect(an.find((c) => c.id === 'family').el).toBe('outline-family')
    expect(an.find((c) => c.id === 'sentinel').el).toBe('nav-sentinel')
    expect(an.find((c) => c.id === 'setup').el).toBe('outline-setup')
  })
})

describe('every page has one home', () => {
  it('every registered view kind has a home in the left list or the frame', () => {
    for (const v of listViews()) {
      const h = homeOf(v.kind, [])
      expect(h, v.kind).toBeTruthy()
      if (h.section) expect(NAV.some((s) => s.id === h.section), v.kind).toBe(true)
      else expect(Object.keys(FRAME_KINDS), v.kind).toContain(v.kind)
    }
  })
  it('a kind with no home is caught (the check is not vacuous)', () => {
    expect(homeOf('no-such-kind', [])).toBeNull()
  })
  it('each section owns the kinds that belong to it', () => {
    const table = [
      ['home', [], 'datasets'], ['canvas', [], 'datasets'],
      ['ds', ['mini'], 'overview'],
      ['tasks', ['mini'], 'tasks'], ['task', ['mini', 'm', 'h', 't1'], 'tasks'], ['lanes', ['mini', 'm', 'h', 't1'], 'tasks'],
      ['field', ['mini'], 'runs'], ['run', ['a'], 'runs'], ['span', ['a', '1'], 'runs'], ['cmp', ['a', 'b'], 'runs'], ['fork', ['a'], 'runs'], ['paused', [], 'runs'],
      ['q', ['mini'], 'analysis'], ['q', ['mini', 'grader'], 'analysis'], ['an', ['mini', 'family'], 'analysis'], ['an', ['mini', 'setup'], 'analysis'], ['sentinel', [], 'analysis'],
      ['harnesses', [], 'harnesses'], ['shallowCards', [], 'harnesses'], ['shallowWizard', [], 'harnesses'], ['shallowApply', [], 'harnesses'], ['blocks', [], 'harnesses'], ['blocks', ['customize'], 'harnesses'],
      ['sources', [], 'adddata'], ['sources', ['sample'], 'adddata'], ['capture', [], 'adddata'], ['recommend', [], 'adddata'],
    ]
    for (const [kind, args, want] of table) expect(sectionOf(kind, args), `${kind}:${args.join(':')}`).toBe(want)
    for (const kind of ['settings', 'guide', 'package']) expect(sectionOf(kind, []), kind).toBeNull()
  })
})

describe('the model the list draws', () => {
  it('opens only the section of the page in view, and marks its child row', () => {
    const m = navModel({ kind: 'an', args: ['mini', 'outcomes', 'beta-2', 'terse'], dir: 'mini', condition: cond })
    expect(ids(m)).toEqual(['start', 'datasets', 'overview', 'tasks', 'runs', 'analysis', 'harnesses', 'adddata'])
    expect(m.sections.filter((s) => s.open).map((s) => s.id)).toEqual(['analysis'])
    const an = m.sections.find((s) => s.id === 'analysis')
    expect(an.has).toBe(true)
    expect(an.on).toBe(false)       // the child row is the page; the section only contains it
    expect(an.children.filter((c) => c.on).map((c) => c.id)).toEqual(['outcomes'])
  })
  it('a section page without a child row is marked itself', () => {
    const m = navModel({ kind: 'task', args: ['mini', 'm', 'h', 't1'], dir: 'mini', condition: cond })
    expect(m.sections.filter((s) => s.on).map((s) => s.id)).toEqual(['tasks'])
    expect(m.sections.filter((s) => s.open).map((s) => s.id)).toEqual([])
  })
  it('a group the reader opened stays open on other pages', () => {
    const m = navModel({ kind: 'ds', args: ['mini'], dir: 'mini', condition: cond, expanded: { harnesses: true } })
    expect(m.sections.filter((s) => s.open).map((s) => s.id)).toEqual(['harnesses'])
    expect(kids(m, 'harnesses')).toEqual(['one', 'setup', 'experiments', 'runs', 'minimal', 'fixed', 'build', 'six', 'file', 'versions'])
  })
  it('the Harnesses views each mark their own row; Customize marks One run', () => {
    const on = (kind, args) => navModel({ kind, args, dir: 'mini', condition: cond }).sections.find((s) => s.id === 'harnesses').children.filter((c) => c.on).map((c) => c.id)
    expect(on('harnesses', [])).toEqual(['one'])
    expect(on('harnesses', ['view', 'experiments'])).toEqual(['experiments'])
    expect(on('harnesses', ['view', 'runs'])).toEqual(['runs'])
    expect(on('harnesses', ['view', 'file'])).toEqual(['file'])
    expect(on('harnesses', ['view', 'versions'])).toEqual(['versions'])
    expect(on('shallowWizard', [])).toEqual(['minimal'])
    expect(on('shallowCards', [])).toEqual(['fixed'])
    expect(on('blocks', [])).toEqual(['build'])
    expect(on('blocks', ['customize'])).toEqual(['one'])
    expect(on('shallowApply', [])).toEqual(['six'])
  })
  it('Run setup lives under Analysis (the handout path); the Harnesses row is a link to it', () => {
    const m = navModel({ kind: 'an', args: ['mini', 'setup'], dir: 'mini', condition: cond })
    const setupA = m.sections.find((s) => s.id === 'analysis').children.find((c) => c.id === 'setup')
    expect(setupA.on).toBe(true)
    const m2 = navModel({ kind: 'harnesses', args: [], dir: 'mini', condition: cond })
    const setupH = m2.sections.find((s) => s.id === 'harnesses').children.find((c) => c.id === 'setup')
    expect(setupH.link).toBe(true)
    expect(setupH.spec).toBe(setupA.spec)
    expect(setupH.spec).toBe('an:mini:setup:beta-2:terse')
  })
  it('rows carry the dataset and condition in focus', () => {
    const m = navModel({ kind: 'home', args: [], dir: 'mini', condition: cond, expanded: { analysis: true } })
    const spec = (id) => m.sections.find((s) => s.id === id).spec
    expect(spec('datasets')).toBe('home')
    expect(spec('overview')).toBe('ds:mini:beta-2:terse')
    expect(spec('tasks')).toBe('tasks:mini:beta-2:terse')
    expect(spec('runs')).toBe('field:mini:acme/beta-2:terse')
    expect(spec('analysis')).toBe('q:mini')
    expect(spec('harnesses')).toBe('harnesses')
    expect(spec('adddata')).toBe('sources')
    const an = Object.fromEntries(m.sections.find((s) => s.id === 'analysis').children.map((c) => [c.id, c.spec]))
    expect(an.questions).toBe('q:mini')
    expect(an.family).toBe('an:mini:family:beta-2:terse')
    expect(an.sentinel).toBe('sentinel')
  })
  it('with no dataset, dataset pages lead to Datasets and the Analysis pages that need one are not listed', () => {
    const m = navModel({ kind: 'home', args: [], dir: null, condition: null, expanded: { analysis: true } })
    expect(m.sections.find((s) => s.id === 'tasks').spec).toBe('home')
    expect(kids(m, 'analysis')).toEqual(['sentinel'])
  })
  it('the Datasets row opens Map; Add data lists its four ways and Which benchmark?', () => {
    const m = navModel({ kind: 'home', args: [], dir: 'mini', condition: cond, expanded: { adddata: true } })
    expect(m.sections.find((s) => s.id === 'datasets').children.map((c) => [c.id, c.label, c.spec])).toEqual([['map', 'Map', 'canvas']])
    expect(m.sections.find((s) => s.id === 'adddata').children.map((c) => [c.label, c.spec])).toEqual([
      ['Import files', 'sources'], ['Public sample', 'sources:sample'], ['Session capture', 'capture'], ['Results on disk', 'sources:disk'], ['Which benchmark?', 'recommend'],
    ])
  })
  it('every row leads to a registered kind', () => {
    const kinds = new Set(listViews().map((v) => v.kind))
    const m = navModel({ kind: 'home', args: [], dir: 'mini', condition: cond, expanded: { datasets: true, analysis: true, harnesses: true, adddata: true } })
    for (const s of m.sections) {
      expect(kinds.has(parseSpec(s.spec).kind), s.id).toBe(true)
      for (const c of s.children) expect(kinds.has(parseSpec(c.spec).kind), `${s.id}/${c.id}`).toBe(true)
    }
  })
})

describe('old names stay findable', () => {
  it('each renamed page keeps its old name as an alias that leads to the same page', () => {
    const olds = NAV_ALIASES.map((a) => a.old)
    for (const old of ['Condition matrix', 'Matrix', 'Change vs baseline', 'Patterns', 'Model vs harness', 'Many runs', 'Set up a run', 'App copies', 'Build from blocks', 'Customize minimal harness', 'Trajectories', 'Trajectory explorer', 'Canvas', 'Answer 6 questions', 'App menu'])
      expect(olds, old).toContain(old)
    for (const a of NAV_ALIASES) expect(a.now, a.old).toBeTruthy()
  })
  it('an alias names the page it leads to, by the name the page now uses', () => {
    const now = Object.fromEntries(NAV_ALIASES.map((a) => [a.old, a.now]))
    expect(now['Condition matrix']).toBe('Family matrix')
    expect(now['Set up a run']).toBe('One run')
    expect(now['Customize minimal harness']).toBe('Advanced settings')
    expect(now.Canvas).toBe('Map')
  })
})

describe('the reader\'s own choice', () => {
  it('a section the reader closed stays closed, and still shows the row of the page in view', () => {
    const m = navModel({ kind: 'an', args: ['mini', 'judge'], dir: 'mini', condition: cond, expanded: { analysis: false } })
    const a = m.sections.find((s) => s.id === 'analysis')
    expect(a.open).toBe(false)
    expect(a.children.filter((c) => c.on).map((c) => c.id)).toEqual(['judge'])
  })
})
