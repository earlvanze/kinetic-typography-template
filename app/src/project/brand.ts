// Per-project branding (edit for each video).
export const BRAND = {
  titleA: 'SHOW', // title / end card, line 1
  titleB: 'TITLE', // title / end card, line 2 (signal colour)
  host: 'HOST NAME', // "WITH <host>"
  tagline: 'TOPIC · TOPIC · TOPIC',
  slogan: '', // optional small slogan used by some overlays
  field: undefined as string[] | undefined, // background vocabulary for the `search` shot (and plate tokens)
  glowTint: [1.15, 0.85, 0.5] as [number, number, number], // tint of the additive glow layer (match the signal colour)
};
