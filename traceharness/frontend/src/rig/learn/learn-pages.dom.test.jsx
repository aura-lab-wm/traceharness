// @vitest-environment jsdom
/* Learn: the index reads as a path, an article says what to know first and what is on the page,
   credits stay credits (no process notes), and a glossary link lands on its entry, highlighted. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, screen, within } from '@testing-library/react'
import { renderRig, resetRig } from '../../../test/rig-testing'
import { ARTICLES, PARTS, articleById } from './articles'

const doc = () => document.querySelector('.rg-doc')
let restore = []
afterEach(() => { restore.forEach((f) => f()); restore = []; resetRig() })

describe('the Learn index', () => {
  it('lists all 14 articles as a reading path in parts, marks the how-tos, and makes no "short pages" claim', () => {
    renderRig('#/rig/guide:learn')
    const index = document.querySelector('[data-el="learn-index"]')
    const specs = [...index.querySelectorAll('ol a[data-spec]')].map((a) => a.getAttribute('data-spec'))
    expect(specs).toEqual(ARTICLES.map((a) => `guide:${a.id}`))
    const parts = [...index.querySelectorAll('[data-el="learn-part"]')]
    expect(parts.map((p) => p.querySelector('h2').textContent)).toEqual(PARTS.map((p) => `Part ${p.id}. ${p.title}`))
    expect(doc().textContent).toContain('Suggested reading path')
    expect(doc().textContent).not.toMatch(/short pages|short articles/i)
    const howto = index.querySelector('a[data-spec="guide:make-and-run-a-harness"]')
    expect(howto.textContent).toContain('How-to')
    expect(howto.textContent).toMatch(/\d+ min/)
  })
})

describe('an article page', () => {
  it('has a byline with the date its sources were checked, what to know first, and what is on the page', () => {
    const a = articleById('model-or-harness')
    renderRig(`#/rig/guide:${a.id}`)
    const by = document.querySelector('[data-el="learn-byline"]')
    expect(by.textContent).toMatch(/Sources checked \d{1,2} [A-Z][a-z]+ 20\d\d/)
    expect(by.textContent).toMatch(/about \d+ min/)
    const pre = document.querySelector('[data-el="learn-prereq"]')
    for (const id of a.prerequisites.read) expect(pre.querySelector(`a[data-spec="guide:${id}"]`), id).toBeTruthy()
    const toc = document.querySelector('[data-el="learn-toc"]')
    const items = within(toc).getAllByRole('button').map((b) => b.textContent)
    expect(items).toEqual([...a.sections.map((s) => s.heading), 'Worked example', 'Try it', 'Quiz', 'Sources'])
    // a contents item brings its section into view (no hash link: the hash is the console's route)
    const target = [...document.querySelectorAll('.rg-learn-sec h2')].find((h) => h.textContent === a.sections[1].heading).closest('section')
    target.scrollIntoView = vi.fn()
    fireEvent.click(within(toc).getByRole('button', { name: a.sections[1].heading }))
    expect(target.scrollIntoView).toHaveBeenCalled()
    expect(location.hash).toContain(`guide:${a.id}`)
  })

  it('the first article says it needs nothing first; others link the articles to read before', () => {
    renderRig(`#/rig/guide:${ARTICLES[0].id}`)
    expect(document.querySelector('[data-el="learn-prereq"]').textContent).toMatch(/Before you start/)
  })

  it('shows no process notes in its sources, and every see-also row is a link', () => {
    for (const a of ARTICLES) {
      resetRig()
      renderRig(`#/rig/guide:${a.id}`)
      const src = document.querySelector('[data-el="learn-sources"]')
      expect(src.textContent, a.id).not.toMatch(/Checked:|curl|Council/i)
      expect(src.querySelectorAll('li'), a.id).toHaveLength(a.sources.length)
      for (const li of document.querySelectorAll('[data-el="learn-see-also"] li')) expect(li.querySelector('a'), `${a.id}: ${li.textContent}`).toBeTruthy()
    }
  })

  it('credits the second dataset of a worked example that uses two', () => {
    const a = articleById('why-runs-differ')
    renderRig(`#/rig/guide:${a.id}`)
    const we = document.querySelector('[data-el="learn-example"]')
    expect(we.textContent).toContain(a.worked_example.dataset2.name)
    expect(we.textContent).toContain('Trofimova')
  })

  it('each new article opens with its title, its quiz and its sources', () => {
    for (const id of ['where-runs-come-from', 'make-and-run-a-harness', 'traps-in-the-task', 'sentinel-early-warning', 'how-many-runs', 'model-or-harness']) {
      resetRig()
      renderRig(`#/rig/guide:${id}`)
      expect(screen.getByRole('heading', { level: 1, name: articleById(id).title }), id).toBeTruthy()
      expect(document.querySelectorAll('[data-el="learn-quiz"] fieldset'), id).toHaveLength(3)
      expect(document.querySelectorAll('[data-el="learn-sources"] li').length, id).toBeGreaterThanOrEqual(2)
    }
  })
})

describe('a glossary link', () => {
  /** Record, in order, every scroll of the page and every scrollIntoView, and run animation frames by hand. */
  function watchScroll() {
    const log = []
    const frames = []
    const raf = window.requestAnimationFrame
    window.requestAnimationFrame = (cb) => { frames.push(cb); return frames.length }
    const top = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop')
    Object.defineProperty(Element.prototype, 'scrollTop', { configurable: true, get() { return 0 }, set(v) { log.push(`top ${this.id || this.className} ${v}`) } })
    const into = Element.prototype.scrollIntoView
    Element.prototype.scrollIntoView = function () { log.push(`into ${this.id}`) }
    restore.push(() => { window.requestAnimationFrame = raf; Object.defineProperty(Element.prototype, 'scrollTop', top); Element.prototype.scrollIntoView = into })
    const flush = () => { for (let i = 0; i < 10 && frames.length; i++) act(() => { frames.splice(0).forEach((f) => f(0)) }) }
    return { log, flush }
  }

  it('opened from another page lands on its entry after the page scroll is reset, highlighted and focused', () => {
    renderRig(`#/rig/guide:${ARTICLES[0].id}`)
    const { log, flush } = watchScroll()
    fireEvent.click(document.querySelector('[data-el="learn-terms"] a[data-spec="guide:glossary:oracle-test-suite"]'))
    flush()
    const reset = log.lastIndexOf('top rig-doc-main 0')
    const landed = log.lastIndexOf('into glossary-oracle-test-suite')
    expect(reset, log.join(' | ')).toBeGreaterThanOrEqual(0)
    expect(landed, log.join(' | ')).toBeGreaterThan(reset)
    const row = document.getElementById('glossary-oracle-test-suite')
    expect(row.classList.contains('on')).toBe(true)
    expect(document.activeElement).toBe(row)
  })

  it('a row shows its other names: the old article term "work after the fix" stays on the after the fix row', () => {
    renderRig('#/rig/guide:glossary:after-the-fix')
    const on = document.querySelector('[data-el="glossary-row"][aria-current="true"]')
    expect(on.id).toBe('glossary-after-the-fix')
    expect(on.querySelector('dt').textContent).toContain('work after the fix')
  })
  it('an alias opens its row: flip-rate opens flip', () => {
    renderRig('#/rig/guide:glossary:flip-rate')
    const on = document.querySelector('[data-el="glossary-row"][aria-current="true"]')
    expect(on.id).toBe('glossary-flip')
  })
})

