/* ====================================================================================
   Rig · AskBar.jsx — the slim context bar every data page carries under its title: a glyph, the
   Asking sentence (dataset, model, harness; the oracle opens the status bar menu) and, on the
   right, the figures of the condition in focus with one way into its runs. Styles: views/askbar.css.
   ==================================================================================== */
import { AskingSentence, Caret, Go, Icon } from './ui'
import { useRig } from './context'
import { makeSpec } from './route'
import { conditionRuns, tally, metricsCell, fmt } from './data'
import './views/askbar.css'

// loader rays while the answer is read; a still question mark once it is there
const SPARK = 'M12 3v4M12 17v4M3 12h4M17 12h4M6.3 6.3l2.1 2.1M15.6 15.6l2.1 2.1M6.3 17.7l2.1-2.1M15.6 8.4l2.1-2.1'
const ASK = 'M9.1 9a3 3 0 0 1 5.8 1c0 2-3 2.5-3 4.5M12 18h.01M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z'

/** <AskBar dir model harness right? busy? pooled?/> — `right` holds figures (mono, muted) and at most one small action;
 *  `busy` while the answer below it is being read; `pooled` when that answer pools every model and harness. */
export function AskBar({ dir, model, harness, right, busy, pooled, el = 'ask-bar' }) {
  return (
    <div className="rg-ask" data-el={el} aria-busy={busy || undefined}>
      <svg className={`rg-ico rg-ask-g${busy ? ' spin' : ''}`} width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><path d={busy ? SPARK : ASK} /></svg>
      <AskingSentence dir={dir} model={model} harness={harness} pooled={pooled} />
      {right && <div className="rg-ask-r">{right}</div>}
    </div>
  )
}

/** <OracleButton el?/> — the oracle as an inline value for a meta line under a page title (run, step,
 *  compare). Drawn like the oracle in the bar and opens the same status bar menu. */
export function OracleButton({ el }) {
  const { oracle, openOracle } = useRig()
  return <button type="button" className="rg-orc" data-el={el} aria-haspopup="dialog" aria-label={`Oracle: ${oracle}. Change the oracle`} data-hint="Change the oracle (the status bar menu)" onClick={(e) => openOracle && openOracle(e.currentTarget)}>{oracle}<Caret /></button>
}

/** The condition in focus, for the right of the bar: pass@1 under the current oracle, the hidden-oracle
 *  95% interval from /metrics, the number of known grades and a way into its runs. Nothing until the
 *  run index is here. */
export function AskFigures({ dir, c, runs, metrics }) {
  const { oracle } = useRig()
  if (!runs || !c) return null
  const list = conditionRuns(runs, c.model, c.harness)
  if (!list.length) return <span>not run</span>
  const o = tally(list, oracle)
  const ci = oracle === 'hidden' ? (metricsCell(metrics, c.model, c.harness) || {}).ci95 : null
  return (<>
    <span data-el="ask-pass1">pass@1 <b>{fmt.pct(o.rate)}</b></span>
    {ci && ci.length === 2 && <span>95% CI <b>{(ci[0] * 100).toFixed(1)}–{(ci[1] * 100).toFixed(1)}</b></span>}
    <span data-hint="known grades under this oracle">n <b>{fmt.int(o.known)}</b></span>
    <Go spec={makeSpec('field', dir, c.model, c.harness)} className="rg-btn" el="ask-open-runs">Open {fmt.int(list.length)} {list.length === 1 ? 'run' : 'runs'}<Icon name="right" size={12} /></Go>
  </>)
}
