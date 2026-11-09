import { isSweRun, providerOf, SWE_URL } from './provenance'

export function RecordingProvenance({ runs }) {
  const imported = (runs || []).filter(isSweRun)
  const captured = (runs || []).filter((run) => providerOf(run).startsWith('capture:'))
  if (!imported.length && !captured.length) return null
  return <aside className="rg-pnl rg-pnl-b rg-small" aria-label="Recording provenance" style={{ marginBottom: 16 }}>
    {imported.length > 0 && <>
      <p><b>Imported SWE-agent recordings.</b> Source: <a href={SWE_URL} target="_blank" rel="noreferrer">nebius/SWE-agent-trajectories</a> · <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">CC BY 4.0</a>. Hidden is the source SWE-bench evaluation label; visible is an importer heuristic on the last test output. No strengthened grades were supplied.</p>
      <details><summary>How these recordings were converted</summary><p>Source commands and observations were converted into ledger events, retaining up to 75 source steps. Token counts are estimates (characters ÷ 4), not provider usage. Cost and timing were not supplied. Harness settings are importer reconstructions, not recovered original settings. The issue text remains in the source dataset.</p></details>
    </>}
    {captured.length > 0 && <p><b>Captured session.</b> These are recorded actions from an external tool session.{captured.every((run) => run.hid == null && run.str == null) ? ' No independent hidden or strengthened grade was supplied.' : ''} Capture alone does not establish task success.</p>}
  </aside>
}
