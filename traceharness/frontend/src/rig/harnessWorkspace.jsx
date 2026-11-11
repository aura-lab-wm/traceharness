import { useId } from 'react'
import { Go, Icon } from './ui'
import { numberIssue } from './harnessFields'
import { evidenceOrigin, withEvidenceOrigin } from './shallowEvidence'
import './harnessWorkspace.css'

export function HarnessNav({ active, args }) {
  const origin = evidenceOrigin(args)
  return <nav className="rg-harness-return" aria-label="Harness workspace">
    <Go spec={withEvidenceOrigin('harnesses', origin, active === 'minimal' ? 'guided' : active === 'fixed' ? 'fixed' : 'custom')} className="rg-btn" label="Open unified Harnesses workspace"><Icon name="tabs" size={16} />Harnesses<span aria-hidden="true">·</span>Choose a harness, model and task<Icon name="right" size={16} /></Go>
  </nav>
}

export function ByteMeter({ used, cap, name }) {
  const over = used > cap
  return <div className={`rg-harness-meter${over ? ' over' : ''}`}>
    <div><span>Prompt budget</span><span className="rg-mono">{used} / {cap} bytes</span></div>
    <meter min={0} max={cap} value={Math.min(used, cap)} aria-label={`${name} prompt bytes`} aria-valuetext={`${used} of ${cap} bytes${over ? ', over cap' : ''}`} />
    {over && <span className="rg-harness-warning">{used - cap} bytes over the shell cap</span>}
  </div>
}

export function ToolChips({ tools = [] }) {
  return <ul className="rg-harness-tools" aria-label="Available tools">{tools.map((name) => <li key={name}>{name}</li>)}</ul>
}

export function focusWorkspaceSection(ref) {
  if (!ref.current) return
  ref.current.focus({ preventScroll: true })
  ref.current.scrollIntoView({ block: 'start', behavior: 'instant' })
}

export function NumericField({ field, value, onChange }) {
  const id = useId()
  const issue = numberIssue(value, field)
  return <div className="rg-fld"><label htmlFor={id}>{field.label}</label>
    <input className="rg-inp" type="number" min={field.min} max={field.max} step={field.step || 1}
      id={id} value={value ?? ''} aria-invalid={!!issue} aria-describedby={issue ? `${id}-error` : undefined}
      onChange={(event) => onChange(event.target.value === '' ? '' : event.target.valueAsNumber)} />
    {issue && <span id={`${id}-error`} className="rg-harness-field-error">{issue}</span>}
  </div>
}

const showNumber = (value) => value === '' || value == null ? 'Not set' : Object.is(value, -0) ? '-0' : value

export function HarnessSummary({ blocks, children, title = 'Your configuration', headingRef }) {
  // Local stacks apply blocks in order; later blocks of a type override earlier ones.
  const find = (type) => blocks.findLast((block) => block.type === type) || {}
  const tools = find('tools').names || []
  return <aside className="rg-harness-summary" aria-label={title}>
    <div className="rg-harness-summary-head"><Icon name="canvas" size={20} /><h2 ref={headingRef} tabIndex={-1}>{title}</h2></div>
    <div className="rg-harness-summary-body">
      <div className="rg-harness-label">Tools · {tools.length}</div><ToolChips tools={tools} />
      <dl className="rg-harness-spec">
        <div><dt>Permission</dt><dd>{find('policy').mode || '—'}</dd></div>
        <div><dt>History</dt><dd>{find('context').window === 0 ? 'Full history' : find('context').window === '' ? 'Not set' : `${find('context').window ?? '—'} observations`}</dd></div>
        <div><dt>Step cap</dt><dd>{showNumber(find('stop').max_steps)}</dd></div>
        <div><dt>Temperature</dt><dd>{showNumber(find('sampling').temperature)}</dd></div>
        <div><dt>File list</dt><dd>{find('listing').include ? 'Included' : 'Off'}</dd></div>
      </dl>
      {children}
    </div>
  </aside>
}
