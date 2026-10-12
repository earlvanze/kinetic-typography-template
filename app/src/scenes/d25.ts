// 2.5D toolkit (import from '../scenes/d25'): a perspective camera over the Canvas2D layers. Words are glyphs set on 3D
// planes (each glyph gets the local affine of the perspective map, so long words foreshorten correctly) and extruded into
// solid slabs; boxes / panels / lines are projected exactly. World units: pixels at the focal plane; y points DOWN, z INTO the
// screen; positive camera pitch looks DOWN. Default camera { z: -F0 } frames world (0,0,0) at screen centre 1:1.
// Draw far → near (painter's order; box3 sorts its own faces, flyLine sorts its words). Pure functions of their inputs.
import { W, H } from '../engine/gl';
import { font, layout, measure } from '../engine/type';
import type { Word } from '../engine/lyrics';
import { clamp, ease, lerp, prog } from '../engine/util';
import { A, CAP, col, heat, mix } from './kit';
import { txt, type S } from './shots';

export type V3 = [number, number, number];
export interface Cam3 { x: number; y: number; z: number; yaw: number; pitch: number; roll: number; f: number }
export const F0 = 1100;
export const cam3 = (o: Partial<Cam3> = {}): Cam3 => ({ x: 0, y: 0, z: -F0, yaw: 0, pitch: 0, roll: 0, f: F0, ...o });
export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const mul = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const NEAR = 60;

/** Orientation basis: R (text right), U (text down), N (into the plane / away from a facing viewer). */
export interface Basis { R: V3; U: V3; N: V3 }
export function basis(yaw = 0, pitch = 0, roll = 0): Basis {
  const rot = (v: V3): V3 => {
    let [x, y, z] = v;
    const cr = Math.cos(roll), sr = Math.sin(roll); [x, y] = [x * cr - y * sr, x * sr + y * cr];
    const cp = Math.cos(pitch), sp = Math.sin(pitch); [y, z] = [y * cp - z * sp, y * sp + z * cp];
    const cy = Math.cos(yaw), sy = Math.sin(yaw); [x, z] = [x * cy + z * sy, -x * sy + z * cy];
    return [x, y, z];
  };
  return { R: rot([1, 0, 0]), U: rot([0, 1, 0]), N: rot([0, 0, 1]) };
}
export const FACE = basis();
/** A plane lying flat on the floor, text readable from a camera in front (top of text away from the viewer). */
export const FLOOR = basis(0, -Math.PI / 2);

export function view(c: Cam3, p: V3): V3 {
  let x = p[0] - c.x, y = p[1] - c.y, z = p[2] - c.z;
  const cy = Math.cos(-c.yaw), sy = Math.sin(-c.yaw); [x, z] = [x * cy + z * sy, -x * sy + z * cy];
  const cp = Math.cos(c.pitch), sp = Math.sin(c.pitch); [y, z] = [y * cp - z * sp, y * sp + z * cp];
  const cr = Math.cos(-c.roll), sr = Math.sin(-c.roll); [x, y] = [x * cr - y * sr, x * sr + y * cr];
  return [x, y, z];
}
export function proj(c: Cam3, p: V3) {
  const v = view(c, p);
  if (v[2] < NEAR) return null;
  const k = c.f / v[2];
  return { x: W / 2 + v[0] * k, y: H / 2 + v[1] * k, k, z: v[2] };
}
/** Local affine of the projection at P for the plane (R, U). */
function affine(c: Cam3, P: V3, R: V3, U: V3) {
  const e = 4;
  const p0 = proj(c, P), pr = proj(c, add(P, mul(R, e))), pu = proj(c, add(P, mul(U, e)));
  if (!p0 || !pr || !pu) return null;
  return { a: (pr.x - p0.x) / e, b: (pr.y - p0.y) / e, c: (pu.x - p0.x) / e, d: (pu.y - p0.y) / e, x: p0.x, y: p0.y, z: p0.z };
}
const layers = (s: S) => [s.c, s.g] as const;
export function resetT(s: S) { for (const k of layers(s)) k.setTransform(1, 0, 0, 1, 0, 0); }

