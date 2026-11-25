/* Rig · DemoBanner.jsx — one thin line on the bundled mock datasets, so a scripted control is never
   read as a measurement of a real model. Styles: DemoBanner.css. */
import { Go } from './ui'
import './DemoBanner.css'

export const DEMO_DATASETS = new Set(['prerecorded_mock', 'prerecorded_mock_weak', 'families_mock', 'demo_mock'])
/** A bundled mock dataset, by name or by the overview's kind. */
export const isDemoData = (dir, row) => DEMO_DATASETS.has(dir) || (!!row && row.kind === 'mock')

export function DemoBanner({ dir, row }) {
  if (!isDemoData(dir, row)) return null
  return (
    <aside className="rg-demo" data-el="demo-banner" aria-label="Demo data">
      <b>Demo data</b>
      <span>Scripted mock agents with designed failure rates. They test the measurement, not a model: all Pass or all Fail here means the grading broke.</span>
      <Go spec="sources" className="rg-tlink rg-demo-go">Add your own data</Go>
    </aside>
  )
}
