import { Component, useEffect } from 'react'
import RigApp from './rig/RigApp'
import { isRigHash, makeSpec } from './rig/route'

/* One UI. TraceHarness serves the Rig workbench and nothing else.

   The console that used to live at #/ is retired, but its links are not: a bookmark, a handout
   or an exported report may still carry #/s/<dir>/judge or #/run/<dir>/<id>. Each old address is
   rewritten once, in place (replaceState, so Back does not bounce), to the Rig document that
   replaced it. Anything unrecognised opens the Rig's home rather than a blank page. */

// The six method steps of the old study page, as the Rig's analysis views name them.
const STEP_VIEW = {
  family: 'family', overview: null, run: 'setup', new: 'setup', measure: 'outcomes',
  attribute: 'delta', judge: 'judge', experiment: 'fit', close: 'report',
}

const dec = (s) => { try { return decodeURIComponent(s) } catch { return s } }

/** The Rig hash that replaces a legacy console hash. Pure; never throws. */
export function legacyToRig(hash) {
  const raw = String(hash || '').replace(/^#\/?/, '')
  if (isRigHash('#/' + raw)) return '#/' + raw
  const [path, query] = raw.split('?')
  const params = new URLSearchParams(query || '')
  const [a, ...rest] = path.split('/').filter(Boolean)
  const [b, c, d] = rest.map(dec)
  const model = params.get('model'), harness = params.get('harness'), dataset = params.get('dataset')
  const rig = (spec) => '#/rig/' + spec
  switch (a) {
    case undefined: case 'home': case 'studies': case 'new':
      return rig('home')
    case 'workspace': case 'designs':
      return dataset ? rig(makeSpec('ds', dataset, model, harness)) : rig('home')
    case 's': {
      if (!b) return rig('home')
      const view = c ? STEP_VIEW[c] : null
      return view ? rig(makeSpec('an', b, view, model, harness)) : rig(makeSpec('ds', b, model, harness))
    }
    case 'field': {
      const run = params.get('run')
      return b ? rig(run ? makeSpec('run', run) : makeSpec('field', b)) : rig('home')
    }
    case 'run': case 'spans': return c ? rig(makeSpec('run', c)) : rig('home')
    case 'span': return c ? rig(makeSpec('span', c, d || '0')) : rig('home')
    case 'compare': return c ? rig(makeSpec('cmp', c, d)) : (b ? rig(makeSpec('field', b)) : rig('home'))
    case 'fork': return c ? rig(makeSpec('fork', c)) : rig('home')
    case 'load': return rig('sources')
    case 'start': return rig('guide')
    case 'fixed': return rig('shallowCards')
    case 'minimal': return rig('shallowWizard')
    case 'customize': return rig(makeSpec('blocks', 'customize'))
    case 'canvas': case 'sentinel': case 'sources': case 'capture': case 'settings': case 'package':
      return rig(a)
    default: return rig('home')
  }
}

function normalise() {
  if (typeof location === 'undefined' || isRigHash(location.hash)) return false
  const next = legacyToRig(location.hash)
  try { history.replaceState(null, '', next) } catch { location.hash = next }
  return true
}

/* The last line of defence. Every document tab already has its own boundary; this one catches a
   crash in the shell itself (titlebar, rail, status bar, palette) so the page is never blank. It styles itself from the
   global tokens in index.css, not the Rig's stylesheet, so it draws even if that is what failed. */
const RIG_KEYS = ['rig.theme', 'rig.density', 'rig.motion']
export class AppBoundary extends Component {
  constructor(p) { super(p); this.state = { error: null } }
  static getDerivedStateFromError(error) { return { error } }
  componentDidCatch(e) { if (typeof console !== 'undefined') console.warn('[traceharness] shell crashed:', e && e.message) }
  reset = () => {
    try { for (const k of RIG_KEYS) localStorage.removeItem(k) } catch { /* storage blocked: nothing to reset */ }
    try { history.replaceState(null, '', '#/rig/home') } catch { location.hash = '#/rig/home' }
    this.setState({ error: null })
  }
  render() {
    if (!this.state.error) return this.props.children
    // Literal values on purpose: the --rig-* scale lives in rig.css, which may be what failed. They
    // follow that scale (4 px steps, 14 / 12 px type, 8 px radius, 44 px targets).
    const box = { position: 'fixed', inset: 0, display: 'flex', overflow: 'auto', background: 'var(--rig-bg-d)', color: 'var(--rig-text-d)', font: '14px/1.5 var(--font-sans)', padding: 16 }
    const card = { boxSizing: 'border-box', margin: 'auto', width: '100%', maxWidth: 560, padding: 24, border: '1px solid var(--rig-line-d)', borderRadius: 12, background: 'var(--rig-panel-d)' }
    const btn = { font: '500 13px/1 var(--font-sans)', minHeight: 44, padding: '0 16px', borderRadius: 8, border: '1px solid var(--rig-line2-d)', background: 'var(--rig-panel2-d)', color: 'inherit', cursor: 'pointer' }
    return (
      <div style={box} data-el="app-crash" role="alert">
        <div style={card}>
          <h1 style={{ font: '500 20px/1.2 var(--font-sans)', margin: '0 0 8px' }}>TraceHarness hit an error while drawing the workbench.</h1>
          <p style={{ margin: '0 0 16px', color: 'var(--rig-dim-d)', maxWidth: '68ch' }}>Your recorded runs are untouched: this is the page, not the data. Reset the layout to reopen the workbench on the datasets page, or reload to try the same address again.</p>
          <p style={{ margin: '0 0 24px', padding: '8px 12px', borderRadius: 8, background: 'var(--rig-panel2-d)', font: '12px/1.7 var(--font-mono)', color: 'var(--rig-mute-d)', overflowWrap: 'anywhere' }}>{String(this.state.error.message || this.state.error)}</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <button type="button" style={{ ...btn, background: 'var(--rig-sel-d)', borderColor: 'var(--rig-sel-d)', color: 'var(--rig-sel-ink-d)' }} onClick={this.reset}>Reset layout</button>
            <button type="button" style={btn} onClick={() => location.reload()}>Reload</button>
          </div>
        </div>
      </div>
    )
  }
}

export default function App() {
  try { normalise() } catch { /* a hash the browser refuses to rewrite still opens the Rig */ }   // before the Rig reads the hash; idempotent
  useEffect(() => {
    // A legacy link followed while the Rig is open: rewrite it, then let the Rig hear the change.
    const on = () => { if (normalise()) window.dispatchEvent(new HashChangeEvent('hashchange')) }
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  return <AppBoundary><RigApp /></AppBoundary>
}
