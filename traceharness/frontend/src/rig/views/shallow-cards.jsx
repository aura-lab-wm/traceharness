/* Door 1. The six actual shells. Prompt-only changes save wherever this console keeps a library:
   this computer (local console); the read-only export saves nothing. */
import { useEffect, useState } from 'react'
import { api } from '../../api'
import { HAS_LIBRARY, LIBRARY } from '../../environment'
import { libraryPlace, requireStored } from '../../json'
import { readDraft, writeDraft } from './shallow-drafts'
import { HarnessJson } from '../HarnessJson'
import { ErrorState, Go, Loading, PageHeader } from '../ui'
import { EvidenceOrigin, evidenceOrigin, withEvidenceOrigin } from '../shallowEvidence'
import { CARDS, PERMISSION } from './shallow-data.js'
import { ByteMeter, HarnessNav, ToolChips } from '../harnessWorkspace'
import { standInName } from '../harnessNames'
import { BrandName } from '../brand/BrandMark'

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

const SAVED = `Saved to ${LIBRARY.label}.`

function ShallowCards({ args } = {}) {
  // The six cards are compiled in
  // (shallow-data.js equals the shared bundle), so they render at once and saved copies merge in.
  const [cards, setCards] = useState(CARDS)
  const [prompts, setPrompts] = useState(() => Object.fromEntries(CARDS.map((row) => [row.id, row.prompt])))
  const [drafts, setDrafts] = useState({})
  const [loadError, setLoadError] = useState(null)
  const [messages, setMessages] = useState({})
  const [busy, setBusy] = useState({})
  const [storageError, setStorageError] = useState('')
  const [revision, setRevision] = useState(0)
  const [accountLoaded, setAccountLoaded] = useState(!HAS_LIBRARY)
  const [libraryLoading, setLibraryLoading] = useState(HAS_LIBRARY)
  useEffect(() => {
    if (!HAS_LIBRARY) return
    let active = true
    setLoadError(null)
    setAccountLoaded(false)
    setLibraryLoading(true)
    Promise.all([api('/shallow/catalog'), api('/shallow/harnesses')]).then(([catalog, library]) => {
      if (!active) return
      if (!Array.isArray(catalog?.harnesses) || !Array.isArray(library?.harnesses)) throw new Error('The harness catalog could not be read.')
      const saved = new Map(library.harnesses.filter((row) => row.lane === 'fixed').map((row) => [row.id, row]))
      const rows = catalog.harnesses.map((row) => ({ ...row,
        ...(saved.has(row.id) ? { prompt: saved.get(row.id).prompt, hash: saved.get(row.id).hash } : {}),
        savedHere: saved.has(row.id) && !(library.unconfirmed || []).includes(row.id),
        saveUnconfirmed: (library.unconfirmed || []).includes(row.id),
      }))
      const restored = readDraft('fixed') || {}
      const stock = new Map(catalog.harnesses.map((row) => [row.id, row]))
      // A draft typed on the compiled-in card before the library answered has no base yet: it was
      // written against the stock prompt with no saved copy, so it saves create-only (if_absent)
      // and a copy saved meanwhile comes back as a conflict instead of being overwritten.
      const based = (row) => /^[a-f0-9]{12}$/.test(restored[row.id]?.baseHash) ? restored[row.id]
        : restored[row.id]?.baseHash === undefined && /^[a-f0-9]{12}$/.test(stock.get(row.id)?.hash) ? { ...restored[row.id], baseHash: stock.get(row.id).hash, basePresent: false } : null
      const valid = Object.fromEntries(rows.filter((row) => typeof restored[row.id]?.prompt === 'string' && based(row)).map((row) => [row.id, { ...based(row), restored: true }]))
      setCards(rows)
      setAccountLoaded(library.loaded === true)
      setDrafts(valid)
      setPrompts(Object.fromEntries(rows.map((row) => [row.id, valid[row.id]?.prompt ?? row.prompt])))
      setMessages(Object.fromEntries((library.unconfirmed || []).map((id) => [id, `${libraryPlace()} has not confirmed this prompt. Your draft is still pending.`])))
    }).catch((error) => { if (active) setLoadError(error) })
      .finally(() => { if (active) setLibraryLoading(false) })
    return () => { active = false }
  }, [revision])

  function edit(row, value) {
    setPrompts((cur) => ({ ...cur, [row.id]: value }))
    setMessages((cur) => ({ ...cur, [row.id]: '' }))
    if (!HAS_LIBRARY) return
    setDrafts((cur) => {
      const next = { ...cur, [row.id]: { prompt: value, baseHash: cur[row.id]?.baseHash || row.hash,
        basePresent: cur[row.id]?.basePresent ?? row.savedHere } }
      if (value === row.prompt && accountLoaded && !row.saveUnconfirmed) delete next[row.id]
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
        ...((drafts[row.id]?.basePresent ?? row.savedHere)
          ? { if_hash: drafts[row.id]?.baseHash || row.hash } : { if_absent: true }),
      } }))
      setCards((cur) => cur.map((card) => card.id === row.id ? { ...card, prompt: result.harness.prompt, hash: result.harness.hash, savedHere: true, saveUnconfirmed: false } : card))
      setDrafts((cur) => {
        const next = { ...cur }
        delete next[row.id]
        setStorageError(writeDraft('fixed', next))
        return next
      })
      setPrompts((cur) => ({ ...cur, [row.id]: result.harness.prompt }))
      setMessages((cur) => ({ ...cur, [row.id]: SAVED }))
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

  if (loadError && !cards) return <><ErrorState error={loadError} what="Your fixed harnesses" onRetry={() => setRevision((n) => n + 1)} /></>
  if (!cards) return <Loading label="Reading your fixed harnesses…" />
  return (
    <div className="rg-dpad rg-harness" data-el="shallow-cards">
      <HarnessNav active="fixed" args={args} />
      <PageHeader title="Fixed harnesses" subtitle="Edit the standing prompt. Keep the shell."
        lede="These six stand-ins use TraceHarness lab choices, not verified vendor limits. Tools, permissions, and limits stay fixed while you refine the instructions." />
      <EvidenceOrigin args={args} />
      <p className="rg-small rg-mute" data-el="copy-not-app">Each card is a TraceHarness copy of an app's prompt and tools, run by the TraceHarness engine. To run the app itself, choose its “— your installed app” entry in One run.</p>
      <div className="rg-harness-toolbar" data-tour="harness-toolbar">
        <span className="rg-harness-label">6 shells · prompt editing</span>
        <Go spec={withEvidenceOrigin('shallowApply', evidenceOrigin(args))} className="rg-btn" el="preview-six-shells">Preview one prompt across six shells</Go>
      </div>
      {HAS_LIBRARY && !accountLoaded && !libraryLoading && <p role="alert">{loadError ? loadError.message + ' ' : ''}Your harnesses saved to {LIBRARY.label} have not loaded. Saving is unavailable. <button type="button" className="rg-btn" onClick={() => setRevision((n) => n + 1)}>Retry saved harnesses</button></p>}
      <details className="rg-harness-rules" data-tour="harness-rules"><summary>Permissions and saving</summary><p className="rg-harness-note">{PERMISSION} {HAS_LIBRARY && accountLoaded ? `Drafts stay in this tab until you save them to ${LIBRARY.label}. Saving does not run a model.` : 'Nothing on this screen is saved, and nothing here calls a model.'}</p></details>
      <div className="rg-harness-grid" data-tour="harness-grid">
        {storageError && <p role="alert">{storageError}</p>}
        {cards.map((row) => {
          const value = prompts[row.id]
          const used = utf8Size(value)
          const clipped = clipUtf8(value, row.cap_bytes)
          const dropsVerify = !clipped.includes("verify") || !clipped.includes("modify the tests")
          return (
            <article key={row.id} className="rg-harness-card" data-agent={row.id}>
              <div className="rg-harness-card-head"><div><div className="rg-harness-label">{row.max_steps} steps · strict policy</div><h2><BrandName kind="agent" name={row.name}>{standInName(row.name)}</BrandName></h2></div><span className={`rg-harness-tag${drafts[row.id] || value !== row.prompt ? ' draft' : ''}`}>{drafts[row.id] || value !== row.prompt ? 'Draft' : row.savedHere && accountLoaded ? `Saved to ${LIBRARY.label}` : 'Fixed shell'}</span></div>
              <div className="rg-harness-card-body">
                <ToolChips tools={row.tools} />
                <label className="rg-fld">Standing prompt for {row.name}
                  <textarea className="rg-inp" rows={8} value={value} disabled={!!busy[row.id]} onChange={(e) => edit(row, e.target.value)} spellCheck={false} />
                </label>
                <ByteMeter used={used} cap={row.cap_bytes} name={row.name} />
                <HarnessJson source={value !== row.prompt ? 'Current prompt draft' : row.savedHere ? `Preset saved to ${LIBRARY.label}` : 'Stock preset'} description="Every supplied preset field and the current prompt. This is not the vendor’s native runtime configuration."
                  documents={[{ id: 'preset', label: 'Preset configuration', value: { ...row, prompt: value }, filename: `harness-${row.id}.json` }]} />
                {used > row.cap_bytes || dropsVerify ? <p className="rg-harness-warning">This prompt is over the byte cap, or the clipped text drops verify and modify the tests.</p> : null}
                <div className="rg-harness-actions">
                  {HAS_LIBRARY && <button type="button" className="rg-btn pri" disabled={!accountLoaded || !!busy[row.id] || !value.trim()} aria-busy={!!busy[row.id] || undefined} onClick={() => save(row)}>{busy[row.id] ? 'Saving…' : 'Save harness'}</button>}
                  {value !== row.prompt ? <button type="button" className="rg-btn" disabled={!!busy[row.id]} onClick={() => edit(row, row.prompt)}>Reset prompt</button> : null}
                  {drafts[row.id] && <><span className="rg-small">{drafts[row.id].restored ? 'Restored unsaved draft from this tab' : 'Unsaved draft'}</span><button type="button" className="rg-btn" disabled={Object.values(busy).some(Boolean)} onClick={() => discardAndReload(row.id)}>Discard draft and reload saved prompt</button></>}
                </div>
                {messages[row.id] && <p role={messages[row.id] === SAVED ? 'status' : 'alert'} className="rg-harness-status">{messages[row.id]}</p>}
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
    crumbs: (args) => [['Harnesses', withEvidenceOrigin('harnesses', evidenceOrigin(args))], ['Fixed harnesses']],
    render: ShallowCards,
    palette: () => [{ title: "Fixed harnesses", detail: "six shallow stand-ins", spec: "shallowCards", keywords: "claude codex qwen kimi grok agy antigravity" }],
  },
}
