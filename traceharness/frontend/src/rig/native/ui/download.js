// File hand-off helpers for the workbench: save text the member asked for, read a file the member
// chose, copy a value. Nothing is fetched, uploaded or executed here.

/** A conservative file name: ASCII letters, digits, dot, dash, underscore; at most 120 characters. */
export function safeFileName(name, fallback = 'traceharness-export.txt') {
  const cleaned = String(name ?? '').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/-{2,}/g, '-').replace(/^[-.]+|-+$/g, '').slice(0, 120)
  return cleaned && /[A-Za-z0-9]/.test(cleaned) ? cleaned : fallback
}

/** Offer `text` as a download. Returns false when this environment cannot create a file. */
export function downloadText(filename, text, type = 'application/json') {
  try {
    const url = URL.createObjectURL(new Blob([text], { type }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = safeFileName(filename)
    anchor.rel = 'noopener'
    anchor.click()
    setTimeout(() => { try { URL.revokeObjectURL(url) } catch { /* Already released. */ } }, 1000)
    return true
  } catch { return false }
}

/** Read a chosen file as text, refusing anything above `maxBytes` before it is read. */
export async function readTextFile(file, maxBytes) {
  if (!file || typeof file.size !== 'number') throw new Error('Choose a file to import.')
  if (file.size > maxBytes) throw new Error('This file is larger than ' + (maxBytes / (1024 * 1024)).toLocaleString(undefined, { maximumFractionDigits: 1 }) + ' MiB and was not read.')
  const text = typeof file.text === 'function' ? await file.text() : await new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('The file could not be read.'))
    reader.readAsText(file)
  })
  if (typeof text !== 'string') throw new Error('The file could not be read.')
  return text
}

/** Copy to the clipboard. Returns false when the browser refuses, so the caller can say so. */
export async function copyText(text) {
  try {
    if (!globalThis.navigator?.clipboard?.writeText) return false
    await globalThis.navigator.clipboard.writeText(String(text))
    return true
  } catch { return false }
}
