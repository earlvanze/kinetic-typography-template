// Kinetic-typography compositions ("shots"). Each shot owns 1..8 consecutive lyric lines and turns them into
// one moving typographic composition: words are the material (walls, steps, doors, columns, branches), every
// word lands on its sung onset, the sung word burns gold, and the camera holds-then-snaps between beats.
import { BRAND } from '../project/brand';
import type { AudioData } from '../engine/audio';
import { W, H } from '../engine/gl';
import type { HEX } from '../engine/palette';
import type { PostOverrides } from '../engine/scene';
import { F, layout, measure, textPath2D } from '../engine/type';
import type { Line, Word } from '../engine/lyrics';
import { clamp, ease, frameIdx, hash, lerp, mulberry32, noise1, prog, pulse, smoothstep, springStep, TAU } from '../engine/util';
import {
  A, CAP, type Cam, applyCam, appear, cam0, clean, col, drawLetters, heat, lerpCam, lineIn, mix, note, rule, setFont, sizeFor, slamScale,
  snapCam, up, widthFam,
} from './kit';

export interface Shot { kind: string; lines: Line[]; start: number; end: number; o: Record<string, any>; idx: number; n: number }
export interface Bg { paper: number; grid: number; glow: number; gx: number; gy: number; stars: number; warm: number }
export interface S {
  c: CanvasRenderingContext2D; g: CanvasRenderingContext2D; t: number; lt: number; sh: Shot; au: AudioData;
  post: PostOverrides; bg: Bg; paper: boolean;
}
type K = keyof typeof HEX;

// ------------------------------------------------------------------ shared drawing
export function cam(s: S, k: Cam) {
  // global hit punch: kicks nudge the zoom a hair, the shot's first 0.3 s punches in
  const punch = 1 + 0.07 * (1 - prog(s.lt, 0, 0.35, ease.outExpo));
  const k2 = { ...k, z: k.z * punch };
  applyCam(s.c, k2); applyCam(s.g, k2);
}
export const base = (s: S): K => (s.paper ? 'ink' : 'bone');
export const hotK = (s: S): K => (s.paper ? 'blood' : 'signal');

/** Draw a word centred on (x, cap-centre y). Gold while sung (+ glow copy), ghost before, base after. */
export function word(
  s: S, w: Word | null, text: string, fam: string, size: number, x: number, y: number,
  o: { sc?: number; rot?: number; alpha?: number; ghost?: number; color?: string; glow?: number; tracking?: number; hot?: K; base?: K; align?: 'c' | 'l' | 'r' } = {},
) {
  const { c, g, t } = s;
  const a = (o.alpha ?? 1) * (w ? Math.max(o.ghost ?? 0, appear(w, t)) : 1);
  if (a <= 0.003) return;
  const h = w ? heat(w, t) : 0;
  const fill = o.color ?? (w && t < w.start - 0.06 ? col(o.base ?? base(s), o.ghost ?? 0) : mix(o.base ?? base(s), o.hot ?? hotK(s), h, 1));
  const sc = o.sc ?? 1;
  const draw = (ctx: CanvasRenderingContext2D, f: string, al: number) => {
    ctx.save();
    ctx.globalAlpha = al;
    ctx.translate(x, y);
    if (o.rot) ctx.rotate(o.rot);
    if (sc !== 1) ctx.scale(sc, sc);
    setFont(ctx, fam, size);
    ctx.fillStyle = f;
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = o.align === 'l' ? 'left' : o.align === 'r' ? 'right' : 'center';
    ctx.fillText(text, 0, (CAP * size) / 2);
    ctx.restore();
  };
  draw(c, fill, a);
  const gl = (o.glow ?? 1) * h * (s.paper ? 0 : 1);
  if (gl > 0.01) draw(g, col('ember', 1), a * gl * 0.45);
}
/** Slam envelope for a word: scale from big, drop. */
export const slam = (w: Word, t: number, from = 1.8) => slamScale(w, t, from);
export const wordsOf = (ls: Line[]) => ls.flatMap((l) => l.words);
export const txt = (w: Word) => up(w.w);

/** Fit a row of words to `width`: returns size and x offsets (centred at 0). */
export function fitRow(words: string[], fam: string, width: number, maxSize = 400, gapEm = 0.24) {
  const m = words.map((w) => measure(w, fam, 100));
  const tot = m.reduce((a, b) => a + b, 0) + gapEm * 100 * (words.length - 1);
  const size = Math.min(maxSize, (100 * width) / tot);
  const k = size / 100;
  const xs: number[] = [];
  let x = (-tot * k) / 2;
  for (let i = 0; i < words.length; i++) { xs.push(x + (m[i]! * k) / 2); x += m[i]! * k + gapEm * size; }
  return { size, xs, width: tot * k };
}
/** Group words into rows of <= maxChars (keeps short function words with the next word). */
export function rows(ws: Word[], maxChars = 13): Word[][] {
  const out: Word[][] = [];
  let cur: Word[] = [], n = 0;
  for (const w of ws) {
    const l = clean(w.w).length;
    if (cur.length && n + l > maxChars) { out.push(cur); cur = []; n = 0; }
    cur.push(w); n += l + 1;
  }
  if (cur.length) out.push(cur);
  // don't leave a lonely short word at the end of a row when it's a function word
  return out;
}
export const SMALL = new Set(['a', 'the', 'to', 'and', 'of', 'in', 'on', 'it', 'is', 'you', 'we', 'your', 'how', 'when', 'what', 'with', 'but', 'so', 'that', 'than', 'its', 'it’s', 'one', 'more', 'be', 'from', 'this']);
export const isSmall = (w: Word) => SMALL.has(clean(w.w).toLowerCase());

// ------------------------------------------------------------------ 1. SLAM STACK: justified kinetic block
function slamStack(s: S) {
  const { t, sh } = s;
  const ws = wordsOf(sh.lines);
  const R = rows(ws, sh.o.maxChars ?? 12);
  const colW = sh.o.width ?? 1180;
  const gap = 26;
  let y = 0;
  const lay = R.map((r, i) => {
    const style = sh.o.styles ? sh.o.styles[i % sh.o.styles.length] : [ [100, 900], [125, 300], [62, 900], [125, 700], [87, 500] ][Math.floor(hash(sh.idx, i) * 5)]!;
    const fam = A(style[0], style[1]);
    const fr = fitRow(r.map(txt), fam, colW, 330);
    const hgt = fr.size * CAP;
    const row = { r, fam, fr, y: y + hgt / 2, h: hgt };
    y += hgt + gap;
    return row;
  });
  const total = y - gap;
  // camera: frame the rows sung so far, snap on each new row
  const times = lay.map((r) => r.r[0]!.start - 0.08);
  const targets = lay.map((r, i) => {
    const top = 0, bot = r.y + r.h / 2;
    const span = bot - top;
    const z = clamp(820 / Math.max(span, 300), 0.42, 1.35);
    return { x: 0, y: span > 820 / 1.35 ? bot - (820 / z) / 2 : (top + bot) / 2, z, r: (i % 2 ? 1 : -1) * 0.025 * (sh.o.tilt ?? 1) };
  });
  const k = snapCam(t, times, targets, 0.5);
  k.z *= 1 + 0.03 * (s.lt / Math.max(1, sh.end - sh.start));
  cam(s, k);
  for (const r of lay) {
    r.r.forEach((w, i) => {
      if (t < w.start - 0.1) return;
      const sc = slam(w, t, 1.7);
      const dy = (1 - appear(w, t)) * -40;
      word(s, w, txt(w), r.fam, r.fr.size, r.fr.xs[i]!, r.y + dy, { sc });
    });
  }
  if (sh.o.rule) rule(s.c, -colW / 2, total + 30, colW / 2, total + 30, prog(t, sh.start, sh.start + 0.6, ease.outExpo), col(hotK(s), 0.8), 3);
}

// ------------------------------------------------------------------ 2. ANCHOR: repeated head, rolling tails
function anchor(s: S) {
  const { t, sh } = s;
  const L = sh.lines;
  const h = sh.o.head ?? 1; // number of head words shared by all lines
  const headText = sh.o.headText ?? up(L[0]!.words.slice(0, h).map((w) => w.w).join(' '));
  let cur = 0;
  for (let i = 0; i < L.length; i++) if (t >= L[i]!.start - 0.12) cur = i;
  const curL = L[cur]!;
  const headFam = A(sh.o.headWidth ?? 125, 900);
  const headSize = sh.o.headSize ?? 170;
  const tailW = sh.o.tailWidth ?? 1500;
  const rise = sh.o.rise ?? 0; // camera rise per line (build section)
  const k: Cam = snapCam(t, L.map((l) => l.start - 0.1), L.map((_, i) => ({ x: W / 2, y: H / 2 - rise * i, z: 1 + (sh.o.zoomStep ?? 0.025) * i, r: (i % 2 ? 1 : -1) * (sh.o.tilt ?? 0.018) })), 0.45);
  cam(s, k);
  const cx = W / 2;
  // head: sits above; its words take the current line's timings
  const headY = H / 2 - 230 - rise * cur;
  const hw = measure(headText, headFam, headSize);
  const hk = prog(t, L[0]!.start - 0.15, L[0]!.start + 0.25, ease.outExpo);
  const hwords = curL.words.slice(0, h);
  const hh = hwords.length ? Math.max(...hwords.map((w) => heat(w, t))) : 0;
  const bump = 1 + 0.06 * Math.max(...curL.words.slice(0, h).map((w) => pulse(t, w.start, 0.1)), 0);
  word(s, null, headText, headFam, headSize, cx - (1 - hk) * 300, headY, { color: mix(base(s), hotK(s), hh * 0.7), alpha: hk, sc: bump });
  if (sh.o.counter) {
    const n = String(cur + 1).padStart(2, '0');
    note(s.c, n, cx - hw / 2 - 40, headY + 30, hk, 72, 'signal', 'right');
  }
  if (sh.o.icons) { // one icon per item, popping in on its noun
    const tw = curL.words.slice(h), noun = tw[tw.length - 1];
    if (noun) iconFor(s.c, s.g, clean(noun.w).toLowerCase(), cx + hw / 2 + 170, headY - 10, 150, prog(t, noun.start - 0.08, noun.start + 0.3, ease.outBack));
  }
  // tails: current one big, earlier ones shrink & roll up
  for (let i = 0; i <= cur; i++) {
    const l = L[i]!;
    const tw = l.words.slice(h);
    if (!tw.length) continue;
    const fam = A(sh.o.tailWidths ? sh.o.tailWidths[i % sh.o.tailWidths.length] : i % 2 ? 87 : 100, 900);
    const fr = fitRow(tw.map(txt), fam, tailW, sh.o.tailMax ?? 300);
    const age = cur - i; // 0 = current
    const move = i < cur ? prog(t, L[i + 1]!.start - 0.12, L[i + 1]!.start + 0.3, ease.outExpo) + (age - 1) : 0;
    const sc = i < cur ? lerp(1, 0.34, clamp(move)) * Math.pow(0.92, Math.max(0, move - 1)) : 1;
    const y = H / 2 + 60 - rise * cur + (i < cur ? lerp(0, 150 + fr.size * 0.55, clamp(move)) + Math.max(0, move - 1) * 105 : 0);
    const al = i < cur ? lerp(1, 0.33, clamp(move)) * (1 - clamp((move - 3) / 1)) : 1;
    if (al <= 0) continue;
    tw.forEach((w, j) => {
      if (t < w.start - 0.1) return;
      const sl = i === cur ? slam(w, t, 2.0) : 1;
      word(s, w, txt(w), fam, fr.size, cx + fr.xs[j]! * sc, y + (i === cur ? (1 - appear(w, t)) * 60 : 0), { sc: sl * sc, alpha: al, glow: i === cur ? 1 : 0 });
    });
  }
}

