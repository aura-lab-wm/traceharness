/* A preview only. No write is sent to any library or runner. */
import { useEffect, useState } from 'react'
import { api } from '../../api'
import { HAS_LIBRARY } from '../../environment'
import { ErrorState, Go, Loading, PageHeader } from '../ui'
import { EvidenceOrigin, evidenceOrigin, withEvidenceOrigin } from '../shallowEvidence'
import { readDraft, writeDraft } from './shallow-drafts'
import { CARDS } from './shallow-data.js'
import { ByteMeter, HarnessNav, ToolChips } from '../harnessWorkspace'
import { standInName } from '../harnessNames'
import { BrandName } from '../brand/BrandMark'

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

/** What Apply to all six just did, said beside the button: how many cards took the prompt whole and how many clipped it. */
export function appliedSentence(prompt, cards) {
  const clipped = cards.filter((row) => clipUtf8(prompt, row.cap_bytes) !== prompt).length
  const fits = cards.length - clipped
  return `Applied to all ${cards.length} cards below: ${fits} fit${clipped ? `, ${clipped} clipped to their byte cap` : ''}. Preview only; saved prompts are unchanged.`
}

function ShallowApply({ args } = {}) {
  // As on Fixed harnesses: the local and export catalogs are compiled in, and the local server's copy replaces them when it answers.
  const [cards, setCards] = useState(CARDS)
  const [prompt, setPrompt] = useState(() => readDraft('apply')?.prompt ?? CARDS[0].prompt)
  const [applied, setApplied] = useState(() => readDraft('apply')?.applied ?? CARDS[0].prompt)
  const [error, setError] = useState(null)
  const [storageError, setStorageError] = useState('')
  const [justApplied, setJustApplied] = useState(false)
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    if (!HAS_LIBRARY) return
    let active = true
    setError(null)
    api('/shallow/catalog').then((result) => { if (active && Array.isArray(result?.harnesses)) setCards(result.harnesses) })
      .catch((failure) => { if (active) setError(failure) })
    return () => { active = false }
  }, [revision])
  useEffect(() => { setStorageError(writeDraft('apply', { prompt, applied })) }, [prompt, applied])
  if (error && !cards) return <><ErrorState error={error} what="The six shell preview" onRetry={() => setRevision((n) => n + 1)} /></>
  if (!cards) return <Loading label="Reading the six shells…" />
  return (
    <div className="rg-dpad rg-harness" data-el="shallow-apply">
      <HarnessNav active="fixed" args={args} />
      <PageHeader title="One prompt, six shells"
        subtitle="The prompt is the only thing this change edits. Each harness keeps its own tools, permission rule, stop, and byte cap. These six stay off the vendor ladder."
        lede="This is a preview. Applying it here does not save any prompt or run a model." />
      <EvidenceOrigin args={args} />
      {storageError && <p role="alert">{storageError}</p>}
      <label className="rg-fld" data-tour="apply-prompt">Prompt applied to all six
        <textarea className="rg-inp" rows={6} value={prompt} onChange={(e) => { setPrompt(e.target.value); setJustApplied(false) }} spellCheck={false} />
      </label>
      <div className="rg-harness-toolbar" data-tour="harness-toolbar"><button type="button" className="rg-btn pri" onClick={() => { setApplied(prompt); setJustApplied(true) }}>Apply to all six</button>
      <span className="rg-small" role="status" data-el="apply-result">{prompt !== applied ? 'Unapplied edits' : justApplied ? appliedSentence(prompt, cards) : 'Preview only · saved prompts unchanged'}</span></div>
      <div className="rg-harness-grid">
        {cards.map((row) => {
          const shown = clipUtf8(applied, row.cap_bytes)
          const used = new TextEncoder().encode(shown).length
          const clipped = shown !== applied
          return (
            <article key={row.id} className="rg-harness-card" data-el="apply-shell" data-agent={row.id}>
              <div className="rg-harness-card-head"><div><div className="rg-harness-label">{row.max_steps} steps · {row.policy}</div><h2><BrandName kind="agent" name={row.name}>{standInName(row.name)}</BrandName></h2></div><span className={`rg-harness-tag${clipped ? ' draft' : ''}`}>{clipped ? 'Clipped' : 'Fits cap'}</span></div>
              <div className="rg-harness-card-body">
                <ToolChips tools={row.tools} />
                <p className="rg-harness-preview-prompt">{shown}</p>
                <ByteMeter used={used} cap={row.cap_bytes} name={row.name} />
              </div>
            </article>
          )
        })}
      </div>
      <Go spec={withEvidenceOrigin('shallowCards', evidenceOrigin(args))} className="rg-btn" tour="apply-save">{HAS_LIBRARY ? 'Open fixed harnesses to save individual prompts' : 'Back to fixed harnesses'}</Go>
    </div>
  )
}

export const views = {
  shallowApply: {
    tag: "same",
    title: () => "One prompt, six shells",
    crumbs: (args) => [['Harnesses', withEvidenceOrigin('harnesses', evidenceOrigin(args))], ['One prompt, six shells']],
    render: ShallowApply,
    palette: () => [{ title: "One prompt, six shells", detail: "the same prompt on six harnesses; tools and caps stay", spec: "shallowApply", keywords: "same prompt six harnesses compare" }],
  },
}
