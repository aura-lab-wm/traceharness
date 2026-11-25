/* The build puts every logo inside the stylesheet, so the app and an exported HTML file (which inlines the
   stylesheet but not the files it points to) show them with no network and no second file. */
import { describe, it, expect } from 'vitest'
import { readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import config from '../../../vite.config.js'

const DIR = fileURLToPath(new URL('./', import.meta.url))
const inline = config.build.assetsInlineLimit

describe('the logos in the build', () => {
  it('every logo file is inlined whatever its size; other pictures keep the usual limit; the fonts stay inlined', () => {
    const big = Buffer.alloc(64 * 1024)
    const svgs = readdirSync(DIR).filter((f) => f.endsWith('.svg'))
    expect(svgs.length).toBeGreaterThan(0)
    for (const f of svgs) expect(inline(join(DIR, f), big), f).toBe(true)
    expect(inline(join(DIR, '..', 'picture.svg'), big)).toBeUndefined()
    expect(inline('/app/src/rig/brandnew/x.svg', big)).toBeUndefined()
    expect(inline('/app/src/fonts/x.woff2', big)).toBe(true)
  })
})