// ------------------------------------------------------------------ 3. STAIR: words are steps
function stair(s: S) {
  const { t, sh } = s;
  const ws = wordsOf(sh.lines);
  const fam = A(100, 900);
  const stepX = sh.o.stepX ?? 300, stepY = sh.o.stepY ?? 150;
  const pos = ws.map((w, i) => ({ x: i * stepX, y: -i * stepY }));
  const k = snapCam(t, ws.map((w) => w.start - 0.1), pos.map((p, i) => ({ x: p.x + 120, y: p.y - 40, z: sh.o.zoom ?? 1.05, r: -0.06 })), 0.4);
  cam(s, k);
  ws.forEach((w, i) => {
    const p = pos[i]!;
    const a = appear(w, t);
    if (a <= 0) return;
    const size = isSmall(w) ? 96 : 150;
    const wd = measure(txt(w), fam, size);
    // slab under the word
    const sk = prog(t, w.start - 0.1, w.start + 0.25, ease.outExpo);
    s.c.fillStyle = col('ink2', 0.9 * sk);
    s.c.fillRect(p.x - stepX * 0.55, p.y + 20, stepX * 1.1 * sk, stepY + 4);
    rule(s.c, p.x - stepX * 0.55, p.y + 20, p.x + stepX * 0.55, p.y + 20, sk, col(heat(w, t) > 0.05 ? 'signal' : 'graphite', 0.9), 4);
    rule(s.g, p.x - stepX * 0.55, p.y + 20, p.x + stepX * 0.55, p.y + 20, sk, col('ember', heat(w, t) * 0.8), 5);
    word(s, w, txt(w), fam, Math.min(size, (stepX * 1.5 * size) / wd), p.x, p.y - size * CAP * 0.5 - 6, { sc: slam(w, t, 1.5) });
  });
  if (sh.o.label) note(s.c, sh.o.label, pos[0]!.x - 160, pos[0]!.y + 90, prog(t, sh.start, sh.start + 0.5), 20);
}

// ------------------------------------------------------------------ 4. DOOR: a panel that opens onto light
function door(s: S) {
  const { t, sh, c, g } = s;
  const [l1, l2] = sh.lines as [Line, Line | undefined];
  const dW = 460, dH = 760, x0 = W / 2 - dW / 2, y0 = H / 2 - dH / 2 + 30;
  const doorWord = l1.words[l1.words.length - 1]!;
  const open = prog(t, doorWord.start + 0.1, doorWord.start + 0.9, ease.inOutCubic);
  const push = l2 ? prog(t, l2.start - 0.2, l2.start + 0.7, ease.inOutCubic) : 0;
  cam(s, { x: W / 2, y: H / 2 + 20, z: lerp(0.95, 1.0, prog(t, sh.start, doorWord.start)) * lerp(1, 1.18, push), r: lerp(-0.015, 0.01, push) });
  const fk = prog(t, sh.start, sh.start + 0.7, ease.outExpo);
  // light behind the door
  if (open > 0) {
    const gr = c.createLinearGradient(x0, 0, x0 + dW, 0);
    gr.addColorStop(0, col('signal', 0.95)); gr.addColorStop(1, col('ember', 0.95));
    c.fillStyle = gr; c.globalAlpha = open; c.fillRect(x0, y0, dW, dH); c.globalAlpha = 1;
    g.fillStyle = col('ember', 0.55 * open); g.fillRect(x0 - 10, y0 - 10, dW + 20, dH + 20);
    // light spill on the floor
    c.fillStyle = col('signal', 0.18 * open);
    c.beginPath(); c.moveTo(x0, y0 + dH); c.lineTo(x0 + dW, y0 + dH); c.lineTo(x0 + dW + 420, H + 300); c.lineTo(x0 - 420, H + 300); c.closePath(); c.fill();
  }
  // frame
  c.strokeStyle = col('bone', 0.9 * fk); c.lineWidth = 6;
  c.strokeRect(x0 - 14, y0 - 14, dW + 28, dH + 14);
  rule(c, x0 - 600, y0 + dH, x0 + dW + 600, y0 + dH, fk, col('graphite', 0.8), 2);
  // the panel (hinged left), carrying line 1's words
  const ang = open * 1.25; // radians
  const sx = Math.cos(ang);
  c.save(); g.save();
  for (const ctx of [c, g]) { ctx.translate(x0, y0); ctx.transform(sx, -Math.sin(ang) * 0.12, 0, 1, 0, 0); }
  c.fillStyle = mix('ink2', 'graphite', 0.25 * (1 - open)); c.fillRect(0, 0, dW, dH);
  c.strokeStyle = col('graphite', 0.9); c.lineWidth = 3; c.strokeRect(26, 26, dW - 52, dH - 52);
  c.fillStyle = col('signal', 0.9); c.beginPath(); c.arc(dW - 52, dH * 0.52, 10, 0, TAU); c.fill();
  const R = rows(l1.words, 9);
  let yy = 120;
  for (const r of R) {
    const fam = A(r.length === 1 && clean(r[0]!.w).length > 4 ? 62 : 100, 900);
    const fr = fitRow(r.map(txt), fam, dW - 110, 150);
    r.forEach((w, i) => { if (t >= w.start - 0.1) word(s, w, txt(w), fam, fr.size, dW / 2 + fr.xs[i]!, yy + (fr.size * CAP) / 2, { sc: slam(w, t, 1.5) }); });
    yy += fr.size * CAP + 26;
  }
  c.restore(); g.restore();
  // line 2: words fly out of the light
  if (l2) {
    const R2 = rows(l2.words, 13);
    const bk = prog(t, l2.start - 0.2, l2.start + 0.2, ease.outCubic);
    if (bk > 0) { c.fillStyle = col('ink', 0.82 * bk); c.fillRect(W / 2 - 680, H / 2 - 210, 1360, 40 + R2.length * 170); }
    R2.forEach((r, ri) => {
      const fam = A(ri % 2 ? 125 : 87, ri % 2 ? 300 : 900);
      const fr = fitRow(r.map(txt), fam, 1150, 150);
      r.forEach((w, i) => {
        if (t < w.start - 0.1) return;
        const k = prog(t, w.start - 0.08, w.start + 0.35, ease.outExpo);
        const yC = H / 2 - 120 + ri * 170;
        word(s, w, txt(w), fam, fr.size, lerp(W / 2, W / 2 + fr.xs[i]!, k), lerp(H / 2 + 40, yC, k), { sc: lerp(0.15, 1, k), base: 'bone' });
      });
    });
  }
}

// ------------------------------------------------------------------ 5. LEDGER: typed numbers, signed name
function ledger(s: S) {
  const { t, sh, c } = s;
  cam(s, { x: W / 2 + 40 * prog(t, sh.start, sh.end), y: H / 2, z: 1.02, r: -0.012 });
  const x0 = 250, xMax = 1400;
  const ruleY = [135, 325, 515, 705, 895];
  const ys = ruleY.slice(1).map((r) => r - 12); // baselines sit just above their rule
  const fk = prog(t, sh.start, sh.start + 0.6, ease.outExpo);
  // ruled ledger lines + column
  ruleY.forEach((ry, i) => rule(c, 180, ry, W - 180, ry, prog(fk, i * 0.1, 0.6 + i * 0.1), col('graphite', 0.6), 1.5));
  rule(c, 1430, 120, 1430, 960, fk, col('graphite', 0.6), 1.5);
  let row = 0;
  sh.lines.forEach((l, li) => {
    const fam = F.mono(600);
    const size = 74;
    setFont(c, fam, size);
    const space = c.measureText(' ').width;
    let y = ys[Math.min(ys.length - 1, row)]!;
    const firstY = y;
    note(c, String(li + 1).padStart(3, '0'), 190, y - 54, lineIn(l, t), 18, 'graphite');
    setFont(c, fam, size);
    let x = x0;
    for (const w of l.words) {
      const isNameW = li === sh.lines.length - 1 && w === l.words[l.words.length - 1];
      const ww = isNameW ? measure(clean(w.w), F.serif(600, true), 200) : c.measureText(up(w.w)).width;
      if (x > x0 && x + ww > xMax && row + 1 < ys.length) { row++; y = ys[row]!; x = x0; setFont(c, fam, size); } // wrap to the next rule
      const text = up(w.w);
      const n = text.length;
      const typed = Math.floor(clamp((t - w.start) / Math.max(0.12, Math.min(w.end - w.start, 0.06 * n + 0.08))) * n + (t >= w.start ? 1 : 0));
      const shown = text.slice(0, Math.min(n, typed));
      const isName = li === sh.lines.length - 1 && w === l.words[l.words.length - 1];
      if (isName && t >= w.start - 0.05) {
        // the name is signed: big italic serif in gold
        const k = prog(t, w.start - 0.05, w.start + 0.6, ease.outCubic);
        const fam2 = F.serif(600, true), sz = 200;
        c.save(); c.beginPath(); c.rect(x - 10, y - 200, (measure(clean(w.w), fam2, sz) + 40) * k, 290); c.clip();
        word(s, w, clean(w.w), fam2, sz, x, y - 70, { align: 'l' });
        c.restore();
        x += measure(clean(w.w), fam2, sz) + space;
        continue;
      }
      c.fillStyle = mix(base(s), hotK(s), heat(w, t));
      c.textAlign = 'left';
      c.fillText(shown, x, y);
      if (t >= w.start && typed <= n && t < w.end + 0.1) { c.fillStyle = col(hotK(s), 0.9); c.fillRect(x + c.measureText(shown).width + 4, y - size * 0.72, size * 0.5, size * 0.82); }
      x += c.measureText(text).width + space;
    }
    // right column: a running tally that ticks on every sung word
    const sung = l.words.filter((w) => t >= w.start).length;
    if (t >= l.start - 0.05) {
      const val = (li + 1) * 1000 + sung * 125 + Math.floor(prog(t, l.start, l.end) * 99);
      note(c, String(val).padStart(6, '0'), 1700, firstY, 0.9, 54, li === sh.lines.length - 1 ? hotK(s) : base(s), 'right');
    }
    row++;
  });
}

// ------------------------------------------------------------------ 6. HOUSE → BEYOND → FOUNDATION
function house(s: S) {
  const { t, sh, c, g } = s;
  const [l1, l2, l3] = sh.lines as [Line, Line?, Line?];
  const pull = l2 ? prog(t, l2.start - 0.15, l2.start + 1.1, ease.inOutCubic) : 0;
  const drop = l3 ? prog(t, l3.start - 0.2, l3.start + 0.6, ease.inOutCubic) : 0;
  cam(s, { x: W / 2, y: H / 2 - 520 * pull * (1 - drop) + lerp(0, 120, drop), z: lerp(1.0, 0.6, pull) * lerp(1, 0.9, drop), r: lerp(-0.01, 0.008, pull) });
  const hw = l1.words[l1.words.length - 1]!;
  const fam = A(125, 900);
  const hs = sizeFor('HOUSE', fam, 760);
  const cx = W / 2, cy = H / 2 + 60;
  // outline draws around HOUSE
  const ok = prog(t, hw.start, hw.start + 0.7, ease.outCubic);
  const bx = 430, top = cy - hs * CAP / 2 - 70, bot = cy + hs * CAP / 2 + 60;
  const pts: [number, number][] = [[cx - bx, bot], [cx - bx, top], [cx, top - 260], [cx + bx, top], [cx + bx, bot]];
  const drawPoly = (ctx: CanvasRenderingContext2D, k: number, stroke: string, lw: number) => {
    if (k <= 0) return;
    let total = 0; const seg: number[] = [];
    for (let i = 1; i < pts.length; i++) { const d = Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1]); seg.push(d); total += d; }
    let rem = total * k;
    ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.lineJoin = 'miter'; ctx.beginPath(); ctx.moveTo(...pts[0]!);
    for (let i = 1; i < pts.length && rem > 0; i++) { const d = seg[i - 1]!; const f = Math.min(1, rem / d); ctx.lineTo(lerp(pts[i - 1]![0], pts[i]![0], f), lerp(pts[i - 1]![1], pts[i]![1], f)); rem -= d; }
    ctx.stroke();
  };
  drawPoly(c, ok, col('bone', 0.95), 8);
  drawPoly(g, ok, col('ember', heat(hw, t) * 0.6), 10);
  // "YOU SEE A" small above the roofline
  const small = l1.words.slice(0, -1);
  const fr = fitRow(small.map(txt), A(100, 700), 520, 80);
  small.forEach((w, i) => word(s, w, txt(w), A(100, 700), fr.size, cx + fr.xs[i]!, top - 90, { sc: slam(w, t, 1.4) }));
  word(s, hw, 'HOUSE', fam, hs, cx, cy, { sc: slam(hw, t, 1.6) });
  // windows light up
  for (let i = 0; i < 2; i++) {
    const wx = cx + (i ? 250 : -330), wy = top + 30;
    const k = prog(t, hw.start + 0.3 + i * 0.12, hw.start + 0.6 + i * 0.12);
    c.fillStyle = col('signal', 0.85 * k); c.fillRect(wx, wy, 80, 60); g.fillStyle = col('ember', 0.5 * k); g.fillRect(wx, wy, 80, 60);
  }
  // BEYOND: a skyline of further houses appears, the word stretches across the sky
  if (l2) {
    for (let i = 0; i < 14; i++) {
      const side = i % 2 ? 1 : -1, j = Math.floor(i / 2) + 1;
      const k = prog(t, l2.start + 0.05 * i, l2.start + 0.5 + 0.05 * i, ease.outExpo);
      if (k <= 0) continue;
      const w0 = 260 + hash(i, 3) * 200, h0 = (200 + hash(i, 7) * 300) * k;
      const x = cx + side * (bx + 140 + (j - 1) * 330 + hash(i, 1) * 60);
      c.strokeStyle = col('graphite', 0.9); c.lineWidth = 5;
      c.beginPath(); c.moveTo(x - w0 / 2, bot); c.lineTo(x - w0 / 2, bot - h0); c.lineTo(x, bot - h0 - w0 * 0.45 * k); c.lineTo(x + w0 / 2, bot - h0); c.lineTo(x + w0 / 2, bot); c.stroke();
      if (hash(i, 9) > 0.4) { c.fillStyle = col('signal', 0.7 * k); c.fillRect(x - 25, bot - h0 * 0.6, 50, 40); }
    }
    const lw = l2.words;
    const bw = lw[lw.length - 1]!;
    const pre = lw.slice(0, -1);
    const st = prog(t, bw.start, bw.end + 0.3, ease.outCubic);
    const bf = widthFam(0.3 + 0.7 * st);
    const bs = sizeFor('BEYOND', bf, lerp(1700, 2500, st));
    const by = top - 360 - bs * CAP / 2;
    const frp = fitRow(pre.map(txt), A(100, 500), 900, 120);
    pre.forEach((w, i) => word(s, w, txt(w), A(100, 500), frp.size, cx + frp.xs[i]!, by - bs * CAP / 2 - 110, { sc: slam(w, t, 1.4) }));
    word(s, bw, 'BEYOND', bf, bs, cx, by, { sc: slam(bw, t, 1.3) });
  }
  // FOUNDATION: line 3 words laid as blocks along the ground
  if (l3) {
    const ws = l3.words;
    const fr3 = fitRow(ws.map(txt), A(87, 900), 3000, 150, 0.5);
    ws.forEach((w, i) => {
      if (t < w.start - 0.1) return;
      const k = prog(t, w.start - 0.08, w.start + 0.25, ease.outExpo);
      const x = cx + fr3.xs[i]!, y = bot + 130;
      const wd = measure(txt(w), A(87, 900), fr3.size) + 60;
      c.fillStyle = col('ink2', 0.95 * k); c.fillRect(x - wd / 2, y - 95 + (1 - k) * -200, wd, 190);
      c.strokeStyle = col(heat(w, t) > 0.1 ? 'signal' : 'graphite', k); c.lineWidth = 3; c.strokeRect(x - wd / 2, y - 95 + (1 - k) * -200, wd, 190);
      word(s, w, txt(w), A(87, 900), fr3.size, x, y + (1 - k) * -200);
    });
  }
}

