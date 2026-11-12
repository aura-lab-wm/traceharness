import { useMemo, useState } from 'react'
import { diffText } from '../diff'
import { alignedRows, breakOnly } from './diff-rows'
import { formatBytes, formatCount } from './format'
import './diff-view.css'

const SIGN = { delete: '−', insert: '+', context: ' ' }
const ROW_STEP = 400
const NO_FOLDS = new Set()

function Pieces({ pieces, removedBreak, addedBreak }) {
  return <span className="rg-diff-text">
    {pieces.map((piece, index) => piece.op === 'delete' ? <del key={index}>{piece.text}</del> : piece.op === 'insert' ? <ins key={index}>{piece.text}</ins> : <span key={index}>{piece.text}</span>)}
    {removedBreak && <del className="rg-diff-nl" title="Line break removed">⏎</del>}
    {addedBreak && <ins className="rg-diff-nl" title="Line break added">⏎</ins>}
  </span>
}

function Cell({ side, row, quiet }) {
  const line = side === 'before' ? row.before_line : row.after_line
  if (line === null) return <div className={'rg-diff-cell ' + side + ' empty'} aria-hidden="true" />
  const kind = row.kind === 'context' || quiet ? 'context' : side === 'before' ? 'delete' : 'insert'
  // A break-only row is shown once (the "after" cell), carrying whichever break marker applies.
  const removedBreak = row.before_newline === 'delete' && (quiet ? side === 'after' : side === 'before')
  const addedBreak = row.after_newline === 'insert' && side === 'after'
  return <div className={'rg-diff-cell ' + side} data-kind={kind}>
    <span className="rg-diff-no">{line}</span><span className="rg-diff-sign">{SIGN[kind]}</span>
    <Pieces pieces={side === 'before' ? row.before : row.after} removedBreak={removedBreak} addedBreak={addedBreak} />
  </div>
}

/** Consecutive replaced lines form one hunk, so a single column can list removals before additions. */
function grouped(rows) {
  const out = []
  for (const row of rows) {
    const last = out[out.length - 1]
    if (row.whole && Array.isArray(last)) last.push(row)
    else out.push(row.whole ? [row] : row)
  }
  return out
}

/**
 * A word-level diff of two texts, rendered as text only. One DOM serves both layouts: the
 * style sheet shows it as one column (deletions struck through, insertions underlined, "−"
 * and "+" as real characters) and, where the pane is at least 720 px wide, as two columns.
 * Unchanged runs fold into "n unchanged lines" buttons. Nothing here interprets markup.
 */
export function DiffView({ before, after, label = 'Prompt diff', beforeLabel = 'Baseline', afterLabel = 'Replacement', context = 3, maxRows = ROW_STEP,
  withheld = '', unchanged = 'No text difference from baseline.', children = null }) {
  const diff = useMemo(() => diffText(before, after), [before, after])
  const rows = useMemo(() => ({ folded: alignedRows(diff, context), all: alignedRows(diff, Infinity) }), [diff, context])
  const [expanded, setExpanded] = useState({ diff: null, folds: NO_FOLDS, limit: maxRows })
  const [layout, setLayout] = useState('split')
  const folds = expanded.diff === diff ? expanded.folds : NO_FOLDS
  const limit = expanded.diff === diff ? expanded.limit : maxRows
  const visible = useMemo(() => {
    if (!folds.size) return rows.folded
    const startOf = new Map(rows.all.map((row, index) => [row.before_line, index]))
    return rows.folded.flatMap((row) => row.kind === 'fold' && folds.has(row.before_line) ? rows.all.slice(startOf.get(row.before_line), startOf.get(row.before_line) + row.folded) : [row])
  }, [rows, folds])
  const shown = visible.slice(0, limit)
  const open = (at) => setExpanded({ diff, folds: new Set([...folds, at]), limit })
  const line = (row) => row.kind === 'fold'
    ? <div className="rg-diff-row" data-kind="fold" key={'f' + row.before_line}><button type="button" className="rg-diff-fold" onClick={() => open(row.before_line)}>{formatCount(row.folded)} unchanged lines</button></div>
    : <div className="rg-diff-row" data-kind={breakOnly(row) ? 'context' : row.kind} data-break={breakOnly(row) ? 'true' : undefined} key={row.before_line + ':' + row.after_line}><Cell side="before" row={row} quiet={breakOnly(row)} /><Cell side="after" row={row} quiet={breakOnly(row)} /></div>
  const digits = String(Math.max(diff.before.lines, diff.after.lines, 1)).length
  return <div className="rg-diff" role="group" aria-label={label} data-layout={layout} style={{ '--rig-diff-no': Math.max(2, digits) + 'ch' }}>
    <div className="rg-diff-head">
      <span className="rg-diff-sides"><b>{beforeLabel}</b> → <b>{withheld ? 'Disabled' : afterLabel}</b></span>
      <span className="rg-diff-stats">{formatBytes(diff.before.bytes)} → {withheld ? 'withheld' : formatBytes(diff.after.bytes)} exact{!withheld && diff.changed ? ' · −' + formatCount(diff.stats.delete_bytes) + ' +' + formatCount(diff.stats.insert_bytes) + ' bytes' : ''}</span>
      {!withheld && diff.changed && <span className="rg-seg rg-diff-switch" role="group" aria-label="Diff layout">
        <button type="button" className={layout === 'unified' ? 'on' : ''} aria-pressed={layout === 'unified'} onClick={() => setLayout('unified')}>Unified</button>
        <button type="button" className={layout === 'split' ? 'on' : ''} aria-pressed={layout === 'split'} onClick={() => setLayout('split')}>Split</button>
      </span>}
    </div>
    {withheld ? <p className="rg-diff-note"><b>Disabled: the baseline text is withheld.</b> {withheld}</p>
      : !diff.changed ? <><p className="rg-diff-note">{unchanged}</p>{children}</>
        : <>
          {diff.granularity === 'line' && <p className="rg-diff-note">Part of this change is shown at line level: it is too large for a word-level diff.</p>}
          {diff.granularity === 'none' && <p className="rg-diff-note">This change is too large to align. The whole text is shown as removed and then added.</p>}
          <div className="rg-diff-rows">{grouped(shown).map((entry) => Array.isArray(entry)
            ? <div className="rg-diff-hunk" key={'h' + entry[0].before_line}>{entry.map(line)}</div> : line(entry))}</div>
          {visible.length > shown.length && <button type="button" className="rg-btn rg-diff-more" onClick={() => setExpanded({ diff, folds, limit: limit + Math.max(maxRows, ROW_STEP) })}>Show more of this diff ({formatCount(visible.length - shown.length)} rows hidden)</button>}
        </>}
  </div>
}
