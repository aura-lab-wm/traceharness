// @vitest-environment jsdom
/* Learn: an article says at its top how to reach its quiz, and the list's titles look like what they are, links. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, within } from '@testing-library/react'
import { renderRig, resetRig } from '../../../test/rig-testing'
import { ARTICLES } from './articles'

afterEach(() => resetRig())

describe('Learn cues', () => {
  it('an article has "Go to the quiz" before its first section; it brings the quiz into view and focuses it', () => {
    renderRig(`#/rig/guide:${ARTICLES[2].id}`)
    const go = screen.getByRole('button', { name: /Go to the quiz/ })
    const quiz = document.querySelector('[data-el="learn-quiz"]')
    const first = document.querySelector('.rg-learn-sec')
    expect(go.compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    quiz.scrollIntoView = vi.fn()
    fireEvent.click(go)
    expect(quiz.scrollIntoView).toHaveBeenCalled()
    expect(document.activeElement).toBe(quiz)
  })
  it('each title in the Learn list carries an arrow, so it reads as a link', () => {
    renderRig('#/rig/guide:learn')
    const rows = [...document.querySelectorAll('.rg-doc a.rg-learn-row')]
    expect(rows.length).toBeGreaterThanOrEqual(ARTICLES.length)
    for (const r of rows) expect(within(r).getByText((_, n) => n && n.classList && n.classList.contains('rg-learn-rowgo'))).toBeTruthy()
  })
})
