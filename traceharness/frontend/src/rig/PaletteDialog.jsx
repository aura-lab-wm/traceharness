/* Rig · PaletteDialog.jsx — the command palette (⌘K). Each result says what it is (its kind in one word, one line
   of context), with counts per kind as filter chips and suggestions when nothing matches. Ranking and grouping are
   palette.js (pure). */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useRig } from './context'
import { NAV_ALIASES, aliasSpec } from './navTree'
import { listViews } from './registry'
import { useOverview, useAllRuns, useCacheVersion, peek, load, paths, resolveCondition, short, sfx, fmt, runHandle } from './data'
import { QUESTIONS } from './answers'
import { THEME_NAMES } from './prefs'
import { makeSpec, SUITES, THEMES } from './route'
import { paletteGroups, dedupeBySpec, groupCounts, paletteSuggestions, kindWord, GROUPS } from './palette'
import { KINDS, datasetName, harnessNote, harnessFacts } from './datasetInfo'
import { buildGlossary } from './learn/glossary'
import { ARTICLES } from './learn/articles'
import { glossarySpec } from './learn/routes'
import { canSee } from './learn/gate'
import { Icon, Kbd, MOD, outcomeWord, OUTCOME_GLYPH, showingWords } from './ui'
import { LABELS } from '../shared/index.js'

/* ---------------------------------------------------------------- palette highlight */
function Hl({ t, pos }) {
  const set = new Set(pos.filter((p) => p < t.length))
  return <>{[...t].map((c, i) => (set.has(i) ? <mark key={i}>{c}</mark> : c))}</>
}

