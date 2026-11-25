/* Rig · learn/LearnMore.jsx — the "Learn more" line at the end of a page's "About this view" text:
   a link to each article that explains the page. Kept apart from Learn.jsx so a view can import it
   without the whole Learn page. */
import { Fragment } from 'react'
import { useRig } from '../context'
import { Go } from '../ui'
import { articleById } from './articles'
import { articleSpec } from './routes'
import { canSee } from './gate'

export function LearnMore({ ids }) {
  const { lab } = useRig()
  const list = (ids || []).map(articleById).filter(Boolean)
  if (!list.length || !canSee('articles', lab)) return null
  return (
    <p className="rg-learn-more" data-el="learn-more">Learn more: {list.map((a, i) => (
      <Fragment key={a.id}>{i ? ' · ' : ''}<Go link className="rg-tlink" spec={articleSpec(a.id)}>{a.title}</Go></Fragment>
    ))}</p>
  )
}