// ------------------------------------------------------------------ 7. CEILING: rows push a gold bar upward
function ceiling(s: S) {
  const { t, sh, c, g } = s;
  const ws = wordsOf(sh.lines);
  const R = rows(ws, sh.o.maxChars ?? 9).reverse(); // bottom-up
  const colW = 980;
  const lay: { r: Word[]; fam: string; fr: ReturnType<typeof fitRow>; y: number; h: number }[] = [];
  let y = H - 120;
  R.slice().reverse().forEach(() => {});
  // build rows from the first sung (bottom) upward
  const order = rows(ws, sh.o.maxChars ?? 9);
  order.forEach((r, i) => {
    const last = i === order.length - 1;
    const fam = A(last ? 62 : i % 2 ? 125 : 100, last ? 900 : i % 2 ? 300 : 900);
    const fr = fitRow(r.map(txt), fam, colW, last ? 420 : 250);
    const hgt = fr.size * CAP;
    lay.push({ r, fam, fr, y: y - hgt / 2, h: hgt });
    y -= hgt + 30;
  });
  // ceiling sits just above the highest row sung so far
  let top = H - 120;
  for (const r of lay) {
    const k = prog(t, r.r[0]!.start - 0.08, r.r[0]!.start + 0.3, ease.outExpo);
    top = lerp(top, r.y - r.h / 2 - 40, k);
  }
  const k = { x: W / 2, y: Math.min(H / 2, top + 380), z: 0.95, r: 0.0 };
  cam(s, k);
  for (const r of lay) r.r.forEach((w, i) => { if (t >= w.start - 0.1) word(s, w, txt(w), r.fam, r.fr.size, W / 2 + r.fr.xs[i]!, r.y + (1 - appear(w, t)) * 80, { sc: slam(w, t, 1.5) }); });
  const lastW = ws[ws.length - 1]!;
  const crack = pulse(t, lastW.start, 0.25);
  c.fillStyle = col('signal', 0.95); c.fillRect(W / 2 - 700, top - 6, 1400, 12);
  g.fillStyle = col('ember', 0.5 + crack); g.fillRect(W / 2 - 700, top - 8, 1400, 16);
  note(c, sh.o.label ?? 'CEILING', W / 2 - 700, top - 22, prog(t, sh.start, sh.start + 0.4), 20, 'signal');
  s.post.shake = [noise1(t * 40, 1) * 14 * crack, noise1(t * 40, 2) * 14 * crack];
}

// ------------------------------------------------------------------ 8. BLUEPRINT: drafted outlines, then filled
function blueprint(s: S) {
  const { t, sh, c } = s;
  s.bg.paper = 1; s.bg.grid = 1;
  const ws = wordsOf(sh.lines);
  const R = rows(ws, sh.o.maxChars ?? 11);
  const colW = 1400;
  let y = 0;
  const lay = R.map((r, i) => {
    const fam = A(i % 2 ? 125 : 87, 900);
    const fr = fitRow(r.map(txt), fam, colW, 260);
    const h = fr.size * CAP;
    const row = { r, fam, fr, y: y + h / 2, h };
    y += h + 70;
    return row;
  });
  const total = y - 70;
  cam(s, { x: 0, y: total / 2, z: 0.92 + 0.08 * prog(t, sh.start, sh.end), r: -0.02 + 0.015 * prog(t, sh.start, sh.end) });
  lay.forEach((row) => {
    row.r.forEach((w, i) => {
      const text = txt(w);
      const size = row.fr.size;
      const wd = measure(text, row.fam, size);
      const x = row.fr.xs[i]! - wd / 2, by = row.y + (size * CAP) / 2;
      const draft = prog(t, w.start - 0.5, w.start + 0.05, ease.outCubic);
      if (draft <= 0) return;
      // dimension line above the word
      rule(c, x, row.y - row.h / 2 - 22, x + wd, row.y - row.h / 2 - 22, draft, col('ink', 0.55), 1.5);
      rule(c, x, row.y - row.h / 2 - 32, x, row.y - row.h / 2 - 12, draft, col('ink', 0.55), 1.5);
      rule(c, x + wd, row.y - row.h / 2 - 32, x + wd, row.y - row.h / 2 - 12, draft, col('ink', 0.55), 1.5);
      note(c, `${Math.round(wd)}`, x + wd / 2, row.y - row.h / 2 - 30, draft * 0.8, 15, 'graphite', 'center');
      // outline drawn on, then the fill lands on the onset
      const p = textPath2D(text, row.fam, size, x, by);
      c.save();
      c.setLineDash([4000 * draft, 4000]);
      c.strokeStyle = col('ink', 0.8); c.lineWidth = 1.6; c.stroke(p);
      c.restore();
      const fk = prog(t, w.start - 0.04, w.start + 0.12);
      if (fk > 0) {
        const key = sh.o.key?.includes(clean(w.w).toLowerCase());
        c.fillStyle = key ? mix('blood', 'signal', 0.3, fk) : mix('ink', 'blood', heat(w, t), fk);
        c.fill(p);
      }
    });
  });
  note(c, sh.o.label ?? 'PLAN · SHEET 01', -colW / 2, total + 60, prog(t, sh.start, sh.start + 0.5), 18, 'graphite');
  s.post.paper = 1;
}

// ------------------------------------------------------------------ 9. PATH: words as stepping stones on a road
function path(s: S) {
  const { t, sh, c, g } = s;
  const ws = wordsOf(sh.lines);
  const fam = A(100, 900);
  const sizeOf = (w: Word) => (isSmall(w) ? 90 : 140);
  const us: number[] = []; let acc = 0;
  ws.forEach((w, i) => { const wd = measure(txt(w), fam, sizeOf(w)); if (i) acc += 70; us.push((acc + wd / 2) / 330); acc += wd; });
  const P = (u: number) => ({ x: u * 330, y: Math.sin(u * 0.55) * 140 - u * 18 });
  const pos = us.map((u) => P(u));
  const ang = (i: number) => { const u = us[i] ?? i; return Math.atan2(P(u + 0.05).y - P(u - 0.05).y, P(u + 0.05).x - P(u - 0.05).x); };
  const k = snapCam(t, ws.map((w) => w.start - 0.1), pos.map((p, i) => ({ x: p.x + 160, y: p.y, z: 1.15, r: -ang(i) * 0.6 })), 0.4);
  cam(s, k);
  // road
  let cur = -1;
  ws.forEach((w, i) => { if (t >= w.start) cur = i; });
  const litU = cur < 0 ? -99 : lerp(us[cur]! - 0.5, (us[cur + 1] ?? us[cur]! + 1) - 0.5, prog(t, ws[cur]!.start, ws[cur]!.end));
  for (let u = -3; u < us[us.length - 1]! + 3; u += 0.1) {
    const a = P(u), b = P(u + 0.1);
    const lit = u < litU;
    c.strokeStyle = col(lit ? 'signal' : 'graphite', lit ? 0.9 : 0.5); c.lineWidth = 4;
    c.beginPath(); c.moveTo(a.x, a.y + 70); c.lineTo(b.x, b.y + 70); c.stroke();
    if (lit) { g.strokeStyle = col('ember', 0.4); g.lineWidth = 6; g.beginPath(); g.moveTo(a.x, a.y + 70); g.lineTo(b.x, b.y + 70); g.stroke(); }
  }
  // start gate at the beginning of the road
  { const a = P(-1.4); c.strokeStyle = col('bone', 0.85); c.lineWidth = 8; c.beginPath(); c.moveTo(a.x - 70, a.y + 80); c.lineTo(a.x - 70, a.y - 160); c.moveTo(a.x + 70, a.y + 80); c.lineTo(a.x + 70, a.y - 160); c.stroke();
    c.fillStyle = col('signal', 0.9); c.fillRect(a.x - 90, a.y - 200, 180, 52); setFont(c, A(100, 900), 34); c.fillStyle = col('ink', 1); c.textAlign = 'center'; c.fillText('START', a.x, a.y - 162); }
  // footprints walk the lit part of the road
  for (let u = -1.2; u < litU; u += 0.32) {
    const a = P(u), an = Math.atan2(P(u + 0.05).y - a.y, P(u + 0.05).x - a.x), side = Math.round(u / 0.32) % 2 ? 1 : -1;
    c.save(); c.translate(a.x - Math.sin(an) * side * 22, a.y + 70 + Math.cos(an) * side * 22 - 34); c.rotate(an);
    c.fillStyle = col('bone', 0.55); c.beginPath(); c.ellipse(0, 0, 17, 8, 0, 0, TAU); c.fill(); c.beginPath(); c.ellipse(-22, 0, 9, 7, 0, 0, TAU); c.fill(); c.restore();
  }
  // the fuse head: a spark travelling at the lit point
  if (litU > -50) { const h = P(litU); g.fillStyle = col('ember', 0.9); g.beginPath(); g.arc(h.x, h.y + 70, 22, 0, TAU); g.fill();
    for (let i = 0; i < 10; i++) { const a2 = hash(i, frameIdx(t)) * TAU, r2 = 20 + hash(i, 3, frameIdx(t)) * 50; rule(g, h.x, h.y + 70, h.x + Math.cos(a2) * r2, h.y + 70 + Math.sin(a2) * r2, 1, col('signal', 0.7), 3); }
    c.fillStyle = col('ember', 1); c.beginPath(); c.arc(h.x, h.y + 70, 9, 0, TAU); c.fill(); }
  // YOUR WAY flag at the end of the road
  { const e = P(us[us.length - 1]! + 1.3), k = prog(t, ws[ws.length - 1]!.start, ws[ws.length - 1]!.start + 0.5, ease.outBack);
    if (k > 0) { c.strokeStyle = col('bone', 0.9); c.lineWidth = 6; c.beginPath(); c.moveTo(e.x, e.y + 70); c.lineTo(e.x, e.y + 70 - 260 * k); c.stroke();
      c.fillStyle = col('signal', 0.95); c.beginPath(); c.moveTo(e.x, e.y + 70 - 260 * k); c.lineTo(e.x + 170 * k, e.y + 70 - 215 * k); c.lineTo(e.x, e.y + 70 - 170 * k); c.closePath(); c.fill(); } }
  ws.forEach((w, i) => {
    if (t < w.start - 0.3) return;
    const p = pos[i]!;
    word(s, w, txt(w), fam, sizeOf(w), p.x, p.y - 10, { rot: ang(i), sc: slam(w, t, 1.6), ghost: 0.14 });
  });
}

