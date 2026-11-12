// @vitest-environment jsdom
// Fabricated text only. Layout (one or two columns) is a style-sheet concern checked in the
// headless browser run; these tests hold the structure, the words and the safety of the markup.
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { DiffView } from './DiffView'

afterEach(cleanup)
const text = (selector, root = document) => [...root.querySelectorAll(selector)].map((node) => node.textContent)

describe('DiffView', () => {
  it('marks exactly the changed words of a changed line and shows an added line once', () => {
    const before = 'Line one stays.\nUse the quick brown tool.\nLine three stays.\nLine four stays.\nLine five stays.'
    const after = 'Line one stays.\nUse the slow brown helper.\nLine three stays.\nLine four stays.\nLine five stays.\nAdded line.'
    render(<DiffView before={before} after={after} />)
    const diff = screen.getByRole('group', { name: 'Prompt diff' })
    expect(text('del:not(.rg-diff-nl)', diff)).toEqual(['quick', 'tool'])
    expect(text('ins:not(.rg-diff-nl)', diff)).toEqual(['slow', 'helper', 'Added line.'])
    expect(diff.querySelectorAll('.rg-diff-row[data-kind=change]')).toHaveLength(1)
    expect(diff.querySelectorAll('.rg-diff-row[data-kind=insert]')).toHaveLength(1)
    // Line five differs only by the line break that now follows it: shown once, quietly.
    expect(diff.querySelectorAll('.rg-diff-row[data-kind=context]')).toHaveLength(4)
    expect(diff.querySelector('.rg-diff-row[data-break] ins.rg-diff-nl')).toBeTruthy()
    expect(text('.rg-diff-row[data-kind=change] .rg-diff-sign', diff)).toEqual(['−', '+'])
    expect(text('.rg-diff-row[data-kind=insert] .after .rg-diff-sign', diff)).toEqual(['+'])
    expect(within(diff).getByText(/exact/).textContent).toMatch(/B → .*B exact/)
  })

  it('renders both sides so that a split layout can align them and a single column can hide the duplicate', () => {
    render(<DiffView before={'same\nold\n'} after={'same\nnew\n'} />)
    const context = document.querySelector('.rg-diff-row[data-kind=context]')
    expect(context.querySelector('.before').textContent).toBe(context.querySelector('.after').textContent)
    const change = document.querySelector('.rg-diff-row[data-kind=change]')
    expect(change.querySelector('.before .rg-diff-no').textContent).toBe('2')
    expect(change.querySelector('.after .rg-diff-no').textContent).toBe('2')
    expect(screen.getByRole('button', { name: 'Split' }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: 'Unified' }))
    expect(screen.getByRole('group', { name: 'Prompt diff' }).dataset.layout).toBe('unified')
    expect(screen.getByRole('button', { name: 'Unified' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('folds long unchanged runs into a button that restores exactly those lines', () => {
    const lines = Array.from({ length: 40 }, (_, index) => 'unchanged line ' + (index + 1))
    const before = lines.join('\n'), after = [...lines.slice(0, 20), 'inserted line', ...lines.slice(20)].join('\n')
    render(<DiffView before={before} after={after} />)
    const folds = screen.getAllByRole('button', { name: /unchanged lines$/ })
    expect(folds.map((node) => node.textContent)).toEqual(['17 unchanged lines', '17 unchanged lines'])
    expect(screen.queryByText('unchanged line 1')).toBeNull()
    fireEvent.click(folds[0])
    expect(screen.getAllByText('unchanged line 1').length).toBeGreaterThan(0)
    expect(screen.getAllByRole('button', { name: /unchanged lines$/ })).toHaveLength(1)
    expect(screen.queryByText('unchanged line 40')).toBeNull()
  })

  it('says so when nothing differs and when a fragment is disabled, instead of a wall of removals', () => {
    const { rerender } = render(<DiffView before="Same text" after="Same text"><pre>Same text</pre></DiffView>)
    expect(screen.getByText('No text difference from baseline.')).toBeTruthy()
    expect(document.querySelector('.rg-diff-rows')).toBeNull()
    expect(document.querySelector('pre').textContent).toBe('Same text')
    rerender(<DiffView before="Baseline body" after="" withheld="Claude Code evaluates this fragment to empty text." />)
    expect(screen.getByText('Disabled: the baseline text is withheld.')).toBeTruthy()
    expect(screen.getByText(/evaluates this fragment to empty text/)).toBeTruthy()
    expect(document.querySelector('del')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Split' })).toBeNull()
  })

  it('treats markup in either text as text', () => {
    render(<DiffView before={'<b>old</b>'} after={'<img src=x onerror="window.__pwned = 1"><script>window.__pwned = 1</script>'} />)
    const diff = screen.getByRole('group', { name: 'Prompt diff' })
    expect(diff.querySelector('img, script, b:not(.rg-diff-head b)')).toBeNull()
    expect(diff.textContent).toContain('<img src=x onerror="window.__pwned = 1">')
    expect(window.__pwned).toBeUndefined()
  })

  it('marks a removed or added final line break', () => {
    render(<DiffView before={'one\ntwo\n'} after={'one\ntwo'} />)
    expect(document.querySelector('del.rg-diff-nl')).toBeTruthy()
    cleanup()
    render(<DiffView before={'one\ntwo'} after={'one\ntwo\n'} />)
    expect(document.querySelector('ins.rg-diff-nl')).toBeTruthy()
  })

  it('limits the rows it renders and offers the rest explicitly', () => {
    const before = Array.from({ length: 30 }, (_, index) => 'old ' + index).join('\n')
    const after = Array.from({ length: 30 }, (_, index) => 'new ' + index).join('\n')
    render(<DiffView before={before} after={after} maxRows={12} />)
    expect(document.querySelectorAll('.rg-diff-row')).toHaveLength(12)
    fireEvent.click(screen.getByRole('button', { name: /Show more of this diff/ }))
    expect(document.querySelectorAll('.rg-diff-row').length).toBeGreaterThan(12)
    expect(screen.queryByRole('button', { name: /Show more of this diff/ })).toBeNull()
  })

  it('names its sides and keeps a custom label', () => {
    render(<DiffView before="a" after="b" label="Profile A against profile B" beforeLabel="Saved profile" afterLabel="Current draft" />)
    const diff = screen.getByRole('group', { name: 'Profile A against profile B' })
    expect(within(diff).getByText('Saved profile')).toBeTruthy()
    expect(within(diff).getByText('Current draft')).toBeTruthy()
  })
})
