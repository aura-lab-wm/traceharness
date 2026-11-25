// @vitest-environment jsdom
/* The one-letter tiles on steps (L R F W E T B S) have a key where they are drawn: the letters a view uses, each with
   its word (core/patterns.py ACTION_LABEL). */
import { afterEach, describe, expect, it } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { LetterKey, LETTER_WORDS } from './StepRows'

afterEach(() => cleanup())

describe('the tool-letter key', () => {
  it('says the letters a view draws, in the alphabet order, each with its word', () => {
    const { container } = render(<LetterKey letters={['T', 'L', 'R', 'L', '·', 'B']} />)
    const key = container.querySelector('[data-el="letter-key"]')
    expect([...key.querySelectorAll('.rg-sl-key-i')].map((x) => x.textContent)).toEqual(['L list', 'R read/view', 'T run tests', 'B bash'])
  })
  it('knows the eight letters; nothing to say draws nothing', () => {
    expect(Object.keys(LETTER_WORDS)).toEqual(['L', 'R', 'F', 'W', 'E', 'T', 'B', 'S'])
    const { container } = render(<LetterKey letters={['·', '?']} />)
    expect(container.innerHTML).toBe('')
  })
})