// ------------------------------------------------------------------ 10. TITLE: "this is <BRAND A> <BRAND B>" (last two words slam in)
function title(s: S) {
  const { t, sh, c, g } = s;
  const l = sh.lines[0]!;
  const ws = l.words;
  const w2 = ws[ws.length - 2] ?? ws[0]!, w3 = ws[ws.length - 1]!;
  const lead = ws.slice(0, Math.max(0, ws.length - 2));
  const TA = up(w2 === w3 ? '' : w2.w), TB = up(w3.w);
  const v = sh.o.variant ?? 0;
  const n = sh.n;
  s.bg.glow = 0.6 + 0.2 * n;
  const famA = A(125, 900), famB = A(62, 900);
  const sA = TA ? sizeFor(TA, famA, 1500) : 0, sB = sizeFor(TB, famB, 1500);
  const yA = TA ? -sA * CAP / 2 - 18 : -40, yB = TA ? sB * CAP / 2 + 18 : 0;
  const k0: Cam = v === 0 ? { x: -560, y: yA - sA * CAP / 2 - 30, z: 2.1, r: 0 } : { x: 0, y: 0, z: 0.7, r: 0.22 };
  const k1: Cam = { x: 0, y: 0, z: 0.92, r: -0.02 };
  const kk = prog(t, w2.start - 0.1, w3.start + 0.2, ease.inOutCubic);
  const k = lerpCam(k0, k1, kk);
  k.z *= 1 + 0.04 * prog(t, w3.start, sh.end);
  cam(s, k);
  const rk = prog(t, w3.start - 0.05, w3.start + 0.5, ease.outExpo);
  if (rk > 0) {
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * TAU + t * 0.05;
      const len = (900 + hash(i, 5) * 900) * rk;
      g.strokeStyle = col('signal', 0.05 + 0.025 * (n - 1)); g.lineWidth = 6 + hash(i, 2) * 14;
      g.beginPath(); g.moveTo(Math.cos(a) * 200, Math.sin(a) * 200); g.lineTo(Math.cos(a) * len, Math.sin(a) * len); g.stroke();
    }
  }
  if (lead.length) {
    const small = lead.map((w) => up(w.w)).join(' ');
    note(c, small.slice(0, Math.floor(prog(t, lead[0]!.start, lead[lead.length - 1]!.end) * small.length + (t >= lead[0]!.start ? 1 : 0))), -750, (TA ? yA - sA * CAP / 2 : yB - sB * CAP / 2) - 40, 1, 46, 'ash');
  }
  const fill = (w: Word) => (i: number, k: number) => mix('bone', 'signal', heat(w, t) * 0.4 + (w === w3 ? 1 : 0) * prog(t, w.start, w.start + 0.3), k);
  const spanA = Math.max(0.2, w2.end - w2.start), spanB = Math.max(0.3, Math.min(1.2, w3.end - w3.start));
  if (TA) { const wa = measure(TA, famA, sA); drawLetters(c, TA, famA, sA, -wa / 2, yA + sA * CAP / 2, w2.start - 0.06, t, fill(w2), { stagger: spanA / (TA.length + 1), dy: -260, dur: 0.3 }); }
  const wb = measure(TB, famB, sB);
  drawLetters(c, TB, famB, sB, -wb / 2, yB + sB * CAP / 2, w3.start - 0.06, t, fill(w3), { stagger: spanB / (TB.length + 1), dy: 260, dur: 0.3 });
  drawLetters(g, TB, famB, sB, -wb / 2, yB + sB * CAP / 2, w3.start - 0.06, t, () => col('ember', 0.55), { stagger: spanB / (TB.length + 1), dy: 260, dur: 0.3 });
  if (BRAND.host) note(c, `WITH ${BRAND.host}`, 750, yB + sB * CAP / 2 + 70, prog(t, w3.start + 0.3, w3.start + 0.8), 30, 'signal', 'right');
  s.post.flash = 0.05 * pulse(t, w3.start, 0.1);
  const hit = (TA ? pulse(t, w2.start, 0.1) : 0) + pulse(t, w3.start, 0.12);
  s.post.shake = [noise1(t * 50, 3) * 10 * hit, noise1(t * 50, 4) * 10 * hit];
}

// ------------------------------------------------------------------ 11. PILLARS: three columns, one facade
function pillars(s: S) {
  const { t, sh, c, g } = s;
  const L = sh.lines;
  const lastL = L[L.length - 1]!, growW = lastL.words.find((w) => /grow/i.test(w.w)) ?? lastL.words[lastL.words.length - 1]!;
  const thatIdx = lastL.words.findIndex((w) => /^that$/i.test(clean(w.w)));
  const tail = thatIdx > 0 ? lastL.words.slice(thatIdx) : []; // "that grows" -> foundation + pediment
  const gk = prog(t, growW.start - 0.05, growW.start + 0.9, ease.inOutCubic); // pillars grow taller on "grows"
  cam(s, { x: W / 2, y: H / 2 + 40 - 60 * gk, z: lerp(1.1, 0.86, prog(t, sh.start, sh.end, ease.inOutCubic)) * lerp(1, 0.9, gk), r: 0 });
  const xs = [W / 2 - 460, W / 2, W / 2 + 460];
  const baseY = H - 90, colH = 640 * (1 + 0.28 * gk), colW = 250;
  L.forEach((l, i) => {
    const k = prog(t, l.start - 0.12, l.start + 0.45, ease.outExpo);
    if (k <= 0) return;
    const x = xs[i]!, h = colH * k;
    c.fillStyle = col('ink2', 0.95); c.fillRect(x - colW / 2, baseY - h, colW, h);
    c.strokeStyle = col('graphite', 1); c.lineWidth = 3; c.strokeRect(x - colW / 2, baseY - h, colW, h);
    for (let f = 1; f < 4; f++) rule(c, x - colW / 2 + f * colW / 4, baseY - h + 20, x - colW / 2 + f * colW / 4, baseY - 20, k, col('graphite', 0.5), 2);
    // vertical text along the column
    const text = i === L.length - 1 && thatIdx > 0 ? up(l.words.slice(0, thatIdx).map((w) => w.w).join(' ')) : up(l.text);
    const fam = A(100, 900);
    const sz = Math.min(200, sizeFor(text, fam, colH - 80));
    const hot = Math.max(...l.words.map((w) => heat(w, t)));
    const grow = null as Word | null;
    c.save(); g.save();
    for (const ctx of [c, g]) { ctx.translate(x, baseY - h / 2); ctx.rotate(-Math.PI / 2); }
    setFont(c, fam, sz); c.textAlign = 'center'; c.textBaseline = 'alphabetic';
    c.fillStyle = mix('bone', grow && t >= grow.start ? 'acid' : 'signal', hot);
    c.fillText(text, 0, (CAP * sz) / 2);
    if (hot > 0.02) { setFont(g, fam, sz); g.textAlign = 'center'; g.fillStyle = col(grow && t >= grow.start ? 'acid' : 'ember', 0.6 * hot); g.fillText(text, 0, (CAP * sz) / 2); }
    c.restore(); g.restore();
    note(c, ['I', 'II', 'III'][i]!, x, baseY + 40, k, 22, 'ash', 'center');
  });
  // pediment once all three stand
  const pk = prog(t, (tail[0] ?? lastL.words[0]!).start - 0.1, (tail[0] ?? lastL.words[0]!).start + 0.5, ease.outExpo);
  if (pk > 0) {
    const top = baseY - colH - 10;
    // foundation slab
    c.fillStyle = col('ink2', 0.95 * pk); c.fillRect(W / 2 - 720, baseY + 4, 1440, 86); c.strokeStyle = col('signal', pk); c.lineWidth = 4; c.strokeRect(W / 2 - 720, baseY + 4, 1440, 86);
    // pediment (the ceiling)
    c.fillStyle = col('ink2', 0.95 * pk); c.strokeStyle = col('signal', pk); c.lineWidth = 5;
    c.beginPath(); c.moveTo(W / 2 - 650, top); c.lineTo(W / 2, top - 220 * pk); c.lineTo(W / 2 + 650, top); c.closePath(); c.fill(); c.stroke();
    g.strokeStyle = col('ember', 0.4 * pk); g.lineWidth = 7; g.beginPath(); g.moveTo(W / 2 - 650, top); g.lineTo(W / 2, top - 220 * pk); g.lineTo(W / 2 + 650, top); g.stroke();
    // THAT GROWS on the foundation and in the pediment
    if (tail.length) {
      const fr = fitRow(tail.map(txt), A(125, 900), 900, 64);
      tail.forEach((w, j) => word(s, w, txt(w), A(125, 900), fr.size, W / 2 + fr.xs[j]!, baseY + 47, { alpha: pk, hot: /grow/i.test(w.w) ? 'acid' : 'signal' }));
      const fr2 = fitRow(tail.map(txt), A(100, 900), 520, 70);
      tail.forEach((w, j) => word(s, w, txt(w), A(100, 900), fr2.size, W / 2 + fr2.xs[j]!, top - 70 * pk, { alpha: pk, hot: /grow/i.test(w.w) ? 'acid' : 'signal' }));
    }
  }
}

// ------------------------------------------------------------------ 12. TREE: seed → branches carrying words
interface Br { x0: number; y0: number; x1: number; y1: number; d: number; t0: number; t1: number; w: number }
const treeCache = new Map<number, Br[]>();
function makeTree(seed: number): Br[] {
  if (treeCache.has(seed)) return treeCache.get(seed)!;
  const rnd = mulberry32(seed);
  const out: Br[] = [];
  const grow = (x: number, y: number, a: number, len: number, d: number, t0: number) => {
    const x1 = x + Math.cos(a) * len, y1 = y + Math.sin(a) * len;
    const t1 = t0 + 0.18 + 0.05 * rnd();
    out.push({ x0: x, y0: y, x1, y1, d, t0, t1, w: Math.max(2, 22 * Math.pow(0.68, d)) });
    if (d >= 7) return;
    const n = d < 2 ? 2 : rnd() > 0.3 ? 2 : 3;
    for (let i = 0; i < n; i++) grow(x1, y1, a + (i - (n - 1) / 2) * (0.5 + rnd() * 0.25) + (rnd() - 0.5) * 0.2, len * (0.7 + rnd() * 0.12), d + 1, t1 - 0.04);
  };
  grow(0, 0, -Math.PI / 2, 330, 0, 0);
  treeCache.set(seed, out);
  return out;
}
function tree(s: S) {
  const { t, sh, c, g } = s;
  const [l1, l2] = sh.lines as [Line, Line?];
  const seedW = l1.words.find((w) => /seed/i.test(w.w)) ?? l1.words[0]!;
  const g0 = seedW.start + 0.2, g1 = l2 ? l2.end + 0.3 : sh.end;
  const gk = prog(t, g0, g1, ease.inOutCubic);
  const groundY = 300;
  cam(s, { x: 0, y: lerp(150, -280, gk), z: lerp(1.0, 0.62, gk), r: 0 });
  // line 1 on the ground
  const fr = fitRow(l1.words.map(txt), A(100, 900), 1300, 170);
  l1.words.forEach((w, i) => word(s, w, txt(w), A(100, 900), fr.size, fr.xs[i]!, groundY + 140, { sc: slam(w, t, 1.6), hot: /seed/i.test(w.w) ? 'acid' : 'signal' }));
  rule(c, -1600, groundY, 1600, groundY, prog(t, sh.start, sh.start + 0.5, ease.outExpo), col('graphite', 0.8), 3);
  // seed
  const sk = prog(t, seedW.start - 0.05, seedW.start + 0.2, ease.outBack);
  c.fillStyle = col('acid', 1); c.beginPath(); c.arc(0, groundY - 4, 14 * sk, 0, TAU); c.fill();
  g.fillStyle = col('acid', 0.8 * sk); g.beginPath(); g.arc(0, groundY - 4, 26 * sk, 0, TAU); g.fill();
  // branches
  const br = makeTree(7);
  const T = 1.6; // tree build span in tree-time units
  const tt = gk * T;
  for (const b of br) {
    const k = clamp((tt - b.t0) / (b.t1 - b.t0));
    if (k <= 0) continue;
    c.strokeStyle = mix('bone', 'signal', b.d / 9, 0.95); c.lineWidth = b.w; c.lineCap = 'round';
    c.beginPath(); c.moveTo(b.x0, groundY + b.y0); c.lineTo(lerp(b.x0, b.x1, k), groundY + lerp(b.y0, b.y1, k)); c.stroke();
    if (b.d >= 6 && k >= 1) {
      const lk = clamp((tt - b.t1) / 0.15);
      c.fillStyle = col('acid', 0.85 * lk); c.beginPath(); c.arc(b.x1, groundY + b.y1, 9 * lk, 0, TAU); c.fill();
      g.fillStyle = col('acid', 0.35 * lk); g.beginPath(); g.arc(b.x1, groundY + b.y1, 16 * lk, 0, TAU); g.fill();
    }
  }
  // line 2 words ride up the trunk to the canopy
  if (l2) {
    const n2 = l2.words.length;
    l2.words.forEach((w, i) => {
      if (t < w.start - 0.1) return;
      const last = i === n2 - 1;
      const k = prog(t, w.start - 0.06, w.start + 0.4, ease.outExpo);
      const side = i % 2 ? 1 : -1;
      const tx = last ? 0 : side * (520 + 90 * (i % 3)), ty = last ? -1700 : -420 - (i / Math.max(1, n2 - 1)) * 1050;
      const x = lerp(0, tx, k), y = groundY + lerp(-100, ty, k);
      word(s, w, txt(w), A(last ? 125 : 100, 900), last ? 260 : 120, x, y, { sc: slam(w, t, 1.4) });
    });
  }
}

