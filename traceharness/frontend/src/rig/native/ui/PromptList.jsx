import { useEffect, useId, useLayoutEffect, useRef } from 'react'
import { formatBytes, formatCount, promptDisplay, STATE_LABELS } from './format'

export const LIST_PAGE = 100
const PAGE_KEYS = 10

function rowState(row) {
  if (row.block.capability === 'observed-only') return 'Observed only'
  if (row.block.capability === 'unavailable') return 'Unavailable'
  return STATE_LABELS[row.action] || 'Baseline'
}

/** One line a screen reader hears for a row: everything the row shows, in words. */
function rowName(row, flags) {
  const placeholders = row.block.required_placeholders.length
  return [promptDisplay(row.block).title, row.block.class_name, rowState(row), formatBytes(row.bytes), 'about ' + formatCount(row.est_tokens) + ' tokens (estimate)',
    placeholders ? placeholders + ' placeholder' + (placeholders === 1 ? '' : 's') : '',
    row.block.occurrence_count > 1 ? row.block.occurrence_count + ' occurrences' : '',
    flags.finding ? 'has audit findings' : '', flags.unapplied ? 'unapplied edit' : ''].filter(Boolean).join(', ')
}

/**
 * The fragment list: a multi-select listbox with ONE tab stop. Arrow, Home, End and Page keys
 * move the active row, Enter opens the inspector, Space toggles selection. Rows render 100 at a
 * time (a sentinel and an explicit button load more), so a 2,700-block inventory stays light.
 * The checkbox in each row is a pointer target; keyboard and assistive technology use the listbox.
 */
