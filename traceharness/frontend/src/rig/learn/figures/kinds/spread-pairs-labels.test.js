// a phone-width chart must not put "steps spread more" on "median 1.75x" at the bottom of the chart
import { describe, it, expect } from 'vitest'
import { pairLabels, labelWidth } from './spread-pairs'

const box = (l) => ({ l: l.anchor === 'end' ? l.x - labelWidth(l.text) : l.x, r: l.anchor === 'end' ? l.x : l.x + labelWidth(l.text), t: l.y - 11, b: l.y + 3 })
const hit = (a, b) => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b

describe('the spread chart keeps its labels apart', () => {
  for (const w of [300, 340, 420, 560, 720]) for (const [mx, my] of [[1.75, 2.2], [1.4, 3.1], [2.6, 1.3], [1.1, 5.5]]) {
    it(`width ${w}, medians ${mx} and ${my}: no two labels touch and none leaves the chart`, () => {
      const xs = (v) => 44 + (w - 60) * Math.log(v) / Math.log(4), ys = (v) => 266 - 252 * Math.log(v) / Math.log(6)
      const ls = pairLabels({ w, medX: mx, medY: my, x: xs, y: ys })
      for (let i = 0; i < ls.length; i++) {
        const a = box(ls[i])
        expect(a.l, ls[i].text).toBeGreaterThanOrEqual(44 - 1)
        expect(a.r, ls[i].text).toBeLessThanOrEqual(w - 16 + 1)
        for (let j = i + 1; j < ls.length; j++) expect(hit(a, box(ls[j])), `${ls[i].text} × ${ls[j].text}`).toBe(false)
      }
    })
  }
})
