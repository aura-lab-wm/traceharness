/* ====================================================================================
   Rig · views/home.jsx — `home`: the dataset library (every dataset from /api/overview).
   Owner: Phase 1. Kind, stats, search, filter, open, load trajectories.
   Round 3 (breathing): one stacked table — the side "Selected" panel only repeated the row
   it described. Each row carries its models under the name; the mock-control explanation
   lives behind "About". Empty states always offer the way forward.
   UI contract v1: the table keeps runs and pass at every width and drops tasks / updated
   (narrow pane), then harnesses / models (medium pane); the design card's text keeps a basis.
   ==================================================================================== */
import { useMemo } from 'react'
import { IS_STATIC, IS_MEMBER } from '../../api'
import { makeSpec } from '../route'
import { useDatasets, short, fmt } from '../data'
import { useRig, useTabState } from '../context'
import { Go, Seg, SearchBox, Tag, Empty, Loading, ErrorState, About, Icon, Toolbar, TableScroll, PanelState } from '../ui'
import './home.css'

/** A dataset name with a line-break opportunity after each _ and -, so a narrow column wraps it
 *  between words ("captured_claude_" / "code") instead of mid-word. Text content is unchanged. */
const breakable = (name) => String(name).split(/(?<=[_-])/).flatMap((part, i) => (i ? [<wbr key={i} />, part] : [part]))

