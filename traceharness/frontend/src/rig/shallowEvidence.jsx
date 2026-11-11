import { makeSpec, parseSpec } from './route'
import { Go } from './ui'
import { useFindRun, useRuns } from './data'

// Carry the exact source document in the URL so a saved/reloaded builder can
// return to its evidence without copying or changing a recorded run.
const EVIDENCE_KINDS = new Set(['ds', 'q', 'an', 'field', 'tasks', 'task', 'run', 'span', 'cmp'])

export function evidenceOrigin(args = []) {
  const at = args.lastIndexOf('from')
  const source = at >= 0 ? args[at + 1] : null
  return typeof source === 'string' && EVIDENCE_KINDS.has(parseSpec(source).kind) ? source : null
}

export function withEvidenceOrigin(kind, source, ...args) {
  return source && EVIDENCE_KINDS.has(parseSpec(source).kind)
    ? makeSpec(kind, ...args, 'from', source)
    : makeSpec(kind, ...args)
}

export function EvidenceOrigin({ args }) {
  const source = evidenceOrigin(args)
  const parsed = parseSpec(source)
  const run = useFindRun(['run', 'span', 'cmp'].includes(parsed.kind) ? parsed.args[0] : null)
  // Reloading directly into a source-linked builder still restores the shell's
  // current condition and the selected attempt from the original index.
  useRuns(parsed.kind === 'task' ? parsed.args[0] : null)
  if (!source) return null
  return (
    <div className="rg-note" data-el="harness-source-evidence">
      <div>
        <p>Use the source evidence to guide a new harness. Saving a harness does not run it or change the recorded results.</p>
        {run.data && <p className="rg-small">{run.data.dir} · <span className="rg-mono">{run.data.run.id}</span></p>}
        <Go spec={source} className="rg-btn" el="return-to-source-evidence">Return to source evidence</Go>
      </div>
    </div>
  )
}