describe('steps, tags and credits read as what they are', () => {
  it('a step without a link says which step opened its page, so it reads as an instruction, not a broken control', () => {
    const a = articleById('run-cost-steps-vs-tokens')
    renderRig(`#/rig/guide:${a.id}`)
    const steps = [...document.querySelectorAll('[data-el="learn-try"] .rg-learn-steps > li')]
    const i = a.try_it.links.indexOf(null)
    expect(i).toBe(2)
    expect(steps[i].querySelector('a')).toBeNull()
    expect(steps[i].querySelector('[data-el="learn-step-same"]').textContent).toBe('on the page from step 2')
    // a step with its own link says nothing more
    expect(steps[1].querySelector('[data-el="learn-step-same"]')).toBeNull()
  })

  it('the phase list draws each phase as a tag', () => {
    renderRig('#/rig/guide:phases-and-wasted-work')
    const list = document.querySelector('.rg-learn-sec ul[data-el="learn-tags"]')
    expect([...list.querySelectorAll('li > code')].map((c) => c.textContent)).toEqual(['explore', 'reproduce', 'edit', 'test', 'lookup', 'env', 'submit', 'other'])
    expect(list.querySelectorAll('li')[2].textContent).toBe('edit: changing project files')
  })

  it('the glossary credits the student guide in plain words and keeps the file name in the hover', () => {
    renderRig('#/rig/guide:glossary:span')
    const row = document.getElementById('glossary-span')
    expect(row.textContent).toContain('(student guide, section 16)')
    expect(row.textContent).not.toContain('STUDENT_GUIDE')
    expect(row.querySelector('[data-hint]').getAttribute('data-hint')).toBe('docs/STUDENT_GUIDE.md, section 16')
  })
})
