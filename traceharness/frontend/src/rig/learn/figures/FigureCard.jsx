/* Rig · learn/figures/FigureCard.jsx — the one frame every article figure is drawn in.
   Top: tabs (which data) on the left, Chart / Table on the right. Then the legend chips, the drawing or its
   table, the controls (Play / Step, a slider), a readout line, and the caption:
     "Figure N. <caption> · data: <dataset, filter> · after Figure k of <source> [n]".
   The card fades and rises once when it first scrolls into view (motion.js useReveal). README.md in this folder
   says how to add a figure. */
import { useContext, useId, useState } from 'react'
import { TableScroll, EntityDot } from '../../ui'
import { BrandMark } from '../../brand/BrandMark'
import { Prose, CiteContext, CiteMark } from '../Prose'

const cx = (...a) => a.filter(Boolean).join(' ')

/** Segmented buttons; the chosen one says it is shown and does nothing more. */
function Choice({ label, options, value, onChange, el, className }) {
  return (
    <div className={cx('rg-lfig-seg', className)} role="group" aria-label={label} data-el={el}>
      {options.map(([v, words]) => {
        const on = v === value
        return (
          <button key={v} type="button" className={cx(on && 'on')} aria-pressed={on} data-hint={on ? `${words} · shown` : undefined}
            onClick={() => { if (!on) onChange(v) }}>{words}</button>
        )
      })}
    </div>
  )
}

/** "after Figure 4 of τ-bench [3]": the source this figure redraws an idea from. */
function After({ after }) {
  const c = useContext(CiteContext)
  const src = c && c.sources.find((s) => s.n === after.source)
  const name = src ? String(src.title).split(':')[0] : `source ${after.source}`
  return <span className="rg-lfig-after" data-el="learn-fig-after"> · after Figure {after.figure} of {name}<CiteMark n={after.source} /></span>
}

/** A small table of numbers for the Table view: cols [label…], rows [[cell…]]; the first cell is the row's name. */
export function FigTable({ caption, cols, rows, tall }) {
  return (
    <TableScroll label={caption} maxHeight={tall ? '20rem' : undefined}>
      <table className="rg-tbl rg-lfig-tbl">
        <caption className="sr-only">{caption}</caption>
        <thead><tr>{cols.map((c) => <th key={c} scope="col">{c}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i}>{r.map((v, j) => (j ? <td key={j}>{v}</td> : <th key={j} scope="row">{v}</th>))}</tr>)}</tbody>
      </table>
    </TableScroll>
  )
}

/** <FigureCard fig n reveal tabs? tab? onTab? legend? controls? readout? chart table?/> */
export function FigureCard({ fig, n, reveal, tabs, tab, onTab, legend, controls, readout, chart, table, aside }) {
  const [view, setView] = useState('chart')
  const id = useId()
  const showTable = table && view === 'table'
  return (
    <figure ref={reveal && reveal.ref} className="rg-lfig" data-el="learn-figure" data-kind={fig.kind} id={`fig-${fig.id}`} aria-labelledby={`${id}-c`}>
      {fig.title && <p className="rg-lfig-title">{fig.title}</p>}
      {(tabs || table) && (
        <div className="rg-lfig-bar">
          {tabs && <Choice label={`Figure ${n}: data`} options={tabs} value={tab} onChange={onTab} el="fig-tabs" className="rg-lfig-tabs" />}
          {table && <Choice label={`Figure ${n}: chart or table`} options={[['chart', 'Chart'], ['table', 'Table']]} value={view} onChange={setView} el="fig-view" className="rg-lfig-view" />}
        </div>
      )}
      {legend && !showTable && (
        <ul className="rg-lfig-legend" aria-label="Legend">{legend.map((l) => <li key={l.label}>{l.entity ? <EntityDot kind={l.entity} name={l.label} /> : <i className={cx('rg-lfig-sw', l.tone)} aria-hidden="true" />}{l.brand && <BrandMark kind="model" name={l.brand} />}{l.label}</li>)}</ul>
      )}
      {showTable ? <div className="rg-lfig-body" data-el="fig-table">{table}</div> : (
        <div className={cx('rg-lfig-body', aside && 'split')} data-el="fig-chart">
          <div className="rg-lfig-draw">{chart}</div>
          {aside}
        </div>
      )}
      {controls && !showTable && <div className="rg-lfig-ctl">{controls}</div>}
      {readout != null && <p className="rg-lfig-readout" aria-live="polite" data-el="fig-readout">{readout}</p>}
      <figcaption id={`${id}-c`} className="rg-lfig-cap">
        <b>Figure {n}.</b> <Prose text={fig.caption} />
        {fig.data_note && <span className="rg-lfig-data"> · data: {fig.data_note}</span>}
        {fig.after && <After after={fig.after} />}
      </figcaption>
    </figure>
  )
}
