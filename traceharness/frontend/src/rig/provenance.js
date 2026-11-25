import { fmt } from './data'
export const SWE_SOURCE = 'nebius/SWE-agent-trajectories'
export const SWE_URL = 'https://huggingface.co/datasets/nebius/SWE-agent-trajectories'
export const providerOf = (run) => (run?.raw || run)?.provider || ''
export const isSweRun = (run) => providerOf(run) === SWE_SOURCE
export const suiteLabel = (runs, oracle) => runs?.length && runs.every(isSweRun)
  ? ({ hidden: 'SWE-bench evaluation label', visible: 'last-test-output heuristic', strengthened: 'strengthened grade (not supplied)' }[oracle] || oracle)
  : `${oracle} oracle`
/** How many runs carry token counts, in words ("token counts for 1,190 of 1,200 runs"). */
export const tokenCoverage = (stats) => stats.estimated
  ? `token counts for ${fmt.of(stats.measured, stats.n)} runs; estimated for ${fmt.int(stats.estimated)}`
  : `token counts for ${fmt.of(stats.rec, stats.n)} runs`
/** The same, in the 0.6.0 words the guides use ("usage recorded 1,190/1,200"): the hint under the words above. */
export const tokenCoverageHint = (stats) => stats.estimated
  ? `usage recorded ${fmt.frac(stats.measured, stats.n).replace(/ /g, '')}; estimated ${fmt.frac(stats.estimated, stats.n).replace(/ /g, '')}`
  : `usage recorded ${fmt.frac(stats.rec, stats.n).replace(/ /g, '')}`

// A net rate change is not the number of hidden passes lost: gains can offset losses.
export function oracleChanges(oracle) {
  const n = oracle?.n_eligible
  const lost = oracle?.cells?.only_a_true
  const gained = oracle?.cells?.only_b_true
  return n > 0 && Number.isFinite(lost) && Number.isFinite(gained)
    ? { n, lost, gained, loss: lost / n, gain: gained / n, net: (gained - lost) / n } : null
}
/** The grade basis in the console's words ("hidden oracle"); imported SWE-agent runs keep their source labels. */
export const oracleLabel = (runs, oracle) => (runs?.length && runs.every(isSweRun) ? suiteLabel(runs, oracle) : `${oracle} oracle`)
/** An imported run's "visible" grade is the agent's own last test result (importers/common.py), not a
 *  visible test suite run by a grader. */
export const ownTestVisible = (run) => providerOf(run).startsWith('import:')
export const visibleWord = (run) => (ownTestVisible(run) ? "agent's last test" : 'visible')