/* ---------------------------------------------------------------- command palette */
const GLOSSARY = buildGlossary(ARTICLES)
/** One line of a long text (the whole of it stays searchable). */
const cut = (s, max = 60) => (s.length > max ? s.slice(0, max - 1).trimEnd() + '…' : s)
/** A run's outcome in the palette, in the run page's words; the failure mode comes from /api/outcomes. */
function paletteOutcome(r, outs, oracle) {
  const o = outs.get(r.ds)
  const mode = o && o.runs && o.runs[r.id] ? o.runs[r.id].mode ?? null : null
  const w = outcomeWord(mode ? { ...r, mode } : r, oracle)
  return `${OUTCOME_GLYPH[w]} ${w}`
}
/** The Reading guide and Reference materials: listed only with Student Lab on (docs/student-lab.md:7). */
const TEACHING_SPECS = new Set(['guide', 'package'])
const GO_DETAIL = {
  Datasets: ['every dataset on this computer', 'library home all datasets'],
  Map: ['Datasets · node map of datasets, models and conditions', 'graph canvas'],
  Overview: ['this dataset at a glance', 'dataset summary findings'],
  Tasks: ['every task and the outcome of its runs', 'trajectory explorer trajectories'],
  Runs: ['every run, with filters', 'trajectories run list field every run span'],
  Analysis: ['one page per question about this dataset', 'questions analysis steps'],
  Questions: ['Analysis · plain questions, each with its answer', 'ask why how'],
  Sentinel: ['Analysis · early warning on a partial run', 'risk detectors'],
  Harnesses: ['One run: design a harness and run it', 'harness workspace'],
  'One run': ['Harnesses · choose a harness, model and task, then run', 'set up a run composer guide me advanced settings customize'],
  Experiments: ['Harnesses · frozen matrix and paired-arm plans', 'matrix paired arms prompt variants'],
  'Recent runs': ['Harnesses · what ran lately from this computer', 'jobs runner'],
  'Configuration file': ['Harnesses · the exact JSON that will run', 'json import export'],
  'Saved versions': ['Harnesses · where harnesses are kept: tab, file, this computer, by hash', 'checkpoints library save'],
  'Add data': ['import files, public samples, captured sessions', 'import load trajectories sources capture results on disk hugging face'],
  'Import files': ['Add data · detect a format and import', 'import load trajectories'],
  'Public sample': ['Add data · Hugging Face catalog, SWE-agent sample', 'hugging face download'],
  [LABELS.capture_local]: ['Add data · record coding-agent sessions on this machine', 'capture sessions watcher'],
  'Results on disk': ['Add data · every dataset in data/runs, harness versions', 'sources harness versions'],
  'Which benchmark?': ['Add data · pick a dataset for a question', 'recommend'],
  Settings: ['appearance, Student Lab, keys, paths', 'theme preferences'],
}
function usePaletteItems(datasets, condition, { onKeys, onTour, onVoice, env, railItems }) {
  const rig = useRig()
  const all = useAllRuns(true)
  const overview = useOverview().data
  // every dataset's failure modes, so a run says Cut off here exactly when its page does
  useEffect(() => { for (const d of datasets) load(paths.outcomes(d.name)) }, [datasets])
  useCacheVersion()
  const outsKey = datasets.map((d) => (peek(paths.outcomes(d.name)) ? 1 : 0)).join('')
  return useMemo(() => {
    const outs = new Map(datasets.map((d) => [d.name, peek(paths.outcomes(d.name))]))
    const L = []
    const add = (k, t, d, run, extra = '', o = {}) => L.push({ k, t, d, run, s: `${t} ${d} ${extra}`.toLowerCase(), ...o })
    const open = (spec) => (side) => rig.openTab(spec, { side })
    const dir = condition && condition.dir
    // the sidebar's destinations first: they keep their names when a view offers the same page
    const rail = railItems(null, dir, condition)
    // a page's old and other names find it (no name is retired); an old name of a page with
    // no row of its own (Customize) is an entry of its own
    const aliases = NAV_ALIASES.map((a) => ({ ...a, to: aliasSpec(a, dir, condition) })).filter((a) => a.to)
    // the seven places and Settings first, then the pages under them, so an empty search lists the places
    for (const r of [...rail.items.filter((x) => !x.parent), ...rail.bottom, ...rail.items.filter((x) => x.parent)]) {
      const [d, kw] = GO_DETAIL[r.label] || [r.parent ? r.parent : '', '']
      const olds = aliases.filter((a) => a.to === r.spec).map((a) => a.old.toLowerCase())
      add('go', r.label, ['Overview', 'Tasks', 'Runs', 'Analysis'].includes(r.label) && dir ? `${dir} · ${d}` : d, open(r.spec), `${kw} ${olds.join(' ')}`, { pick: !r.parent, spec: r.spec, aliases: olds })
    }
    const rowSpecs = new Set(rail.items.map((r) => r.spec))
    for (const a of aliases) if (!rowSpecs.has(a.to)) add('go', a.now, `was “${a.old}” · ${a.why}`, open(a.to), a.old.toLowerCase(), { spec: a.to, aliases: [a.old.toLowerCase()] })
    for (const r of datasets) {
      add('view', `Tasks · ${r.name}`, 'every task and the outcome of its runs', open(makeSpec('tasks', r.name)), 'trajectory explorer', { spec: makeSpec('tasks', r.name) })
      add('view', `Runs · ${r.name}`, 'every run, with filters', open(makeSpec('field', r.name)), 'trajectories run list', { spec: makeSpec('field', r.name) })
    }
    // views (each registered kind may contribute entries)
    const E = env()
    for (const v of listViews()) {
      let entries = []
      try { entries = v.palette ? v.palette(E) || [] : [] } catch { entries = [] }
      for (const e of entries) {
        // docs/student-lab.md:7: with Student Lab off the teaching guides are absent from navigation (their links still open)
        if (!rig.lab && TEACHING_SPECS.has(e.spec)) continue
        add(e.group || (v.kind === 'an' ? 'view' : 'go'), e.title, e.detail || '', open(e.spec), e.keywords || '', { pick: e.pick !== false && !e.group, spec: e.spec })
      }
    }
    const taskMeta = new Map(((overview && overview.tasks) || []).map((t) => (typeof t === 'string' ? [t, {}] : [t.id, t])))
    for (const r of datasets) {
      const here = r.name === dir
      // the plain name and the folder; what it is in one line (the picker's words)
      const nm = datasetName(r)
      add('dataset', nm === r.name ? r.name : `${nm} · ${r.name}`, `${(KINDS[r.origin] || KINDS.recorded).label} · ${r.summary || 'no description yet'} · ${fmt.int(r.runs)} ${r.runs === 1 ? 'run' : 'runs'}`,
        open(makeSpec('ds', r.name)), `open ${r.name} ${r.models.join(' ')} ${r.description || ''}`, { pick: true, spec: makeSpec('ds', r.name), ids: [r.name.toLowerCase()] })
      const c = here ? condition : resolveCondition(r, null, null)
      for (const q of QUESTIONS) {
        add('question', q.q(c), `${r.name} · ${q.short}`, open(makeSpec('q', r.name, q.id)), 'question ask why how ' + q.id, { pick: here, boost: here ? 8 : 0, spec: makeSpec('q', r.name, q.id) })
      }
      // every dataset's tasks, so "<dataset> <task>" finds a task outside the dataset in focus
      for (const id of r.tasks || []) {
        const t = taskMeta.get(id) || {}
        add('task', id, `${t.title ? t.title + ' · ' : ''}${r.name} · ${short(c.model)} · ${c.harness}`, open(makeSpec('task', r.name, short(c.model), c.harness, id)), t.probe || '',
          { ids: [String(id).toLowerCase()], ds: r.name.toLowerCase(), boost: here ? 2 : 0 })
      }
    }
    // the harnesses and models of the dataset in focus, with their notes and provider: choosing one scopes the pages to it
    const row = datasets.find((r) => r.name === dir)
    if (row) {
      for (const h of row.harnesses) {
        const n = harnessNote(h, row, overview && overview.harnesses)
        add('harness', h, `${n ? cut(n.notes) : 'no notes recorded'}${harnessFacts(n) ? ` · ${harnessFacts(n)}` : ''} · show it in ${dir}`, () => rig.setCondition({ dir, harness: h }), `harness condition ${n ? n.notes : ''}`)
      }
      for (const m of row.models) {
        const provider = String(m).includes('/') ? String(m).split('/')[0] : null
        add('model', short(m), `${m}${provider ? ` · provider ${provider}` : ''} · ${fmt.int((row.model_runs || {})[m])} runs · show it in ${dir}`, () => rig.setCondition({ dir, model: m }), 'model condition')
      }
    }
    // glossary words open their entry (the glossary is for everyone)
    if (canSee('glossary', rig.lab)) for (const e of GLOSSARY) if (e.meaning) add('term', e.term, e.meaning, open(glossarySpec(e.slug)), `${e.names.join(' ')} glossary define meaning`, { spec: glossarySpec(e.slug) })
    const act = (t, d, fn, e = '') => add('action', t, d, () => fn(), e, { pick: true })
    act('toggle Student Lab', rig.lab ? 'currently on' : 'currently off', () => rig.setLab(!rig.lab), 'guided analysis teaching')
    for (const t of THEMES) act(`theme: ${t}`, t === 'system' ? 'follow the operating system' : `${THEME_NAMES[t]}${rig.themePref === t ? ' · current' : ''}`, () => rig.setTheme(t), 'appearance ' + THEME_NAMES[t])
    act('colour-blind safe status colours', `${rig.cvd ? 'on' : 'off'} · Pass blue, Fail orange`, () => rig.setCvd(!rig.cvd), 'color blind cvd deuteranopia protanopia appearance accessibility')
    if (onTour) act('take the tour', 'seven steps around the console', onTour, 'help onboarding first visit')
    if (rig.startPageTour) act('tour this page', 'a few steps over the parts of the page in view and what you can do there', () => rig.startPageTour(), 'guide me through this page help walkthrough onboarding')
    if (onVoice) act('voice tour', 'five narrated chapters', onVoice, 'help narration audio')
    act('toggle split view', MOD + '+\\', () => rig.toggleSplit(), 'split side')
    act(rig.maximized ? 'restore layout' : 'maximize document', MOD + '+Shift+Enter', () => rig.toggleMax(), 'maximize full screen zen focus zoom')
    act('open Buddy', MOD + '+J', () => rig.setDock('buddy'), 'assistant ask')
    if (onKeys) act('keyboard shortcuts', '?', onKeys, 'keys help hotkeys cheatsheet')
    act('open case file', 'pinned evidence', () => rig.setDock('case'), 'pins export review')
    act('open event log', 'events of the run in focus', () => rig.setDock('log'), 'ledger')
    act('open capture watcher', 'captured sessions', () => rig.setDock('capture'))
    // an old name of a control opens the control that took its place (the status bar: the Change menu)
    for (const a of NAV_ALIASES) if (a.act === 'scope') act(a.now, `was the ${a.old} · ${a.why}`, () => rig.openCondition(null), a.old.toLowerCase())
    for (const o of SUITES) act('oracle: ' + o, `grade every run with the ${o} oracle`, () => rig.setOracle(o), 'test suite grader')
    for (const r of all.data) {
      const h = runHandle(r, all.index)
      add('run', 'run ' + h, `${r.task} · ${short(r.model)} · ${r.harness} · ${r.ds} · ${paletteOutcome(r, outs, rig.oracle)}`, open(makeSpec('run', h)), `${r.id} ${sfx(r.id)}`,
        { boost: -2, ids: [String(r.id).toLowerCase(), sfx(r.id).toLowerCase()], rel: [String(r.task).toLowerCase()], ds: String(r.ds).toLowerCase() })
    }
    return dedupeBySpec(L)
  }, [datasets, condition, all, overview, rig, onKeys, onTour, onVoice, outsKey, env, railItems])   // eslint-disable-line react-hooks/exhaustive-deps
}

