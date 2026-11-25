/* Rig · PagePath.jsx — the title of a page that a section's row and one of its child rows both open (navTree.pagePath):
   "Harnesses › Experiments", the section's name muted before the row's. So the left list's Harnesses and its
   Experiments row each land on a page whose title says their name. Any other page keeps its own title (`children`). */
import { pagePath } from './navTree'
import './PagePath.css'

export function PagePath({ kind, args, children }) {
  const p = pagePath(kind, args)
  if (!p) return children
  return <><span className="rg-ph-in">{p[0]} ›</span> {p[1]}</>
}
