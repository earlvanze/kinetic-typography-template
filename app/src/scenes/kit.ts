// Shared kinetic-typography toolkit: camera, word envelopes, sung colouring, glyph drawing.
// Everything is a pure function of song time t (the engine averages sub-frames for motion blur).
import { W, H } from '../engine/gl';
import { HEX } from '../engine/palette';
import { F, font, layout, measure } from '../engine/type';
import type { Line, Word } from '../engine/lyrics';
import { clamp, ease, lerp, prog, springStep } from '../engine/util';

export const CAP = 0.705; // Archivo cap height / em
export const XH = 0.53; // Archivo x-height / em

// ------------------------------------------------------------------ colour
function hexRGB(h: string): [number, number, number] {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const RGB: Record<string, [number, number, number]> = Object.fromEntries(Object.entries(HEX).map(([k, v]) => [k, hexRGB(v)]));
export function col(key: keyof typeof HEX | string, a = 1): string {
  const c = RGB[key] ?? hexRGB(key);
  return `rgba(${c[0]},${c[1]},${c[2]},${clamp(a)})`;
}
/** Mix two palette colours (sRGB space) and alpha. */
export function mix(a: keyof typeof HEX, b: keyof typeof HEX, k: number, alpha = 1): string {
  const x = RGB[a]!, y = RGB[b]!;
  k = clamp(k);
  return `rgba(${Math.round(lerp(x[0], y[0], k))},${Math.round(lerp(x[1], y[1], k))},${Math.round(lerp(x[2], y[2], k))},${clamp(alpha)})`;
}

// ------------------------------------------------------------------ word timing
/** 0..1 appearance (snappy, starts 60 ms before the onset so the slam lands on it). */
export const appear = (w: { start: number }, t: number, dur = 0.2) => prog(t, w.start - 0.06, w.start - 0.06 + dur, ease.outExpo);
/** Slam scale: big -> 1 with a small spring settle. */
export function slamScale(w: { start: number }, t: number, from = 1.9) {
  const k = springStep(t - (w.start - 0.05), 3.2, 0.62);
  return lerp(from, 1, clamp(k, 0, 1.08));
}
/** Is the word currently being sung (with a short tail)? */
export const active = (w: Word, t: number) => t >= w.start - 0.03 && t < w.end + 0.12;
/** 0..1 how "hot" the word is: 1 while sung, decays after. */
export function heat(w: Word, t: number) {
  if (t < w.start - 0.05) return 0;
  if (t < w.end) return prog(t, w.start - 0.05, w.start + 0.03);
  return Math.pow(0.5, (t - w.end) / 0.18);
}
/** Colour for a sung word: ghost before, gold while sung, bone after. */
export function wordCol(w: Word, t: number, base: keyof typeof HEX = 'bone', hot: keyof typeof HEX = 'signal', ghost = 0.0) {
  if (t < w.start - 0.06) return col(base, ghost);
  return mix(base, hot, heat(w, t));
}
/** Line-level fade in/out helpers. */
export const lineIn = (l: Line, t: number, lead = 0.12, dur = 0.25) => prog(t, l.start - lead, l.start - lead + dur, ease.outCubic);

// ------------------------------------------------------------------ camera
export interface Cam { x: number; y: number; z: number; r: number }
export const cam0 = (): Cam => ({ x: W / 2, y: H / 2, z: 1, r: 0 });
/** Map composition coordinates to the screen: (x,y) of the composition lands on screen centre. */
export function applyCam(c: CanvasRenderingContext2D, k: Cam, shake: [number, number] = [0, 0]) {
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.translate(W / 2 + shake[0], H / 2 + shake[1]);
  c.rotate(k.r);
  c.scale(k.z, k.z);
  c.translate(-k.x, -k.y);
}
export function lerpCam(a: Cam, b: Cam, k: number): Cam {
  return { x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k), z: a.z * Math.pow(b.z / a.z, k), r: lerp(a.r, b.r, k) };
}
/**
 * Camera that snaps between targets: each target i becomes active at times[i] and is reached with an
 * outExpo move of `dur` seconds (holds, then snaps — no floaty drift), plus a slow continuous push.
 */