// ------------------------------------------------------------------ primitives
export function poly(ctx: CanvasRenderingContext2D, c: Cam3, pts: V3[], fill?: string, stroke?: string, lw = 2) {
  const P = pts.map((p) => proj(c, p));
  if (P.some((p) => !p)) return false;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.beginPath(); P.forEach((p, i) => (i ? ctx.lineTo(p!.x, p!.y) : ctx.moveTo(p!.x, p!.y))); ctx.closePath();
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.stroke(); }
  return true;
}
export function seg(ctx: CanvasRenderingContext2D, c: Cam3, a: V3, b: V3, stroke: string, lw = 2) {
  let va = view(c, a), vb = view(c, b);
  if (va[2] < NEAR && vb[2] < NEAR) return;
  if (va[2] < NEAR || vb[2] < NEAR) {
    const k = (NEAR - va[2]) / (vb[2] - va[2]);
    const m: V3 = [lerp(va[0], vb[0], k), lerp(va[1], vb[1], k), NEAR];
    if (va[2] < NEAR) va = m; else vb = m;
  }
  const pa = { x: W / 2 + (va[0] * c.f) / va[2], y: H / 2 + (va[1] * c.f) / va[2] }, pb = { x: W / 2 + (vb[0] * c.f) / vb[2], y: H / 2 + (vb[1] * c.f) / vb[2] };
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y); ctx.stroke();
}
/** Rectangle on a plane: centre O, half sizes hw/hh along R/U. */
export function rect3(ctx: CanvasRenderingContext2D, c: Cam3, O: V3, b: Basis, hw: number, hh: number, fill?: string, stroke?: string, lw = 2) {
  const { R, U } = b;
  return poly(ctx, c, [add(add(O, mul(R, -hw)), mul(U, -hh)), add(add(O, mul(R, hw)), mul(U, -hh)), add(add(O, mul(R, hw)), mul(U, hh)), add(add(O, mul(R, -hw)), mul(U, hh))], fill, stroke, lw);
}
/** Solid box: centre, half extents along the basis. Draws visible faces back-to-front. Returns the front (-N) face plane. */
export function box3(s: S, c: Cam3, C: V3, b: Basis, hw: number, hh: number, hd: number, o: { front?: string; side?: string; top?: string; edge?: string; lw?: number; glowEdge?: number } = {}) {
  const { R, U, N } = b;
  const cpos: V3 = [c.x, c.y, c.z];
  const faces: { n: V3; ctr: V3; u: V3; v: V3; hu: number; hv: number; fill: string }[] = [
    { n: mul(N, -1), ctr: add(C, mul(N, -hd)), u: R, v: U, hu: hw, hv: hh, fill: o.front ?? col('ink2') },
    { n: N, ctr: add(C, mul(N, hd)), u: R, v: U, hu: hw, hv: hh, fill: o.side ?? col('ink') },
    { n: R, ctr: add(C, mul(R, hw)), u: N, v: U, hu: hd, hv: hh, fill: o.side ?? col('ink') },
    { n: mul(R, -1), ctr: add(C, mul(R, -hw)), u: N, v: U, hu: hd, hv: hh, fill: o.side ?? col('ink') },
    { n: mul(U, -1), ctr: add(C, mul(U, -hh)), u: R, v: N, hu: hw, hv: hd, fill: o.top ?? o.side ?? col('ink') },
    { n: U, ctr: add(C, mul(U, hh)), u: R, v: N, hu: hw, hv: hd, fill: o.side ?? col('ink') },
  ];
  const vis = faces.filter((f) => dot(f.n, sub(cpos, f.ctr)) > 0).sort((a, b2) => view(c, b2.ctr)[2] - view(c, a.ctr)[2]);
  for (const f of vis) {
    rect3(s.c, c, f.ctr, { R: f.u, U: f.v, N: f.n }, f.hu, f.hv, f.fill, o.edge, o.lw ?? 2);
    if (o.glowEdge && o.edge) rect3(s.g, c, f.ctr, { R: f.u, U: f.v, N: f.n }, f.hu, f.hv, undefined, col('ember', o.glowEdge), (o.lw ?? 2) * 3);
  }
  return { O: add(C, mul(N, -hd)), b };
}

