/* ====================================================================================
   Rig · views/home.jsx — `home`: the dataset library (every dataset from /api/overview).
   Studio Graphite: title and one count line with the one primary action (Add data, key A); a filter
   field and filter chips whose counts follow the search, with Reset while anything narrows the list;
   one lean table (name, kind, runs, tasks, models, harnesses, pass rate with its interval, updated),
   every column sorted by its header, newest first; ↑ ↓ move between rows and ↵ opens one. The sort
   and the kind chip are in the address (home:sort.runs,kind.mock; viewState.js), so a link or Back
   reopens the list as it was. The dataset in focus is marked "open". The harness design doors and the
   note on recorded and mock data sit under the table. Empty states always offer the way forward.
   ==================================================================================== */
import { Fragment, useCallback, useEffect, useMemo, useRef } from 'react'
import { IS_STATIC } from '../../api'
import { MODE, can, why } from '../../environment'
import { DATASETS } from '../../shared/index.js'
import { Unavailable } from '../unavailable'
import { makeSpec } from '../route'
import { useDatasets, short, fmt } from '../data'
import { useRig, useTabState } from '../context'
import { Go, SearchBox, Empty, Loading, ErrorState, About, Icon, Kbd, PanelState, PageHeader, FilterChips, Wb, EntityName } from '../ui'
import { InfoTip } from '../Inspector'
import { HoverCard } from '../HoverCard'
import './home.css'
import { useFlip } from '../flip'
import { RateWithCI, rateWords } from '../RateWithCI'
import { useViewState } from '../useViewState'
import { COLUMNS, HOME_VS, nextSort, readSort, sortRows } from './home-sort'
import { shortDate, KINDS, KIND_ORDER, datasetName, datasetText } from '../datasetInfo'
import { DatasetCard } from '../DatasetOption'
import { SourceName } from '../brand/BrandMark'

const cx = (...a) => a.filter(Boolean).join(' ')
/** A dataset ran a Sentinel arm when one of its harnesses is the "<id>+sentinel" twin of another. */
export const hasSentinelArm = (r) => (r.harnesses || []).some((h) => String(h).endsWith('+sentinel'))

/** Where a dataset can also be opened (SPEC 4.8), as a quiet suffix to its name. Nothing when the server did not say. */
const PLACE = { school: 'school package' }
const placeLabels = (places) => (!Array.isArray(places) ? [] : places.length ? places.map((p) => PLACE[p]).filter(Boolean) : ['this computer only'])
function Availability({ places, dot = true }) {
  const labels = placeLabels(places)
  return labels.map((label, i) => <span key={label} className="rg-home-tag">{(dot || i > 0) && <span aria-hidden="true">· </span>}<span data-el="dataset-availability">{label}</span></span>)
}

