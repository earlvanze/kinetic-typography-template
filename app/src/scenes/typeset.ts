// Swiss-grid typesetting + camera helpers shared by project shots (import from '../scenes/typeset').
// The point (from the pdoom treatment): lyrics are part of the image, not subtitles. Content words are big and heavy, small
// words narrow and light on the same baseline; a row ghosts in ~0.4 s before it is sung; big rows get a hairline rule and a
// mono figure annotation; set rows FLUSH LEFT/RIGHT ({ align: 'l' | 'r' }) where the shot's layout leaves room.
import { W } from '../engine/gl';
import { measure } from '../engine/type';
import type { Line, Word } from '../engine/lyrics';
import { ease, lerp, prog } from '../engine/util';
import { A, CAP, clean, col, note, rule, snapCam, type Cam } from './kit';
import { cam, slam, txt, word, type S } from './shots';

export const last = <T,>(a: T[]) => a[a.length - 1]!;
export const SCR: Cam = { x: W / 2, y: 540, z: 1, r: 0 };
export const screen = (s: S) => cam(s, SCR);
export const findW = (l: Line, re: RegExp) => l.words.find((w) => re.test(clean(w.w))) ?? last(l.words);
/** Scalar snap: holds, then snaps to vals[i] at times[i] (outExpo by default). */
export function snapVal(t: number, times: number[], vals: number[], dur = 0.4, fn = ease.outExpo) {
  let v = vals[0]!;
  for (let i = 1; i < vals.length; i++) { if (t < times[i]!) break; v = lerp(v, vals[i]!, prog(t, times[i]!, times[i]! + dur, fn)); }
  return v;
}
const SMALLW = /^(a|an|the|to|and|of|in|on|it|is|my|we|our|for|with|from|at|by|but|so|that|this|then|now|too|till|into|i|are|was|be|let|own|just|no|not|could|would|what|how|who|every|more|than|one)$/i;
/** A lyric row: hierarchy + ghost-in + annotation; centred at x unless { align }. Returns { size, xs (relative to x), width }. */
export function row(s: S, ws: Word[], fam: string, width: number, max: number, x: number, y: number, o: { from?: number; alpha?: number; hot?: any; base?: any; glow?: number; rot?: number; align?: 'l' | 'r' | 'c'; anno?: boolean } = {}) {
  if (!ws.length) return null;
  const { t } = s;
  const famS = A(62, 300), ratio = 0.5, gapEm = 0.24;
  const isBig = ws.map((w) => !SMALLW.test(clean(w.w)) || ws.every((v) => SMALLW.test(clean(v.w))));
  const m = ws.map((w, i) => (isBig[i] ? measure(txt(w), fam, 100) : measure(txt(w), famS, 100) * ratio));
  const tot = m.reduce((a, b) => a + b, 0) + gapEm * 100 * (ws.length - 1);
  const size = Math.min(max, (100 * width) / tot), k = size / 100, totalW = tot * k;
  const align = o.rot ? 'c' : (o.align ?? 'c');
  const x0 = align === 'l' ? 170 : align === 'r' ? W - 170 - totalW : x - totalW / 2;
  const ghostA = 0.3 * prog(t, ws[0]!.start - 0.45, ws[0]!.start - 0.15);
  const xs: number[] = [];
  let cx = x0;
  ws.forEach((w, i) => {
    const wd = m[i]! * k, big = isBig[i]!, sz = big ? size : size * ratio;
    const px = cx + wd / 2, py = y + (big ? 0 : ((CAP * size) - (CAP * sz)) / 2);
    xs.push(px - x);
    const dx = o.rot ? (px - x) * Math.cos(o.rot) - (px - x) : 0, dy = o.rot ? (px - x) * Math.sin(o.rot) : 0;
    word(s, w, txt(w), big ? fam : famS, sz, px + dx, py + dy, { sc: t < w.start - 0.06 ? 1 : slam(w, t, big ? (o.from ?? 1.7) : 1.2), alpha: o.alpha, hot: o.hot, base: o.base, glow: big ? o.glow : 0, rot: o.rot, ghost: ghostA });
    cx += wd + gapEm * size;
  });
  if ((o.anno ?? size >= 110) && !o.rot) {
    const a = prog(t, ws[0]!.start - 0.2, ws[0]!.start + 0.2) * (o.alpha ?? 1);
    const ry = y + (CAP * size) / 2 + 26;
    rule(s.c, x0, ry, x0 + totalW * prog(t, ws[0]!.start - 0.1, last(ws).end, ease.outCubic), ry, 1, col('graphite', 0.9 * a), 2);
    const mm = Math.floor(ws[0]!.start / 60), ss = (ws[0]!.start % 60).toFixed(1).padStart(4, '0');
    note(s.c, `${String(s.sh.idx).padStart(2, '0')} · ${mm}:${ss}`, align === 'r' ? x0 + totalW : x0, y - (CAP * size) / 2 - 22, a * 0.8, 18, 'ash', align === 'r' ? 'right' : 'left');
  }
  return { size, xs, width: totalW };
}
/** Words placed one after another along a path in the world; the camera snaps to each word as it is sung. */
export function ride(s: S, ws: Word[], fam: string, size: number, at: (i: number, wd: number) => { x: number; y: number; r?: number }, o: { z?: number; hot?: any; from?: number; lead?: Cam; tilt?: number; alpha?: number } = {}) {
  const { t, sh } = s;
  const pos = ws.map((w, i) => at(i, measure(txt(w), fam, size)));
  const times = [sh.start, ...ws.map((w) => w.start - 0.07)];
  const targets: Cam[] = [o.lead ?? { x: pos[0]!.x, y: pos[0]!.y, z: o.z ?? 1, r: 0 }, ...pos.map((p, i) => ({ x: p.x, y: p.y, z: o.z ?? 1, r: (i % 2 ? 1 : -1) * (o.tilt ?? 0.02) }))];
  cam(s, snapCam(t, times, targets, 0.38));
  ws.forEach((w, i) => word(s, w, txt(w), fam, size, pos[i]!.x, pos[i]!.y, { sc: slam(w, t, o.from ?? 1.6), rot: pos[i]!.r ?? 0, hot: o.hot, alpha: o.alpha }));
  return pos;
}
/** Readability band behind type (paper-aware: a bone wash on paper plates, an ink band otherwise). */
export function band(s: S, y: number, h: number, a = 0.6) {
  if (a <= 0) return;
  const k = s.paper ? 'bone' : 'ink', c = s.c;
  const gr = c.createLinearGradient(0, y - h / 2, 0, y + h / 2);
  gr.addColorStop(0, col(k, 0)); gr.addColorStop(0.25, col(k, s.paper ? a * 0.6 : a)); gr.addColorStop(0.75, col(k, s.paper ? a * 0.6 : a)); gr.addColorStop(1, col(k, 0));
  c.fillStyle = gr; c.fillRect(-4000, y - h / 2, 9000, h);
}