// ------------------------------------------------------------------ 13. SERIF: the storyteller's voice
function serif(s: S) {
  const { t, sh, c } = s;
  const L = sh.lines;
  if (sh.o.stars) s.bg.stars = 1;
  const fam = F.serif(sh.o.weight ?? 400, true);
  const size = sh.o.size ?? 120;
  const lh = size * 1.12;
  const tot = lh * (L.length - 1);
  let cur = 0;
  L.forEach((l, i) => { if (t >= l.start - 0.2) cur = i; });
  cam(s, { x: W / 2, y: H / 2 - tot / 2 + lerp(0, tot, L.length > 1 ? prog(t, L[0]!.start, L[L.length - 1]!.start + 0.5, ease.inOutCubic) : 0) * 0.5, z: 1 + 0.06 * prog(t, sh.start, sh.end), r: 0.008 });
  L.forEach((l, i) => {
    const y = H / 2 - tot / 2 + i * lh;
    const dim = i < cur ? 0.38 : 1;
    const text = clean(l.text);
    const Ly = layout(text, fam, size);
    const x0 = W / 2 - Ly.width / 2;
    setFont(c, fam, size); c.textAlign = 'left'; c.textBaseline = 'alphabetic';
    // each glyph rises with its word's onset
    let ci = 0;
    for (const w of l.words) {
      const wt = clean(w.w);
      const st = text.indexOf(wt, ci);
      for (let j = 0; j < wt.length; j++) {
        const gph = Ly.glyphs[st + j];
        if (!gph) continue;
        const k = prog(t, w.start - 0.1 + j * 0.025, w.start + 0.25 + j * 0.025, ease.outCubic);
        if (k <= 0) continue;
        c.fillStyle = mix('bone', 'signal', heat(w, t) * (sh.o.gold ? 1 : 0.6), k * dim);
        c.fillText(gph.ch, x0 + gph.x, y + (CAP * size) / 2 + (1 - k) * 40);
      }
      ci = st + wt.length;
    }
  });
}

// ------------------------------------------------------------------ 14. LEGACY: we learned / we built / LEGACY
function legacy(s: S) {
  const { t, sh, c, g } = s;
  const L = sh.lines;
  const say = L[0]!, rest = L.slice(1);
  const lg = rest[rest.length - 1]!;
  const lw = lg.words[lg.words.length - 1]!;
  const final = prog(t, lg.start - 0.1, lg.start + 0.4, ease.outExpo);
  cam(s, snapCam(t, L.map((l) => l.start - 0.08), [
    { x: W / 2, y: H / 2 - 60, z: 1.1, r: 0.02 }, { x: W / 2 - 40, y: H / 2 - 120, z: 1.15, r: -0.025 }, { x: W / 2 + 40, y: H / 2 + 20, z: 1.15, r: 0.025 }, { x: W / 2, y: H / 2 + 60, z: 0.86, r: 0 },
  ].slice(0, L.length), 0.4));
  const frs = fitRow(say.words.map(txt), F.mono(600), 620, 64);
  say.words.forEach((w, i) => word(s, w, txt(w), F.mono(600), frs.size, W / 2 - 330 + frs.xs[i]!, H / 2 - 400 + final * -40, { sc: slam(w, t, 1.3), alpha: 1 - 0.5 * final }));
  // WE LEARNED · WE BUILT : stacked, slamming
  rest.slice(0, -1).forEach((l, i) => {
    const fam = A(i ? 62 : 125, 900);
    const fr = fitRow(l.words.map(txt), fam, 1000, 230);
    const y = lerp(H / 2 - 180 + i * 200, H / 2 - 330 + i * 0, final);
    const fade = 1 - 0.55 * final;
    const xo = lerp(0, i ? 330 : -330, final);
    l.words.forEach((w, j) => word(s, w, txt(w), fam, fr.size, W / 2 + xo + fr.xs[j]! * (1 - 0.55 * final), y, { sc: slam(w, t, 1.45) * (1 - 0.55 * final), alpha: fade }));
  });
  // WE MADE A + LEGACY
  const pre = lg.words.slice(0, -1);
  const frp = fitRow(pre.map(txt), A(100, 700), 520, 70);
  pre.forEach((w, i) => word(s, w, txt(w), A(100, 700), frp.size, W / 2 + frp.xs[i]!, H / 2 - 160, { sc: slam(w, t, 1.4) }));
  if (t >= lw.start - 0.1) {
    const fam = F.serif(600, true);
    const sz = sizeFor('Legacy', fam, 1150);
    const st = Math.max(0.4, Math.min(1.2, lw.end - lw.start));
    drawLetters(c, 'Legacy', fam, sz, W / 2 - measure('Legacy', fam, sz) / 2, H / 2 + 240, lw.start - 0.06, t, (i, k) => mix('bone', 'signal', 0.6 + 0.4 * heat(lw, t), k), { stagger: st / 7, dy: 120, dur: 0.5 });
    drawLetters(g, 'Legacy', fam, sz, W / 2 - measure('Legacy', fam, sz) / 2, H / 2 + 240, lw.start - 0.06, t, () => col('ember', 0.22), { stagger: st / 7, dy: 120, dur: 0.5 });
  }
  const hit = Math.max(...rest.map((l) => pulse(t, l.start, 0.1)));
  s.post.shake = [noise1(t * 50, 5) * 12 * hit, noise1(t * 50, 6) * 12 * hit];
  s.post.flash = 0.03 * pulse(t, lw.start, 0.12);
}

// ------------------------------------------------------------------ 15. SEARCH: spotlight over a field of words
const FIELD = ['COMPS', 'ZONING', 'EQUITY', 'LEADS', 'RATES', 'LISTINGS', 'PERMITS', 'DEMAND', 'TRENDS', 'CASHFLOW', 'TITLE', 'ESCROW', 'APPRAISAL', 'INVENTORY', 'SQ FT', 'CAP RATE', 'NOI', 'VACANCY', 'RENTS', 'LOTS', 'PARCEL', 'DEED', 'TERMS', 'OFFERS'];
function search(s: S) {
  const { t, sh, c, g } = s;
  const ws = wordsOf(sh.lines);
  const pos = ws.map((w, i) => ({ x: W / 2 + i * 330, y: H / 2 + (i % 2 ? 130 : -130) }));
  const k = snapCam(t, ws.map((w) => w.start - 0.08), pos.map((p) => ({ x: p.x + 250, y: H / 2, z: 1.1, r: -0.03 })), 0.35);
  cam(s, k);
  // field
  for (let i = 0; i < 260; i++) {
    const x = (i % 26) * 260 - 330 + (Math.floor(i / 26) % 2) * 130, y = Math.floor(i / 26) * 140 - 90;
    if (Math.abs(y - H / 2 - 130) < 90 || Math.abs(y - H / 2 + 130) < 90) continue;
    note(c, FIELD[i % FIELD.length]!, x, y, 0.1, 22, 'graphite', 'center');
  }
  let cur = 0; ws.forEach((w, i) => { if (t >= w.start - 0.08) cur = i; });
  const sp = snapCam(t, ws.map((w) => w.start - 0.08), pos.map((p) => ({ x: p.x, y: p.y, z: 1, r: 0 })), 0.3);
  const gr = g.createRadialGradient(sp.x, sp.y, 20, sp.x, sp.y, 420);
  gr.addColorStop(0, col('signal', 0.14)); gr.addColorStop(1, col('signal', 0));
  g.fillStyle = gr; g.fillRect(sp.x - 420, sp.y - 420, 840, 840);
  ws.forEach((w, i) => {
    const p = pos[i]!;
    const found = t >= w.start - 0.06;
    word(s, w, txt(w), A(100, 900), isSmall(w) ? 80 : 130, p.x, p.y, { ghost: 0.18, sc: found ? slam(w, t, 1.5) : 1, alpha: i <= cur + 1 ? 1 : 0.6 });
    if (found) { c.strokeStyle = col('signal', 0.6 * heat(w, t)); c.lineWidth = 2; c.beginPath(); c.arc(p.x, p.y, 120 + 30 * (1 - appear(w, t)), 0, TAU); c.stroke(); }
  });
}

// ------------------------------------------------------------------ 16. NETWORK: one lead becomes many
function network(s: S) {
  const { t, sh, c, g } = s;
  const L = sh.lines;
  const nodes = [{ x: W / 2 - 520, y: H / 2 - 160 }, { x: W / 2 + 480, y: H / 2 - 240 }, { x: W / 2, y: H / 2 + 230 }];
  const last = L[L.length - 1]!;
  const spread = prog(t, last.start, last.end + 0.5, ease.inOutCubic);
  cam(s, { x: W / 2, y: H / 2, z: lerp(1.15, 0.72, spread), r: lerp(0.02, -0.02, spread) });
  // satellites
  const rnd = mulberry32(5);
  const sats = Array.from({ length: 70 }, (_, i) => ({ x: W / 2 + (rnd() - 0.5) * 2600, y: H / 2 + (rnd() - 0.5) * 1500, p: nodes[i % 3]!, d: rnd() }));
  for (const st of sats) {
    const k = prog(spread, st.d * 0.7, st.d * 0.7 + 0.3);
    if (k <= 0) continue;
    c.strokeStyle = col('graphite', 0.5 * k); c.lineWidth = 1.5; c.beginPath(); c.moveTo(st.p.x, st.p.y); c.lineTo(lerp(st.p.x, st.x, k), lerp(st.p.y, st.y, k)); c.stroke();
    c.fillStyle = col('signal', 0.8 * k); c.beginPath(); c.arc(lerp(st.p.x, st.x, k), lerp(st.p.y, st.y, k), 6, 0, TAU); c.fill();
    g.fillStyle = col('ember', 0.3 * k); g.beginPath(); g.arc(lerp(st.p.x, st.x, k), lerp(st.p.y, st.y, k), 12, 0, TAU); g.fill();
  }
  L.forEach((l, i) => {
    const n = nodes[i]!;
    const k = prog(t, l.start - 0.1, l.start + 0.3, ease.outBack);
    if (k <= 0) return;
    if (i > 0) {
      const p = nodes[i - 1]!;
      const ek = prog(t, l.start - 0.1, l.start + 0.35, ease.outExpo);
      rule(c, p.x, p.y, n.x, n.y, ek, col('signal', 0.9), 4);
      rule(g, p.x, p.y, n.x, n.y, ek, col('ember', 0.5), 6);
    }
    c.fillStyle = col('ink2', 0.95); c.strokeStyle = col('signal', 0.9); c.lineWidth = 4;
    c.beginPath(); c.arc(n.x, n.y, 30 * k, 0, TAU); c.fill(); c.stroke();
    const R = rows(l.words, 12);
    R.forEach((r, ri) => {
      const fam = A(ri ? 87 : 100, 900);
      const fr = fitRow(r.map(txt), fam, 700, 120);
      r.forEach((w, j) => word(s, w, txt(w), fam, fr.size, n.x + fr.xs[j]!, n.y + 110 + ri * 120, { sc: slam(w, t, 1.5), hot: /seed/i.test(w.w) ? 'acid' : 'signal' }));
    });
  });
}