export default function Palette({ close, datasets, condition, onKeys, onTour, onVoice, env, railItems }) {
  const rig = useRig()
  const items = usePaletteItems(datasets, condition, { onKeys, onTour, onVoice, env, railItems })
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const [all, setAll] = useState(false)
  // one kind of result only (a chip under the field); null shows every kind
  const [only, setOnly] = useState(null)
  const input = useRef(null)
  const listRef = useRef(null)
  const counts = useMemo(() => groupCounts(items, q), [items, q])
  const kind = only && counts[only] ? only : null
  const res = useMemo(() => paletteGroups(items, q, { all, only: kind }), [items, q, all, kind])
  const tips = useMemo(() => paletteSuggestions(items, condition && condition.dir), [items, condition])
  const rows = useMemo(() => res.groups.flatMap((g) => g.rows), [res])
  const n = rows.length + (res.hidden ? 1 : 0)   // the "Show all" row is the last option
  const cur = Math.min(sel, Math.max(0, n - 1))
  useEffect(() => { input.current?.focus() }, [])
  useEffect(() => { const el = listRef.current && listRef.current.querySelector('[aria-selected="true"]'); if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' }) }, [cur])
  const run = (i, side) => {
    if (i === rows.length && res.hidden) { setAll(true); return }
    const r = rows[i]; if (!r) return
    close(); r.i.run(side)
  }
  const onKey = (e) => {
    const mod = e.metaKey || e.ctrlKey
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close() }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setSel(Math.min(cur + 1, n - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel(Math.max(cur - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); run(cur, mod) }
  }
  // the option index where each group starts, so arrows run straight through the groups
  const starts = res.groups.reduce((acc, g, gi) => [...acc, gi ? acc[gi - 1] + res.groups[gi - 1].rows.length : 0], [])
  return (
    <div className="rg-scrim pal" onMouseDown={(e) => { if (e.target === e.currentTarget) close() }}>
      <div className="rg-pal" role="dialog" aria-modal="true" aria-label="Command palette" onKeyDown={onKey}>
        <div className="rg-pal-in"><Icon name="search" size={18} />
          <input ref={input} role="combobox" aria-expanded="true" aria-controls="rg-pal-list" aria-autocomplete="list" aria-label="Search datasets, questions, runs, tasks, pages and settings"
            aria-activedescendant={n ? `rg-po-${cur}` : undefined} value={q} autoComplete="off" spellCheck="false"
            placeholder="llma4se t02 · how do runs fail · run c95aff · add data · oracle" onChange={(e) => { setQ(e.target.value); setSel(0); setAll(false) }} />
          <span className="rg-pal-chip rg-hide-sm">{MOD} K</span>
          <button type="button" className="rg-btn ghost" aria-label="Close palette" onClick={close}>esc</button>
        </div>
        {counts.all > 0 && (
          <div className="rg-pal-kinds rg-filts" role="group" aria-label="Show one kind of result" data-el="palette-kinds">
            {Object.entries(counts).map(([k, n]) => {
              // the kind already shown: inert, and it says so
              const on = k === 'all' ? !kind : kind === k
              return (
                <button key={k} type="button" className="rg-filt" aria-pressed={on} aria-disabled={on || undefined} data-hint={on ? showingWords(k, GROUPS[k]) : undefined}
                  onClick={() => { input.current?.focus(); if (on) return; setOnly(k === 'all' ? null : k); setSel(0); setAll(false) }}>
                  {k === 'all' ? 'All' : GROUPS[k]} <span className="rg-filt-n">{fmt.int(n)}</span>
                </button>
              )
            })}
          </div>
        )}
        <div className="rg-pal-list" id="rg-pal-list" role="listbox" aria-label="Results" ref={listRef}>
          {!rows.length
            ? <div className="rg-pal-empty" data-el="empty-state">
                <p>Nothing matches “{q}”. Search finds datasets, tasks, runs, questions, pages, harnesses, models and glossary words. Try one of these:</p>
                <div className="rg-pal-tips" data-el="palette-suggestions">{tips.map((t) => (
                  <button key={t.k + t.q} type="button" className="rg-btn sm" onClick={() => { setQ(t.q); setSel(0); setOnly(null); input.current?.focus() }}>{t.label}</button>
                ))}</div>
              </div>
            : res.groups.map((g, gi) => (
              <div key={g.k} role="group" aria-label={g.label} className="rg-pal-sec">
                <div className="rg-pal-g" role="presentation">{g.label}</div>
                {g.rows.map((r, ri) => {
                  const k = starts[gi] + ri
                  // the page in view says so (choosing it only closes the palette)
                  const here = !!(r.i.spec && rig.isHere && rig.isHere(r.i.spec))
                  return (
                    <button key={k + r.i.t} type="button" role="option" id={`rg-po-${k}`} aria-selected={k === cur} aria-current={here ? 'page' : undefined} className={`rg-pal-it${k === cur ? ' on' : ''}`} data-hint={r.i.d ? `${r.i.t} · ${r.i.d}${here ? ' · you are here' : ''}` : here ? `${r.i.t} · you are here` : r.i.t}
                      onMouseEnter={() => setSel(k)} onClick={(e) => run(k, e.metaKey || e.ctrlKey)}>
                      <span className="k">{kindWord(r.i.k)}</span><span className="t"><Hl t={r.i.t} pos={r.pos} /></span><span className="d">{r.i.d}{here ? ' · you are here' : ''}</span>
                    </button>
                  )
                })}
              </div>
            ))}
          {res.hidden > 0 && (
            <button type="button" role="option" id={`rg-po-${rows.length}`} aria-selected={cur === rows.length} className={`rg-pal-it rg-pal-all${cur === rows.length ? ' on' : ''}`} data-el="palette-show-all"
              onMouseEnter={() => setSel(rows.length)} onClick={() => setAll(true)}>
              <span className="k" aria-hidden="true">more</span><span className="t">Show all {fmt.int(res.total)} results</span>
            </button>
          )}
        </div>
        <div className="rg-pal-f"><span><Kbd>↑</Kbd><Kbd>↓</Kbd> move</span><span><Kbd>↵</Kbd> open</span><span><Kbd>{MOD} ↵</Kbd> open to the side</span><span><Kbd>esc</Kbd> close</span><span className="rg-grow" /><span>{q.trim() ? `${fmt.int(res.total)} ${res.total === 1 ? 'result' : 'results'}` : `${fmt.int(items.length)} commands indexed`}</span></div>
      </div>
    </div>
  )
}
