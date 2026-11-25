/* A path as the page shows it: the home folder (/Users/<you>, /home/<you>, C:\Users\<you>) becomes ~.
   Display only; the value a control sends or a command copies stays the full path. */
const HOME = /^(\/Users\/(?!Shared(?:\/|$))[^/]+|\/home\/[^/]+|[A-Za-z]:\\Users\\[^\\]+)(?=$|[/\\])/

/** @param {string | null | undefined} path @returns {string} */
export function tildeHome(path) {
  const s = path == null ? '' : String(path)
  const m = s.match(HOME)
  return m ? '~' + s.slice(m[1].length) : s
}