/* Every column sorts (home-sort.js); the header says which one does and which way. */
function SortHead({ col, sort, onSort }) {
  const on = sort.sort === col.id
  return (
    <th className={cx(col.num && 'rg-num', on && 'rg-home-sorted')} aria-sort={on ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button type="button" className="rg-home-sort" onClick={() => onSort(col.id)}>{col.label}{on && <Icon name={sort.dir === 'asc' ? 'sortu' : 'sortd'} size={12} />}</button>
    </th>
  )
}
/** The names a count counts, each one whole: the first SHOWN in the row, the rest behind "+N more", which names
 *  them on hover and on keyboard focus (a laptop column has no room for nine harness names, and a name cut to
 *  "bas…" names nothing). */
const SHOWN = 2
function Names({ names, el, kind, ids = names }) {
  const rest = names.slice(SHOWN)
  return (
    <span className="rg-home-models" data-el={el}>
      {names.slice(0, SHOWN).map((n, i) => <Fragment key={`${i}:${n}`}>{i > 0 && ', '}{kind ? <EntityName kind={kind} id={ids[i]} name={n} /> : <Wb>{n}</Wb>}</Fragment>)}
      {rest.length > 0 && <>{' '}<span className="rg-home-more" tabIndex={0} data-el="dataset-more" data-hint={rest.join('\n')}>+{rest.length} more</span></>}
    </span>
  )
}
/** A count and, after it, the short names it counts (dropped in a narrow pane, kept in the hint). */
function CountCell({ n, names, el, namesEl, hint, kind }) {
  return (
    <td className="rg-home-ccell" data-hint={hint}>
      <span className="rg-home-ml"><span className="rg-home-mn" data-el={el}>{n}</span><span className="rg-home-sep" aria-hidden="true"> · </span><Names names={names} el={namesEl} kind={kind} /></span>
    </td>
  )
}

/** How many models and harnesses a dataset's rate pools: "all 3 models · 9 harnesses", or null for one condition. */
export function poolWords(r) {
  const m = (r.models || []).length, h = (r.harnesses || []).length
  if (m <= 1 && h <= 1) return null
  return `${m > 1 ? `all ${m} models` : '1 model'} · ${h > 1 ? `${h} harnesses` : '1 harness'}`
}
/** A dataset's pass rate with what it pools, and a card that says so and links to the rates per model and harness
 *  (the Family matrix), or to Outcomes when the dataset is one condition. */
function DatasetRate({ r }) {
  const pool = poolWords(r)
  const m = (r.models || []).length, h = (r.harnesses || []).length
  const card = (
    <span className="rg-home-ratecard">
      <b className="rg-home-ratew">{rateWords(r.pass_rate, r.pass_ci95, r.graded)}.</b>{' '}
      {pool
        ? <>Pooled over {m > 1 ? `all ${m} models` : 'the one model'} and {h > 1 ? `${h} harnesses` : 'the one harness'} of {r.name}: every hidden-oracle pass divided by every known grade; ungraded runs are left out.</>
        : <>The hidden-oracle pass rate of {r.name}'s one model and harness, among known grades; ungraded runs are left out.</>}
      {' '}{pool ? <Go link spec={makeSpec('an', r.name, 'family')} className="rg-tlink">Pass rate per model and harness →</Go> : <Go link spec={makeSpec('an', r.name, 'outcomes')} className="rg-tlink">Outcomes of this condition →</Go>}
    </span>
  )
  return (
    <HoverCard el="dataset-rate-card" content={card}>
      <span className="rg-home-rate" tabIndex={0} data-el="dataset-rate">
        <RateWithCI rate={r.pass_rate} ci={r.pass_ci95} n={r.graded} el="dataset-pass-rate" hint={false} classes={{ root: 'rg-home-pr', bar: 'rg-home-prt' }} />
        {pool && <span className="rg-home-scope" data-el="dataset-rate-scope">pooled · {pool}</span>}
      </span>
    </HoverCard>
  )
}

function Home({ spec }) {
  const ds = useDatasets()
  const { openTab, condition } = useRig()
  // the typed search is the tab's own; the sort and the kind chip are in the address
  const [q, setQ] = useTabState('home', 'q', '')
  const [vs, setVs] = useViewState(spec, HOME_VS, 'home')
  const sort = readSort(vs)
  const f = vs.kind
  const setF = (kind) => setVs({ kind })
  const root = useRef(null)
  const all = useMemo(() => ds.data || [], [ds.data])
  const filters = useMemo(() => [
    { value: 'all', label: 'All', test: () => true },
    // Recorded and Mock always; the other kinds (datasetInfo.KINDS) while some dataset is one
    ...KIND_ORDER.filter((k) => k === 'recorded' || k === 'mock' || all.some((r) => r.origin === k))
      .map((k) => ({ value: k, label: KINDS[k].short, dot: KINDS[k].dot, test: (r) => (r.origin || r.kind) === k })),
    // only when some dataset has a Sentinel arm: a chip that can only ever say 0 is noise
    all.some(hasSentinelArm) && { value: 'sentinel', label: 'With Sentinel arm', icon: <Icon name="shield" size={12} />, test: hasSentinelArm },
  ].filter(Boolean), [all])
  const active = filters.find((x) => x.value === f) || filters[0]
  // the filter counts follow the search: each chip says how many rows it would show now
  // Find matches the folder, the plain name, the description, the kind, the source, the models and the harnesses
  const found = useMemo(() => all.filter((r) => !q || datasetText(r).includes(q.trim().toLowerCase())), [all, q])
  const list = useMemo(() => sortRows(found.filter(active.test), sort.sort, sort.dir), [found, active, sort.sort, sort.dir])
  const onSort = (id) => setVs(nextSort(sort, id))
  const narrowed = active.value !== 'all' || !!q
  const reset = () => { setQ(''); setVs({ kind: 'all' }) }
  // a new sort or filter moves the rows to their places instead of redrawing them there
  useFlip(root, 'tbody tr[data-row]', list.map((r) => r.name).join('|'))
  const open = useCallback((name, side) => openTab(makeSpec('ds', name), { side }), [openTab])
  // a row's click goes to its dataset link, with the same modifier keys
  const clickLink = (row, e) => {
    const a = row.querySelector('a[data-el~="dataset-open"]')
    if (a) a.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, metaKey: e.metaKey, ctrlKey: e.ctrlKey }))
  }
  const rows = () => (root.current ? [...root.current.querySelectorAll('tbody tr[data-row]')] : [])
  const move = (dir) => {
    const rs = rows()
    if (!rs.length) return
    const i = rs.indexOf(document.activeElement)
    rs[Math.max(0, Math.min(rs.length - 1, i < 0 ? (dir > 0 ? 0 : rs.length - 1) : i + dir))].focus()
  }
  // ↑ ↓ from the filter field, a row, or the page itself; A for Add data while nothing is being typed
  const canAdd = can('data.import')
  useEffect(() => {
    const onKey = (e) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || document.querySelector('.rg-tour-layer')) return
      const node = root.current
      const doc = node && node.closest('.rg-doc')
      if (!doc || doc.id !== 'rig-doc-main') return
      const t = document.activeElement
      const onPage = !t || t === document.body || t === doc
      if (onPage && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { e.preventDefault(); move(e.key === 'ArrowDown' ? 1 : -1) }
      else if (onPage && canAdd && !e.shiftKey && (e.key === 'a' || e.key === 'A')) { e.preventDefault(); openTab('sources') }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }) // eslint-disable-line react-hooks/exhaustive-deps
  const onKeyDown = (e) => {
    const inRow = e.target.matches && e.target.matches('tr[data-row]')
    const inFilter = e.target.matches && e.target.matches('input[type=search]')
    if ((inRow || inFilter) && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { e.preventDefault(); move(e.key === 'ArrowDown' ? 1 : -1) }
    else if (inRow && e.key === 'Enter') { e.preventDefault(); open(e.target.dataset.row, e.metaKey || e.ctrlKey) }
    else if (inRow && !e.metaKey && !e.ctrlKey && !e.altKey && canAdd && (e.key === 'a' || e.key === 'A')) { e.preventDefault(); openTab('sources') }
  }
  if (ds.error) return <ErrorState error={ds.error} onRetry={ds.reload} what="The dataset library" />
  if (!ds.data) return <Loading label="Reading the dataset library (/api/overview)…" />
  const total = all.reduce((a, r) => a + (r.runs || 0), 0)
  const here = condition && condition.dir
  const where = IS_STATIC ? 'in this snapshot' : 'on this machine'
  // an export names the school datasets it does not carry; the local console has what it has
  const lacking = MODE === 'local' ? [] : DATASETS.school.filter((name) => !all.some((r) => r.name === name))
  // the three ways to start a harness, one counted line under the table
  const doors = (
    <details className="rg-home-doors" data-el="harness-workflow collapsed-line">
      <summary>Design a harness from the evidence · 3 ways to start</summary>
      <div className="rg-home-doors-b" role="group" aria-label="Design a harness from the evidence">
        <span className="rg-home-doors-t">Open a run and choose Design a harness, or start from</span>
        <Go spec="shallowWizard" className="rg-btn sm" el="minimal-harness-cta">Minimal harness</Go>
        <Go spec="shallowCards" className="rg-btn sm" el="fixed-harnesses-cta">Fixed harnesses</Go>
        <Go spec="blocks" className="rg-btn sm" el="build-harness-cta">Build a harness</Go>
      </div>
    </details>
  )
  if (!all.length) {
    return (
      <div className="rg-dpad rg-home">
        <PageHeader title="Datasets" subtitle={`No datasets ${where} yet`} />
        <Empty title="No datasets yet." actions={[can('data.import') && { label: 'Add data', spec: 'sources', primary: true }, can('capture.local') && { label: 'Capture sessions on this machine', spec: 'capture' }, { label: 'Fixed harnesses', spec: 'shallowCards' }, { label: 'Minimal harness', spec: 'shallowWizard' }].filter(Boolean)}>
          {IS_STATIC ? `This snapshot contains no datasets. You can still design a harness. ${why('data.import', 'Importing')}` : 'data/runs on this machine holds no dataset. Add data: import another harness\'s runs, download a public sample, or capture the coding-agent sessions already on this machine.'}
        </Empty>
      </div>
    )
  }
  return (
    <div className="rg-dpad rg-home" ref={root} onKeyDown={onKeyDown}>
      <PageHeader title="Datasets" el="home-head"
        subtitle={`${fmt.plural(all.length, 'dataset')} · ${fmt.int(total)} ${total === 1 ? 'run' : 'runs'} ${where}`}
        actions={canAdd && <Go spec="sources" className="rg-btn pri" el="load-trajectories-cta" tour="add-data" tip="Add data (A)"><Icon name="plus" size={14} />Add data<Kbd>A</Kbd></Go>} />
      <section className="rg-home-lib" aria-label="Datasets">
        <div className="rg-home-bar" role="group" aria-label="Find a dataset">
          <SearchBox value={q} onChange={setQ} placeholder="Filter by name, model or harness" el="dataset-search" />
          <FilterChips el="dataset-filter" label="Dataset kind" value={active.value} onChange={setF}
            options={filters.map((x) => ({ ...x, count: found.filter(x.test).length }))} />
          {narrowed && <button type="button" className="rg-filt rg-home-reset" data-el="dataset-filter-reset" onClick={reset} data-hint="Show every dataset again: all kinds, no search. The sort stays.">
            <Icon name="x" size={12} />Reset</button>}
        </div>
        <div className="rg-home-list" data-fill data-el="dataset-list">
          {list.length ? (
            <table className="rg-tbl rg-home-tbl">
              <colgroup>{COLUMNS.map((col) => <col key={col.id} className={`rg-home-c-${col.id}`} />)}</colgroup>
              <thead><tr>{COLUMNS.map((col) => <SortHead key={col.id} col={col} sort={sort} onSort={onSort} />)}</tr></thead>
              <tbody>{list.map((r) => {
                const cur = r.name === here
                const date = shortDate(r.updated)
                return (
                  /* the whole row is a mouse target and an arrow-key stop; Tab reaches the dataset through its name. A click
                     on the row is a click on that link: one target, one action (⌘/Ctrl opens it beside, as the link does) */
                  <tr key={r.name} className={cx('hov', cur && 'rg-home-cur')} data-row={r.name} tabIndex={-1} aria-label={`${r.name}${cur ? ', open' : ''}`}
                    onClick={(e) => { if (!e.target.closest('button,a')) clickLink(e.currentTarget, e) }}>
                    <td className="rg-home-name">
                      {/* the plain name, its folder and where else it opens under it; what the dataset is, where it comes from and
                          its kind in the card. "open now" is a status inside the link, not a command beside it */}
                      <div className="rg-home-nl"><HoverCard el="dataset-card" content={<DatasetCard row={r} />}><Go spec={makeSpec('ds', r.name)} className="rg-elink rg-home-dn" el="dataset-open" label={`Open ${datasetName(r)}${datasetName(r) !== r.name ? ` (${r.name})` : ''}`}><b>{datasetName(r)}</b>{cur && <>{' '}<span className="rg-home-tag rg-home-open" data-el="dataset-open-now">open now</span></>}</Go></HoverCard></div>
                      <span className="rg-home-sub">{datasetName(r) !== r.name && <span className="rg-home-folder rg-mono" data-el="dataset-folder"><Wb>{r.name}</Wb></span>}{' '}<Availability places={r.availability} dot={datasetName(r) !== r.name} /></span>
                    </td>
                    <td><span className="rg-tag dash rg-home-kind" data-el="dataset-kind" data-kind={r.origin}><span className={`rg-kdot rg-kdot-${(KINDS[r.origin] || KINDS.recorded).dot}`} aria-hidden="true" />{(KINDS[r.origin] || KINDS.recorded).short}</span><SourceName source={r.source} /></td>
                    <td className="rg-num" data-el="dataset-stats">{fmt.int(r.runs)}</td>
                    <td className="rg-num" data-el="dataset-tasks" data-hint={`${fmt.plural(r.tasks.length, 'task')} in ${r.name}`}>{fmt.int(r.tasks.length)}</td>
                    <td className="rg-home-mcell" data-hint={`${Object.entries(r.model_runs || {}).map(([m, n]) => `${m}: ${fmt.int(n)} runs`).join('\n') || r.models.join(', ')}\n${fmt.plural(r.tasks.length, 'task')} · ${fmt.plural(r.harnesses.length, 'harness', 'harnesses')}`}>
                      <span className="rg-home-ml"><span className="rg-home-mn">{r.models.length}</span><span className="rg-home-sep" aria-hidden="true"> · </span><Names names={r.models.map(short)} ids={r.models} el="dataset-models" kind="model" /></span>
                    </td>
                    <CountCell n={r.harnesses.length} names={r.harnesses} el="dataset-harnesses" namesEl="dataset-harness-names" hint={r.harnesses.join('\n')} kind="harness" />
                    <td>{r.pass_rate == null
                      ? <span className="rg-home-ng"><span className="rg-mono" aria-hidden="true">—</span>not graded</span>
                      : <DatasetRate r={r} />}</td>
                    <td className={cx('rg-num rg-home-date', !date && 'rg-home-nodate')} data-hint={r.updated || 'The dataset has no recorded date'}>{date || 'not recorded'}</td>
                  </tr>
                )
              })}</tbody>
            </table>
          ) : (
            <PanelState center title="No dataset matches." actions={<button type="button" className="rg-btn" onClick={() => { setQ(''); setF('all') }}>Clear search &amp; filter</button>}>
              No {active.value === 'all' ? '' : active.value === 'sentinel' ? 'Sentinel-arm ' : `${(KINDS[active.value] || KINDS.recorded).short.toLowerCase()} `}dataset matches{q ? <> “{q}”</> : ' this filter'}.
            </PanelState>
          )}
        </div>
        <div className="rg-home-foot">
          <span data-el="dataset-count">Showing {list.length} of {all.length}</span>
          <InfoTip label="Keys on this page"><p className="rg-home-hints"><span><Kbd>↑</Kbd><Kbd>↓</Kbd> move</span> <span><Kbd>↵</Kbd> open</span> <span><Kbd>/</Kbd> filter</span> <span><Kbd>A</Kbd> Add data</span></p></InfoTip>
        </div>
        {lacking.length > 0 && (
          <div className="rg-home-nothere" data-el="datasets-not-here">
            <p className="rg-small rg-dim">Not in this export: {lacking.join(', ')}.</p>
            <Unavailable capability="data.import" what="Opening them" el="datasets-not-here-why" />
          </div>
        )}
      </section>
      {doors}
      <About summary="About recorded and mock datasets" el="dataset-kind-about">
        <p><b>Recorded</b> datasets hold real agent trajectories: each run is a ledger of model calls and tool actions. Oracle grades are shown where recorded; captured sessions and imported runs can have unknown outcomes.</p>
        <p><b>Mock</b> datasets are scripted agents with designed failure rates. They check the measurement, not a model: all-pass or all-fail on mock data means the grading broke.</p>
        <p data-el="dataset-kinds">The kinds: {KIND_ORDER.map((k, i) => <span key={k}>{i ? ' · ' : ''}<b>{KINDS[k].label}</b>: {KINDS[k].what.replace(/\.$/, '')}</span>)}. The card on a dataset's name says which one it is and where its description comes from.</p>
        <p>“Pass rate” is the hidden-oracle pass rate among known grades, pooled over every model and harness in the dataset. Ungraded runs are excluded; open a dataset for rates per condition, with their denominators.</p>
        <p>The ± and the whisker are the 95% interval of that rate. Runs of one task repeat each other, so they count for less than independent runs: the interval is the Wilson interval at the effective number of runs.</p>
      </About>
    </div>
  )
}

export const views = {
  home: {
    tag: 'lib',
    title: () => 'Datasets',
    crumbs: () => [['Datasets']],
    render: Home,
    palette: (env) => [{ title: 'Datasets', detail: `${env.datasets.length || ''} datasets in data/runs`, spec: 'home' }],
  },
}