export function snapCam(t: number, times: number[], targets: Cam[], dur = 0.45, fn = ease.outExpo): Cam {
  let cur = targets[0]!;
  for (let i = 1; i < targets.length; i++) {
    const t0 = times[i]!;
    if (t < t0) break;
    cur = lerpCam(cur, targets[i]!, prog(t, t0, t0 + dur, fn));
  }
  return cur;
}

// ------------------------------------------------------------------ type
export const A = (width = 100, weight = 900) => F.archivo(width, weight);
/** Width-axis animation through the static instances (62..125). */
export const widthFam = (k: number, weight = 900) => F.archivo(lerp(62, 125, clamp(k)), weight);

export function setFont(c: CanvasRenderingContext2D, fam: string, size: number) { c.font = font(fam, size); }

/** Draw a word centred at (x, y-centre of caps) with scale about its centre. */
export function drawWordC(c: CanvasRenderingContext2D, text: string, fam: string, size: number, x: number, y: number, fill: string, s = 1, rot = 0, tracking = 0) {
  if (s <= 0.001) return;
  c.save();
  c.translate(x, y);
  if (rot) c.rotate(rot);
  if (s !== 1) c.scale(s, s);
  setFont(c, fam, size);
  c.fillStyle = fill;
  c.textBaseline = 'alphabetic';
  if (tracking) {
    const L = layout(text, fam, size, tracking);
    let x0 = -L.width / 2;
    for (const g of L.glyphs) c.fillText(g.ch, x0 + g.x, (CAP * size) / 2);
  } else {
    c.textAlign = 'center';
    c.fillText(text, 0, (CAP * size) / 2);
  }
  c.restore();
}
/** Draw left-aligned at baseline. */
export function drawWordL(c: CanvasRenderingContext2D, text: string, fam: string, size: number, x: number, y: number, fill: string) {
  setFont(c, fam, size);
  c.fillStyle = fill;
  c.textAlign = 'left';
  c.textBaseline = 'alphabetic';
  c.fillText(text, x, y);
}
/** Size that makes `text` exactly `width` px wide. */
export function sizeFor(text: string, fam: string, width: number) {
  const m = measure(text, fam, 100);
  return (100 * width) / Math.max(1, m);
}
export const up = (s: string) => s.toUpperCase().replace(/[,.!?]/g, '');
export const clean = (s: string) => s.replace(/[,.!?]/g, '');

/** Per-glyph drop: each letter falls in with a stagger. Returns nothing; draws at baseline-left x,y. */
export function drawLetters(
  c: CanvasRenderingContext2D, text: string, fam: string, size: number, x: number, y: number, t0: number, t: number,
  fill: (i: number, k: number) => string, opts: { stagger?: number; dy?: number; rot?: number; dur?: number; tracking?: number } = {},
) {
  const L = layout(text, fam, size, opts.tracking ?? 0);
  setFont(c, fam, size);
  c.textAlign = 'left';
  c.textBaseline = 'alphabetic';
  const st = opts.stagger ?? 0.035, dur = opts.dur ?? 0.35, dy = opts.dy ?? -size * 0.6;
  for (const g of L.glyphs) {
    const k = prog(t, t0 + g.i * st, t0 + g.i * st + dur, ease.outExpo);
    if (k <= 0) continue;
    c.save();
    c.translate(x + g.x + g.w / 2, y + (1 - k) * dy);
    if (opts.rot) c.rotate((1 - k) * opts.rot * (g.i % 2 ? 1 : -1));
    c.fillStyle = fill(g.i, k);
    c.fillText(g.ch, -g.w / 2, 0);
    c.restore();
  }
  return L.width;
}

/** Thin rule with an animated draw-on. */
export function rule(c: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, k: number, stroke: string, w = 2) {
  if (k <= 0) return;
  c.strokeStyle = stroke;
  c.lineWidth = w;
  c.beginPath();
  c.moveTo(x0, y0);
  c.lineTo(lerp(x0, x1, k), lerp(y0, y1, k));
  c.stroke();
}

/** Small mono annotation (the "drafting" voice). */
export function note(c: CanvasRenderingContext2D, text: string, x: number, y: number, a: number, size = 18, color: keyof typeof HEX = 'ash', align: CanvasTextAlign = 'left') {
  if (a <= 0) return;
  setFont(c, F.mono(500), size);
  c.textAlign = align;
  c.textBaseline = 'alphabetic';
  c.fillStyle = col(color, a);
  c.fillText(text, x, y);
}
