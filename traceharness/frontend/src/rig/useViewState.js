/* Rig · useViewState.js — one hook per page for the selections it keeps in its tab spec (viewState.js).

     const [vs, setVs] = useViewState(spec, { sort: 'updated', dir: 'desc', kind: 'all' }, 'home')
     setVs({ kind: 'mock' })            // merges; the spec is rewritten in place (no history entry, no scroll)

   A spec that carries a state wins (a link, Back). A spec without one (the rail's link, a new condition)
   keeps what the page last showed, remembered per `memKey` like useTabState, and writes it back to the
   spec, so the address bar always says what the page shows. Outside the shell (a bare render) the
   state is the page's own. */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useRig, useTabState, usePane } from './context'
import { formatVS, parseVS, vsOf, withVS } from './viewState'

/** Only the keys the page has: a key from another page or an old link is dropped, never carried on. */
const own = (defaults, vs) => Object.fromEntries(Object.entries(vs || {}).filter(([k]) => Object.hasOwn(defaults, k)))

export function useViewState(spec, defaults, memKey) {
  const { rewriteTab: rewriteAny } = useRig()
  // only the tab in this page's own pane: the same page in the other pane keeps its own selections
  const { pi } = usePane()
  const rewriteTab = (from, to) => rewriteAny(from, to, pi)
  const raw = vsOf(spec)
  const [mem, setMem] = useTabState(memKey, '\u0000vs', null)
  const [state, setState] = useState(() => ({ ...defaults, ...own(defaults, raw ? parseVS(raw) : mem) }))
  // a link or Back changed the state under the page: follow it; a spec that lost it keeps the page's
  const seen = useRef(raw)
  useEffect(() => {
    if (raw === seen.current) return
    seen.current = raw
    if (raw) setState({ ...defaults, ...own(defaults, parseVS(raw)) })
  }, [raw]) // eslint-disable-line react-hooks/exhaustive-deps
  const want = formatVS(state, defaults)
  useEffect(() => {
    setMem(state)
    if (want !== raw) rewriteTab(spec, withVS(spec, want))
  }, [want]) // eslint-disable-line react-hooks/exhaustive-deps
  // the spec came back without a state (a retarget): write the page's state into it again
  const mounted = useRef(false)
  useEffect(() => {
    if (mounted.current && !raw && want) rewriteTab(spec, withVS(spec, want))
    mounted.current = true
  }, [spec]) // eslint-disable-line react-hooks/exhaustive-deps
  const set = useCallback((patch) => setState((prev) => ({ ...prev, ...own(defaults, typeof patch === 'function' ? patch(prev) : patch) })), []) // eslint-disable-line react-hooks/exhaustive-deps
  return [state, set]
}
