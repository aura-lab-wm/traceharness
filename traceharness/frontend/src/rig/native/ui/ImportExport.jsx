import { useId, useRef, useState } from 'react'
import { readTextFile } from './download'
import { IMPORT_MAX_BYTES } from './useWorkbench'

/**
 * Files: the member's own copy of an intervention. Import reads a profile, a bundle, a
 * configuration export or an agent-patcher block dump; nothing in a file is fetched or executed,
 * and the result passes the same checks as any edit. Exports hold edits and digests; only
 * "Download inventory JSON" contains baseline text.
 */
export function ImportExport({ wb }) {
  const id = useId()
  const input = useRef(null)
  const [reading, setReading] = useState(false)
  const stale = !!wb.profileIssue
  async function choose(event) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setReading(true)
    try {
      const text = await readTextFile(file, IMPORT_MAX_BYTES)
      await wb.importText(text, file.name)
    } catch (failure) { wb.setError(failure instanceof Error && failure.message ? failure.message : 'The file could not be read.') } finally { setReading(false) }
  }
  const row = (key, button, description) => <li key={key} className="rg-native-file-row">{button}<span className="rg-native-file-desc" id={id + key}>{description}</span></li>
  return <section className="rg-native-block" aria-labelledby={id + 'h'}>
    <div className="rg-native-block-head"><h3 id={id + 'h'}>Files</h3></div>
    <ul className="rg-native-files">
      {row('import', <button type="button" className="rg-btn" aria-describedby={id + 'import'} disabled={wb.disabled || reading} onClick={() => input.current?.click()}>{reading ? 'Reading file…' : 'Import profile file'}</button>,
        'A profile, a profile bundle, a configuration export or an agent-patcher block dump, up to 1.5 MiB. It replaces the draft as one step that Undo reverses; nothing in it is executed.')}
      {row('profile', <button type="button" className="rg-btn" aria-describedby={id + 'profile'} onClick={() => wb.exportFile('profile')}>Export profile</button>,
        'The exact schema-1 profile as canonical JSON. Its SHA-256 equals native_prompt_profile_sha256 in the manifest of a run that used it.')}
      {row('bundle', <button type="button" className="rg-btn" aria-describedby={id + 'bundle'} onClick={() => wb.exportFile('bundle')}>Export bundle</button>,
        'The profile with its name, named sets and digest, for sharing. The runner never reads a bundle, only the profile inside it.')}
      {row('blocks', <button type="button" className="rg-btn" aria-describedby={id + 'blocks'} disabled={stale} onClick={() => wb.exportFile('agent-patcher-blocks')}>Export agent-patcher blocks</button>,
        stale ? 'Available once the draft belongs to the current inventory.'
          : 'A block dump of { id, body, source_path } for the stand-alone agent-patcher. Fragments whose placeholders would need renaming are skipped and listed.')}
      {row('inventory', <button type="button" className="rg-btn" aria-describedby={id + 'inventory'} onClick={wb.downloadInventory}>Download inventory JSON</button>,
        'The exact public inventory, including every baseline text: the input of the offline traceharness native-prompts commands. Handle it as you handle the runtime itself.')}
    </ul>
    <input ref={input} className="sr-only" type="file" accept="application/json,.json" tabIndex={-1} aria-label="Import profile file" onChange={choose} />
  </section>
}
