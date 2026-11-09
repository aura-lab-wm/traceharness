import { Go, Icon } from './ui'
import { evidenceOrigin, withEvidenceOrigin } from './shallowEvidence'
import './harnessWorkspace.css'

export function HarnessNav({ active, args }) {
  const origin = evidenceOrigin(args)
  return <nav className="rg-harness-nav" aria-label="Harness workspace">
    {[
      ['fixed', 'shallowCards', 'Fixed', 'Edit a standing prompt', 'sent'],
      ['minimal', 'shallowWizard', 'Minimal', 'Start with six choices', 'guide'],
      ['custom', 'blocks', 'Flexible', 'Configure every block', 'set'],
    ].map(([id, view, title, detail, icon]) => <div key={id} className={active === id ? 'rg-harness-lane active' : 'rg-harness-lane'} aria-current={active === id ? 'page' : undefined}>
      <Go spec={withEvidenceOrigin(view, origin, ...(id === 'custom' ? ['customize'] : []))} className="rg-harness-lane-link" label={`${title} harness workspace`}>
        <Icon name={icon} size={20} /><span><strong>{title}</strong><small>{detail}</small></span><Icon name="right" size={16} />
      </Go>
    </div>)}
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

export function HarnessSummary({ blocks, children, title = 'Your configuration' }) {
  const find = (type) => blocks.find((block) => block.type === type) || {}
  const tools = find('tools').names || []
  return <aside className="rg-harness-summary" aria-label={title}>
    <div className="rg-harness-summary-head"><Icon name="canvas" size={20} /><h2>{title}</h2></div>
    <div className="rg-harness-summary-body">
      <div className="rg-harness-label">Tools · {tools.length}</div><ToolChips tools={tools} />
      <dl className="rg-harness-spec">
        <div><dt>Permission</dt><dd>{find('policy').mode || '—'}</dd></div>
        <div><dt>History</dt><dd>{find('context').window === 0 ? 'Full history' : `${find('context').window ?? '—'} observations`}</dd></div>
        <div><dt>Step cap</dt><dd>{find('stop').max_steps ?? '—'}</dd></div>
        <div><dt>Temperature</dt><dd>{find('sampling').temperature ?? '—'}</dd></div>
        <div><dt>File list</dt><dd>{find('listing').include ? 'Included' : 'Off'}</dd></div>
      </dl>
      {children}
    </div>
  </aside>
}
