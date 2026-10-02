// Per-project palette. Keep the key names: the engine's GLSL constants (C_INK, C_SIGNAL...) are built from them.
// signal = the sung word / the only colour that blooms; acid = one rare accent owned by one motif.
export const HEX = {
  ink: '#080B10', // background
  ink2: '#121822', // raised panels
  graphite: '#4E5664', // dim lines, secondary text
  ash: '#98A0AA', // mid grey
  bone: '#F1EBDD', // primary type
  signal: '#F2A93B', // sung word, light
  ember: '#FFD488', // hot core of signal
  blood: '#9A4E14', // deep shadow of signal (and the ink colour on paper sheets)
  acid: '#6FD08C', // rare accent
} as const;