function Home({ spec }) {
  const ds = useDatasets()
  const { openTab } = useRig()
  const [q, setQ] = useTabState(spec, 'q', '')
  const [f, setF] = useTabState(spec, 'f', 'all')
  const all = ds.data || []
  const list = useMemo(() => all
    .filter((r) => (f === 'all' || r.kind === f) && (!q || `${r.name} ${r.models.join(' ')} ${r.harnesses.join(' ')}`.toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => (a.kind === b.kind ? b.runs - a.runs : a.kind === 'recorded' ? -1 : 1)), [all, f, q])
  if (ds.error) return <ErrorState error={ds.error} onRetry={ds.reload} what="The dataset library" />
  if (!ds.data) return <Loading label="Reading the dataset library (/api/overview)…" />
  const total = all.reduce((a, r) => a + (r.runs || 0), 0)
  const cnt = (k) => all.filter((r) => k === 'all' || r.kind === k).length
  if (!all.length) {
    return (
      <div className="rg-dpad">
        <div className="rg-dh"><div className="t"><div className="rg-eyebrow">Library · data/runs</div><h1>Datasets</h1></div></div>
        <Empty title="No datasets yet." actions={[!IS_STATIC && { label: 'Load trajectories', spec: 'sources', primary: true }, !IS_STATIC && { label: 'Capture sessions on this machine', spec: 'capture' }, { label: 'Fixed harnesses', spec: 'shallowCards' }, { label: 'Minimal harness', spec: 'shallowWizard' }].filter(Boolean)}>
          {IS_STATIC ? 'This snapshot contains no trajectory sets. You can still design a harness; import and capture run in the local workbench.' : 'data/runs on this machine holds no trajectory sets. Import another harness\'s traces, or capture the coding-agent sessions already on this machine.'}
        </Empty>
      </div>
    )
  }
  return (
    <div className="rg-dpad">
      <div className="rg-dh rg-home-head">
        <div className="t"><div className="rg-eyebrow">Library · {IS_STATIC ? 'saved snapshot' : 'data/runs'} · {fmt.int(total)} runs</div><h1>Datasets</h1>
          <p>{fmt.plural(all.length, 'trajectory set')}. Recorded agents appear first; scripted mock controls stay labeled. Open a dataset to examine its analysis, then follow a result into its run evidence.</p></div>
        {!IS_STATIC && <Go spec="sources" className="rg-btn pri lg" el="load-trajectories-cta">Load trajectories</Go>}
      </div>
      <section className="rg-card rg-home-design" data-el="harness-workflow" aria-label="Design from the evidence">
        <div className="rg-home-design-t">
          <h2>Design from the evidence</h2>
          <p>Open a run and choose Design a harness to keep a link back to it. {IS_MEMBER ? 'Choose a harness, compatible model and registered task in Harnesses. Save to your account, review the full configuration, then start a hosted run.' : 'Or begin with a fixed shell, six questions, or a block stack.'}</p>
        </div>
        <div className="rg-cluster rg-home-design-a">
          {IS_MEMBER ? <Go spec="harnesses" className="rg-btn pri" el="open-harnesses-cta">Open Harnesses</Go> : <>
            <Go spec="shallowWizard" className="rg-btn pri" el="minimal-harness-cta">Minimal harness</Go>
            <Go spec="shallowCards" className="rg-btn" el="fixed-harnesses-cta">Fixed harnesses</Go>
            <Go spec="blocks" className="rg-btn" el="build-harness-cta">Build a harness</Go>
          </>}
        </div>
      </section>
      <section className="rg-home-lib" aria-label="Dataset library">
        <Toolbar label="Find a dataset" className="rg-home-bar">
          <SearchBox value={q} onChange={setQ} placeholder="Find a dataset, model or harness" el="dataset-search" />
          <Seg el="dataset-filter" label="Dataset kind" value={f} onChange={setF}
            options={[['all', `All ${cnt('all')}`], ['recorded', `Recorded agents ${cnt('recorded')}`], ['mock', `Mock controls ${cnt('mock')}`]]} />
        </Toolbar>
        <div className="rg-pnl rg-home-list" data-el="dataset-list">
          {list.length ? (
            <TableScroll label="Datasets" stickyCol={false}><table className="rg-tbl rg-home-tbl">
              <thead><tr><th>dataset</th><th className="rg-num">runs</th>
                <th className="rg-num rg-home-pass" title="Known hidden-suite grades, every condition pooled; ungraded runs are excluded"><span className="rg-cq-hide-sm">pass (index)</span><span className="rg-cq-show-sm">pass</span></th>
                <th className="rg-num rg-cq-hide-sm">tasks</th><th className="rg-num rg-cq-hide-md">harnesses</th><th className="rg-num rg-cq-hide-md">models</th>
                <th className="rg-cq-hide-sm">updated</th><th className="rg-home-go rg-cq-hide-xs"><span className="sr-only">Open</span></th></tr></thead>
              <tbody>{list.map((r) => (
                /* the whole row is a mouse target; the keyboard reaches the dataset through its name button,
                   so the row is not a Tab stop of its own (it opened the same document) */
                <tr key={r.name} className="hov"
                  onClick={(e) => { if (!e.target.closest('button')) openTab(makeSpec('ds', r.name), { side: e.metaKey || e.ctrlKey }) }}>
                  <td className="rg-home-name">
                    {/* every row has the same two-line shape: the name, then its kind tag and its models */}
                    <div className="rg-home-nl"><Go spec={makeSpec('ds', r.name)} className="rg-tlink rg-home-dn"><b>{breakable(r.name)}</b></Go></div>
                    <div className="rg-home-meta"><Tag tone={r.kind === 'mock' ? 'dash' : undefined} el="dataset-kind">{r.kind === 'mock' ? 'Mock control' : 'Recorded'}</Tag>
                      <span className="rg-home-models rg-ell" data-el="dataset-models" title={r.models.join(', ')}>{r.models.map(short).join(' · ')}</span></div>
                  </td>
                  <td className="rg-num" data-el="dataset-stats">{fmt.int(r.runs)}</td>
                  <td className="rg-num rg-home-pass">{r.pass_rate == null
                    ? <span className="rg-home-ng">Not graded</span>
                    : <span className="rg-home-pr"><span className="rg-home-prt" aria-hidden="true"><i style={{ width: `${Math.max(0, Math.min(1, r.pass_rate)) * 100}%` }} /></span><span>{fmt.pct(r.pass_rate)}</span></span>}</td>
                  <td className="rg-num rg-cq-hide-sm">{r.tasks.length}</td><td className="rg-num rg-cq-hide-md">{r.harnesses.length}</td><td className="rg-num rg-cq-hide-md">{r.models.length}</td>
                  <td className="rg-mono rg-cq-hide-sm rg-home-date">{String(r.updated || '').slice(0, 10) || 'not recorded'}</td>
                  <td className="rg-home-go rg-cq-hide-xs"><Go spec={makeSpec('ds', r.name)} className="rg-rowgo" el="dataset-open" label={`Open ${r.name}`}><Icon name="right" size={16} /></Go></td>
                </tr>))}</tbody>
            </table></TableScroll>
          ) : (
            <PanelState title="No dataset matches." actions={<button type="button" className="rg-btn pri" onClick={() => { setQ(''); setF('all') }}>Clear search &amp; filter</button>}>
              Nothing in the {f === 'all' ? '' : f === 'mock' ? 'mock-control ' : 'recorded '}library matches “{q}”{q ? '' : ' under this filter'}.
            </PanelState>
          )}
        </div>
      </section>
      <About summary="About recorded datasets and mock controls" el="dataset-kind-about">
        <p><b>Recorded</b> datasets hold real agent trajectories: each run is a ledger of model calls and tool actions. Test-suite grades are shown where recorded; captured sessions and imported runs can have unknown outcomes.</p>
        <p><b>Mock controls</b> are scripted agents with designed failure rates. They check the measurement, not a model: all-pass or all-fail on a mock control means the grader broke.</p>
        <p>“pass (index)” is the hidden-suite pass rate among known grades, pooled over every model and harness in the dataset. Ungraded runs are excluded; open a dataset for rates per condition, with their denominators.</p>
      </About>
    </div>
  )
}

export const views = {
  home: {
    tag: 'lib',
    title: () => 'Datasets',
    crumbs: () => [['datasets']],
    render: Home,
    palette: (env) => [{ title: 'Datasets', detail: `library · ${env.datasets.length || ''} trajectory sets`, spec: 'home' }],
  },
}