// ------------------------------------------------------------------ type in space
export interface T3 {
  depth?: number; steps?: number; alpha?: number; sc?: number; color?: string; side?: string; glow?: number;
  w?: Word | null; hot?: string; base?: string; align?: 'c' | 'l' | 'r'; tracking?: number;
  fx?: (i: number, n: number) => { dx?: number; dy?: number; dz?: number; rot?: number; a?: number } | null;
}
/** Text set on a plane at O (cap-centred), extruded `depth` along +N (behind the face). */
export function text3(s: S, c: Cam3, text: string, fam: string, size: number, O: V3, b: Basis, o: T3 = {}) {
  const a0 = o.alpha ?? 1;
  if (a0 <= 0.003 || !text) return;
  const sc = o.sc ?? 1;
  const R = mul(b.R, sc), U = mul(b.U, sc), N = b.N;
  const L = layout(text, fam, size, o.tracking ?? 0);
  const x0 = o.align === 'l' ? 0 : o.align === 'r' ? -L.width : -L.width / 2;
  const h = o.w ? heat(o.w, s.t) : 0;
  const face = o.color ?? mix((o.base ?? 'bone') as any, (o.hot ?? 'signal') as any, h, 1);
  const depth = o.depth ?? size * 0.22, steps = o.steps ?? Math.max(2, Math.min(12, Math.round(depth / 5)));
  const n = L.glyphs.length;
  const fxs = L.glyphs.map((g) => o.fx?.(g.i, n) ?? {});
  const yc = (CAP * size) / 2;
  for (const ctx of [s.c]) {
    ctx.font = font(fam, size);
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  }
  const drawLayer = (ctx: CanvasRenderingContext2D, dz: number, fill: string, alpha: number) => {
    ctx.fillStyle = fill;
    L.glyphs.forEach((g, i) => {
      const f = fxs[i]!;
      if (f === null) return;
      const ga = alpha * (f.a ?? 1);
      if (ga <= 0.003) return;
      const gx = x0 + g.x + g.w / 2 + (f.dx ?? 0);
      const P = add(add(add(O, mul(R, gx)), mul(U, f.dy ?? 0)), mul(N, dz + (f.dz ?? 0)));
      const A2 = affine(c, P, R, U);
      if (!A2) return;
      ctx.globalAlpha = ga;
      ctx.setTransform(A2.a, A2.b, A2.c, A2.d, A2.x, A2.y);
      if (f.rot) ctx.rotate(f.rot);
      ctx.fillText(g.ch, -g.w / 2, yc);
    });
    ctx.globalAlpha = 1;
  };
  const side = o.side ?? mix('ink2', 'graphite', 0.6);
  for (let k = steps; k >= 1; k--) drawLayer(s.c, (depth * k) / steps, k === 1 ? mix('graphite', 'ash', 0.3) : side, a0);
  drawLayer(s.c, 0, face, a0);
  const gl = (o.glow ?? 1) * h * (s.paper ? 0 : 1);
  if (gl > 0.02) { s.g.font = font(fam, size); s.g.textAlign = 'left'; s.g.textBaseline = 'alphabetic'; drawLayer(s.g, 0, col('ember'), a0 * gl * 0.5); }
  resetT(s);
}

