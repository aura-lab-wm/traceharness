/* A preview only. No write is sent to any account or runner. */
import { useEffect, useState } from 'react'
import { api, IS_MEMBER } from '../../api'
import { ErrorState, Go, Loading } from '../ui'
import { EvidenceOrigin, evidenceOrigin, withEvidenceOrigin } from '../shallowEvidence'
import { readDraft, writeDraft } from './shallow-drafts'
import { CARDS } from './shallow-data.js'
import { ByteMeter, HarnessNav, ToolChips } from '../harnessWorkspace'

function clipUtf8(text, capBytes) {
  const raw = new TextEncoder().encode(text)
  let cap = Number(capBytes)
  if (!Number.isFinite(cap) || cap < 0) cap = 0
  cap = Math.floor(cap)
  if (raw.length <= cap) return text
  const dec = new TextDecoder("utf-8", { fatal: true })
  let end = cap
  while (end > 0) {
    try { return dec.decode(raw.slice(0, end)) } catch { end -= 1 }
  }
  return ""
}

function ShallowApply({ args } = {}) {
  const [cards, setCards] = useState(IS_MEMBER ? null : CARDS)
  const [prompt, setPrompt] = useState(() => readDraft('apply')?.prompt ?? CARDS[0].prompt)
  const [applied, setApplied] = useState(() => readDraft('apply')?.applied ?? CARDS[0].prompt)
  const [error, setError] = useState(null)
  const [storageError, setStorageError] = useState('')
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    if (!IS_MEMBER) return
    let active = true
    setError(null)
    api('/shallow/catalog').then((result) => { if (active) setCards(result.harnesses) })
      .catch((failure) => { if (active) setError(failure) })
    return () => { active = false }
  }, [revision])
  useEffect(() => { setStorageError(writeDraft('apply', { prompt, applied })) }, [prompt, applied])
  if (error) return <><ErrorState error={error} what="The six shell preview" onRetry={() => setRevision((n) => n + 1)} /><p><a href="/login">Account</a> · Sign back into the original account to keep working on its draft.</p></>
  if (!cards) return <Loading label="Reading the six shells…" />
  return (
    <div className="rg-dpad rg-harness" data-el="shallow-apply">
      <HarnessNav active="fixed" args={args} />
      <div className="rg-dh">
        <div className="t">
          <div className="rg-eyebrow">Harness workspace / Compare prompt fit</div>
          <h1>One prompt, six shells</h1>
          <p>The prompt is the only thing this change edits. Each harness keeps its own tools, permission rule, stop, and byte cap. These cells stay off the vendor ladder.</p>
          <p>This is a preview. Applying it here does not save any account prompt or run a model.</p>
        </div>
      </div>
      <EvidenceOrigin args={args} />
      {storageError && <p role="alert">{storageError}</p>}
      <label className="rg-fld">Prompt applied to all six
        <textarea className="rg-inp" rows={6} value={prompt} onChange={(e) => setPrompt(e.target.value)} spellCheck={false} />
      </label>
      <div className="rg-harness-toolbar"><button type="button" className="rg-btn pri" onClick={() => setApplied(prompt)}>Apply to all six</button>
      <span className="rg-small">{prompt !== applied ? 'Unapplied edits' : 'Preview only · account prompts unchanged'}</span></div>
      <div className="rg-harness-grid">
        {cards.map((row) => {
          const shown = clipUtf8(applied, row.cap_bytes)
          const used = new TextEncoder().encode(shown).length
          const clipped = shown !== applied
          return (
            <article key={row.id} className="rg-harness-card" data-el="apply-shell" data-agent={row.id}>
              <div className="rg-harness-card-head"><div><div className="rg-harness-label">{row.max_steps} steps · {row.policy}</div><h2>{row.name}</h2></div><span className={`rg-harness-tag${clipped ? ' draft' : ''}`}>{clipped ? 'Clipped' : 'Fits cap'}</span></div>
              <div className="rg-harness-card-body">
                <ToolChips tools={row.tools} />
                <p className="rg-harness-preview-prompt">{shown}</p>
                <ByteMeter used={used} cap={row.cap_bytes} name={row.name} />
              </div>
            </article>
          )
        })}
      </div>
      <Go spec={withEvidenceOrigin('shallowCards', evidenceOrigin(args))} className="rg-btn">{IS_MEMBER ? 'Open fixed harnesses to save individual prompts' : 'Back to fixed harnesses'}</Go>
    </div>
  )
}

export const views = {
  shallowApply: {
    tag: "same",
    title: () => "One prompt, six shells",
    crumbs: (args) => [['Harnesses', withEvidenceOrigin('shallowCards', evidenceOrigin(args))], ['Same prompt']],
    render: ShallowApply,
    palette: () => [{ title: "Same prompt on six harnesses", detail: "tools and caps stay", spec: "shallowApply" }],
  },
}
