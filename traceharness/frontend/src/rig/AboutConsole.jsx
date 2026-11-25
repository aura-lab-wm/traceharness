/* ====================================================================================
   Rig · AboutConsole.jsx — "About this console" in Settings (SPEC 4.3).

   Which console this tab is: the package version and the shared sources compiled into it, the UI
   build (__HL_BUILD__, the hash of the source the bundle was built from) and the mode.
     local    also reads the server's own stamp (GET /api/version) and asks for a reload when the
              server serves a different UI build or different shared sources than this tab.
     export   asks nothing: the file is what it is.
   Every value is drawn as text; the stamps carry versions, digests and dates only.
   ==================================================================================== */
import { MODE } from '../environment'
import { SHARED, SHARED_SHA256 } from '../shared/index.js'
import { useApi } from './data'
import { BUILD } from './buildWatch'

const HEX64 = /^[0-9a-f]{64}$/
const short = (hex) => (typeof hex === 'string' && HEX64.test(hex) ? hex.slice(0, 12) : null)

/** The local server's stamp, when it is one: { ui, shared } digests (ui may be null). */
function serverStampOf(d) {
  if (!d || typeof d !== 'object' || d.schema !== 1 || d.component !== 'package') return null
  if (!HEX64.test(String(d.shared_sources_sha256))) return null
  const ui = typeof d.ui_source_sha256 === 'string' && HEX64.test(d.ui_source_sha256) ? d.ui_source_sha256 : null
  return { ui, shared: d.shared_sources_sha256, version: typeof d.package_version === 'string' ? d.package_version : null }
}

function LocalServer() {
  const answer = useApi('/version')
  if (answer.loading && !answer.data) return <p className="rg-small rg-mute" data-el="about-server">Reading the server&apos;s build…</p>
  const server = serverStampOf(answer.data)
  if (!server) return <p className="rg-small rg-mute" data-el="about-server">The server did not report its build.</p>
  const differs = server.shared !== SHARED_SHA256 || (server.ui !== null && BUILD !== null && server.ui !== BUILD)
  return <>
    <p className="rg-small rg-dim" data-el="about-server">Server · UI build {short(server.ui) || 'not stamped'} · shared sources {short(server.shared)}</p>
    {differs && <p className="rg-small rg-amb" data-el="about-drift" role="status">The server is a different build; reload this tab.</p>}
  </>
}

export function AboutConsole() {
  return (
    <section className="rg-ws-sec" data-el="about-console" aria-label="About this console">
      <div className="rg-ws-sech"><h2>About this console</h2><span className="rg-ws-meta">{MODE}</span></div>
      <dl className="rg-kv rg-ws-kv">
        <dt>package version</dt><dd className="rg-mono">{SHARED.package_version}</dd>
        <dt>UI build</dt><dd className="rg-mono">{short(BUILD) || 'not stamped'}</dd>
        <dt>shared sources</dt><dd className="rg-hash">{short(SHARED_SHA256)}</dd>
        <dt>mode</dt><dd className="rg-mono">{MODE}</dd>
      </dl>
      {MODE === 'local' && <LocalServer />}
    </section>
  )
}
