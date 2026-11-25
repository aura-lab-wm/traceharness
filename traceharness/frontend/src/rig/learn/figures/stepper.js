/* Rig · learn/figures/stepper.js — Play / Pause / Step for a step-through figure. PURE (a reducer).
   Play goes through the steps once and stops on the last one: it never loops. Play on the last step starts again
   from the first. Any step press pauses, so the reader always holds the controls. */

export const START = (n) => ({ at: 0, n, playing: false })

export function stepper(s, a) {
  const last = s.n - 1
  switch (a.type) {
    case 'play': return s.at >= last ? { ...s, at: 0, playing: true } : { ...s, playing: true }
    case 'pause': return { ...s, playing: false }
    case 'tick': {
      if (!s.playing) return s
      const at = Math.min(last, s.at + 1)
      return { ...s, at, playing: at < last }
    }
    case 'next': return { ...s, at: Math.min(last, s.at + 1), playing: false }
    case 'back': return { ...s, at: Math.max(0, s.at - 1), playing: false }
    case 'go': return { ...s, at: Math.max(0, Math.min(last, a.at)), playing: false }
    default: return s
  }
}
