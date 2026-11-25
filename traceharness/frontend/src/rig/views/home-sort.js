/* Rig · views/home-sort.js — the dataset list's columns and their order. PURE.
   Every column sorts. A first click sorts numbers and dates biggest first and words A to Z; a second
   click on the same column reverses it. A dataset with no value (no pass rate, no date) goes last in
   either direction, and ties keep A-to-Z by name, so the list never jumps between equal rows.
   The sort and the kind filter live in the tab spec (viewState.js): home:sort.runs,dir.asc,kind.mock. */

/** The page as it first opens: newest first, every kind. */
export const HOME_VS = Object.freeze({ sort: 'updated', dir: 'desc', kind: 'all' })

const len = (a) => (Array.isArray(a) ? a.length : 0)
const time = (iso) => { const t = iso ? Date.parse(iso) : NaN; return Number.isNaN(t) ? null : t }

/** [id, header, first direction, the value it sorts by (null = no value)] */
export const COLUMNS = [
  { id: 'name', label: 'Name', first: 'asc', by: (r) => String(r.name || '').toLowerCase() },
  { id: 'kind', label: 'Kind', first: 'asc', by: (r) => String(r.origin || (r.kind === 'mock' ? 'mock' : 'recorded')) },
  { id: 'runs', label: 'Runs', first: 'desc', num: true, by: (r) => r.runs || 0 },
  { id: 'tasks', label: 'Tasks', first: 'desc', num: true, by: (r) => len(r.tasks) },
  // a count followed by its names: the column reads from the left, its header too (the count sits in a fixed slot)
  { id: 'models', label: 'Models', first: 'desc', by: (r) => len(r.models) },
  { id: 'harnesses', label: 'Harnesses', first: 'desc', by: (r) => len(r.harnesses) },
  { id: 'pass', label: 'Pass rate', first: 'desc', by: (r) => (typeof r.pass_rate === 'number' ? r.pass_rate : null) },
  { id: 'updated', label: 'Updated', first: 'desc', num: true, by: (r) => time(r.updated) },
]
const BY_ID = Object.fromEntries(COLUMNS.map((c) => [c.id, c]))

/** The sort a (possibly hand-edited) state asks for, or newest first. */
export function readSort(vs) {
  if (!vs || !BY_ID[vs.sort]) return { sort: HOME_VS.sort, dir: HOME_VS.dir }
  return { sort: vs.sort, dir: vs.dir === 'asc' || vs.dir === 'desc' ? vs.dir : BY_ID[vs.sort].first }
}

/** A new array in that order; the given one is left alone. */
export function sortRows(rows, sort, dir) {
  const by = (BY_ID[sort] || BY_ID[HOME_VS.sort]).by
  const sign = dir === 'asc' ? 1 : -1
  const name = (r) => String(r.name || '').toLowerCase()
  return [...rows].sort((a, b) => {
    const x = by(a), y = by(b)
    if (x == null || y == null) return (x == null) - (y == null) || name(a).localeCompare(name(b))
    return (x < y ? -1 : x > y ? 1 : 0) * sign || name(a).localeCompare(name(b))
  })
}

/** The sort after a click on column `id`. */
export const nextSort = (cur, id) => (cur.sort === id ? { sort: id, dir: cur.dir === 'asc' ? 'desc' : 'asc' } : { sort: id, dir: BY_ID[id].first })