// ------------------------------------------------------------------ 17. GRID: scattered letters snap into alignment
function grid(s: S) {
  const { t, sh, c, g } = s;
  const L = sh.lines;
  cam(s, { x: W / 2, y: H / 2, z: 1, r: 0 });
  const cell = 96;
  for (let x = -2; x < 24; x++) rule(c, x * cell, 0, x * cell, H, 1, col('graphite', 0.22), 1);
  for (let y = 0; y < 13; y++) rule(c, 0, y * cell, W, y * cell, 1, col('graphite', 0.22), 1);
  L.forEach((l, li) => {
    const text = up(l.text);
    const fam = A(100, 900);
    const size = cell * 1.45;
    const Ly = layout(text, fam, size);
    const n = Ly.glyphs.length;
    const x0 = Math.round((W / 2 - (n * cell) / 2) / cell) * cell;
    const y0 = (li ? 7 : 4) * cell;
    let ci = 0;
    for (const w of l.words) {
      const wt = up(clean(w.w));
      const st = text.indexOf(wt, ci);
      const snap = springStep(t - w.start + 0.04, 3.5, 0.5);
      for (let j = 0; j < wt.length; j++) {
        const gi = st + j;
        const h1 = hash(li, gi, 1), h2 = hash(li, gi, 2);
        const tx = x0 + gi * cell + cell / 2, ty = y0;
        const k = clamp(snap, 0, 1.2);
        const x = lerp(tx + (h1 - 0.5) * 1400, tx, k), y = lerp(ty + (h2 - 0.5) * 900, ty, k);
        const rot = (1 - clamp(k)) * (h1 - 0.5) * 4;
        const a = prog(t, w.start - 0.6, w.start - 0.1) * 0.5 + 0.5 * clamp(k);
        word(s, w, wt[j]!, fam, size * 0.62, x, y + cell / 2, { rot, alpha: a, ghost: 0.35 });
        if (k > 0.98 && heat(w, t) > 0.05) { c.strokeStyle = col('signal', heat(w, t)); c.lineWidth = 2; c.strokeRect(tx - cell / 2, ty, cell, cell); }
      }
      ci = st + wt.length;
    }
    const lk = prog(t, l.words[l.words.length - 1]!.start, l.end + 0.2, ease.outExpo);
    rule(c, x0, y0 + cell + 10, x0 + n * cell, y0 + cell + 10, lk, col('signal', 0.9), 4);
    rule(g, x0, y0 + cell + 10, x0 + n * cell, y0 + cell + 10, lk, col('ember', 0.5), 6);
  });
}

// ------------------------------------------------------------------ 18. CLOCK: words on a dial, TIME at the centre
function clock(s: S) {
  const { t, sh, c, g } = s;
  const ws = wordsOf(sh.lines);
  const R = 400;
  const cx = W / 2, cy = H / 2;
  cam(s, { x: cx, y: cy, z: lerp(0.68, 0.78, prog(t, sh.start, sh.end)), r: -0.25 * prog(t, sh.start, sh.end, ease.inOutCubic) });
  const fk = prog(t, sh.start, sh.start + 0.6, ease.outExpo);
  c.strokeStyle = col('graphite', 0.9); c.lineWidth = 3; c.beginPath(); c.arc(cx, cy, R * fk, 0, TAU); c.stroke();
  for (let i = 0; i < 60; i++) {
    const a = (i / 60) * TAU, l = i % 5 ? 14 : 34;
    rule(c, cx + Math.cos(a) * (R - l), cy + Math.sin(a) * (R - l), cx + Math.cos(a) * R, cy + Math.sin(a) * R, fk, col('graphite', 0.9), i % 5 ? 2 : 4);
  }
  const n = ws.length - 1;
  let hand = -Math.PI / 2;
  ws.slice(0, -1).forEach((w, i) => {
    const a = -Math.PI / 2 + ((i + 0.5) / n) * TAU;
    const k = prog(t, w.start - 0.05, w.start + 0.25, ease.outExpo);
    hand = lerp(hand, a, k);
    word(s, w, txt(w), A(87, 900), isSmall(w) ? 80 : 120, cx + Math.cos(a) * (R + 150), cy + Math.sin(a) * (R + 140), { rot: a + Math.PI / 2, sc: slam(w, t, 1.5) });
  });
  const tw = ws[ws.length - 1]!;
  hand = lerp(hand, hand + TAU, prog(t, tw.start - 0.2, tw.start + 0.3, ease.inOutCubic));
  c.strokeStyle = col('signal', 1); c.lineWidth = 8; c.lineCap = 'round';
  c.beginPath(); c.moveTo(cx, cy); c.lineTo(cx + Math.cos(hand) * (R - 50), cy + Math.sin(hand) * (R - 50)); c.stroke();
  g.strokeStyle = col('ember', 0.5); g.lineWidth = 12; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(hand) * (R - 50), cy + Math.sin(hand) * (R - 50)); g.stroke();
  word(s, tw, txt(tw), A(125, 900), 200, cx, cy, { sc: slam(tw, t, 1.35) });
}

// ------------------------------------------------------------------ 19. KEY: teaching, passing, opening options
function keyShot(s: S) {
  const { t, sh, c, g } = s;
  const [l1, l2, l3] = sh.lines as [Line, Line?, Line?];
  const pass = l2 ? prog(t, l2.start - 0.1, l2.end + 0.2, ease.inOutCubic) : 0;
  const fan = l3 ? prog(t, l3.start - 0.1, l3.start + 0.6, ease.outExpo) : 0;
  cam(s, { x: W / 2 + lerp(-200, 200, pass), y: H / 2, z: lerp(1.05, 0.9, fan), r: 0 });
  // line 1 on top
  const fr = fitRow(l1.words.map(txt), A(100, 900), 1300, 140);
  l1.words.forEach((w, i) => word(s, w, txt(w), A(100, 900), fr.size, W / 2 + fr.xs[i]! - 200 * (1 - pass) * 0 , H / 2 - 330, { sc: slam(w, t, 1.5), alpha: 1 - 0.5 * fan }));
  // the key, drawn from strokes; it travels across on "passing"
  const kx = lerp(W / 2 - 640, W / 2 + 260, pass), ky = H / 2 + 30;
  const dk = prog(t, sh.start + 0.1, sh.start + 0.9, ease.outCubic);
  const drawKey = (ctx: CanvasRenderingContext2D, stroke: string, lw: number) => {
    ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(kx - 140, ky, 80, 0, TAU * dk); ctx.stroke();
    ctx.beginPath(); ctx.arc(kx - 140, ky, 34, 0, TAU * dk); ctx.stroke();
    rule(ctx, kx - 60, ky, kx + 380, ky, dk, stroke, lw);
    for (const [x, h] of [[300, 70], [340, 46], [380, 84]] as const) rule(ctx, kx + x, ky, kx + x, ky + h, prog(dk, 0.7, 1), stroke, lw);
  };
  drawKey(c, col('signal', 1), 14);
  drawKey(g, col('ember', 0.5 + 0.5 * (l2 ? Math.max(...l2.words.map((w) => heat(w, t))) : 0)), 18);
  if (l2) {
    const fr2 = fitRow(l2.words.map(txt), A(125, 900), 900, 130);
    l2.words.forEach((w, i) => word(s, w, txt(w), A(125, 900), fr2.size, kx + 160 + fr2.xs[i]!, ky + 170, { sc: slam(w, t, 1.4) }));
  }
  // line 3: options fan out of the key's tip
  if (l3) {
    const tip = { x: kx + 400, y: ky };
    l3.words.forEach((w, i) => {
      const a = -0.9 + (i / Math.max(1, l3.words.length - 1)) * 1.8;
      const k = prog(t, w.start - 0.08, w.start + 0.35, ease.outExpo);
      if (k <= 0) return;
      const r = 300 * k;
      const camX = W / 2 + lerp(-200, 200, pass), z = lerp(1.05, 0.9, fan), half = (W / 2 - 170) / z, halfY = (H / 2 - 110) / z;
      const sz = isSmall(w) ? 60 : 88, wd = measure(txt(w), A(100, 900), sz) / 2;
      const wx = clamp(tip.x + Math.cos(a) * (r + 110), camX - half + wd, camX + half - wd), wy = clamp(tip.y + Math.sin(a) * (r + 50), H / 2 - halfY, H / 2 + halfY);
      rule(g, tip.x, tip.y, wx - wd, wy, k, col('signal', 0.25), 3);
      word(s, w, txt(w), A(100, 900), sz, wx, wy, { rot: a * 0.2 });
    });
  }
}

// ------------------------------------------------------------------ 20. GENERATIONS: a course that bends upward
function generations(s: S) {
  const { t, sh, c, g } = s;
  const ws = wordsOf(sh.lines);
  const l1 = sh.lines[0]!;
  const big = (w: Word) => /generation|more|course/i.test(w.w);
  const famOf = (w: Word) => A(big(w) ? 75 : 100, 900), sizeOf = (w: Word) => (big(w) ? 150 : 96);
  const step = 300, turn = -0.42;
  const us: number[] = []; let acc = 0;
  ws.forEach((w, i) => { const wd = measure(txt(w), famOf(w), sizeOf(w)); if (i) acc += 60; us.push((acc + wd / 2) / step); acc += wd; });
  const bendAt = (us[l1.words.length - 1]! + us[l1.words.length]!) / 2; // the course turns after line 1
  const P = (u: number) => (u < bendAt ? { x: u * step, y: 0, a: 0 } : { x: bendAt * step + Math.cos(turn) * (u - bendAt) * step, y: Math.sin(turn) * (u - bendAt) * step, a: turn });
  const pos = us.map((u) => P(u));
  const k = snapCam(t, ws.map((w) => w.start - 0.1), pos.map((p) => ({ x: p.x + 200, y: p.y - 60, z: 1.0, r: -p.a * 0.75 })), 0.5);
  cam(s, k);
  let cur = -1; ws.forEach((w, i) => { if (t >= w.start) cur = i; });
  const litU = cur < 0 ? -99 : us[cur]! + 0.5;
  for (let u = -4; u < us[us.length - 1]! + 3; u += 0.25) {
    const a = P(u), b = P(u + 0.25);
    const lit = u <= litU;
    c.strokeStyle = col(lit ? 'signal' : 'graphite', lit ? 1 : 0.5); c.lineWidth = lit ? 6 : 3;
    c.beginPath(); c.moveTo(a.x, a.y + 60); c.lineTo(b.x, b.y + 60); c.stroke();
    if (lit) { g.strokeStyle = col('ember', 0.4); g.lineWidth = 8; g.beginPath(); g.moveTo(a.x, a.y + 60); g.lineTo(b.x, b.y + 60); g.stroke(); }
  }
  ws.forEach((w, i) => {
    if (t < w.start - 0.25) return;
    const p = pos[i]!;
    word(s, w, txt(w), famOf(w), sizeOf(w), p.x, p.y - 20, { rot: p.a, sc: slam(w, t, 1.6), ghost: 0.12 });
  });
}

// ------------------------------------------------------------------ 21. HIGHER: the word climbs off the top of the frame
function higher(s: S) {
  const { t, sh, c, g } = s;
  const l = sh.lines[0]!;
  const ws = l.words;
  const hw = ws[ws.length - 1]!;
  const span = Math.max(0.8, Math.min(3.2, sh.end - hw.start - 0.5)); // the held note runs up to the chorus
  const climb = prog(t, hw.start, hw.start + span + 0.4, ease.inOutCubic);
  s.bg.glow = 0.4 + climb;
  cam(s, { x: W / 2, y: lerp(H / 2, H / 2 - 1300, climb), z: lerp(1.1, 0.8, climb), r: lerp(0, -0.04, climb) });
  // TO AIM on the ground
  const pre = ws.slice(0, -1);
  const fr = fitRow(pre.map(txt), A(100, 900), 900, 200);
  pre.forEach((w, i) => word(s, w, txt(w), A(100, 900), fr.size, W / 2 + fr.xs[i]!, H / 2 + 260, { sc: slam(w, t, 1.8) }));
  // HIGHER: letters stack upward, each one rung higher
  const letters = 'HIGHER';
  const fam = A(125, 900), sz = 230;
  for (let i = 0; i < letters.length; i++) {
    const t0 = hw.start - 0.05 + (i / letters.length) * span;
    const k = prog(t, t0, t0 + 0.35, ease.outExpo);
    if (k <= 0) continue;
    const y = H / 2 + 20 - i * 270 - (1 - k) * -180;
    const x = W / 2 + Math.sin(i * 1.3) * 60;
    word(s, null, letters[i]!, fam, sz, x, y, { color: mix('bone', 'signal', clamp(heat(hw, t) + 0.4)), alpha: k, sc: lerp(1.8, 1, k) });
    g.globalAlpha = k * 0.6; setFont(g, fam, sz); g.textAlign = 'center'; g.fillStyle = col('ember', 0.8); g.fillText(letters[i]!, x, y + (CAP * sz) / 2); g.globalAlpha = 1;
    rule(c, x - 260, y + 150, x + 260, y + 150, k, col('signal', 0.7), 3);
  }
  // speed lines
  for (let i = 0; i < 30; i++) {
    const x = W / 2 + (hash(i, 31) - 0.5) * 1800, y0 = H / 2 - hash(i, 32) * 1800;
    const len = 200 + 400 * climb;
    rule(g, x, y0, x, y0 + len, climb, col('signal', 0.15), 3);
  }
}

