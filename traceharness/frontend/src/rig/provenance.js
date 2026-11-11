export const SWE_SOURCE = 'nebius/SWE-agent-trajectories'
export const SWE_URL = 'https://huggingface.co/datasets/nebius/SWE-agent-trajectories'
export const providerOf = (run) => (run?.raw || run)?.provider || ''
export const isSweRun = (run) => providerOf(run) === SWE_SOURCE
export const suiteLabel = (runs, oracle) => runs?.length && runs.every(isSweRun)
  ? ({ hidden: 'SWE-bench evaluation label', visible: 'last-test-output heuristic', strengthened: 'strengthened grade (not supplied)' }[oracle] || oracle)
  : `${oracle} suite`
export const tokenCoverage = (stats) => stats.estimated
  ? `usage recorded ${stats.measured}/${stats.n}; estimated ${stats.estimated}/${stats.n}`
  : `usage recorded ${stats.rec}/${stats.n}`

// A net rate change is not the number of hidden passes lost: gains can offset losses.
export function oracleChanges(oracle) {
  const n = oracle?.n_eligible
  const lost = oracle?.cells?.only_a_true
  const gained = oracle?.cells?.only_b_true
  return n > 0 && Number.isFinite(lost) && Number.isFinite(gained)
    ? { n, lost, gained, loss: lost / n, gain: gained / n, net: (gained - lost) / n } : null
}
