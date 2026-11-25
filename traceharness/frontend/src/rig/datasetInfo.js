/* Rig · datasetInfo.js — what a dataset (and a harness inside it) is, in plain words. PURE.

   The server says what each dataset is (backend/dataset_meta.py: display_name, summary, description, kind,
   source, harness_notes), computed from the dataset's own files; this module turns that into what every
   picker shows: the plain name first, the kind as a badge, one line, the counts, the groups. What the
   server does not say is never filled in here: a dataset without a summary reads "no description yet". */
import { fmt } from './data'

/** The six kinds, in the order the pickers group them. `short` is the table's word (the Datasets list), `what` one
 *  sentence for the kind's hover card. */
export const KINDS = Object.freeze({
  recorded: { label: 'Recorded agents', short: 'Recorded', dot: 'rec', what: 'Real model runs recorded by TraceHarness, through OpenRouter or the local runner.' },
  imported: { label: 'Imported by you', short: 'Imported', dot: 'imp', what: 'Runs you brought in from another tool with Add data › Import files.' },
  captured: { label: 'Captured on this computer', short: 'Captured', dot: 'cap', what: 'Coding-agent sessions captured on this computer with Add data › Session capture.' },
  public: { label: 'Public dataset', short: 'Public', dot: 'pub', what: 'Runs from a published dataset, with its source and licence.' },
  demo: { label: 'Bundled demo', short: 'Demo', dot: 'demo', what: 'An import or a captured session that ships with TraceHarness as an example.' },
  mock: { label: 'Mock control', short: 'Mock', dot: 'mock', what: 'A scripted fake agent with designed failure rates: it checks the measurement, not a model.' },
})
export const KIND_ORDER = Object.freeze(['recorded', 'imported', 'captured', 'public', 'demo', 'mock'])

/** One sentence for "What is a dataset?" (also the glossary row `dataset`). */
export const WHAT_IS_A_DATASET = 'A dataset is one folder of runs under data/runs: some models under some harnesses on some tasks, every run kept with its steps and grades.'

const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k)
const isMock = (models) => Array.isArray(models) && models.length > 0 && models.every((m) => String(m).startsWith('mock'))

/** The kind of a raw server row: its `kind` when it is one of the six, else mock or recorded from its models. */
export function originOf(raw) {
  if (!raw) return 'recorded'
  if (typeof raw.kind === 'string' && own(KINDS, raw.kind)) return raw.kind
  return isMock(raw.models) ? 'mock' : 'recorded'
}

const text = (s) => (typeof s === 'string' && s.trim() ? s.trim() : null)
/** The name a picker shows first: the plain name, else the folder. */
export const datasetName = (r) => (r && (text(r.display_name) || r.name)) || ''
/** "2 models", "1 harness", "24 tasks", "3,240 runs". */
export function datasetFacts(r) {
  const n = (a) => (Array.isArray(a) ? a.length : 0)
  return [fmt.plural(n(r.models), 'model'), fmt.plural(n(r.harnesses), 'harness', 'harnesses'), fmt.plural(n(r.tasks), 'task'),
    `${fmt.int(r.runs || 0)} ${r.runs === 1 ? 'run' : 'runs'}`]
}

const byDate = (a, b) => String(b.updated || '').localeCompare(String(a.updated || '')) || String(a.name).localeCompare(String(b.name))
/** Datasets grouped by kind (KIND_ORDER), newest first inside a group: [{ kind, label, count, rows }]. */
export function groupDatasets(rows) {
  const out = []
  for (const kind of KIND_ORDER) {
    const list = (rows || []).filter((r) => (r.origin || 'recorded') === kind).sort(byDate)
    if (list.length) out.push({ kind, label: KINDS[kind].label, count: list.length, rows: list })
  }
  return out
}
/** { kind: n } for the kinds present. */
export function kindCounts(rows) {
  const out = {}
  for (const r of rows || []) { const k = r.origin || 'recorded'; out[k] = (out[k] || 0) + 1 }
  return out
}
/** Everything Find matches a dataset on, lower-cased. */
export function datasetText(r) {
  const src = r.source || {}
  return [r.name, r.display_name, r.summary, r.description, (KINDS[r.origin] || {}).label, ...(r.models || []), ...(r.harnesses || []),
    src.adapter, src.file, src.dataset, src.attribution].filter(Boolean).join(' ').toLowerCase()
}

