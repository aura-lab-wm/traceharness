// @vitest-environment jsdom
/* The logo beside a name is decorative (the name is in the text beside it), and the model's dot or the harness's
   ring stays beside it in its own tone. Names invented. */
import { afterEach, describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { BrandMark, BrandMarks, BrandName } from './BrandMark'
import { EntityDot, EntityName } from '../EntityDot'
import { resetRig } from '../../../test/rig-testing'

afterEach(resetRig)

/** Everything that would make a mark more than decoration. */
function exposed(el) {
  return {
    hidden: el.getAttribute('aria-hidden'), role: el.getAttribute('role'), label: el.getAttribute('aria-label'), title: el.getAttribute('title'),
    alt: el.getAttribute('alt'), tab: el.getAttribute('tabindex'), text: el.textContent, tag: el.tagName,
  }
}
const DECORATIVE = { hidden: 'true', role: null, label: null, title: null, alt: null, tab: null, text: '', tag: 'I' }

describe('BrandMark', () => {
  it('a name a rule claims gets its logo, hidden from screen readers, with no text, label, title or tab stop', () => {
    const { container } = render(<span><BrandMark kind="model" name="qwen/qwen9-1b" />qwen9-1b</span>)
    const i = container.querySelector('.rg-logo')
    expect(i.dataset.brand).toBe('qwen')
    expect(i.dataset.ink).toBe('dark-mono')
    expect(exposed(i)).toEqual(DECORATIVE)
    expect(container.textContent).toBe('qwen9-1b')
  })
  it('an unknown name, a mock model and an empty name render nothing', () => {
    for (const [kind, name] of [['model', 'acme/alpha-1'], ['model', 'mock'], ['model', 'mock-weak'], ['model', 'unknown'], ['harness', 'baseline'], ['harness', ''], ['source', null]]) {
      const { container, unmount } = render(<BrandMark kind={kind} name={name} />)
      expect(container.innerHTML, `${kind}:${name}`).toBe('')
      unmount()
    }
  })
  it('BrandMarks draws one logo per brand of a list, the whole group hidden; none when no name has one', () => {
    const { container } = render(<BrandMarks kind="model" names={['google/gemini-9-flash', 'gemini-9-pro', 'acme/alpha-1', 'openai/gpt-9']} />)
    expect([...container.querySelectorAll('.rg-logo')].map((i) => i.dataset.brand)).toEqual(['gemini', 'openai'])
    expect(container.firstChild.getAttribute('aria-hidden')).toBe('true')
    const none = render(<BrandMarks kind="model" names={['mock', 'acme/alpha-1']} />)
    expect(none.container.innerHTML).toBe('')
  })
})

describe('BrandName', () => {
  it('holds the logo with the first part of the name, so it never ends a line alone; the name reads the same', () => {
    const { container } = render(<b><BrandName kind="dataset" name="acme/SWE-agent-trajectories" /></b>)
    const held = container.querySelector('.rg-logo-n')
    expect(held.firstChild.dataset.brand).toBe('sweagent')
    expect(held.textContent).toBe('acme/')
    expect(container.textContent).toBe('acme/SWE-agent-trajectories')
    const shown = render(<BrandName kind="agent" name="claude_code">Claude Code</BrandName>)
    expect(shown.container.querySelector('.rg-logo-n').textContent).toBe('Claude ')
    expect(shown.container.textContent).toBe('Claude Code')
  })
  it('a name no rule claims is the plain text, with no wrapper', () => {
    const { container } = render(<b><BrandName kind="agent" name="muse">muse</BrandName></b>)
    expect(container.innerHTML).toBe('<b>muse</b>')
  })
})

describe('EntityDot and EntityName carry the logo beside the dot', () => {
  it('the dot (with its tone) comes first, the logo right after it; the name reads the same', () => {
    const { container } = render(<b><EntityName kind="model" id="qwen/qwen9-1b" name="qwen9-1b" /></b>)
    const dot = container.querySelector('.rg-ent')
    const logo = container.querySelector('.rg-logo')
    expect(dot.dataset.tone).toMatch(/^em-\d$/)
    expect(dot.nextElementSibling).toBe(logo)
    expect(logo.dataset.brand).toBe('qwen')
    expect(exposed(logo)).toEqual(DECORATIVE)
    expect(container.textContent).toBe('qwen9-1b')
    // held with the first part of the name, so neither mark ends a line alone
    expect(logo.parentElement.className).toBe('rg-ent-n')
  })
  it('a harness ring takes its agent\'s logo; a setting name and a mock keep the plain mark', () => {
    const h = render(<EntityDot kind="harness" name="claude-code@9.x" />)
    expect(h.container.querySelector('.rg-ent.h')).not.toBeNull()
    expect(h.container.querySelector('.rg-logo').dataset.brand).toBe('claudecode')
    for (const [kind, name] of [['harness', 'baseline'], ['model', 'mock'], ['model', 'acme/alpha-1']]) {
      const { container, unmount } = render(<EntityDot kind={kind} name={name} />)
      expect(container.querySelectorAll('.rg-ent').length, name).toBe(1)
      expect(container.querySelector('.rg-logo'), name).toBeNull()
      unmount()
    }
  })
})
