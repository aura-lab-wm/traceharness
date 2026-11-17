/* ====================================================================================
   Rig · AboutConsole.jsx — "About this console" in Settings (SPEC 4.3).

   Which console this tab is: the package version and the shared sources compiled into it, the UI
   build (__HL_BUILD__, the hash of the source the bundle was built from) and the mode.
     local    also reads the server's own stamp (GET /api/version) and asks for a reload when the
              server serves a different UI build or different shared sources than this tab.
     member   also reads the site's stamp (fetchSiteVersion: one same-origin GET of /api/version)
              and shows its snapshot's version and date, and says so when the site and this
              console were built from different shared sources. Any failure: "site version not
              reported", nothing else.
     export   asks nothing: the file is what it is.
   Every value is drawn as text; the stamps carry versions, digests and dates only.
   ==================================================================================== */
import { useEffect, useState } from 'react'
import { MODE } from '../environment'
import { SHARED, SHARED_SHA256 } from '../shared/index.js'
import { fetchSiteVersion } from '../site-version'
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

function MemberSite() {
  const [site, setSite] = useState(undefined)   // undefined while asking, null when not reported
  useEffect(() => {
    let alive = true
    fetchSiteVersion().then((v) => { if (alive) setSite(v) })
    return () => { alive = false }
  }, [])
  if (site === undefined) return <p className="rg-small rg-mute" data-el="about-site">Reading the site&apos;s version…</p>
  if (site === null) return <p className="rg-small rg-mute" data-el="about-site">site version not reported</p>
  const snap = site.app_snapshot
  return <>
    <dl className="rg-kv" data-el="about-site">
      <dt>site snapshot</dt><dd className="rg-mono">{snap ? `${snap.package_version} · published ${snap.published_at.slice(0, 10)}` : 'not recorded'}</dd>
      <dt>site shared sources</dt><dd className="rg-mono">{short(site.shared_sources_sha256)}</dd>
    </dl>
    {site.shared_sources_sha256 !== SHARED_SHA256 && <p className="rg-small rg-amb" data-el="about-drift" role="status">This console and the site were built from different shared sources.</p>}
  </>
}

export function AboutConsole() {
  return (
    <section className="rg-ws-sec" data-el="about-console" aria-label="About this console">
      <div className="rg-ws-sech"><h2>About this console</h2><span className="rg-ws-meta">{MODE}</span></div>
      <dl className="rg-kv rg-ws-kv">
        <dt>package version</dt><dd className="rg-mono">{SHARED.package_version}</dd>
        <dt>UI build</dt><dd className="rg-mono">{short(BUILD) || 'not stamped'}</dd>
        <dt>shared sources</dt><dd className="rg-mono">{short(SHARED_SHA256)}</dd>
        <dt>mode</dt><dd className="rg-mono">{MODE}</dd>
      </dl>
      {MODE === 'local' && <LocalServer />}
      {MODE === 'member' && <MemberSite />}
    </section>
  )
}
