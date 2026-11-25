/* Rig · learn/LearnNav.jsx — the list of every Learn page (Learn, the articles, the glossary and, with Student Lab
   on, the guides). The glossary and the guides show it as a left list beside the page (LearnFrame); an article
   shows it inside its "All articles" picker. The page in view is marked and inert (Go's "you are here"). */
import { useRig } from '../context'
import { Go } from '../ui'
import { ARTICLES } from './articles'
import { LEARN_HOME, articleSpec, glossarySpec } from './routes'
import { canSee } from './gate'

const cx = (...a) => a.filter(Boolean).join(' ')
export const GUIDES = [['guide', 'Reading guide', 'Student Lab · start here'], ['package', 'Reference materials', 'The handout, the lab sheet and the glossary.']]

export function LearnNav({ current }) {
  const { lab } = useRig()
  const item = (spec, label, on, n) => (
    <li key={spec}><Go link replace spec={spec} current={on} className={cx('rg-learn-ni', on && 'on')}>{n != null && <span className="n">{n}</span>}<span>{label}</span></Go></li>
  )
  const guides = GUIDES.filter(([k]) => canSee(k, lab))
  return (
    <nav className="rg-learn-nav" aria-label="Learn" data-el="learn-nav">
      <ul>{item(LEARN_HOME, 'All of Learn', current === 'learn')}</ul>
      {canSee('articles', lab) && <><p className="rg-lbl rg-learn-nh">Articles</p><ol>{ARTICLES.map((a) => item(articleSpec(a.id), a.title, current === a.id, a.number))}</ol></>}
      {canSee('glossary', lab) && <ul>{item(glossarySpec(), 'Glossary', current === 'glossary')}</ul>}
      {guides.length > 0 && <><p className="rg-lbl rg-learn-nh">Student Lab</p><ul>{guides.map(([k, label]) => item(k, label, current === k))}</ul></>}
    </nav>
  )
}

/** The page beside the left list. On a narrow pane the list moves under the page. */
export function LearnFrame({ current, children }) {
  return <div className="rg-learn"><div className="rg-learn-main">{children}</div><LearnNav current={current} /></div>
}
