/* Rig · DatasetOption.jsx — a dataset as every picker shows it.

   <DatasetOption row/>   the plain name, then the folder (mono, small) when the two differ; the kind badge;
                          one line saying what the dataset is ("no description yet" when no file says);
                          models · harnesses · tasks · runs · pass rate · date.
   <DatasetCard row/>     the hover card: the same, plus the whole description, where it comes from and what
                          the kind means.
   <KindBadge kind/>      the kind as a small badge with its shape.
   <DatasetSelect label value datasets onChange hideLabel?/>   a searchable dataset select (HarnessPicker) whose options
                          are DatasetOptions grouped by kind; Find matches the folder and the description too. */
import { fmt } from './data'
import { KINDS, datasetName, datasetFacts, groupDatasets, shortDate } from './datasetInfo'
import { RateWithCI } from './RateWithCI'
import { HarnessPicker } from './harnessPicker'
import { BrandMarks, SourceName } from './brand/BrandMark'

const cx = (...a) => a.filter(Boolean).join(' ')

export function KindBadge({ kind, el }) {
  const k = KINDS[kind] || KINDS.recorded
  return <span className="rg-tag dash rg-kind" data-el={el} data-kind={kind}><span className={`rg-kdot rg-kdot-${k.dot}`} aria-hidden="true" />{k.label}</span>
}

/** The rate cell of an option: the rate with its interval, or "not graded". */
function Rate({ row }) {
  if (row.pass_rate == null) return <span className="rg-dso-ng">not graded</span>
  return <span className="rg-nw">pass <RateWithCI rate={row.pass_rate} ci={row.pass_ci95} n={row.graded} hint={false} bar={false} classes={{ root: 'rg-dso-rate' }} /></span>
}

/** `badge` false where a group heading already names the kind (the grouped pickers). */
export function DatasetOption({ row, className, badge = true }) {
  const name = datasetName(row)
  const date = shortDate(row.updated)
  return (
    <span className={cx('rg-dso', className)}>
      <span className="rg-dso-h"><b className="rg-dso-n">{name}</b>{badge && <KindBadge kind={row.origin} />}</span>
      {name !== row.name && <span className="rg-dso-f rg-mono">{row.name}</span>}
      <SourceName source={row.source} />
      <span className={cx('rg-dso-s', !row.summary && 'none')}>{row.summary || 'no description yet'}</span>
      <span className="rg-dso-m"><BrandMarks kind="model" names={row.models} />{datasetFacts(row).join(' · ')} · <Rate row={row} /> · {date ? `updated ${date}` : 'date not recorded'}</span>
    </span>
  )
}

/** Where the description comes from, as short facts. */
function sourceLines(row) {
  const s = row.source || {}
  const out = []
  if (s.doc) out.push(['From', s.doc])
  if (s.dataset) out.push(['Dataset', s.dataset])
  if (s.attribution) out.push(['Credit', s.attribution])
  if (s.license) out.push(['Licence', s.license])
  if (s.fetched_at) out.push(['Fetched', shortDate(s.fetched_at) || s.fetched_at])
  if (Number.isInteger(s.n) && Number.isInteger(s.n_imported)) out.push(['Rows imported', `${fmt.int(s.n_imported)} of ${fmt.int(s.n)} in the sample`])
  if (s.adapter) out.push(['Adapter', s.adapter])
  if (s.file) out.push(['Source file', s.file])
  if (s.notes) out.push(['Import notes', s.notes])
  return out
}

export function DatasetCard({ row }) {
  const k = KINDS[row.origin] || KINDS.recorded
  const lines = sourceLines(row)
  return (
    <span className="rg-dsc">
      <span className="rg-dso-h"><b className="rg-dso-n">{datasetName(row)}</b><KindBadge kind={row.origin} /></span>
      <span className="rg-dso-f rg-mono">data/runs/{row.name}</span>
      <span className="rg-dsc-d">{row.description || row.summary || 'No description yet: no file in this folder says what it is.'}</span>
      {lines.length > 0 && <span className="rg-dsc-src">{lines.map(([label, v]) => <span key={label}><span className="rg-mute">{label}</span> {v}</span>)}</span>}
      <span className="rg-dsc-k">{k.what}</span>
      <span className="rg-dso-m">{datasetFacts(row).join(' · ')} · <Rate row={row} />{row.pass_rate != null && row.graded != null && <> of {fmt.int(row.graded)} graded</>}</span>
    </span>
  )
}

/** The options of a DatasetSelect: grouped by kind (with the count), searchable by folder and description. */
export function datasetOptions(rows) {
  return groupDatasets(rows).flatMap((g) => g.rows.map((r) => ({
    value: r.name, label: datasetName(r), row: r, group: `${g.label} · ${g.count}`,
    description: [r.name, r.summary].filter(Boolean).join(' · '), meta: datasetFacts(r).join(' · '),
  })))
}

export function DatasetSelect({ label = 'Dataset', value, datasets, onChange, hideLabel, className }) {
  return <HarnessPicker label={label} value={value} options={datasetOptions(datasets || [])} onChange={onChange} hideLabel={hideLabel}
    className={cx('rg-dsel', className)} placeholder="Choose a dataset" searchPlaceholder="Search by name, folder or description" emptyMessage="No dataset matches"
    renderOption={(o) => <DatasetOption row={o.row} />} />
}
