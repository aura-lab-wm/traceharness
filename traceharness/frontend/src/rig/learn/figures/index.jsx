/* Rig · learn/figures/index.jsx — an article figure, by its kind.
   Kinds live in ./kinds/*.jsx; each exports KINDS = { <kind>: { Figure, Preview?, headlines? } } and is listed once
   below (a static import, so the dead-surface check sees it). Data lives in ./data/<id>.json, written by
   scripts/learn_figures.py; an article's figure names it with `data_file`, and the folder is read whole. README.md has
   the steps. */
import { FigureCard } from './FigureCard'
import { Prose } from '../Prose'
import * as legacy from './kinds/legacy'
import * as runSteps from './kinds/run-steps'
import * as callTokens from './kinds/call-tokens'
import * as repeatDots from './kinds/repeat-dots'
import * as passK from './kinds/pass-k'
import * as spreadRuns from './kinds/spread-runs'
import * as riskSteps from './kinds/risk-steps'
import * as catchBlock from './kinds/catch-block'
import * as pairedCi from './kinds/paired-ci'
import * as poolWeights from './kinds/pool-weights'
import * as detectN from './kinds/detect-n'
import * as taskInterval from './kinds/task-interval'
import * as heatGrid from './kinds/heat-grid'
import * as varShare from './kinds/var-share'
import * as gradeSets from './kinds/grade-sets'
import * as gradeCounts from './kinds/grade-counts'
import * as patchRuns from './kinds/patch-runs'
import * as slopeGrades from './kinds/slope-grades'
import * as probeFlow from './kinds/probe-flow'
import * as harnessFields from './kinds/harness-fields'
import * as harnessEffect from './kinds/harness-effect'
import * as wizardSteps from './kinds/wizard-steps'
import * as runReplay from './kinds/run-replay'
// figs-a: articles 02, 03, 05, 06
import * as labelFlow from './kinds/label-flow'
import * as labelMix from './kinds/label-mix'
import * as importPipeline from './kinds/import-pipeline'
import * as keepMatrix from './kinds/keep-matrix'
import * as cumTokens from './kinds/cum-tokens'
import * as spreadPairs from './kinds/spread-pairs'
import * as phaseBand from './kinds/phase-band'
import * as afterHist from './kinds/after-hist'
const FIGS_A = [labelFlow, labelMix, importPipeline, keepMatrix, cumTokens, spreadPairs, phaseBand, afterHist]

const KIND_MODULES = [
  legacy, runSteps, callTokens, repeatDots, passK, spreadRuns, riskSteps, catchBlock, pairedCi, poolWeights, detectN, taskInterval, heatGrid, varShare, gradeSets, gradeCounts, patchRuns, slopeGrades, probeFlow, harnessFields, harnessEffect, wizardSteps, runReplay, ...FIGS_A]
const dataModules = import.meta.glob('./data/*.json', { eager: true, import: 'default' })

/** kind -> { Figure, Preview?, headlines? } */
export const KINDS = Object.freeze(Object.assign({}, ...KIND_MODULES.map((m) => m.KINDS || {})))
/** data file id -> its JSON */
export const FIGURE_DATA = Object.freeze(Object.fromEntries(Object.entries(dataModules).map(([p, d]) => [p.replace(/^.*\/|\.json$/g, ''), d])))

/** The data a figure draws: its data file, else the data written into the article. */
export const figureData = (fig) => (fig.data_file ? FIGURE_DATA[fig.data_file] || null : fig.data || {})

/** <Figure fig n/> — figure number n of its article. */
export function Figure({ fig, n }) {
  const k = KINDS[fig.kind]
  const d = figureData(fig)
  if (!k || !d) {
    return <FigureCard fig={fig} n={n} chart={<p className="rg-lfig-missing">This figure is not drawn yet ({k ? `its data ${fig.data_file} is missing` : `no drawing for ${fig.kind}`}).</p>} />
  }
  return <k.Figure fig={fig} n={n} d={d} />
}

/** <FigurePreview fig/> — the small drawing on the article's card in the Learn index (aria-hidden). */
export function FigurePreview({ fig }) {
  const k = fig && KINDS[fig.kind]
  const d = fig && figureData(fig)
  return (
    <svg className="rg-learn-prev" viewBox="0 0 120 56" preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false">
      {k && k.Preview && d ? <k.Preview fig={fig} d={d} /> : <BlankPreview />}
    </svg>
  )
}
/** An article with no figure yet: three lines of text. */
function BlankPreview() {
  return <g className="rg-prev-blank">{[14, 26, 38].map((y, i) => <rect key={y} x="14" y={y} width={[92, 80, 56][i]} height="4" rx="2" />)}</g>
}

export { Prose }
