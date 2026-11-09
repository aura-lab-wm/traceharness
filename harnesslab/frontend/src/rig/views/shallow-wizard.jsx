/* Door 2. Six questions, recommended answer first. MCP stays off. */
import { useEffect, useState } from 'react'
import { api, IS_MEMBER } from '../../api'
import { requireStored } from '../../member-api'
import { Go } from '../ui'
import { EvidenceOrigin, evidenceOrigin, withEvidenceOrigin } from '../shallowEvidence'
import { QUESTIONS, blocksFromAnswers } from './shallow-data.js'
import { wizardAnswers, writeDraft } from './shallow-drafts'
import { HarnessNav, HarnessSummary } from '../harnessWorkspace'

const INITIAL = Object.fromEntries(QUESTIONS.map((row) => [row.id, row.recommended]))

function ShallowWizard({ args } = {}) {
  const [answers, setAnswers] = useState(wizardAnswers)
  const [storageError, setStorageError] = useState('')
  const [preview, setPreview] = useState(null)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState('')
  const [busy, setBusy] = useState(false)
  const [previewRevision, setPreviewRevision] = useState(0)
  const [accountLoaded, setAccountLoaded] = useState(!IS_MEMBER)
  const [accountError, setAccountError] = useState('')
  const [accountRevision, setAccountRevision] = useState(0)
  const blocks = blocksFromAnswers(answers)
  const matches = QUESTIONS.every((row) => answers[row.id] === INITIAL[row.id])
  useEffect(() => {
    if (!IS_MEMBER) return
    let active = true
    const controller = new AbortController()
    setAccountLoaded(false)
    setAccountError('')
    api('/shallow/harnesses', { signal: controller.signal }).then((result) => {
      if (!active) return
      setAccountLoaded(result.loaded === true)
      if (result.loaded !== true) setAccountError('Your saved account data has not loaded. Saving is unavailable.')
    }).catch((failure) => { if (active) setAccountError(failure.message) })
    return () => { active = false; controller.abort() }
  }, [accountRevision])
  useEffect(() => {
    setStorageError(writeDraft('answers', answers) || writeDraft('customize', blocksFromAnswers(answers)))
    setSaved('')
    if (!IS_MEMBER) return
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
    setBusy(true); setError(''); setSaved('')
    try {
      const result = requireStored(await api('/shallow/wizard', { method: 'POST', body: { answers } }))
      setPreview(result)
      setSaved(`Saved ${result.harness.id} to your account.`)
    } catch (failure) { setError(failure.message) }
    finally { setBusy(false) }
  }
  return (
    <div className="rg-dpad rg-harness" data-el="shallow-wizard">
      <HarnessNav active="minimal" args={args} />
      <div className="rg-dh">
        <div className="t">
          <div className="rg-eyebrow">Harness workspace / Guided setup</div>
          <h1>Minimal harness</h1>
          <p>Six choices to define how your agent works. Start with the recommended answers, then adjust its tools, permissions, and limits. This lane stays off the six-card comparison and off the vendor ladder.</p>
        </div>
      </div>
      <EvidenceOrigin args={args} />
      {storageError && <p role="alert">{storageError}</p>}
      <div className="rg-harness-layout">
      <div className="rg-harness-questions">
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
      <HarnessSummary blocks={blocks}>
      {preview && <p className="rg-small">Cell {preview.harness.id}</p>}
      {(preview?.warnings || []).map((warning) => <p key={warning} role="status" className="rg-harness-warning">{warning}</p>)}
      {error && <p role="alert">{error}{IS_MEMBER && error.includes('account changed') && <> <a href="/login">Account</a></>}</p>}
      {IS_MEMBER && error && !preview && <button type="button" className="rg-btn" onClick={() => setPreviewRevision((n) => n + 1)}>Retry preview</button>}
      {saved && <p role="status">{saved}</p>}
      {accountError && <p role="alert">{accountError} <button type="button" className="rg-btn" onClick={() => setAccountRevision((n) => n + 1)}>Retry account data</button> <a href="/login">Account</a></p>}
      {IS_MEMBER && <button type="button" className="rg-btn pri" disabled={!accountLoaded || busy || !preview?.ok} onClick={save}>{busy ? 'Saving…' : 'Save minimal harness'}</button>}
      <Go spec={withEvidenceOrigin('blocks', evidenceOrigin(args), 'customize')} className="rg-btn" el="customize-spec">Customize</Go>
      <p className="rg-small" data-el="wizard-summary">{matches ? "Matches min_099dc52e693e." : "The selection diverges from the recommended cell."} MCP is off.</p>
      {matches ? null : <button type="button" className="rg-btn" disabled={busy} onClick={() => setAnswers(INITIAL)}>Reset to recommended</button>}
      <p className="rg-small">Network, privilege, secret access, and path escape are not a choice. They stay blocked.</p>
      {IS_MEMBER && <p className="rg-small">Answers stay in this tab until you save. Saving keeps the harness in your account and does not run a model.</p>}
      {IS_MEMBER && <p className="rg-small">Open Customize to reopen your saved minimal harnesses.</p>}
      </HarnessSummary>
      </div>
    </div>
  )
}

export const views = {
  shallowWizard: {
    tag: "min",
    title: () => "Minimal harness",
    crumbs: (args) => [['Harnesses', withEvidenceOrigin('shallowCards', evidenceOrigin(args))], ['Minimal']],
    render: ShallowWizard,
    palette: () => [{ title: "Minimal harness", detail: "six questions, recommended answers", spec: "shallowWizard" }],
  },
}
