/* Rig · brand/BrandMark.jsx — the logo of a model, agent or source beside its name (brands.js picks it,
   brand.css draws it from the files in this folder). Decorative: the name beside it says what it is, so it is
   hidden from screen readers and takes no room when no rule claims the name.

   <BrandMark kind="model"|"harness"|"agent"|"source"|"dataset" name/>
   <BrandName kind name>text</BrandName>   the text with its logo held to its first part (so the logo never ends a line
                                           alone); the plain text when no rule claims the name
   <BrandMarks kind names/>   one logo per distinct brand of a list (a dataset's models), none when no name has one
   <SourceName source/>       "Hugging Face" with its logo when a dataset was fetched from there, else nothing */
import { BRANDS, brandOf, brandsOf, sourceBrandOf } from './brands'
import './brand.css'

function Mark({ id }) {
  return <i className="rg-logo" data-brand={id} data-ink={BRANDS[id].ink} aria-hidden="true" />
}

export function BrandMark({ kind, name }) {
  const id = brandOf(kind, name)
  return id ? <Mark id={id} /> : null
}

export function BrandMarks({ kind, names, className }) {
  const ids = brandsOf(kind, names)
  if (!ids.length) return null
  return <span className={['rg-logos', className].filter(Boolean).join(' ')} aria-hidden="true">{ids.map((id) => <Mark key={id} id={id} />)}</span>
}

export function BrandName({ kind, name, children }) {
  const text = String(children ?? name ?? '')
  const id = brandOf(kind, name)
  if (!id) return text
  const [head, ...tail] = text.split(/(?<=[-_/+\s])(?=\S)/)
  return <><span className="rg-logo-n"><Mark id={id} />{head}</span>{tail.join('')}</>
}

export function SourceName({ source, el = 'dataset-source', className }) {
  const id = sourceBrandOf(source)
  if (!id) return null
  return <span className={['rg-logo-src', className].filter(Boolean).join(' ')} data-el={el}><Mark id={id} />{BRANDS[id].label}</span>
}
