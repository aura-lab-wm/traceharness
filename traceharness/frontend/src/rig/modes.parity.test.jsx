// @vitest-environment jsdom
/* Every view in every mode (SPEC 4.2, §5 WP2 step 6).

   For each mode the console runs in (local, export, member) the modules are loaded fresh with that
   mode's window globals, and every view kind in the registry, the nine analysis steps (AN_VIEWS) and
   the four dock panels are rendered through test/rig-testing.jsx on its small fixture. Each must:
     - render without throwing (no shell crash, no per-tab "this view failed" boundary);
     - show only "not available here" notes ([data-capability]) for a capability that is unavailable
       in that mode's column of the shared capability table;
     - say no retired phrase (glossary RETIRED) anywhere on the page.
   The harness views (blocks, harnesses, shallow*) belong to another package: they are rendered and
   must not crash, but their own text is not asserted here; what they show is printed instead.
   A view that cannot be rendered in jsdom goes into NOT_RENDERED with its reason; the map is printed
   so the gap is visible. */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

/** kind (or kind@mode) -> why it is not rendered here. Empty: every view renders in every mode. */
const NOT_RENDERED = {}
/** Views owned by the harness package: rendered, not asserted on (their findings are printed). */
const HARNESS_VIEWS = new Set(['blocks', 'harnesses', 'shallowApply', 'shallowCards', 'shallowWizard'])
const MODES = ['local', 'export', 'member']
const SCOPE = '9'.repeat(24)
const M1 = 'alpha-1', H = 'baseline', RUN = 'a00000', RUN2 = 'a00001'

/** One spec per registered kind, on the fixture's "mini" dataset. */
const SPECS = {
  home: 'home', ds: 'ds:mini', q: 'q:mini', an: 'an:mini:family', tasks: `tasks:mini:${M1}:${H}`, task: `task:mini:${M1}:${H}:t1`,
  run: `run:${RUN}`, span: `span:${RUN}:0`, cmp: `cmp:${RUN}:${RUN2}`, fork: `fork:${RUN}`, field: 'field:mini', paused: 'paused',
  sources: 'sources', capture: 'capture', sentinel: 'sentinel', canvas: 'canvas', settings: 'settings', guide: 'guide', package: 'package',
  blocks: 'blocks', harnesses: 'harnesses', shallowApply: 'shallowApply', shallowCards: 'shallowCards', shallowWizard: 'shallowWizard',
}
const DOCKS = ['buddy', 'log', 'capture', 'case']

function setMode(mode) {
  delete window.__TRACEHARNESS_MEMBER__
  delete window.__TRACEHARNESS_DATA__
  if (mode !== 'local') window.__TRACEHARNESS_DATA__ = {}
  if (mode === 'member') window.__TRACEHARNESS_MEMBER__ = { version: 1, scope: SCOPE }
}

const report = { rendered: {}, notRendered: NOT_RENDERED, harnessFindings: [] }

afterAll(() => {
  delete window.__TRACEHARNESS_MEMBER__
  delete window.__TRACEHARNESS_DATA__
})

