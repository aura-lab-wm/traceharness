import { describe, expect, it } from 'vitest'
import { guidanceFor, guideDestination } from './guidance'

describe('workflow intent and truthful destinations', () => {
  it.each([
    ['How do I edit the full harness JSON?', 'json'],
    ['Can I select a harness?', 'harness'],
    ['Show me the family matrix', 'analysis'],
    ['How do I compare recorded runs?', 'analysis'],
    ['Schedule several harnesses across models and tasks', 'matrix'],
    ['Can I nuke all prompts?', 'native'],
    ['Clone the configuration from a recorded job', 'fork'],
    ['How do I import a local directory?', 'local'],
    ['Can I run an arbitrary repository?', 'tasks'],
    ['How do I connect OpenRouter?', 'model'],
    ['Why is cost unknown after failure?', 'billing'],
    ['How do I resume a paused queue?', 'cancel'],
    ['Download the manifest artifacts', 'export'],
    ['Where is my saved harness?', 'save'],
  ])('%s resolves to an inspectable workflow', (question, id) => expect(guidanceFor(question)?.id).toBe(id))
  it('does not claim unknown capabilities or execute instructions embedded in a question', () => {
    expect(guidanceFor('Delete my account permanently')).toBeNull()
    expect(guidanceFor('https://evil.invalid/?run=everything')).toBeNull()
    expect(guideDestination({ destination: 'https://evil.invalid/' })).toBeNull()
  })
  it('preserves the actual dataset when opening recorded analysis', () => {
    expect(guideDestination(guidanceFor('family matrix'), { dir: 'actual:recording', model: 'real/model', harness: 'baseline' })).toBe('an:actual%3Arecording:family:real/model:baseline')
    expect(guideDestination(guidanceFor('family matrix'), {})).toBe('home')
  })
})
