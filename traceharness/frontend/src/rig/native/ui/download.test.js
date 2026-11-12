// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { copyText, downloadText, readTextFile, safeFileName } from './download'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('workbench file helpers', () => {
  it('reduces any requested name to a conservative file name', () => {
    expect(safeFileName('native-prompt-profile-native-claude-code-4c1d09aa77e2.json')).toBe('native-prompt-profile-native-claude-code-4c1d09aa77e2.json')
    expect(safeFileName('../../etc/passwd')).toBe('etc-passwd')
    expect(safeFileName('Lean tools: v2 <script>.json')).toBe('Lean-tools-v2-script-.json')
    expect(safeFileName('…')).toBe('traceharness-export.txt')
    expect(safeFileName(null, 'fallback.json')).toBe('fallback.json')
    expect(safeFileName('a'.repeat(300)).length).toBe(120)
  })

  it('offers text as a download through a temporary object URL', async () => {
    let blob
    vi.stubGlobal('URL', class extends URL { static createObjectURL(value) { blob = value; return 'blob:fixture' } static revokeObjectURL() {} })
    let anchor
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () { anchor = this })
    expect(downloadText('profile v1.json', '{"a":1}\n')).toBe(true)
    expect(click).toHaveBeenCalledTimes(1)
    expect(anchor.download).toBe('profile-v1.json')
    expect(blob.type).toBe('application/json')
    expect(await new Promise((resolve) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.readAsText(blob) })).toBe('{"a":1}\n')
  })

  it('reports failure instead of throwing when a file cannot be created', () => {
    vi.stubGlobal('URL', class extends URL { static createObjectURL() { throw new Error('blocked') } })
    expect(downloadText('x.json', '{}')).toBe(false)
  })

  it('refuses an oversized file before reading it and reads an accepted one', async () => {
    const read = vi.fn(() => Promise.resolve('{}'))
    await expect(readTextFile({ size: 3 * 1024 * 1024, text: read }, 1.5 * 1024 * 1024)).rejects.toThrow(/larger than 1\.5 MiB and was not read/)
    expect(read).not.toHaveBeenCalled()
    await expect(readTextFile({ size: 2, text: read }, 10)).resolves.toBe('{}')
    await expect(readTextFile(new File(['{"k":"λ"}'], 'p.json'), 100)).resolves.toBe('{"k":"λ"}')
    await expect(readTextFile(null, 10)).rejects.toThrow(/Choose a file/)
  })

  it('copies when the clipboard allows it and says so when it does not', async () => {
    const writeText = vi.fn(() => Promise.resolve())
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    expect(await copyText('abc')).toBe(true)
    expect(writeText).toHaveBeenCalledWith('abc')
    vi.stubGlobal('navigator', { clipboard: { writeText: () => Promise.reject(new Error('denied')) } })
    expect(await copyText('abc')).toBe(false)
    vi.stubGlobal('navigator', {})
    expect(await copyText('abc')).toBe(false)
  })
})