export function PromptList({ rows, total, patchableCount, shown, onShow, activeId, onActive, inspectedId, selected, onToggle, onOpen,
  onSelectFiltered, onClearSelection, onClearFilters, filtered, locked, findingIds, unappliedIds, listRef, scrollRef, bulk = null, searching = false }) {
  const baseId = useId()
  const sentinel = useRef(null)
  const visible = rows.slice(0, shown)
  const remaining = rows.length - visible.length
  const activeIndex = rows.findIndex((row) => row.block.id === activeId)
  const optionId = (row) => baseId + 'o' + row.index
  const selectedSet = selected instanceof Set ? selected : new Set(selected)

  useEffect(() => {
    const node = sentinel.current
    if (!node || !remaining || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver((entries) => { if (entries.some((entry) => entry.isIntersecting)) onShow(shown + LIST_PAGE) }, { root: scrollRef?.current || null, rootMargin: '240px' })
    observer.observe(node)
    return () => observer.disconnect()
  }, [remaining, shown, onShow, scrollRef])

  useLayoutEffect(() => {
    if (activeIndex < 0 || document.activeElement !== listRef?.current) return
    const node = document.getElementById(optionId(rows[activeIndex]))
    if (node && typeof node.scrollIntoView === 'function') node.scrollIntoView({ block: 'nearest' })
  // The active row is identified by id; rows and ids are stable between these changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId])

  function move(index) {
    if (!rows.length) return
    const next = Math.max(0, Math.min(rows.length - 1, index))
    if (next >= shown) onShow(Math.ceil((next + 1) / LIST_PAGE) * LIST_PAGE)
    onActive(rows[next].block.id)
  }
  function keyDown(event) {
    if (event.altKey || event.defaultPrevented) return
    const modifier = event.ctrlKey || event.metaKey
    const current = activeIndex < 0 ? -1 : activeIndex
    const handled = () => { event.preventDefault(); event.stopPropagation() }
    if (modifier && event.key.toLowerCase() === 'a') { handled(); if (!locked) onSelectFiltered() }
    else if (modifier) return
    else if (event.key === 'ArrowDown') { handled(); move(current + 1) }
    else if (event.key === 'ArrowUp') { handled(); move(current < 0 ? 0 : current - 1) }
    else if (event.key === 'Home') { handled(); move(0) }
    else if (event.key === 'End') { handled(); move(rows.length - 1) }
    else if (event.key === 'PageDown') { handled(); move(current + PAGE_KEYS) }
    else if (event.key === 'PageUp') { handled(); move(current < 0 ? 0 : current - PAGE_KEYS) }
    else if (event.key === 'Enter') { if (current >= 0) { handled(); onOpen(rows[current].block.id, 'keyboard') } }
    else if (event.key === ' ') { if (current >= 0) { handled(); const row = rows[current]; if (!locked && row.block.capability === 'patchable') onToggle(row.block.id) } }
  }
  function focusList() {
    if (activeIndex < 0 && rows.length) onActive(inspectedId && rows.some((row) => row.block.id === inspectedId) ? inspectedId : rows[0].block.id)
  }

  return <div className="rg-native-list" ref={scrollRef} data-searching={searching ? 'true' : undefined}>
    <div className="rg-native-list-head">
      <span className="rg-native-list-count" role="status" title={formatCount(patchableCount) + ' of them patchable'}>{formatCount(rows.length)} of {formatCount(total)}<span className="sr-only"> fragments match{filtered ? ' the filters' : ''}, {formatCount(patchableCount)} patchable</span></span>
      <span className="rg-native-list-actions">
        <button type="button" className="rg-btn" disabled={locked || !patchableCount} onClick={onSelectFiltered}>Select filtered</button>
        <button type="button" className="rg-btn" aria-label="Clear selection" disabled={locked || !selectedSet.size} onClick={onClearSelection}>Clear</button>
      </span>
    </div>
    <div className="rg-native-rows" role="listbox" aria-label="Prompt list" aria-multiselectable="true" tabIndex={0} ref={listRef}
      aria-activedescendant={activeIndex >= 0 && activeIndex < visible.length ? optionId(rows[activeIndex]) : undefined} onKeyDown={keyDown} onFocus={focusList}>
      {visible.map((row, position) => {
        const block = row.block, display = promptDisplay(block), patchable = block.capability === 'patchable'
        const flags = { finding: findingIds.has(block.id), unapplied: unappliedIds.has(block.id) }
        const placeholders = block.required_placeholders.length
        return <div key={block.id} id={optionId(row)} role="option" className="rg-native-row" aria-selected={selectedSet.has(block.id)} aria-setsize={rows.length} aria-posinset={position + 1}
          aria-label={rowName(row, flags)} aria-current={inspectedId === block.id ? 'true' : undefined} data-active={activeId === block.id ? 'true' : undefined}
          data-state={patchable ? row.action || 'keep' : 'read-only'} onClick={() => { onActive(block.id); onOpen(block.id, 'pointer') }}>
          <label className="rg-native-check" onClick={(event) => event.stopPropagation()}>
            <input type="checkbox" tabIndex={-1} aria-label={'Select prompt ' + block.title} disabled={locked || !patchable} checked={selectedSet.has(block.id)} onChange={() => onToggle(block.id)} />
          </label>
          <span className="rg-native-row-main">
            <strong title={block.title}>{display.title}</strong>
            <span className="rg-native-row-meta">
              <span>{block.class_name}</span><span className="rg-native-row-state">{rowState(row)}</span><span>{formatBytes(row.bytes)}</span>
              <span title="Estimate: characters divided by 3.9. Not billed tokens. Measured input tokens appear in run results.">≈ {formatCount(row.est_tokens)} tokens</span>
              {placeholders > 0 && <span className="rg-native-mark" title={placeholders + ' placeholder' + (placeholders === 1 ? '' : 's') + ' must be preserved'}>{'{' + placeholders + '}'}</span>}
              {block.occurrence_count > 1 && <span className="rg-native-mark" title={block.occurrence_count + ' located occurrences'}>×{block.occurrence_count}</span>}
              {flags.finding && <span className="rg-native-mark warn" title="Has audit findings">!</span>}
              {flags.unapplied && <span className="rg-native-mark edit" title="Unapplied edit">•</span>}
            </span>
            {row.snippet && <span className="rg-native-row-snip"><span className="rg-native-snip-field">{row.snippet.field === 'new' ? 'replacement' : row.snippet.field}</span> {row.snippet.before}<mark>{row.snippet.match}</mark>{row.snippet.after}</span>}
          </span>
        </div>
      })}
    </div>
    {!rows.length && <p className="rg-native-empty">No fragment matches. <button type="button" className="rg-btn" onClick={onClearFilters}>Clear filters</button></p>}
    {remaining > 0 && <div className="rg-native-more" ref={sentinel}>
      <button type="button" className="rg-btn" onClick={() => onShow(shown + LIST_PAGE)}>Show {formatCount(Math.min(LIST_PAGE, remaining))} more</button>
      <span>{formatCount(visible.length)} of {formatCount(rows.length)} shown</span>
    </div>}
    {bulk}
  </div>
}
