/* Rig · learn/gate.js — which parts of Learn are listed while Student Lab is off. PURE.

   docs/student-lab.md:7: "When Student Lab is off, teaching guides and package materials are absent
   from navigation." So the Reading guide and Reference materials are listed in Learn only with
   Student Lab on, while the articles and the glossary are listed for everyone.
   Set a part to true to list it only with Student Lab on, or to false to list it for everyone.
   Direct links (#/start, #/package, a shared article link) open either way. */
export const NEEDS_STUDENT_LAB = Object.freeze({ articles: false, glossary: false, guide: true, package: true })

/** Is this part of Learn listed (Help, the Learn page, its left list, "Learn more" links)? */
export const canSee = (part, lab) => !!lab || !NEEDS_STUDENT_LAB[part]

/** The parts listed, in page order. */
export const learnParts = (lab) => Object.keys(NEEDS_STUDENT_LAB).filter((p) => canSee(p, lab))

const WORDS = { articles: 'articles with a quiz each', glossary: 'the glossary', guide: 'the reading guide', package: 'reference materials' }

/** The one-line description under Help › Learn. */
export function learnHelpDesc(lab) {
  const w = learnParts(lab).map((p) => WORDS[p])
  const s = w.length < 2 ? w.join('') : `${w.slice(0, -1).join(', ')} and ${w[w.length - 1]}`
  return s.charAt(0).toUpperCase() + s.slice(1) + '.'
}