// ------------------------------------------------------------------ sung words as flying objects
const SMALLW = /^(a|an|the|to|and|of|in|on|it|is|my|we|for|with|from|at|by|but|so|that|this|then|just|no|not|than|you|your|it's|its)$/i;
export const small = (w: Word) => SMALLW.test(w.w.replace(/[^\w']/g, ''));
export interface Placed { w: Word; fam: string; size: number; u: number; v: number; big: boolean }
/** Lay out words in rows (Swiss hierarchy: content words heavy, function words light/half size). u/v relative to centre. */
export function setRows(ws: Word[], width: number, max: number, maxChars = 16, gapV = 1.08): Placed[] {
  const R: Word[][] = []; let cur: Word[] = [], n = 0;
  for (const w of ws) { const l = txt(w).length; if (cur.length && n + l > maxChars) { R.push(cur); cur = []; n = 0; } cur.push(w); n += l + 1; }
  if (cur.length) R.push(cur);
  const famB = A(100, 900), famS = A(62, 400);
  const out: Placed[] = [];
  const sizes = R.map((r) => {
    const allSmall = r.every(small);
    const m = r.map((w) => (allSmall || !small(w) ? measure(txt(w), famB, 100) : measure(txt(w), famS, 100) * 0.5));
    const tot = m.reduce((a, b) => a + b, 0) + 24 * (r.length - 1);
    return { m, size: Math.min(max, (100 * width) / tot), allSmall };
  });
  const size0 = Math.min(...sizes.map((x) => x.size));
  R.forEach((r, ri) => {
    const { m, allSmall } = sizes[ri]!;
    const size = Math.min(sizes[ri]!.size, size0 * 1.25), k = size / 100;
    const tot = (m.reduce((a, b) => a + b, 0) + 24 * (r.length - 1)) * k;
    let x = -tot / 2;
    const v = (ri - (R.length - 1) / 2) * size0 * gapV;
    r.forEach((w, i) => {
      const big = allSmall || !small(w), wd = m[i]! * k;
      out.push({ w, fam: big ? famB : famS, size: big ? size : size * 0.5, u: x + wd / 2, v: big ? v : v + (CAP * size - CAP * size * 0.5) / 2, big });
      x += wd + 24 * k;
    });
  });
  return out;
}
/**
 * A lyric line as objects in space: each word flies in from `from` (offset in world, default toward the camera)
 * and lands on its sung onset with a decelerating hit, then settles with a small spring. Returns the placements.
 */
export function flyLine(s: S, c: Cam3, ws: Word[], O: V3, b: Basis, width: number, max: number, o: { maxChars?: number; from?: V3; alpha?: number; depth?: number; spin?: number; hot?: string; lead?: number; tumble?: number } = {}) {
  const t = s.t;
  const P = setRows(ws, width, max, o.maxChars ?? 16);
  // far words first (painter's order): sort by view depth of their landing spot
  const items = P.map((p) => ({ p, at: add(add(O, mul(b.R, p.u)), mul(b.U, p.v)) })).sort((x, y) => view(c, y.at)[2] - view(c, x.at)[2]);
  for (const { p, at } of items) {
    const w = p.w, lead = o.lead ?? 0.22;
    if (t < w.start - lead) continue;
    const k = prog(t, w.start - lead, w.start, ease.outCubic);
    const settle = t > w.start ? Math.exp(-(t - w.start) * 9) * Math.sin((t - w.start) * 40) : 0;
    const from = o.from ?? [0, 0, -700];
    const off = mul(from, (1 - k) + settle * 0.04);
    const sp = (o.spin ?? 0.6) * (1 - k) * (hashSign(w.start));
    const bb = sp ? rotB(b, sp, (o.tumble ?? 0) * (1 - k)) : b;
    text3(s, c, txt(w), p.fam, p.size, add(at, off), bb, { w, depth: p.big ? (o.depth ?? p.size * 0.28) : p.size * 0.12, alpha: (o.alpha ?? 1) * clamp(k * 3), hot: o.hot });
  }
  return P;
}
const hashSign = (x: number) => (Math.sin(x * 91.7) > 0 ? 1 : -1);
/** Rotate a basis about its own U (yaw-like) and R (pitch-like) axes. */
export function rotB(b: Basis, yaw: number, pitch = 0): Basis {
  const r = (v: V3, ax: V3, a: number): V3 => { const c2 = Math.cos(a), s2 = Math.sin(a); return add(add(mul(v, c2), mul(cross(ax, v), s2)), mul(ax, dot(ax, v) * (1 - c2))); };
  let { R, U, N } = b;
  if (yaw) { R = r(R, b.U, yaw); N = r(N, b.U, yaw); }
  if (pitch) { U = r(U, R, pitch); N = r(N, R, pitch); }
  return { R, U, N };
}

// ------------------------------------------------------------------ environment
/** Perspective floor grid at height y, scrolling along z by `scroll`. */
export function floor(s: S, c: Cam3, y: number, a = 1, o: { span?: number; step?: number; scroll?: number; z0?: number; z1?: number; hot?: number } = {}) {
  const span = o.span ?? 4000, step = o.step ?? 200, z0 = o.z0 ?? -1200, z1 = o.z1 ?? 6000, sc = ((o.scroll ?? 0) % step + step) % step;
  for (let x = -span; x <= span; x += step) seg(s.c, c, [x, y, z0], [x, y, z1], col(x === 0 ? 'blood' : 'graphite', (x === 0 ? 0.9 : 0.5) * a), 1.5);
  for (let z = z0 - sc + step; z <= z1; z += step) {
    const fade = 1 - clamp((z - z0) / (z1 - z0));
    seg(s.c, c, [-span, y, z], [span, y, z], col('graphite', 0.55 * a * fade), 1.5);
  }
  if (o.hot) seg(s.g, c, [-span, y, z0 + 400], [span, y, z0 + 400], col('signal', 0.2 * o.hot), 4);
}
/** Floating tokens at fixed 3D positions (parallax depth cue). */
export function dust(s: S, c: Cam3, words: string[], n = 40, seed = 1, a = 0.35) {
  const fam = 'Plex-400';
  for (let i = 0; i < n; i++) {
    const r = (k: number) => { const x = Math.sin((i + 1) * 12.9898 + seed * 78.233 + k * 37.719) * 43758.5453; return x - Math.floor(x); };
    const P: V3 = [(r(1) - 0.5) * 5000, (r(2) - 0.5) * 2600, 300 + r(3) * 5000];
    text3(s, c, words[i % words.length]!, fam, 34, P, FACE, { depth: 0, steps: 0, color: col('graphite', 1), alpha: a });
  }
}
/** Snap a camera between keyframes: each key is reached with outExpo over `dur` after its time. */
export function camAt(t: number, times: number[], keys: Partial<Cam3>[], dur = 0.6, fn = ease.outExpo): Cam3 {
  let cur = cam3(keys[0]);
  for (let i = 1; i < keys.length; i++) {
    if (t < times[i]!) break;
    const nx = cam3({ ...cur, ...keys[i] });
    const k = fn(clamp((t - times[i]!) / dur));
    cur = { x: lerp(cur.x, nx.x, k), y: lerp(cur.y, nx.y, k), z: lerp(cur.z, nx.z, k), yaw: lerp(cur.yaw, nx.yaw, k), pitch: lerp(cur.pitch, nx.pitch, k), roll: lerp(cur.roll, nx.roll, k), f: lerp(cur.f, nx.f, k) };
  }
  return cur;
}
/** Shot-start punch + kick bounce on the focal length. */
export function punch(s: S, c: Cam3, amt = 0.07): Cam3 {
  return { ...c, f: c.f * (1 + amt * (1 - prog(s.lt, 0, 0.35, ease.outExpo))) };
}
/** A mono label on a plane (no extrusion). */
export function label3(s: S, c: Cam3, text: string, O: V3, b: Basis, size: number, color: string, align: 'l' | 'c' | 'r' = 'l', ctx: 'c' | 'g' = 'c', weight = 500) {
  if (!text) return;
  const fam = `Plex-${weight}`;
  const L = measure(text, fam, size);
  const dx = align === 'l' ? L / 2 : align === 'r' ? -L / 2 : 0;
  const P = add(O, mul(b.R, dx));
  const A2 = affine(c, P, b.R, b.U);
  if (!A2) return;
  const k = s[ctx];
  k.setTransform(A2.a, A2.b, A2.c, A2.d, A2.x, A2.y);
  k.font = font(fam, size); k.textAlign = 'center'; k.textBaseline = 'alphabetic'; k.fillStyle = color;
  k.fillText(text, 0, size * 0.35);
  k.setTransform(1, 0, 0, 1, 0, 0);
}

// ------------------------------------------------------------------ props (from "Works On My Machine")
/** Point on a plane: O + u·R + v·U + n·N. */
export const P3 = (O: V3, b: Basis, u: number, v: number, n = 0): V3 => add(add(add(O, mul(b.R, u)), mul(b.U, v)), mul(b.N, n));
/** 0..1 visibility of line i while it is current: in at its start, out just before the next line begins. */
export function lineVis(L: { start: number }[], i: number, t: number) {
  const l = L[i]!, n = L[i + 1];
  return prog(t, l.start - 0.3, l.start - 0.05) * (n ? 1 - prog(t, n.start - 0.25, n.start - 0.02) : 1);
}
/** ✓ / ✗ drawn as projected strokes on a plane (Archivo has neither glyph). */
export function mark3(s: S, c: Cam3, kind: 'ok' | 'err', O: V3, b: Basis, sz: number, a: number, glow = 0, okKey = 'signal', errKey = 'acid') {
  if (a <= 0.01) return;
  const p = proj(c, O); if (!p) return;
  const pts: [number, number][][] = kind === 'ok' ? [[[-0.45, 0.02], [-0.12, 0.36], [0.48, -0.4]]] : [[[-0.38, -0.38], [0.38, 0.38]], [[0.38, -0.38], [-0.38, 0.38]]];
  s.c.lineCap = 'round'; s.g.lineCap = 'round';
  for (const pl of pts) for (let i = 0; i + 1 < pl.length; i++) {
    const A2 = P3(O, b, pl[i]![0] * sz, pl[i]![1] * sz), B2 = P3(O, b, pl[i + 1]![0] * sz, pl[i + 1]![1] * sz);
    seg(s.c, c, A2, B2, col(kind === 'ok' ? okKey : errKey, a), Math.max(2, sz * 0.16 * p.k));
    if (glow && kind === 'ok') seg(s.g, c, A2, B2, col('ember', a * glow), sz * 0.3 * p.k);
  }
}
/** A flat UI window on a plane: body, title bar, three dots, mono title. */
export function panel3(s: S, c: Cam3, O: V3, b: Basis, hw: number, hh: number, title: string, a = 1, edge = 'graphite') {
  if (a <= 0.01) return;
  rect3(s.c, c, O, b, hw, hh, col('ink2', 0.97 * a), col(edge, 0.9 * a), 2);
  rect3(s.c, c, P3(O, b, 0, -hh + 22), b, hw, 22, col('graphite', 0.4 * a));
  (['acid', 'ash', 'signal'] as const).forEach((k, i) => rect3(s.c, c, P3(O, b, -hw + 26 + i * 24, -hh + 22), b, 7, 7, col(k, 0.8 * a)));
  label3(s, c, title, P3(O, b, -hw + 110, -hh + 22), b, 19, col('ash', 0.9 * a), 'l');
}
/** A block of half-height hh standing on `base` (bottom-centre) that topples backward by k (0 upright → 1 flat). */
export function standing(base: V3, yaw: number, hh: number, k: number): { C: V3; b: Basis } {
  const b = basis(yaw, (-Math.PI / 2) * k);
  return { C: add(base, mul(b.U, -hh)), b };
}
/** Size of a word slab (see slab3) for these words. */
export function slabDims(ws: Word[], width: number, label = false) {
  const P = setRows(ws, width, 200, 999);
  const size = Math.max(...P.map((p) => p.size));
  const half = (p: Placed) => measure(txt(p.w), p.fam, p.size) / 2;
  const ms = size * CAP * 1.1, pad = Math.max(26, size * 0.38);
  const left = P[0]!.u - half(P[0]!), textW = P[P.length - 1]!.u + half(P[P.length - 1]!) - left;
  return { P, size, ms, pad, left, hw: (textW + ms + pad * 3) / 2, hh: (size * CAP + pad * 2 + (label ? 44 : 0)) / 2 };
}
/**
 * Word slab: the sung words raised on the front of a solid block, with a ✓/✗ (a rubber stamp, a badge, a sign).
 * C = block centre; pair with standing() to drop it onto the floor or knock it flat.
 */
export function slab3(s: S, c: Cam3, ws: Word[], C: V3, b: Basis, width: number, o: { alpha?: number; colr?: 'signal' | 'acid'; label?: string; kind?: 'ok' | 'err' | 'none' } = {}) {
  const a = o.alpha ?? 1;
  if (a <= 0.01 || !ws.length) return;
  const { P, ms, pad, left, hw, hh } = slabDims(ws, width, !!o.label);
  const colr = o.colr ?? 'signal', ok = colr === 'signal';
  const lit = 0.4 + 0.6 * Math.max(0, ...ws.map((w) => heat(w, s.t)));
  const face = box3(s, c, C, b, hw, hh, 34, { front: col('ink2', a), side: mix('ink', 'blood', ok ? 0.5 : 0, a), top: mix('ink2', 'blood', ok ? 0.6 : 0, a), edge: col(colr, 0.95 * a), lw: 3, glowEdge: ok ? 0.25 * a * lit : 0 });
  rect3(s.c, c, add(face.O, mul(b.N, -1)), b, hw - 16, hh - 16, undefined, col(colr, 0.7 * a), 2);
  const cy = o.label ? -20 : 0;
  if (o.kind !== 'none') mark3(s, c, o.kind ?? 'ok', P3(face.O, b, -hw + pad * 1.4 + ms / 2, cy, -2), b, ms, a, 0.5);
  const ox = -hw + pad * 2 + ms - left;
  for (const p of P) text3(s, c, txt(p.w), p.fam, p.size, P3(face.O, b, ox + p.u, cy + p.v, -16), b, { w: p.w, depth: 14, steps: 3, alpha: a * (s.t >= p.w.start - 0.06 ? 1 : 0.35), hot: colr });
  if (o.label) label3(s, c, o.label, P3(face.O, b, 0, hh - 32, -2), b, 20, col('ash', 0.9 * a), 'c');
}