for (const mode of MODES) {
  describe(`${mode} mode`, () => {
    let M
    beforeAll(async () => {
      vi.resetModules()
      setMode(mode)
      HTMLElement.prototype.scrollTo = HTMLElement.prototype.scrollTo || (() => {})
      const testing = await import('../../test/rig-testing')
      const registry = await import('./registry')
      const analysis = await import('./views/analysis.jsx')
      const env = await import('../environment')
      const shared = await import('../shared/index.js')
      const route = await import('./route')
      M = { testing, registry, analysis, env, shared, route }
      report.rendered[mode] = []
    })

    it('loads the console in this mode', () => {
      expect(M.env.MODE).toBe(mode)
      // every registered kind has a spec here, so a new view is covered (or listed) the day it lands
      expect(M.registry.listViews().map((v) => v.kind).filter((k) => !(k in SPECS))).toEqual([])
      expect(M.registry.listDocks().map((d) => d.id).sort()).toEqual([...DOCKS].sort())
    })

    const cases = () => [
      ...Object.entries(SPECS).map(([kind, spec]) => ({ name: kind, kind, hash: '#/rig/' + spec })),
      ...M.analysis.AN_VIEWS.map(([view]) => ({ name: `an:${view}`, kind: 'an',
        hash: '#/rig/' + (view === 'traj' ? M.route.makeSpec('tasks', 'mini', M1, H) : M.route.makeSpec('an', 'mini', view, M1, H)) })),
      ...DOCKS.map((id) => ({ name: `dock:${id}`, kind: `dock:${id}`, hash: `#/rig/home?dock=${id}` })),
    ]

    it('renders every view, analysis step and dock: notes name an unavailable capability, no retired phrase', () => {
      const table = M.shared.SHARED.environment.table
      const retired = M.shared.RETIRED.map((r) => r.phrase)
      expect(M.analysis.AN_VIEWS).toHaveLength(9)
      const failures = []
      for (const c of cases()) {
        if (NOT_RENDERED[c.name] || NOT_RENDERED[`${c.name}@${mode}`]) continue
        let container
        try {
          ({ container } = M.testing.renderRig(c.hash, { data: M.testing.rigFixture() }))
        } catch (e) {
          failures.push(`${c.name}: the shell threw: ${e && e.message}`)
          M.testing.resetRig()
          continue
        }
        const crashed = container.querySelector('[data-el="view-crash"]')
        if (crashed) failures.push(`${c.name}: the view failed while drawing: ${crashed.textContent.slice(0, 200)}`)
        const notes = [...document.body.querySelectorAll('[data-capability]')].map((n) => n.getAttribute('data-capability'))
        const available = notes.filter((cap) => !table[cap] || table[cap][mode] === 'ok')
        const text = document.body.textContent + ' ' + document.title
        const said = retired.filter((phrase) => text.includes(phrase))
        if (HARNESS_VIEWS.has(c.kind)) {
          if (available.length || said.length) report.harnessFindings.push({ mode, view: c.name, availableNotes: available, retired: said })
        } else {
          if (available.length) failures.push(`${c.name}: a note names a capability available in ${mode} mode (or unknown): ${available.join(', ')}`)
          if (said.length) failures.push(`${c.name}: says a retired phrase: ${said.join(', ')}`)
        }
        report.rendered[mode].push(c.name)
        M.testing.resetRig()
      }
      expect(failures).toEqual([])
    })

    it('in a snapshot, a machine-side view says why with the mode\'s own sentence', () => {
      if (mode === 'local') return
      const { container } = M.testing.renderRig('#/rig/sources', { data: M.testing.rigFixture() })
      const note = container.querySelector('[data-capability="data.import"]')
      expect(note).not.toBeNull()
      expect(note.getAttribute('data-reason')).toBe(table(M, 'data.import'))
      expect(note.textContent).toBe(M.env.why('data.import', 'Importing'))
      expect(note.textContent).toContain(M.shared.LOCAL_APP.command)
      M.testing.resetRig()
    })
  })
}

const table = (M, cap) => M.shared.SHARED.environment.table[cap][M.env.MODE]

describe('the gap', () => {
  it('prints NOT_RENDERED and what was rendered in each mode', () => {
    // written to stdout, not console.log, so it shows in every run and not only on a failure
    process.stdout.write(`NOT_RENDERED ${JSON.stringify(NOT_RENDERED)}\n`)
    for (const mode of MODES) process.stdout.write(`RENDERED ${mode} (${(report.rendered[mode] || []).length}): ${(report.rendered[mode] || []).join(' ')}\n`)
    process.stdout.write(`HARNESS_VIEW_FINDINGS ${JSON.stringify(report.harnessFindings)}\n`)
    const expected = Object.keys(SPECS).length + 9 + DOCKS.length
    for (const mode of MODES) expect(report.rendered[mode], mode).toHaveLength(expected - Object.keys(NOT_RENDERED).filter((k) => !k.includes('@') || k.endsWith(`@${mode}`)).length)
  })
})