// ------------------------------------------------------------------ 22. OUTRO: final legacy + end card
function outro(s: S) {
  const { t, sh, c, g } = s;
  const l = sh.lines[0];
  const card = sh.o.card ?? sh.end - 4.5;
  const ck = prog(t, card, card + 1.0, ease.inOutCubic);
  cam(s, { x: W / 2, y: H / 2, z: lerp(1.0, 1.08, prog(t, sh.start, sh.end)), r: 0 });
  if (l) {
    const lw = l.words[l.words.length - 1]!;
    const pre = l.words.slice(0, -1);
    const a = 1 - ck;
    pre.forEach((w, i) => word(s, w, txt(w), A(100, 500), 70, W / 2 - 300 + i * 200, H / 2 - 170, { alpha: a, sc: slam(w, t, 1.3) }));
    if (t >= lw.start - 0.1) {
      const fam = F.serif(600, true), sz = sizeFor('Legacy', fam, 1200);
      const st = Math.max(0.5, Math.min(2, lw.end - lw.start));
      drawLetters(c, 'Legacy', fam, sz, W / 2 - measure('Legacy', fam, sz) / 2, H / 2 + 180, lw.start - 0.06, t, (i, k) => mix('bone', 'signal', 0.7, k * a), { stagger: st / 7, dy: 80, dur: 0.6 });
      drawLetters(g, 'Legacy', fam, sz, W / 2 - measure('Legacy', fam, sz) / 2, H / 2 + 180, lw.start - 0.06, t, () => col('ember', 0.4 * a), { stagger: st / 7, dy: 80, dur: 0.6 });
    }
  }
  if (ck > 0) {
    const fa = A(125, 900), fb = A(62, 900);
    const sa = sizeFor(BRAND.titleA, fa, 1100), sb = sizeFor(BRAND.titleB, fb, 1100);
    word(s, null, BRAND.titleA, fa, sa, W / 2, H / 2 - sa * CAP / 2 - 30, { color: col('bone', ck), sc: lerp(1.1, 1, ck) });
    word(s, null, BRAND.titleB, fb, sb, W / 2, H / 2 + sb * CAP / 2 - 10, { color: col('signal', ck), sc: lerp(0.9, 1, ck) });
    setFont(g, fb, sb); g.textAlign = 'center'; g.fillStyle = col('ember', 0.35 * ck); g.fillText(BRAND.titleB, W / 2, H / 2 + sb * CAP - 10);
    rule(c, W / 2 - 550, H / 2 + sb * CAP + 40, W / 2 + 550, H / 2 + sb * CAP + 40, ck, col('signal', 0.8), 3);
    note(c, BRAND.host, W / 2, H / 2 + sb * CAP + 110, ck, 38, 'bone', 'center');
    note(c, BRAND.tagline, W / 2, H / 2 + sb * CAP + 160, ck * 0.8, 22, 'ash', 'center');
  }
  s.post.fade = prog(t, sh.end - 1.6, sh.end - 0.1, ease.inOutCubic);
}

// ------------------------------------------------------------------ 0. INTRO: the show title builds before the first word
function intro(s: S) {
  const { t, sh, c, g } = s;
  const e = sh.end;
  const out = prog(t, e - 0.45, e, ease.inCubic);
  cam(s, { x: W / 2, y: H / 2, z: lerp(1.0, 1.12, prog(t, 0, e)) * lerp(1, 2.4, out), r: 0 });
  const fa = A(125, 300), fb = A(125, 900);
  const sa = sizeFor(BRAND.titleA, fa, 980), sb = sizeFor(BRAND.titleB, fb, 980);
  const alpha = 1 - out;
  drawLetters(c, BRAND.titleA, fa, sa, W / 2 - measure(BRAND.titleA, fa, sa) / 2, H / 2 - 30, 0.35, t, (i, k) => col('bone', k * alpha), { stagger: 0.07, dy: -120, dur: 0.6 });
  drawLetters(c, BRAND.titleB, fb, sb, W / 2 - measure(BRAND.titleB, fb, sb) / 2, H / 2 + sb * CAP + 10, 0.9, t, (i, k) => mix('bone', 'signal', 0.85, k * alpha), { stagger: 0.06, dy: 120, dur: 0.6 });
  drawLetters(g, BRAND.titleB, fb, sb, W / 2 - measure(BRAND.titleB, fb, sb) / 2, H / 2 + sb * CAP + 10, 0.9, t, (i, k) => col('ember', 0.3 * k * alpha), { stagger: 0.06, dy: 120, dur: 0.6 });
  const rk = prog(t, 1.6, 2.4, ease.outExpo);
  rule(c, W / 2 - 490, H / 2 + sb * CAP + 60, W / 2 + 490, H / 2 + sb * CAP + 60, rk, col('signal', 0.9 * alpha), 3);
  note(c, BRAND.host, W / 2, H / 2 + sb * CAP + 120, prog(t, 2.0, 2.6) * alpha, 34, 'bone', 'center');
}


// =================================================================== feedback additions (2026-10-01)
/** Screen-space lyric rows at the top (the camera is reset first). */
function topRows(s: S, l: Line, y0 = 150, maxSize = 150, n = 16) {
  const { t } = s;
  cam(s, { x: W / 2, y: H / 2, z: 1, r: 0 });
  const R = rows(l.words, n); let y = y0;
  R.forEach((r, ri) => { const fam = A(ri % 2 ? 100 : 125, 900), fr = fitRow(r.map(txt), fam, 1560, maxSize); r.forEach((w, j) => word(s, w, txt(w), fam, fr.size, W / 2 + fr.xs[j]!, y + (fr.size * CAP) / 2, { sc: slam(w, t, 1.6) })); y += fr.size * CAP + 30; });
  return y;
}
const at = (l: Line, re: RegExp, fb = 0) => (l.words.find((w) => re.test(w.w)) ?? l.words[Math.min(l.words.length - 1, fb)]!).start;

// ------------------------------------------------------------------ SKILL: a neural brain lights up, its signal forges a gear + tools
function skill(s: S) {
  const { t, sh, c, g } = s;
  const l = sh.lines[0]!;
  const tK = at(l, /knowledge/i, 2), tI = at(l, /into/i, 3), tS = at(l, /skill/i, l.words.length - 1);
  s.bg.glow = 0.45; s.bg.gy = 0.6; s.bg.grid = 0.3;
  cam(s, { x: W / 2, y: H / 2 + 60, z: lerp(1.05, 0.98, prog(t, sh.start, sh.end)), r: 0 });
  // brain: two lobes, folds, and a neural net that fires on "knowledge"
  const bx = 600, by = 640, fire = prog(t, tK - 0.1, tK + 0.9, ease.outCubic);
  const lobe = new Path2D(); lobe.ellipse(bx - 95, by, 190, 160, 0, 0, TAU); lobe.ellipse(bx + 95, by, 190, 160, 0, 0, TAU);
  c.fillStyle = col('ink2', 0.95); c.fill(lobe); c.strokeStyle = col('bone', 0.85); c.lineWidth = 6; c.stroke(lobe);
  c.strokeStyle = col('graphite', 0.9); c.lineWidth = 4; c.beginPath(); c.moveTo(bx, by - 155); c.bezierCurveTo(bx - 20, by - 60, bx + 20, by + 40, bx, by + 150); c.stroke();
  for (let k = 0; k < 7; k++) { const a = -2.6 + k * 0.75, r = 120; c.beginPath(); c.arc(bx + (k % 2 ? 95 : -95) + Math.cos(a) * 40, by + Math.sin(a) * 60, 50, a, a + 1.6); c.stroke(); }
  const nodes = Array.from({ length: 22 }, (_, i) => ({ x: bx + (hash(i, 1) - 0.5) * 420, y: by + (hash(i, 2) - 0.5) * 260 }));
  nodes.forEach((n, i) => nodes.forEach((m, j) => {
    if (j <= i || Math.hypot(n.x - m.x, n.y - m.y) > 150) return;
    const on = clamp((fire - hash(i, j) * 0.7) * 3);
    if (on <= 0) return; rule(c, n.x, n.y, m.x, m.y, on, col('acid', 0.7), 2); rule(g, n.x, n.y, m.x, m.y, on, col('acid', 0.35), 4);
  }));
  nodes.forEach((n, i) => { const on = clamp((fire - hash(i, 7) * 0.6) * 3); c.fillStyle = mix('graphite', 'acid', on); c.beginPath(); c.arc(n.x, n.y, 7 + 4 * on, 0, TAU); c.fill(); if (on > 0.5) { g.fillStyle = col('acid', 0.4 * on); g.beginPath(); g.arc(n.x, n.y, 18, 0, TAU); g.fill(); } });
  // the signal travels from the brain to the forge on "into"
  const beam = prog(t, tI - 0.1, tS, ease.inOutCubic);
  if (beam > 0) for (let k = 0; k < 7; k++) { const u = (beam - k * 0.06); if (u <= 0 || u > 1) continue; const x = lerp(bx + 260, 1260, u), y = by + Math.sin(u * 9 + k) * 22; g.fillStyle = col('signal', 0.6 - k * 0.07); g.beginPath(); g.arc(x, y, 14 - k, 0, TAU); g.fill(); }
  // gear + crossed wrench/hammer assemble on "skill"
  const gk = prog(t, tS - 0.08, tS + 0.5, ease.outBack), gx = 1380, gy = 640;
  if (gk > 0) {
    const gear = new Path2D(); const teeth = 12, R1 = 150 * gk, R2 = 185 * gk, rot = (t - tS) * 0.8;
    for (let k = 0; k < teeth * 2; k++) { const a0 = rot + (k / (teeth * 2)) * TAU, a1 = rot + ((k + 1) / (teeth * 2)) * TAU, R = k % 2 ? R1 : R2; if (k === 0) gear.moveTo(gx + Math.cos(a0) * R, gy + Math.sin(a0) * R); gear.lineTo(gx + Math.cos(a0) * R, gy + Math.sin(a0) * R); gear.lineTo(gx + Math.cos(a1) * R, gy + Math.sin(a1) * R); }
    gear.closePath(); gear.moveTo(gx + 60 * gk, gy); gear.arc(gx, gy, 60 * gk, 0, TAU, true);
    const gg = c.createLinearGradient(gx, gy - R2, gx, gy + R2); gg.addColorStop(0, col('ember', 1)); gg.addColorStop(1, col('signal', 1));
    c.fillStyle = gg; c.fill(gear, 'evenodd'); g.fillStyle = col('signal', 0.3); g.fill(gear, 'evenodd');
    c.save(); c.translate(gx, gy); c.rotate(-0.7); c.globalAlpha = clamp(gk);
    c.fillStyle = col('bone', 1); c.fillRect(-14, -230, 28, 300); c.beginPath(); c.arc(0, -250, 44, Math.PI * 0.25, Math.PI * 1.75); c.lineTo(0, -250); c.closePath(); c.fill(); // wrench
    c.rotate(1.4); c.fillStyle = col('blood', 1); c.fillRect(-12, -200, 24, 300); c.fillStyle = col('bone', 1); c.fillRect(-60, -240, 120, 50); // hammer
    c.restore();
  }
  note(c, 'KNOWLEDGE', bx, by + 230, fire, 26, 'acid', 'center'); note(c, 'SKILL', gx, gy + 260, clamp(gk), 26, 'signal', 'center');
  topRows(s, l, 140, 150, 16);
}

