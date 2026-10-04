// Kinetic plate library (template): see scenes/kinetic/README.md.
// Kinetic toolkit (pdoom plates in Canvas2D): burin engraving, engraved solids, gears, stamps, paper,
// world-placed Swiss type. Rules: ink/bone/signal; hairlines + hatching instead of flat fills; only signal/ember on the glow
// layer; type lives IN the drawing (world coordinates, moves with the camera) — never a caption over a picture.
// word() sets an ABSOLUTE globalAlpha, so every fade goes through its `alpha` option.
import { F, measure } from '../../engine/type';
import type { Line, Word } from '../../engine/lyrics';
import { clamp, ease, hash, lerp, noise1, prog, springStep, TAU } from '../../engine/util';
import { A, CAP, col, heat, mix, rule, setFont, clean } from '../kit';
import { slam, txt, word, type S } from '../shots';

export const SMALLW = /^(a|the|to|and|of|in|on|it|is|you|we|your|then|that|for|with|what|be|by|into|than|ever|ain'?t|just|let|yourself|it'?s|who'?s|got|isn'?t|a|if|you'?re|they|can|too|do|say|when)$/i;
export const fw = (l: Line, re: RegExp) => l.words.find((w) => re.test(clean(w.w))) ?? l.words[l.words.length - 1]!;
export const wi = (l: Line, re: RegExp) => Math.max(0, l.words.findIndex((w) => re.test(clean(w.w))));
export const lastW = (l: Line) => l.words[l.words.length - 1]!;
/** 0→1 as a word is sung (from just before its start to its end). */
export const sung = (w: Word, t: number, lead = 0.06) => prog(t, w.start - lead, Math.max(w.end, w.start + 0.2), ease.outCubic);
export const on = (w: Word, t: number, d = 0.35, f = ease.outCubic) => (t <= w.start - 0.05 ? 0 : prog(t, w.start - 0.05, w.start - 0.05 + d, f)); // hard 0 before: ease.outBack(0) is ~2e-16, not 0

/**
 * A row of words centred on (x, y) in the current (world) transform. Content words are Archivo 125/900 at `size`; function
 * words drop to Archivo 62/300 at half size (Swiss hierarchy). Each word slams in on its start. Returns the word centres.
 */
export function wrow(s: S, ws: Word[], x: number, y: number, size: number, o: { alpha?: number; hot?: any; base?: any; align?: 'c' | 'l' | 'r'; from?: number; rot?: number; fam?: string; small?: boolean } = {}) {
  if (!ws.length) return { xs: [] as number[], width: 0 };
  const { t } = s;
  const fam = o.fam ?? A(125, 900), famS = A(62, 300), gap = 0.24 * size;
  const big = ws.map((w) => o.small === false || !SMALLW.test(clean(w.w)) || ws.every((v) => SMALLW.test(clean(v.w))));
  const wd = ws.map((w, i) => measure(txt(w), big[i] ? fam : famS, big[i] ? size : size * 0.5));
  const tot = wd.reduce((a, b) => a + b, 0) + gap * (ws.length - 1);
  const al = o.align ?? 'c';
  let cx = al === 'l' ? x : al === 'r' ? x - tot : x - tot / 2;
  const xs: number[] = [];
  const cr = Math.cos(o.rot ?? 0), sr = Math.sin(o.rot ?? 0);
  ws.forEach((w, i) => {
    const sz = big[i] ? size : size * 0.5, px = cx + wd[i]! / 2, py = big[i] ? 0 : (CAP * size - CAP * sz) / 2;
    const rx = x + (px - x) * cr - py * sr, ry = y + (px - x) * sr + py * cr;
    xs.push(px);
    word(s, w, txt(w), big[i] ? fam : famS, sz, rx, ry, { sc: t < w.start - 0.06 ? 1 : slam(w, t, big[i] ? Math.min(o.from ?? 1.25, 1.3) : 1.1), alpha: o.alpha, hot: o.hot, base: o.base, rot: o.rot });
    cx += wd[i]! + gap;
  });
  return { xs, width: tot };
}
/** Width a wrow would take. */
export function wrowW(ws: Word[], size: number, fam = A(125, 900)) {
  const famS = A(62, 300);
  return ws.reduce((n, w) => n + measure(txt(w), SMALLW.test(clean(w.w)) ? famS : fam, SMALLW.test(clean(w.w)) ? size * 0.5 : size), 0) + 0.24 * size * (ws.length - 1);
}
/** Largest size ≤ max at which ws fit in width. */
export const fitW = (ws: Word[], width: number, max: number, fam?: string) => Math.min(max, (max * width) / Math.max(1, wrowW(ws, max, fam)));

/** Mono annotation in world space (FIG. labels, callouts). */
export function anno(s: S, text: string, x: number, y: number, a = 1, size = 18, k = 'ash', align: CanvasTextAlign = 'left') {
  if (a <= 0.003) return;
  const c = s.c; setFont(c, F.mono(500), size); c.textAlign = align; c.textBaseline = 'alphabetic'; c.fillStyle = col(k, 0.85 * a); c.fillText(text, x, y);
}
/** A leader line with a dot (callout). */
export function leader(s: S, x0: number, y0: number, x1: number, y1: number, k: number, a = 1, kk = 'graphite') {
  if (k <= 0 || a <= 0) return;
  rule(s.c, x0, y0, x1, y1, k * a, col(kk, 0.9), 1.5);
  s.c.fillStyle = col(kk, a); s.c.beginPath(); s.c.arc(x0, y0, 4, 0, TAU); s.c.fill();
}

/**
 * Engraving (burin hatching): parallel hairlines at `angle` clipped to `path`; each segment's weight follows the local
 * darkness (0 = lit → broken hairline, 1 = shadow → heavy + crosshatch). The silhouette gets a bone rim.
 */
export function engrave(c: CanvasRenderingContext2D, path: Path2D, bx: [number, number, number, number], dark: (x: number, y: number) => number, o: { angle?: number; step?: number; ink?: string; a?: number; rim?: number; fill?: string; rimK?: string } = {}) {
  const [x0, y0, x1, y1] = bx, a = o.a ?? 1, ang = o.angle ?? -0.6, step = o.step ?? 7;
  if (a <= 0.003) return;
  c.save(); c.clip(path);
  if (o.fill) { c.fillStyle = o.fill; c.fillRect(x0, y0, x1 - x0, y1 - y0); }
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, R = Math.hypot(x1 - x0, y1 - y0) / 2 + 4;
  const ca = Math.cos(ang), sa = Math.sin(ang);
  c.strokeStyle = o.ink ?? col('bone', 0.8 * a); c.lineCap = 'round';
  const segs = Math.max(2, Math.min(6, Math.round(R / 60)));
  for (let d = -R; d <= R; d += step) for (let k = 0; k < segs; k++) {
    const u0 = -R + (k / segs) * 2 * R, u1 = -R + ((k + 1) / segs) * 2 * R;
    const dk = clamp(dark(cx - sa * d + ca * (u0 + u1) / 2, cy + ca * d + sa * (u0 + u1) / 2));
    const lw = 0.5 + 2.4 * dk;
    if (lw < 0.6 && hash(Math.floor(d), k) < 0.5) continue;
    c.lineWidth = lw; c.beginPath(); c.moveTo(cx - sa * d + ca * u0, cy + ca * d + sa * u0); c.lineTo(cx - sa * d + ca * u1, cy + ca * d + sa * u1); c.stroke();
  }
  const cb = Math.cos(ang + 1.1), sb = Math.sin(ang + 1.1);
  for (let d = -R; d <= R; d += step * 1.3) for (let k = 0; k < segs; k++) {
    const u0 = -R + (k / segs) * 2 * R, u1 = -R + ((k + 1) / segs) * 2 * R;
    const dk = clamp(dark(cx - sb * d + cb * (u0 + u1) / 2, cy + cb * d + sb * (u0 + u1) / 2) * 2 - 1.1); if (dk <= 0) continue;
    c.lineWidth = 0.4 + 1.5 * dk; c.beginPath(); c.moveTo(cx - sb * d + cb * u0, cy + cb * d + sb * u0); c.lineTo(cx - sb * d + cb * u1, cy + cb * d + sb * u1); c.stroke();
  }
  c.restore();
  if ((o.rim ?? 1.4) > 0) { c.strokeStyle = col(o.rimK ?? 'bone', 0.9 * a); c.lineWidth = o.rim ?? 1.4; c.stroke(path); }
}
export const rectP = (x: number, y: number, w: number, h: number, r = 0) => { const p = new Path2D(); if (r) p.roundRect(x, y, w, h, r); else p.rect(x, y, w, h); return p; };
export const circP = (x: number, y: number, r: number) => { const p = new Path2D(); p.arc(x, y, r, 0, TAU); return p; };
export const polyP = (pts: [number, number][]) => { const p = new Path2D(); pts.forEach(([x, y], i) => (i ? p.lineTo(x, y) : p.moveTo(x, y))); p.closePath(); return p; };
/** Engraved block lit from the top-left (shade 0..1 overall darkness). */
export function eblock(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, o: { a?: number; shade?: number; step?: number; fill?: string; r?: number; ink?: string; angle?: number } = {}) {
  const sh = o.shade ?? 0.35;
  engrave(c, rectP(x, y, w, h, o.r ?? 0), [x, y, x + w, y + h], (px, py) => sh + 0.45 * ((py - y) / h) + 0.15 * ((px - x) / w) - 0.2, { a: o.a, step: o.step ?? 7, fill: o.fill ?? mix('ink', 'ink2', 0.7, o.a ?? 1), ink: o.ink, angle: o.angle });
}
/** Engraved isometric box (front + top + side). */
export function ebox(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, d: number, o: { a?: number; hot?: number; label?: string; ink?: string } = {}) {
  const a = o.a ?? 1, dx = d * 0.75, dy = -d * 0.55;
  eblock(c, x, y, w, h, { a, shade: 0.3, fill: mix('ink2', 'blood', 0.1 + 0.5 * (o.hot ?? 0), a), ink: o.ink });
  const top = polyP([[x, y], [x + dx, y + dy], [x + w + dx, y + dy], [x + w, y]]), side = polyP([[x + w, y], [x + w + dx, y + dy], [x + w + dx, y + h + dy], [x + w, y + h]]);
  engrave(c, top, [x, y + dy, x + w + dx, y], () => 0.15, { a, step: 6, angle: 0.2, fill: mix('ink2', 'graphite', 0.3, a), ink: o.ink });
  engrave(c, side, [x + w, y + dy, x + w + dx, y + h], () => 0.8, { a, step: 5, angle: 1.2, fill: col('ink', a), ink: o.ink });
  if (o.label) { const sz = Math.min(h * 0.4, (w * 0.8) / Math.max(1, o.label.length * 0.62)); setFont(c, A(100, 900), sz); c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = col('bone', 0.95 * a); c.fillText(o.label, x + w / 2, y + h / 2); }
}
/** Engraved gear: hatched body, teeth, hub; rotates by ang. */
export function gear(s: S, x: number, y: number, r: number, teeth: number, ang: number, o: { a?: number; hot?: number } = {}) {
  const { c, g } = s; const a = o.a ?? 1;
  const p = new Path2D(), n = teeth * 4;
  for (let i = 0; i <= n; i++) { const q = i % 4, rr = q === 0 || q === 3 ? r : r + r * 0.14, th = ang + (i / n) * TAU + (q === 1 ? 0.02 : q === 2 ? -0.02 : 0); const px = x + Math.cos(th) * rr, py = y + Math.sin(th) * rr; i ? p.lineTo(px, py) : p.moveTo(px, py); }
  p.closePath(); p.moveTo(x + r * 0.32, y); p.arc(x, y, r * 0.32, 0, TAU, true);
  c.save(); c.fillStyle = mix('ink2', 'blood', 0.1 + 0.5 * (o.hot ?? 0), a); c.fill(p, 'evenodd'); c.restore();
  engrave(c, p, [x - r * 1.2, y - r * 1.2, x + r * 1.2, y + r * 1.2], (px, py) => 0.25 + 0.5 * clamp((px - x + py - y) / (2.4 * r) + 0.5), { a, step: Math.max(4, r / 14), angle: -0.7 });
  for (let k = 0; k < 6; k++) { const th = ang + (k / 6) * TAU; rule(c, x + Math.cos(th) * r * 0.36, y + Math.sin(th) * r * 0.36, x + Math.cos(th) * r * 0.8, y + Math.sin(th) * r * 0.8, 1, col('bone', 0.5 * a), 2); }
  c.strokeStyle = col('bone', 0.9 * a); c.lineWidth = 2; c.beginPath(); c.arc(x, y, r * 0.2, 0, TAU); c.stroke();
  if ((o.hot ?? 0) > 0.05) { g.fillStyle = col('ember', 0.25 * (o.hot ?? 0) * a); g.beginPath(); g.arc(x, y, r * 1.2, 0, TAU); g.fill(); }
}
/** A rubber stamp, springs in on t0. */
export function stampT(s: S, x: number, y: number, text: string, t0: number, rot = -0.12, sz = 54, k: 'signal' | 'blood' | 'acid' | 'ink' = 'signal', a = 1) {
  const { t, c } = s;
  const sk = t > t0 ? clamp(springStep(t - t0, 3, 0.5), 0, 1.1) : 0; if (sk <= 0 || a <= 0) return;
  c.save(); c.translate(x, y); c.rotate(rot); c.scale(lerp(2.2, 1, sk), lerp(2.2, 1, sk));
  const fam = A(100, 900); setFont(c, fam, sz); const w = measure(text, fam, sz) + 56;
  c.strokeStyle = col(k, 0.92 * a); c.lineWidth = 5; c.strokeRect(-w / 2, -sz * 0.72, w, sz * 1.44); c.lineWidth = 1.5; c.strokeRect(-w / 2 + 7, -sz * 0.72 + 7, w - 14, sz * 1.44 - 14);
  c.fillStyle = col(k, 0.92 * a); c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(text, 0, 3);
  c.globalCompositeOperation = 'destination-out'; for (let i = 0; i < 26; i++) { c.fillStyle = 'rgba(0,0,0,0.5)'; c.fillRect(-w / 2 + hash(i, 3) * w, -sz * 0.7 + hash(i, 4) * sz * 1.4, 2 + hash(i, 5) * 5, 1.5); } c.globalCompositeOperation = 'source-over';
  c.restore();
  if (t0 < t && t < t0 + 0.12) s.post.shake = [noise1(t * 70, 1) * 8, noise1(t * 70, 2) * 8];
}
/** Bone paper sheet with ink hairline grid and a drop shadow. */
export function sheet(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, a = 1, grid = 0, rot = 0) {
  if (a <= 0.003) return;
  c.save(); c.translate(x + w / 2, y + h / 2); c.rotate(rot); c.translate(-w / 2, -h / 2);
  c.fillStyle = col('ink', 0.55 * a); c.fillRect(12, 16, w, h);
  c.fillStyle = mix('bone', 'ash', 0.06, a); c.fillRect(0, 0, w, h);
  if (grid) { for (let gx = grid; gx < w; gx += grid) rule(c, gx, 0, gx, h, 1, col('graphite', 0.16 * a), 1); for (let gy = grid; gy < h; gy += grid) rule(c, 0, gy, w, gy, 1, col('graphite', 0.16 * a), 1); }
  c.restore();
}
/** Mono typewriter text revealed by word timings (ink on paper). */
export function typed(s: S, ws: Word[], x: number, y: number, size: number, k = 'ink', a = 1) {
  const { t, c } = s;
  setFont(c, F.mono(600), size); c.textAlign = 'left'; c.textBaseline = 'alphabetic';
  let cx = x;
  for (const w of ws) {
    const T = clean(w.w).toUpperCase(), n = Math.floor(clamp((t - w.start + 0.03) / Math.max(0.08, (w.end - w.start) * 0.8)) * T.length + (t >= w.start - 0.03 ? 1 : 0));
    c.fillStyle = mix(k as any, 'blood', heat(w, t), a); c.fillText(T.slice(0, Math.min(T.length, n)), cx, y); cx += measure(T + ' ', F.mono(600), size);
  }
}
/** Dashed hairline (route lines, flight paths). */
export function dash(c: CanvasRenderingContext2D, pts: { x: number; y: number }[], k: string, w = 2, d: [number, number] = [14, 10], off = 0) {
  c.save(); c.setLineDash(d); c.lineDashOffset = off; c.strokeStyle = k; c.lineWidth = w; c.beginPath(); pts.forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y))); c.stroke(); c.restore();
}
/** Strike-through rule across a word row, drawn as the word ends. */
export function strike(s: S, x0: number, x1: number, y: number, k: number, kk = 'signal') {
  if (k <= 0) return; rule(s.c, x0, y, lerp(x0, x1, k), y, 1, col(kk, 1), 8);
  s.g.strokeStyle = col('signal', 0.4 * k); s.g.lineWidth = 16; s.g.beginPath(); s.g.moveTo(x0, y); s.g.lineTo(lerp(x0, x1, k), y); s.g.stroke();
}
export { TAU };
