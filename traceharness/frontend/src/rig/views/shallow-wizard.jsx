/* Door 2. Six questions, recommended answer first. MCP stays off. */
import { useEffect, useRef, useState } from 'react'
import { api } from '../../api'
import { HAS_LIBRARY, LIBRARY } from '../../environment'
import { requireStored } from '../../json'
import { Go, Icon, PageHeader } from '../ui'
import { makeSpec } from '../route'
import { EvidenceOrigin, evidenceOrigin, withEvidenceOrigin } from '../shallowEvidence'
import { QUESTIONS, blocksFromAnswers } from './shallow-data.js'
import { wizardAnswers, writeDraft } from './shallow-drafts'
import { HarnessNav, HarnessSummary, focusWorkspaceSection } from '../harnessWorkspace'
import { HarnessJson } from '../HarnessJson'

const INITIAL = Object.fromEntries(QUESTIONS.map((row) => [row.id, row.recommended]))

function ShallowWizard({ args } = {}) {
  const summaryRef = useRef(null)
  const questionsRef = useRef(null)
  const [answers, setAnswers] = useState(wizardAnswers)
  const [storageError, setStorageError] = useState('')
  const [preview, setPreview] = useState(null)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState('')
  // the harness just saved: the next step runs it in One run
  const [savedId, setSavedId] = useState('')
  const [busy, setBusy] = useState(false)
  const [previewRevision, setPreviewRevision] = useState(0)
  const [accountLoaded, setAccountLoaded] = useState(!HAS_LIBRARY)
  const [accountError, setAccountError] = useState('')
  const [accountRevision, setAccountRevision] = useState(0)
  const blocks = blocksFromAnswers(answers)
  const matches = QUESTIONS.every((row) => answers[row.id] === INITIAL[row.id])
  useEffect(() => {
    if (!HAS_LIBRARY) return
    let active = true
    const controller = new AbortController()
    setAccountLoaded(false)
    setAccountError('')
    api('/shallow/harnesses', { signal: controller.signal }).then((result) => {
      if (!active) return
      setAccountLoaded(result?.loaded === true)
      if (result?.loaded !== true) setAccountError(`Your harnesses saved to ${LIBRARY.label} have not loaded. Saving is unavailable.`)
    }).catch((failure) => { if (active) setAccountError(failure.message) })
    return () => { active = false; controller.abort() }
  }, [accountRevision])
  useEffect(() => {
    setStorageError(writeDraft('answers', answers) || writeDraft('customize', blocksFromAnswers(answers)))
    setSaved('')
    setSavedId('')
    if (!HAS_LIBRARY) return
    let active = true
    const controller = new AbortController()
    setPreview(null)
    setError('')
    const timer = setTimeout(() => {
      api('/shallow/compile', { method: 'POST', body: { answers }, signal: controller.signal })
        .then((result) => { if (active) setPreview(result) })
        .catch((failure) => { if (active) setError(failure.message) })
    }, 180)
    return () => { active = false; clearTimeout(timer); controller.abort() }
  }, [answers, previewRevision])
  async function save() {
    if (!accountLoaded) return
    setBusy(true); setError(''); setSaved(''); setSavedId('')
    try {
      const result = requireStored(await api('/shallow/wizard', { method: 'POST', body: { answers } }))
      setPreview(result)
      setSaved(`Saved ${result.harness.id} to ${LIBRARY.label}.`)
      setSavedId(result.harness.id)
    } catch (failure) { setError(failure.message) }
    finally { setBusy(false) }
  }
  return (
    <div className="rg-dpad rg-harness" data-el="shallow-wizard">
      <HarnessNav active="minimal" args={args} />
      <PageHeader title="Minimal harness" subtitle="Six choices to define how your agent works."
        lede="Start with the recommended answers, then adjust its tools, permissions, and limits. This lane stays off the six-card comparison and off the vendor ladder." />
      <p className="rg-small rg-mute" data-el="wizard-difference">Builds a new harness from six answers. Guide me in One run asks the same questions but changes 4 settings of the harness you have open.</p>
      <EvidenceOrigin args={args} />
      <div className="rg-harness-toolbar" data-tour="harness-toolbar"><span className="rg-small">Start with the recommended answers, then review your configuration.</span><button type="button" className="rg-btn pri" data-hint="Jump to Your configuration, below the six questions" onClick={() => focusWorkspaceSection(summaryRef)}>Review configuration</button></div>
      {storageError && <p role="alert">{storageError}</p>}
      {/* the six questions first; the configuration they make follows (Review configuration jumps to it) */}
      <div className="rg-harness-layout q-first" data-panes>
      <div ref={questionsRef} tabIndex={-1} className="rg-harness-questions" role="group" aria-label="Wizard answers" data-tour="wizard-answers">
        {QUESTIONS.map((row, index) => (
          <fieldset key={row.id} className="rg-harness-question" data-question={row.id} role="radiogroup" aria-label={row.prompt}>
            <legend><span aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>{row.prompt}</legend>
            <div className="rg-harness-options">
              {row.options.map(([value, label]) => (
                <label key={value} className="rg-harness-option" data-mcp={row.id === "mcp" ? "none" : undefined}>
                  <input
                    type="radio"
                    name={row.id}
                    value={value}
                    checked={answers[row.id] === value}
                    disabled={busy}
                    onChange={() => {
                      if (row.id === "mcp" && value !== "none") return
                      setAnswers((cur) => ({ ...cur, [row.id]: value }))
                    }}
                  />
                  <span>{label}</span>{value === row.recommended && <small>Recommended</small>}
                </label>
              ))}
            </div>
          </fieldset>
        ))}
      </div>
      <HarnessSummary blocks={blocks} headingRef={summaryRef}>
      <button type="button" className="rg-btn" onClick={() => focusWorkspaceSection(questionsRef)}>Back to answers</button>
      {HAS_LIBRARY && !preview && !error && <p role="status" className="rg-small">Checking configuration…</p>}
      {preview && <p className="rg-small">Cell {preview.harness.id}</p>}
      {(preview?.warnings || []).map((warning) => <p key={warning} role="status" className="rg-harness-warning">{warning}</p>)}
      {error && <p role="alert">{error}</p>}
      {HAS_LIBRARY && error && !preview && <button type="button" className="rg-btn" onClick={() => setPreviewRevision((n) => n + 1)}>Retry preview</button>}
      {saved && <p role="status">{saved}</p>}
      {savedId && <Go spec={makeSpec('harnesses', 'saved', savedId)} className="rg-btn pri" el="wizard-run-it" tip="One run opens with this harness selected; pick a model and a task there">Run it in One run<Icon name="right" size={12} /></Go>}
      {accountError && <p role="alert">{accountError} <button type="button" className="rg-btn" onClick={() => setAccountRevision((n) => n + 1)}>Retry saved harnesses</button></p>}
      {HAS_LIBRARY && <button type="button" className="rg-btn pri" disabled={!accountLoaded || busy || !preview?.ok} aria-busy={busy || undefined} onClick={save}>{busy ? 'Saving…' : 'Save harness'}</button>}
      <Go spec={withEvidenceOrigin('blocks', evidenceOrigin(args), 'customize')} className="rg-btn" el="customize-spec">Customize in Advanced settings</Go>
      <p className="rg-small" data-el="wizard-summary">{matches ? "Matches min_099dc52e693e." : "The selection diverges from the recommended cell."} MCP is off.</p>
      {matches ? null : <button type="button" className="rg-btn" disabled={busy} onClick={() => setAnswers(INITIAL)}>Reset to recommended</button>}
      <p className="rg-small">Network, privilege, secret access, and path escape are not a choice. They stay blocked.</p>
      {HAS_LIBRARY && <p className="rg-small">Answers stay in this tab until you save. Saving sends the harness to {LIBRARY.label} and does not run a model.</p>}
      {HAS_LIBRARY && <p className="rg-small">Reopen your saved minimal harnesses in One run › Advanced settings.</p>}
      <HarnessJson source="Current wizard draft" description="The complete block configuration from these answers, with the compiled harness when available."
        documents={[{ id: 'blocks', label: 'Block configuration', value: { blocks: blocksFromAnswers(answers) }, filename: 'minimal-harness-blocks.json' }, { id: 'compiled', label: 'Compiled harness', value: preview?.ok ? preview.harness : null, filename: 'minimal-harness.json' }]} />
      </HarnessSummary>
      </div>
    </div>
  )
}

export const views = {
  shallowWizard: {
    tag: "min",
    title: () => "Minimal harness",
    crumbs: (args) => [['Harnesses', withEvidenceOrigin('harnesses', evidenceOrigin(args))], ['Minimal harness']],
    render: ShallowWizard,
    palette: () => [{ title: "Minimal harness", detail: "six questions, recommended answers", spec: "shallowWizard" }],
  },
}
