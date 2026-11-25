// words that must never ship (names of private data), one per line in frontend/private-words.txt, which git ignores
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const FILE = fileURLToPath(new URL('../private-words.txt', import.meta.url))
export const PRIVATE_WORDS = existsSync(FILE) ? readFileSync(FILE, 'utf8').split('\n').map((s) => s.trim().toLowerCase()).filter(Boolean) : []
