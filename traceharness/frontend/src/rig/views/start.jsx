/* ====================================================================================
   Rig · views/start.jsx — `start`: Home, the page the app opens on, in TraceHarness's own look:
   * the hero band (start/hero.jsx): what TraceHarness shows and is for, the counts on this machine (each opening the
     datasets sorted by it), Open a dataset and Learn, the search with three questions, the facts of the dataset in
     focus;
   * "A run · five phases" (start/run.jsx): one real run of study_v04, phase by phase;
   * "You are here" (start/here.jsx): where this browser left off, and Learn as one square per article;
   * three ways to start and the six newest datasets, the closing band and the footer (start/lists.jsx).
   Every figure is the dataset library's own (/api/overview) or the articles' own, and every line opens the page it
   names. `home` stays the Datasets page, so old links keep working. Tokens only; the dark bands are start.css's.
   ==================================================================================== */
import { useMemo } from 'react'
import { useDatasets } from '../data'
import { useRig } from '../context'
import { Loading, ErrorState } from '../ui'
import { entityKey } from '../entityColor'
import { HOME_VS } from './home-sort'
import { formatVS, withVS } from '../viewState'
import { Hero } from './start/hero'
import { RunPhases } from './start/run'
import { YouAreHere } from './start/here'
import { StartCards, DatasetCards, Closing, Footer } from './start/lists'
import RUN from './start/start-run.json'
import './start.css'


/** The Datasets page sorted by one of its columns, biggest first. */
const sortedBy = (col) => withVS('home', formatVS({ ...HOME_VS, sort: col }, HOME_VS))
const distinct = (rows, field, kind) => new Set(rows.flatMap((r) => (r[field] || []).map((x) => (kind ? entityKey(kind, x) : String(x))))).size

/** The counts on this machine: [n, word(s), the page it opens, what it counts]. */
export function libraryCounts(rows) {
  const runs = rows.reduce((a, r) => a + (r.runs || 0), 0)
  const tasks = distinct(rows, 'tasks'), models = distinct(rows, 'models', 'model'), harnesses = distinct(rows, 'harnesses', 'harness')
  return [
    { n: rows.length, word: rows.length === 1 ? 'dataset' : 'datasets', spec: 'home', hint: 'Every dataset, newest first' },
    { n: runs, word: runs === 1 ? 'run' : 'runs', spec: sortedBy('runs'), hint: 'Runs in every dataset; opens the datasets, most runs first' },
    { n: tasks, word: tasks === 1 ? 'task' : 'tasks', spec: sortedBy('tasks'), hint: 'Different task names over every dataset; opens the datasets, most tasks first' },
    { n: models, word: models === 1 ? 'model' : 'models', spec: sortedBy('models'), hint: 'Different models over every dataset, a provider prefix aside; opens the datasets, most models first' },
    { n: harnesses, word: harnesses === 1 ? 'harness' : 'harnesses', spec: sortedBy('harnesses'), hint: 'Different harnesses over every dataset; opens the datasets, most harnesses first' },
  ]
}

function Start() {
  const ds = useDatasets()
  const { condition } = useRig()
  const rows = useMemo(() => ds.data || [], [ds.data])
  if (ds.error) return <ErrorState error={ds.error} onRetry={ds.reload} what="The dataset library" />
  if (!ds.data) return <Loading label="Reading the dataset library (/api/overview)…" />
  const dir = condition && rows.some((r) => r.name === condition.dir) ? condition.dir : null
  const row = dir ? rows.find((r) => r.name === dir) : null
  return (
    <div className="rg-start">
      <Hero counts={libraryCounts(rows)} dir={dir} row={row} />
      <RunPhases here={rows.some((r) => r.name === RUN.dataset)} />
      <YouAreHere rows={rows} />
      <div className="rg-start-sec">
        <div className="rg-start-in rg-start-lower">
          <StartCards dir={dir} />
          {rows.length > 0 && <DatasetCards rows={rows} />}
        </div>
      </div>
      <Closing />
      <Footer />
    </div>
  )
}

export const views = {
  start: {
    tag: 'home',
    title: () => 'Home',
    crumbs: () => [['Home']],
    render: Start,
    palette: () => [{ title: 'Home', detail: 'What TraceHarness is for, and where to start', spec: 'start' }],
  },
}