/* ---------------------------------------------------------------- harnesses */
const SENTINEL = '+sentinel'
const toolsOf = (t) => (Array.isArray(t) ? t.length : Number.isInteger(t) && t > 0 ? t : null)
function noteOf(e, from) {
  if (!e || !text(e.notes)) return null
  const out = { notes: e.notes.trim() }
  if (Number.isInteger(e.max_steps) && e.max_steps > 0) out.max_steps = e.max_steps
  const tools = toolsOf(e.tools)
  if (tools) out.tools = tools
  if (text(e.policy)) out.policy = e.policy
  return { ...out, from }
}
/** A harness's notes: the ones its runs in `row` were recorded under, else its file in harnesses/ (the
 *  overview's list); a "<id>+sentinel" twin reads its base harness and says so. null when neither says. */
export function harnessNote(id, row, files) {
  if (!id) return null
  const notes = (row && row.harness_notes) || {}
  if (own(notes, id)) { const n = noteOf(notes[id], 'recorded'); if (n) return n }
  const base = String(id).endsWith(SENTINEL) ? String(id).slice(0, -SENTINEL.length) : null
  if (base && own(notes, base)) { const n = noteOf(notes[base], 'recorded'); if (n) return { ...n, sentinel: true } }
  const file = (files || []).find((h) => h && h.id === (base || id))
  const n = noteOf(file, 'file')
  return n ? (base ? { ...n, sentinel: true } : n) : null
}
/** "max 6 steps · 3 tools · strict policy": only the limits that were recorded. */
export function harnessFacts(n) {
  if (!n) return ''
  return [n.max_steps && `max ${fmt.plural(n.max_steps, 'step')}`, n.tools && fmt.plural(n.tools, 'tool'), n.policy && `${n.policy} policy`].filter(Boolean).join(' · ')
}

const thisYear = new Date().getUTCFullYear()
/** "Nov 14" (the year only when it is not this one), or null for no date. */
export const shortDate = (iso) => {
  const d = iso ? new Date(iso) : null
  if (!d || Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(d.getUTCFullYear() !== thisYear && { year: 'numeric' }), timeZone: 'UTC' })
}

/** A harness as an option of a native select: "tight_budget — Six model calls, then the run is cut off." (the notes cut
 *  to one short line; the whole notes are in the hover cards). Just the id when nothing is known. */
export function harnessOption(id, row, files, max = 70) {
  const n = harnessNote(id, row, files)
  if (!n) return id
  return `${id} — ${n.notes.length > max ? n.notes.slice(0, max - 1).trimEnd() + '…' : n.notes}`
}

/* ---------------------------------------------------------------- models */
const price = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? `$${+v.toFixed(3)}` : null)
/** "provider google · $0.1 / $0.4 per 1M tokens in / out · 1,048,576 context": the provider from the id, and the
 *  price and context only when /api/models lists this exact id with them (never guessed). '' when nothing is known. */
export function modelLine(id, catalog) {
  const s = String(id || '')
  const provider = s.includes('/') ? s.split('/')[0] : s.startsWith('mock') ? 'mock (offline, free)' : null
  const m = ((catalog && catalog.models) || []).find((x) => x && x.id === s)
  const pin = m && price(m.price_in), pout = m && price(m.price_out)
  return [provider && `provider ${provider}`, pin && pout && `${pin} / ${pout} per 1M tokens in / out`,
    m && Number.isInteger(m.context) && m.context > 0 && `${fmt.int(m.context)} context`].filter(Boolean).join(' · ')
}