// ------------------------------------------------------------------ TRUST: attention (eyes) -> trust (handshake) -> people -> the business grows
function eye(s: S, x: number, y: number, r: number, look: number, open: number) {
  const { c } = s;
  c.save(); c.beginPath(); c.ellipse(x, y, r * 1.6, r * open, 0, 0, TAU); c.fillStyle = col('bone', 1); c.fill(); c.clip();
  c.fillStyle = col('signal', 1); c.beginPath(); c.arc(x + look * r * 0.5, y, r * 0.62, 0, TAU); c.fill();
  c.fillStyle = col('ink', 1); c.beginPath(); c.arc(x + look * r * 0.5, y, r * 0.3, 0, TAU); c.fill();
  c.fillStyle = col('bone', 0.9); c.beginPath(); c.arc(x + look * r * 0.5 - r * 0.15, y - r * 0.15, r * 0.1, 0, TAU); c.fill();
  c.restore(); c.strokeStyle = col('graphite', 1); c.lineWidth = 4; c.beginPath(); c.ellipse(x, y, r * 1.6, Math.max(1, r * open), 0, 0, TAU); c.stroke();
}
function person(s: S, x: number, y: number, sc: number, k: number, colr: string) {
  const { c } = s; if (k <= 0) return;
  c.save(); c.globalAlpha = k; c.translate(x, y + (1 - k) * 40); c.scale(sc, sc); c.fillStyle = colr;
  c.beginPath(); c.arc(0, -120, 38, 0, TAU); c.fill(); c.beginPath(); c.moveTo(-70, 0); c.quadraticCurveTo(-70, -78, 0, -78); c.quadraticCurveTo(70, -78, 70, 0); c.closePath(); c.fill(); c.restore();
}
function trust(s: S) {
  const { t, sh, c, g } = s;
  const [l1, l2] = sh.lines as [Line, Line?];
  const tA = at(l1, /attention/i, 2), tT = at(l1, /trust/i, l1.words.length - 1);
  const hk = prog(t, tT - 0.1, tT + 0.6, ease.outBack);
  s.bg.glow = 0.4; s.bg.gy = 0.6; s.bg.warm = 1.0;
  cam(s, { x: W / 2, y: H / 2 + 40, z: 1, r: 0 });
  const p2 = l2 ? prog(t, l2.start - 0.15, l2.start + 0.4, ease.inOutCubic) : 0;
  // eyes open on "attention", all looking at the centre, then fade into the handshake
  const eyesA = prog(t, tA - 0.1, tA + 0.35, ease.outCubic) * (1 - hk * 0.85) * (1 - p2);
  if (eyesA > 0.01) for (let i = 0; i < 6; i++) {
    const x = 330 + i * 252, y = 560 + (i % 2) * 70, blink = 1 - pulse(t, tA + 0.6 + i * 0.13, 0.05) * 0.95;
    c.save(); c.globalAlpha = eyesA; eye(s, x, y, 46, clamp((W / 2 - x) / 500, -1, 1), blink * clamp(eyesA * 1.3)); c.restore();
  }
  // handshake on "trust": two sleeved arms meet; clasped hands with a thumb over the top and finger lines
  if (hk > 0 && p2 < 1) {
    c.save(); c.globalAlpha = 1 - p2; const cx = W / 2, cy = 600, kk = clamp(hk);
    const sleeve = (side: number, fill: string) => {
      const sx = cx + side * lerp(820, 150, kk);
      c.save(); c.translate(sx, cy + 40); c.rotate(side * -0.12);
      c.fillStyle = fill; c.beginPath(); c.roundRect(side > 0 ? 0 : -560, -55, 560, 110, 30); c.fill(); // sleeve
      c.fillStyle = col('bone', 1); c.beginPath(); c.roundRect(side > 0 ? -10 : -30, -60, 40, 120, 10); c.fill(); // cuff
      c.restore();
    };
    sleeve(-1, col('graphite', 1)); sleeve(1, mix('blood', 'ink2', 0.3));
    if (kk > 0.6) {
      const hf = prog(hk, 0.6, 1);
      c.save(); c.translate(cx, cy + 30); c.scale(hf, hf);
      const skinA = mix('ember', 'blood', 0.35), skinB = mix('ember', 'blood', 0.55);
      c.fillStyle = skinB; c.beginPath(); c.roundRect(-40, -70, 230, 130, 55); c.fill();   // right hand (under)
      c.fillStyle = skinA; c.beginPath(); c.roundRect(-190, -95, 230, 130, 55); c.fill();  // left hand (over)
      c.strokeStyle = col('ink', 0.35); c.lineWidth = 5; c.lineCap = 'round';
      for (let k = 0; k < 4; k++) { c.beginPath(); c.moveTo(-10 + k * 28, -60); c.quadraticCurveTo(0 + k * 28, -20, -12 + k * 28, 20); c.stroke(); } // finger lines
      c.fillStyle = skinA; c.beginPath(); c.ellipse(10, -100, 70, 26, -0.25, 0, TAU); c.fill(); // thumb over the top
      c.strokeStyle = col('ink', 0.3); c.beginPath(); c.ellipse(10, -100, 70, 26, -0.25, 0, TAU); c.stroke();
      c.restore();
      g.fillStyle = col('signal', 0.28 * hf); g.beginPath(); g.arc(cx, cy, 190, 0, TAU); g.fill();
    }
    c.restore();
  }
  // line 2: people gather; the business grows up behind them
  if (l2) {
    const bk = prog(t, at(l2, /grow/i, l2.words.length - 2) - 0.1, l2.end + 0.4, ease.inOutCubic);
    for (let i = 0; i < 5; i++) { const h = (120 + i * 90) * bk; c.fillStyle = col(i === 4 ? 'signal' : 'graphite', 0.9); c.fillRect(560 + i * 170, 900 - h, 120, h); }
    rule(c, 400, 900, 1520, 900, p2, col('bone', 0.6), 3);
    l2.words.forEach((w, i) => { if (i > 6) return; });
    for (let i = 0; i < 9; i++) { const k = prog(t, l2.start + i * 0.12, l2.start + 0.4 + i * 0.12, ease.outBack); person(s, 260 + i * 175, 900, 0.85 + 0.15 * (i % 2), k, i === 4 ? col('signal', 1) : mix('bone', 'ash', 0.3)); }
  }
  let ci = 0; sh.lines.forEach((l, i) => { if (t >= l.start - 0.12) ci = i; });
  topRows(s, sh.lines[ci]!, 140, 140, 18);
}

// ------------------------------------------------------------------ CONSTRUCTION overlay: every sung "build" brings the crane in (From the Ground Up)
export function constructionOverlay(s: S) {
  const { t, sh, c, g } = s;
  const builds = sh.lines.flatMap((l) => l.words).filter((w) => /^build/i.test(clean(w.w)));
  let k = 0, t0 = 0;
  for (const w of builds) { const kk = prog(t, w.start - 0.1, w.start + 0.3, ease.outCubic) * (1 - prog(t, w.start + 1.6, w.start + 2.2, ease.inCubic)); if (kk > k) { k = kk; t0 = w.start; } }
  if (k <= 0.01) return;
  cam(s, { x: W / 2, y: H / 2, z: 1, r: 0 });
  c.save(); g.save(); c.globalAlpha = k; g.globalAlpha = k;
  // tower crane at the right edge: lattice mast, jib, counter-jib, trolley and a hook lowering a steel beam
  const mx = W - 210, top = 150, swing = Math.sin((t - t0) * 0.9) * 0.05;
  for (let y = top; y < H; y += 46) { c.strokeStyle = col('signal', 0.85); c.lineWidth = 4; c.strokeRect(mx - 22, y, 44, 46); rule(c, mx - 22, y, mx + 22, y + 46, 1, col('signal', 0.7), 3); }
  c.save(); c.translate(mx, top); c.rotate(swing);
  c.strokeStyle = col('signal', 0.95); c.lineWidth = 6; c.beginPath(); c.moveTo(-760, 0); c.lineTo(180, 0); c.stroke();
  for (let x = -740; x < 180; x += 40) rule(c, x, 0, x + 20, -24, 1, col('signal', 0.6), 2);
  c.fillStyle = col('graphite', 1); c.fillRect(110, 4, 70, 50);
  const tx = -520 + 90 * Math.sin((t - t0) * 0.6), drop = 160 + 140 * prog(t, t0, t0 + 1.4, ease.inOutCubic);
  rule(c, tx, 0, tx, drop, 1, col('bone', 0.8), 2);
  c.fillStyle = col('blood', 1); c.fillRect(tx - 150, drop, 300, 26); c.fillStyle = col('signal', 1); c.fillRect(tx - 150, drop, 300, 6);
  g.fillStyle = col('signal', 0.35); g.fillRect(tx - 150, drop, 300, 26);
  c.restore();
  // scaffolding rising at the lower left
  const sk = prog(t, t0 - 0.05, t0 + 0.8, ease.outCubic), sh2 = 380 * sk;
  for (let i = 0; i < 4; i++) { rule(c, 110 + i * 80, H - 40, 110 + i * 80, H - 40 - sh2, 1, col('ash', 0.8), 4); }
  for (let y = H - 40; y > H - 40 - sh2; y -= 76) { rule(c, 110, y, 350, y, 1, col('ash', 0.8), 4); rule(c, 110, y, 190, y - 76, 1, col('ash', 0.4), 2); }
  note(c, ((BRAND as any).slogan ?? ''), 110, H - 52 - sh2, sk, 18, 'signal');
  c.restore(); g.restore();
}

// ------------------------------------------------------------------ ICONS for the build section (one property / decision / skill / vision / call / try / reason)
export function iconFor(c: CanvasRenderingContext2D, g: CanvasRenderingContext2D, name: string, x: number, y: number, sz: number, k: number) {
  if (k <= 0) return;
  c.save(); g.save(); for (const ctx of [c, g]) { ctx.translate(x, y); ctx.scale(sz / 100 * k, sz / 100 * k); }
  c.strokeStyle = col('signal', 1); c.fillStyle = col('signal', 1); c.lineWidth = 8; c.lineJoin = 'round'; c.lineCap = 'round'; g.strokeStyle = col('signal', 0.4); g.lineWidth = 14;
  const P = new Path2D();
  if (/propert|house|home/.test(name)) { P.moveTo(-80, -10); P.lineTo(0, -80); P.lineTo(80, -10); P.moveTo(-60, -25); P.lineTo(-60, 70); P.lineTo(60, 70); P.lineTo(60, -25); P.rect(-18, 20, 36, 50); }
  else if (/decision/.test(name)) { P.moveTo(0, 80); P.lineTo(0, -80); P.moveTo(0, -60); P.lineTo(70, -60); P.lineTo(90, -40); P.lineTo(70, -20); P.lineTo(0, -20); P.moveTo(0, 0); P.lineTo(-70, 0); P.lineTo(-90, 20); P.lineTo(-70, 40); P.lineTo(0, 40); }
  else if (/skill/.test(name)) { for (let i = 0; i < 16; i++) { const a = (i / 16) * TAU, R = i % 2 ? 62 : 82; i ? P.lineTo(Math.cos(a) * R, Math.sin(a) * R) : P.moveTo(Math.cos(a) * R, Math.sin(a) * R); } P.closePath(); P.moveTo(28, 0); P.arc(0, 0, 28, 0, TAU); }
  else if (/vision/.test(name)) { P.ellipse(0, 0, 90, 46, 0, 0, TAU); P.moveTo(34, 0); P.arc(0, 0, 34, 0, TAU); }
  else if (/call/.test(name)) { P.moveTo(-60, -70); P.quadraticCurveTo(-90, 0, -40, 50); P.quadraticCurveTo(10, 90, 70, 70); P.lineTo(50, 30); P.lineTo(15, 40); P.quadraticCurveTo(-25, 10, -30, -30); P.lineTo(-20, -60); P.closePath(); }
  else if (/try/.test(name)) { P.arc(0, 0, 80, 0, TAU); P.moveTo(50, 0); P.arc(0, 0, 50, 0, TAU); P.moveTo(20, 0); P.arc(0, 0, 20, 0, TAU); P.moveTo(100, -100); P.lineTo(0, 0); }
  else { P.moveTo(0, 70); P.bezierCurveTo(-110, -10, -60, -90, 0, -40); P.bezierCurveTo(60, -90, 110, -10, 0, 70); }
  c.stroke(P); g.stroke(P);
  c.restore(); g.restore();
}

export const SHOTS: Record<string, (s: S) => void> = {
  skill, trust,
  intro,
  slam: slamStack, anchor, stair, door, ledger, house, ceiling, blueprint, path, title, pillars, tree, serif, legacy,
  search, network, grid, clock, key: keyShot, generations, higher, outro,
};
export const LIBRARY = SHOTS;
