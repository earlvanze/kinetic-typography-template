// The edit (generic): every lyric line belongs to one shot from src/project/script.ts. Shots start on the beat just before their
// first sung word (never after it) and hold until the next shot — hard cuts, like the music.
import type { Lyrics } from '../engine/lyrics';
import type { AudioData } from '../engine/audio';
import type { Shot } from './shots';

import * as P from '../project/script';
type Spec = [kind: string, lines: number, opts?: Record<string, any>];

/**
 * Section-driven edit: if project/script.ts exports SECTIONS (base section name -> (occurrence, lineCount) => Spec[]),
 * the edit is assembled from the [section] tags the ACTIVE take actually sings (data/lyrics.json lines[].section), so a
 * take with a different structure gets a matching edit. A section whose specs don't cover its lines exactly falls back to
 * 2-line slams (with a warning). Otherwise the fixed SCRIPT list is used.
 */
function scriptFor(ly: Lyrics): Spec[] {
  const SECTIONS = (P as any).SECTIONS as Record<string, (occ: number, count: number) => Spec[]> | undefined;
  if (!SECTIONS) return (P as any).SCRIPT as Spec[];
  const out: Spec[] = []; const occ: Record<string, number> = {};
  const lines = ly.lines.filter((l: any) => !l.absent);
  for (let i = 0; i < lines.length;) {
    const sec = String((lines[i] as any).section ?? ''); let j = i;
    while (j < lines.length && String((lines[j] as any).section ?? '') === sec) j++;
    const count = j - i, base = sec.replace(/\d+$/, ''); occ[base] = (occ[base] ?? 0) + 1;
    const specs = SECTIONS[base]?.(occ[base]!, count) ?? [];
    if (specs.reduce((a, s) => a + s[1], 0) === count) out.push(...specs);
    else { console.warn(`director: section ${sec} (${count} lines) has no exact spec; using slams`); for (let k = 0; k < count; k += 2) out.push(['slam', Math.min(2, count - k)]); }
    i = j;
  }
  return out;
}

export function buildShots(ly: Lyrics, au: AudioData, start: number, end: number): Shot[] {
  const shots: Shot[] = [];
  let li = 0, n = 0;
  const SCRIPT = scriptFor(ly);
  const present = ly.lines.filter((l: any) => !l.absent);
  for (const [kind, cnt, o = {}] of SCRIPT) {
    // instrumental shot: no lines, placed at an explicit song time (o.at)
    // (o.at = absolute time; o.afterPrev = seconds after the previous shot's last sung word starts)
    if (cnt === 0) {
      const pl = present[li - 1]?.words.at(-1);
      const at = o.at ?? (o.afterPrev != null && pl ? pl.start + o.afterPrev : null);
      if (at != null) shots.push({ kind, lines: [], start: at, end: 0, o, idx: shots.length, n: Math.max(1, n) });
      continue;
    }
    const lines = present.slice(li, li + cnt);
    li += cnt;
    if (!lines.length) continue;
    if (kind === 'title' && (o.variant ?? 0) === 0) n++;
    const first = lines[0]!.words[0]!.start;
    // cut on the last beat at/before the first word, but no more than 0.3 s early (no dead frames)
    const b = au.timeOfBeat(Math.floor(au.beatAt(first + 0.02)));
    const st = first - b <= 0.3 ? b : first - 0.18;
    shots.push({ kind, lines, start: st, end: 0, o, idx: shots.length, n: Math.max(1, n) });
  }
  if (li !== present.length) console.warn(`director: script covers ${li} of ${present.length} lines`);
  shots[0]!.start = start;
  // holdAfter: keep a shot on screen this long after its last word starts before cutting (readability)
  for (let i = 0; i + 1 < shots.length; i++) {
    const h = shots[i]!.o.holdAfter; if (!h || !shots[i]!.lines.length) continue;
    const lw = shots[i]!.lines.at(-1)!.words.at(-1)!;
    let ns = Math.max(shots[i + 1]!.start, lw.start + h);
    const nf = shots[i + 1]!.lines[0]?.words[0]?.start;
    if (shots[i]!.o.holdClamp && nf != null) ns = Math.min(ns, Math.max(shots[i + 1]!.start, nf - 0.12)); // don't cover the next line
    shots[i + 1]!.start = ns;
  }
  for (let i = 0; i < shots.length; i++) {
    if (i > 0) shots[i]!.start = Math.max(shots[i]!.start, shots[i - 1]!.start + 0.05);
    shots[i]!.end = i + 1 < shots.length ? shots[i + 1]!.start : end;
  }
  return shots;
}
