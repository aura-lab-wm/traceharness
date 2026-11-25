/* Rig · patch-files.js — the files a recorded patch.diff names, and what it did to each. PURE.

     patchFiles(patch)   [{ path, kind: 'changed' | 'created' | 'deleted' }] in order of first mention; [] for no patch
   The same reading as traceharness/core/patch_kinds.py: only a file's header lines (before its first hunk) are read,
   so a removed line that starts with "--" is not taken for a file. */

const strip = (p) => (p.startsWith('a/') || p.startsWith('b/') ? p.slice(2) : p)

function headerOf(block) {
  const at = block.search(/^@@/m)
  return at < 0 ? block : block.slice(0, at)
}

export function patchFiles(patch) {
  const out = new Map()
  const add = (path, kind) => { if (path && !out.has(path)) out.set(path, kind) }
  for (const block of String(patch || '').split(/^(?=diff --git )/m)) {
    const head = /^diff --git a\/(\S+) b\/(\S+)/.exec(block)
    if (head) {
      const h = headerOf(block)
      const pair = /^--- (\S+)[^\n]*\n\+\+\+ (\S+)/m.exec(h)
      if (/^new file mode/m.test(h) || (pair && pair[1] === '/dev/null')) add(head[2], 'created')
      else if (/^deleted file mode/m.test(h) || (pair && pair[2] === '/dev/null')) add(head[1], 'deleted')
      else add(head[2], 'changed')
      continue
    }
    for (const m of block.matchAll(/^--- (\S+)[^\n]*\n\+\+\+ (\S+)[^\n]*\n@@/gm)) {
      if (m[1] === '/dev/null') add(strip(m[2]), 'created')
      else if (m[2] === '/dev/null') add(strip(m[1]), 'deleted')
      else add(strip(m[2]), 'changed')
    }
  }
  return [...out].map(([path, kind]) => ({ path, kind }))
}
