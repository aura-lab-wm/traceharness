import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

async function render(win, props) {
  vi.resetModules()
  vi.stubGlobal('window', win)
  const { Unavailable } = await import('./unavailable.js')
  return renderToStaticMarkup(createElement(Unavailable, props))
}
afterEach(() => vi.unstubAllGlobals())

describe('Unavailable', () => {
  it('says why, on a note that names the capability and the reason', async () => {
    const html = await render({ __TRACEHARNESS_DATA__: {} }, { capability: 'harness.save', what: 'Saving' })
    expect(html).toBe('<div class="rg-note" data-el="unavailable-note" data-capability="harness.save" '
      + 'data-reason="export_read_only">Saving is not available in a read-only export. Start the local console: '
      + 'python -m traceharness --host 127.0.0.1 --port 8765</div>')
  })

  it('takes its own data-el', async () => {
    const html = await render({}, { capability: 'run.container', what: 'Running a task', el: 'runner-note' })
    expect(html).toContain('data-el="runner-note"')
    expect(html).toContain('data-reason="runner_not_ready"')
    expect(html).toContain('Running a task needs the local runner. Run traceharness runner setup (Docker required).')
  })

  it('renders nothing when the capability is available', async () => {
    expect(await render({}, { capability: 'run.local', what: 'Running' })).toBe('')
  })
})
