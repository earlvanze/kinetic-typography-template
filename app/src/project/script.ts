// The edit, by SECTION. The director reads the [section] tags of data/lyrics.json and asks each section (by base name, digits
// stripped) for its shots: (occurrence, lineCount) => [kind, lines, options][]. The specs must cover the section's lines exactly
// (otherwise it falls back to 2-line slams and warns). Shot kinds: LIBRARY in scenes/shots.ts + EXTRA in project/shots.ts.
// Options every shot understands: bg {paper, grid, glow, gx, gy, stars, warm}, wash [topKey, bottomKey, alpha],
// plate '<kind>' (+ plateLabel, plateHot, plateLines, plateDark, plateStamps, plateTokens), holdAfter s (+ holdClamp).
// Count-0 specs are INSTRUMENTAL shots: ['kind', 0, { at: seconds }] or ['kind', 0, { afterPrev: seconds after the last sung word }].
// (A fixed `export const SCRIPT: Spec[]` list is also supported: the director uses SECTIONS when it is exported.)
export type Spec = [kind: string, lines: number, opts?: Record<string, any>];

const chorus = (n: number, c: number): Spec[] => (c >= 2 ? [['title', 1, { variant: 0, plate: 'guilloche' }], ['slam', c - 1, { maxChars: 10 }]] : [['slam', c]]);

export const SECTIONS: Record<string, (occ: number, count: number) => Spec[]> = {
  intro: (_o, c) => [['intro', 0, { at: 0 }], ['slam', c, { plate: 'halftone' }]],
  verse: (o, c) => [['anchor', Math.min(c, 3), { head: 1, plate: o % 2 ? 'blueprint' : 'contour' }], ...(c > 3 ? ([['slam', c - 3, { plate: 'scope' }]] as Spec[]) : [])],
  chorus: (n, c) => chorus(n, c),
  final: (n, c) => chorus(n + 1, c),
  bridge: (_o, c) => [['serif', c, { plate: 'engrave' }]],
  outro: (_o, c) => [['outro', c]],
};
