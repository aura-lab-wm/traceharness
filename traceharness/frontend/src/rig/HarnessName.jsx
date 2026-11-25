/* Rig · HarnessName.jsx — a harness name that says what the harness is.

   <HarnessName id dir? children?/>   the name, with a hover card (also on focus and tap) giving its notes, its
                                      recorded limits and where the notes come from: the dataset's own runs, else
                                      its file in harnesses/. A click (or Enter) pins the card open, as the (i)
                                      does; it is a tinted chip, not underlined like a link, because it opens no
                                      page. A name nothing is known about stays a plain name.
   useHarnessNote(id, dir)           { notes, max_steps?, tools?, policy?, from, sentinel? } or null.
   harnessLine(note)                 "notes · max 6 steps · 2 tools · strict policy", the short line a picker shows. */
import { useDataset, useOverview } from './data'
import { HoverCard } from './HoverCard'
import { harnessNote, harnessFacts } from './datasetInfo'

export function useHarnessNote(id, dir) {
  const row = useDataset(dir).data
  const ov = useOverview().data
  return harnessNote(id, row, ov && ov.harnesses)
}

export const harnessLine = (n) => (n ? [n.notes, harnessFacts(n)].filter(Boolean).join(' · ') : '')

export function HarnessCard({ id, note }) {
  return (
    <span className="rg-hnc">
      <b className="rg-mono">{id}</b>
      <span>{note.notes}</span>
      {harnessFacts(note) && <span className="rg-mono rg-hnc-f">{harnessFacts(note)}</span>}
      <span className="rg-mute">{note.from === 'recorded' ? 'Notes as recorded with these runs.' : `Notes from harnesses/${String(id).replace(/\+sentinel$/, '')}.json.`}
        {note.sentinel ? ' The +sentinel twin adds the Sentinel early warning to that harness.' : ''}</span>
    </span>
  )
}

export function HarnessName({ id, dir, children }) {
  const note = useHarnessNote(id, dir)
  const text = children == null ? id : children
  if (!note) return text
  return (
    <HoverCard portal toggle className="rg-hn-hc" content={<HarnessCard id={id} note={note} />}>
      <span className="rg-hn" role="button" tabIndex={0} data-harness={id}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.currentTarget.click() } }}>{text}</span>
    </HoverCard>
  )
}

/** The same card, in place (the inspector's column view); says so when nothing is recorded. */
export function HarnessAbout({ id, dir }) {
  const note = useHarnessNote(id, dir)
  return note ? <HarnessCard id={id} note={note} /> : <p className="rg-insp-p">No notes recorded for {id}, and no file in harnesses/ names it.</p>
}
