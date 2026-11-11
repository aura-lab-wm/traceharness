/* Door 1. The six actual shells; hosted members can save prompt-only changes. */
import { useEffect, useState } from 'react'
import { api, IS_MEMBER } from '../../api'
import { requireStored } from '../../member-api'
import { readDraft, writeDraft } from './shallow-drafts'
import { HarnessJson } from '../HarnessJson'
import { ErrorState, Go, Loading } from '../ui'
import { EvidenceOrigin, evidenceOrigin, withEvidenceOrigin } from '../shallowEvidence'
import { CARDS, PERMISSION } from './shallow-data.js'
import { ByteMeter, HarnessNav, ToolChips } from '../harnessWorkspace'

function utf8Size(text) {
  return new TextEncoder().encode(text).length
}

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

function ShallowCards({ args } = {}) {
  const [cards, setCards] = useState(IS_MEMBER ? null : CARDS)
  const [prompts, setPrompts] = useState(() => Object.fromEntries(CARDS.map((row) => [row.id, row.prompt])))
  const [drafts, setDrafts] = useState({})
  const [loadError, setLoadError] = useState(null)
  const [messages, setMessages] = useState({})
  const [busy, setBusy] = useState({})
  const [storageError, setStorageError] = useState('')
  const [revision, setRevision] = useState(0)
  const [accountLoaded, setAccountLoaded] = useState(!IS_MEMBER)
  useEffect(() => {
    if (!IS_MEMBER) return
    let active = true
    setLoadError(null)
    setAccountLoaded(false)
    Promise.all([api('/shallow/catalog'), api('/shallow/harnesses')]).then(([catalog, library]) => {
      if (!active) return
      if (!Array.isArray(catalog.harnesses) || !Array.isArray(library.harnesses)) throw new Error('The member harness catalog could not be read.')
      const saved = new Map(library.harnesses.filter((row) => row.lane === 'fixed').map((row) => [row.id, row]))
      const rows = catalog.harnesses.map((row) => ({ ...row,
        ...(saved.has(row.id) ? { prompt: saved.get(row.id).prompt, hash: saved.get(row.id).hash } : {}),
        memberSaved: saved.has(row.id) && !(library.unconfirmed || []).includes(row.id),
        memberUnconfirmed: (library.unconfirmed || []).includes(row.id),
      }))
      const restored = readDraft('fixed') || {}
      const valid = Object.fromEntries(rows.filter((row) => typeof restored[row.id]?.prompt === 'string' && /^[a-f0-9]{12}$/.test(restored[row.id]?.baseHash)).map((row) => [row.id, { ...restored[row.id], restored: true }]))
      setCards(rows)
      setAccountLoaded(library.loaded === true)
      setDrafts(valid)
      setPrompts(Object.fromEntries(rows.map((row) => [row.id, valid[row.id]?.prompt ?? row.prompt])))
      setMessages(Object.fromEntries((library.unconfirmed || []).map((id) => [id, 'Account storage has not confirmed this prompt. Your draft is still pending.'])))
    }).catch((error) => { if (active) setLoadError(error) })
    return () => { active = false }
  }, [revision])

  function edit(row, value) {
    setPrompts((cur) => ({ ...cur, [row.id]: value }))
    setMessages((cur) => ({ ...cur, [row.id]: '' }))
    if (!IS_MEMBER) return
    setDrafts((cur) => {
      const next = { ...cur, [row.id]: { prompt: value, baseHash: cur[row.id]?.baseHash || row.hash,
        basePresent: cur[row.id]?.basePresent ?? row.memberSaved } }
      if (value === row.prompt && accountLoaded && !row.memberUnconfirmed) delete next[row.id]
      setStorageError(writeDraft('fixed', next))
      return next
    })
  }

  async function save(row) {
    if (!accountLoaded) return
    const submitted = prompts[row.id]
    setBusy((cur) => ({ ...cur, [row.id]: true }))
    setMessages((cur) => ({ ...cur, [row.id]: '' }))
    try {
      const result = requireStored(await api('/shallow/harnesses', { method: 'POST', body: {
        id: row.id, prompt: submitted,
        ...((drafts[row.id]?.basePresent ?? row.memberSaved)
          ? { if_hash: drafts[row.id]?.baseHash || row.hash } : { if_absent: true }),
      } }))
      setCards((cur) => cur.map((card) => card.id === row.id ? { ...card, prompt: result.harness.prompt, hash: result.harness.hash, memberSaved: true, memberUnconfirmed: false } : card))
      setDrafts((cur) => {
        const next = { ...cur }
        delete next[row.id]
        setStorageError(writeDraft('fixed', next))
        return next
      })
      setPrompts((cur) => ({ ...cur, [row.id]: result.harness.prompt }))
      setMessages((cur) => ({ ...cur, [row.id]: 'Saved to your account.' }))
    } catch (error) { setMessages((cur) => ({ ...cur, [row.id]: error.message })) }
    finally { setBusy((cur) => ({ ...cur, [row.id]: false })) }
  }

  function discardAndReload(id) {
    const next = { ...drafts }
    delete next[id]
    const failure = writeDraft('fixed', next)
    setStorageError(failure)
    if (failure) return
    setDrafts(next)
    setRevision((n) => n + 1)
  }

  if (loadError) return <><ErrorState error={loadError} what="Your fixed harnesses" onRetry={() => setRevision((n) => n + 1)} /><p><a href="/login">Account</a> · Sign back into the original account to keep working on its draft.</p></>
  if (!cards) return <Loading label="Reading your fixed harnesses…" />
  return (
    <div className="rg-dpad rg-harness" data-el="shallow-cards">
      <HarnessNav active="fixed" args={args} />
      <div className="rg-dh">
        <div className="t">
          <div className="rg-eyebrow">Harness workspace / Fixed</div>
          <h1>Fixed harnesses</h1>
          <p>Edit the standing prompt. Keep the shell. These six stand-ins use TraceHarness lab choices, not verified vendor limits. Tools, permissions, and limits stay fixed while you refine the instructions.</p>
        </div>
      </div>
      <EvidenceOrigin args={args} />
      <div className="rg-harness-toolbar">
        <span className="rg-harness-label">6 shells · prompt editing</span>
        <Go spec={withEvidenceOrigin('shallowApply', evidenceOrigin(args))} className="rg-btn" el="preview-six-shells">Preview one prompt across six shells</Go>
      </div>
      {IS_MEMBER && !accountLoaded && <p role="alert">Your saved account data has not loaded. Saving is unavailable. <button type="button" className="rg-btn" onClick={() => setRevision((n) => n + 1)}>Retry account data</button> <a href="/login">Account</a></p>}
      <details className="rg-harness-rules"><summary>Permissions and saving</summary><p className="rg-harness-note">{PERMISSION} {IS_MEMBER ? 'Drafts stay in this workbench tab; the plain editor shares confirmed account saves only. Saving does not run a model.' : 'Nothing on this screen is saved, and nothing here calls a model.'}</p></details>
      <div className="rg-harness-grid">
        {storageError && <p role="alert">{storageError}</p>}
        {cards.map((row) => {
          const value = prompts[row.id]
          const used = utf8Size(value)
          const clipped = clipUtf8(value, row.cap_bytes)
          const dropsVerify = !clipped.includes("verify") || !clipped.includes("modify the tests")
          return (
            <article key={row.id} className="rg-harness-card" data-agent={row.id}>
              <div className="rg-harness-card-head"><div><div className="rg-harness-label">{row.max_steps} steps · strict policy</div><h2>{row.name}</h2></div><span className={`rg-harness-tag${drafts[row.id] || value !== row.prompt ? ' draft' : ''}`}>{drafts[row.id] || value !== row.prompt ? 'Draft' : row.memberSaved && accountLoaded ? 'Account save' : 'Fixed shell'}</span></div>
              <div className="rg-harness-card-body">
                <ToolChips tools={row.tools} />
                <label className="rg-fld">Standing prompt for {row.name}
                  <textarea className="rg-inp" rows={8} value={value} disabled={!!busy[row.id]} onChange={(e) => edit(row, e.target.value)} spellCheck={false} />
                </label>
                <ByteMeter used={used} cap={row.cap_bytes} name={row.name} />
                <HarnessJson source={value !== row.prompt ? 'Current prompt draft' : row.memberSaved ? 'Account-saved preset' : 'Stock preset'} description="Every supplied preset field and the current prompt. This is not the vendor’s native runtime configuration."
                  documents={[{ id: 'preset', label: 'Preset configuration', value: { ...row, prompt: value }, filename: `harness-${row.id}.json` }]} />
                {used > row.cap_bytes || dropsVerify ? <p className="rg-harness-warning">This prompt is over the byte cap, or the clipped text drops verify and modify the tests.</p> : null}
                <div className="rg-harness-actions">
                  {IS_MEMBER && <button type="button" className="rg-btn pri" disabled={!accountLoaded || !!busy[row.id] || !value.trim()} onClick={() => save(row)}>{busy[row.id] ? 'Saving…' : 'Save prompt'}</button>}
                  {value !== row.prompt ? <button type="button" className="rg-btn" disabled={!!busy[row.id]} onClick={() => edit(row, row.prompt)}>Reset prompt</button> : null}
                  {drafts[row.id] && <><span className="rg-small">{drafts[row.id].restored ? 'Restored unsaved draft from this tab' : 'Unsaved draft'}</span><button type="button" className="rg-btn" disabled={Object.values(busy).some(Boolean)} onClick={() => discardAndReload(row.id)}>Discard draft and reload saved prompt</button></>}
                </div>
                {messages[row.id] && <p role={messages[row.id] === 'Saved to your account.' ? 'status' : 'alert'} className="rg-harness-status">{messages[row.id]}{messages[row.id].includes('account changed') && <> <a href="/login">Account</a></>}</p>}
              </div>
            </article>
          )
        })}
      </div>
    </div>
  )
}

export const views = {
  shallowCards: {
    tag: "six",
    title: () => "Fixed harnesses",
    crumbs: (args) => [['Harnesses', withEvidenceOrigin('shallowCards', evidenceOrigin(args))], ['Fixed']],
    render: ShallowCards,
    palette: () => [{ title: "Fixed harnesses", detail: "six shallow stand-ins", spec: "shallowCards", keywords: "claude codex qwen kimi grok agy antigravity" }],
  },
}
