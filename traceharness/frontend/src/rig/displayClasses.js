/* The ten display classes of the console: the one source of viewport-width boundaries.
   Same ten as the website (traceharness-site tools/theme.py DISPLAY_CLASSES). Every viewport @media width query
   in the console CSS, and every matchMedia / innerWidth width test in its scripts, uses one of these boundaries
   B as (min-width:B) or (max-width:B-1). displayClasses.test.js enforces it. (@container queries measure a
   panel, not the window, and are not covered.) */
export const DISPLAY_CLASSES = Object.freeze({
  'small-phone': 0, phone: 360, 'large-phone': 480, tablet: 768, 'tablet-wide': 1024,
  laptop: 1280, desktop: 1440, 'full-hd': 1920, qhd: 2560, ultrawide: 3440,
})
export const BOUNDARIES = Object.freeze(Object.values(DISPLAY_CLASSES).filter((px) => px > 0))

/** "(min-width:1440px)" for up('desktop'): that class and wider. */
export const up = (name) => `(min-width:${DISPLAY_CLASSES[name]}px)`
/** "(max-width:767px)" for below('tablet'): everything narrower than that class. */
export const below = (name) => `(max-width:${DISPLAY_CLASSES[name] - 1}px)`

/** The class a viewport width falls in. */
export const classOf = (width) => {
  let out = 'small-phone'
  for (const [name, px] of Object.entries(DISPLAY_CLASSES)) if (width >= px) out = name
  return out
}
const viewport = () => (typeof window === 'undefined' ? null : window.innerWidth)
/** True when the window is at least as wide as the class (no window: false). */
export const isUp = (name) => { const w = viewport(); return w != null && w >= DISPLAY_CLASSES[name] }
/** True when the window is narrower than the class (no window: false). */
export const isBelow = (name) => { const w = viewport(); return w != null && w < DISPLAY_CLASSES[name] }
