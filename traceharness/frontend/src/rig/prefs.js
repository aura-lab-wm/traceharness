/* Rig · prefs.js — the shell's per-browser preferences. Every read survives blocked storage
   (the default comes back); every write reports whether it stuck. */
import { THEMES } from './route'

export const THEME_KEY = 'rig.theme'
export const CVD_KEY = 'rig.cvd'
export const DATASET_KEY = 'rig.dataset'
export const TOUR_KEY = 'rig.tour.v1'

const get = (k) => { try { return localStorage.getItem(k) } catch { return null } }
const set = (k, v) => { try { localStorage.setItem(k, v); return true } catch { return false } }

export const readTheme = () => { const t = get(THEME_KEY); return THEMES.includes(t) ? t : 'light' }
export const writeTheme = (t) => set(THEME_KEY, THEMES.includes(t) ? t : 'light')
/** dark -> light -> contrast -> contrast-light -> system -> dark (the top-bar button). */
export const nextTheme = (t) => THEMES[(Math.max(0, THEMES.indexOf(t)) + 1) % THEMES.length]
/** What 'system' resolves to: the system's light or dark, as its high-contrast variant when it asks for more contrast. */
export const resolveTheme = (pref, { light = false, more = false } = {}) => (pref !== 'system' ? pref : more ? (light ? 'contrast-light' : 'contrast') : light ? 'light' : 'dark')
export const THEME_NAMES = { dark: 'Graphite', light: 'Paper', contrast: 'High contrast · dark', 'contrast-light': 'High contrast · light', system: 'System' }

export const readCvd = () => get(CVD_KEY) === '1'
export const writeCvd = (on) => set(CVD_KEY, on ? '1' : '0')

export const readDataset = () => get(DATASET_KEY) || null
export const writeDataset = (dir) => (dir ? set(DATASET_KEY, dir) : false)

let tourSeen = false   // blocked storage: the tour still shows once per visit, not on every render
export const readTourDone = () => get(TOUR_KEY) === 'done' || tourSeen
export const writeTourDone = () => { const ok = set(TOUR_KEY, 'done'); if (!ok) tourSeen = true; return ok }
