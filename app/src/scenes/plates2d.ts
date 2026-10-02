// Plate styles (after the pdoom treatment: "each set piece has its own instrument, idiom" — engraving, oscilloscope,
// bureaucratic paper, banknote guilloché, blueprint, UI...). A plate is a full-frame graphic idiom drawn BEHIND a shot
// (screen space, before the shot draws). Choose it per shot in project/script.ts with { plate: '<kind>' }; paper plates also
// need { bg: { paper: 1 } } so the type inverts to ink. Pure functions of s.t; palette keys only; no glow on paper.
import { W, H } from '../engine/gl';
import { F } from '../engine/type';
import { clamp, hash, noise1, prog, TAU } from '../engine/util';
import { col, mix, note, rule, setFont } from './kit';
import type { S } from './shots';
import { BRAND } from '../project/brand';

const K = (s: S) => (s.paper ? 'blood' : 'graphite');

/** Banknote guilloché: interlaced rosettes and a fine-line border; slowly turning. */
function guilloche(s: S, a: number) {
  const { c, t } = s;
  const hot = s.sh.o.plateHot ?? 'signal';
  c.lineWidth = 1.2;
  for (const [cx, cy, R, n, ph] of [[W * 0.5, H * 0.5, 430, 9, 0], [W * 0.14, H * 0.82, 230, 7, 1.3], [W * 0.86, H * 0.2, 230, 11, 2.1]] as const) {
    for (let L = 0; L < 14; L++) {
      c.strokeStyle = col(L % 3 ? (s.paper ? 'blood' : 'graphite') : hot, (L % 3 ? 0.35 : 0.22) * a);
      c.beginPath();
      for (let i = 0; i <= 360; i++) {
        const q = (i / 360) * TAU, rr = R * (0.55 + 0.45 * (L / 14)) + 26 * Math.sin(n * q + L * 0.45 + ph + t * 0.08) + 10 * Math.sin((n + 3) * q - t * 0.05);
        const x = cx + Math.cos(q) * rr, y = cy + Math.sin(q) * rr;
        i ? c.lineTo(x, y) : c.moveTo(x, y);
      }
      c.stroke();
    }
  }
  // border: fine wavy bands
  for (let b = 0; b < 4; b++) {
    c.strokeStyle = col(K(s), 0.4 * a); c.beginPath();
    for (let x = 40; x <= W - 40; x += 6) { const y = 46 + b * 7 + Math.sin(x * 0.06 + b) * 3; x === 40 ? c.moveTo(x, y) : c.lineTo(x, y); }
    c.stroke(); c.beginPath();
    for (let x = 40; x <= W - 40; x += 6) { const y = H - 46 - b * 7 + Math.sin(x * 0.06 + b) * 3; x === 40 ? c.moveTo(x, y) : c.lineTo(x, y); }
    c.stroke();
  }
  note(c, 'SERIES ' + (s.sh.o.plateLabel ?? `${BRAND.titleA} ${BRAND.titleB}`), W - 70, H - 70, 0.55 * a, 16, s.paper ? 'blood' : 'ash', 'right');
}
/** Bone-paper ledger: ruled lines, a double red margin, column rules, mono headers. */
function ledger(s: S, a: number) {
  const { c } = s;
  for (let y = 120; y < H - 40; y += 44) rule(c, 60, y, W - 60, y, 1, col('ash', 0.45 * a), 1);
  rule(c, 200, 40, 200, H - 40, 1, col('blood', 0.55 * a), 2); rule(c, 208, 40, 208, H - 40, 1, col('blood', 0.55 * a), 1);
  for (const x of [W - 520, W - 340, W - 170]) rule(c, x, 80, x, H - 40, 1, col('ash', 0.4 * a), 1);
  note(c, s.sh.o.plateLabel ?? 'GENERAL LEDGER', 230, 92, 0.7 * a, 18, 'blood');
  ['DEBIT', 'CREDIT', 'BALANCE'].forEach((h, i) => note(c, h, W - 430 + i * 175, 92, 0.6 * a, 15, 'graphite', 'center'));
  note(c, `p. ${1 + (s.sh.idx % 40)}`, W - 80, H - 60, 0.6 * a, 15, 'graphite', 'right');
}
/** Blueprint: fine + major grid, dimension arrows, a title block. */
function blueprint(s: S, a: number) {
  const { c } = s;
  const k = K(s);
  for (let x = 0; x <= W; x += 40) rule(c, x, 0, x, H, 1, col(k, (x % 200 ? 0.16 : 0.34) * a), 1);
  for (let y = 0; y <= H; y += 40) rule(c, 0, y, W, y, 1, col(k, (y % 200 ? 0.16 : 0.34) * a), 1);
  const bx = W - 480, by = H - 170;
  c.strokeStyle = col(k, 0.8 * a); c.lineWidth = 2; c.strokeRect(bx, by, 420, 120); rule(c, bx, by + 40, bx + 420, by + 40, 1, col(k, 0.8 * a), 1); rule(c, bx + 260, by, bx + 260, by + 120, 1, col(k, 0.8 * a), 1);
  note(c, s.sh.o.plateLabel ?? 'DRAWING A-101', bx + 14, by + 28, 0.85 * a, 16, s.paper ? 'blood' : 'ash');
  note(c, 'SCALE 1:50', bx + 14, by + 72, 0.7 * a, 14, s.paper ? 'blood' : 'ash'); note(c, `REV ${String.fromCharCode(65 + (s.sh.idx % 6))}`, bx + 274, by + 72, 0.7 * a, 14, s.paper ? 'blood' : 'ash');
  for (const [x0, y0, x1] of [[120, 110, 640], [W - 700, 80, W - 160]] as const) { rule(c, x0, y0, x1, y0, 1, col(k, 0.6 * a), 1.5); for (const x of [x0, x1]) rule(c, x, y0 - 10, x, y0 + 10, 1, col(k, 0.6 * a), 1.5); note(c, `${Math.round((x1 - x0) / 8)}'-0"`, (x0 + x1) / 2, y0 - 10, 0.6 * a, 14, s.paper ? 'blood' : 'ash', 'center'); }
}
/** Oscilloscope: graticule, a phosphor trace riding the mix, readouts. */
function scope(s: S, a: number) {
  const { c, g, t, au } = s;
  const x0 = 120, y0 = 110, w = W - 240, h = H - 220;
  c.strokeStyle = col('graphite', 0.6 * a); c.lineWidth = 1.5; c.strokeRect(x0, y0, w, h);
  for (let i = 1; i < 10; i++) rule(c, x0 + (w * i) / 10, y0, x0 + (w * i) / 10, y0 + h, 1, col('graphite', (i === 5 ? 0.5 : 0.25) * a), 1);
  for (let j = 1; j < 8; j++) rule(c, x0, y0 + (h * j) / 8, x0 + w, y0 + (h * j) / 8, 1, col('graphite', (j === 4 ? 0.5 : 0.25) * a), 1);
  const amp = 40 + 220 * au.env('mid', t);
  for (const ctx of [c, g]) {
    ctx.strokeStyle = col('signal', (ctx === c ? 0.55 : 0.25) * a); ctx.lineWidth = ctx === c ? 2 : 8; ctx.beginPath();
    for (let x = 0; x <= w; x += 6) { const u = x / w, y = y0 + h / 2 + Math.sin(u * 22 + t * 9) * amp * Math.sin(u * Math.PI) * (0.6 + 0.4 * noise1(u * 8 + t * 3, 2)); x ? ctx.lineTo(x0 + x, y) : ctx.moveTo(x0 + x, y); }
    ctx.stroke();
  }
  note(c, `CH1 ${(amp / 100).toFixed(2)}V/div   ${(1 / (1 + au.env('low', t))).toFixed(2)}ms`, x0 + 10, y0 + h + 30, 0.7 * a, 16, 'signal');
}
/** Engraving: diagonal hatch whose density follows a soft light falloff (depth through line, not fills). */
function engrave(s: S, a: number) {
  const { c } = s;
  const k = K(s);
  for (let i = -H; i < W; i += 9) {
    for (let seg = 0; seg < 12; seg++) {
      const x0 = i + seg * 90, y0 = seg * 90, x1 = x0 + 90, y1 = y0 + 90;
      const cx = (x0 + x1) / 2 - W / 2, cy = (y0 + y1) / 2 - H * 0.45, d = Math.hypot(cx / W, cy / H);
      const dens = clamp(d * 1.6 - 0.25);
      if (hash(i, seg) > dens) continue;
      rule(c, x0, y0, x1, y1, 1, col(k, 0.5 * a * dens), 1);
    }
  }
}
/** UI: a window with title bar, sidebar and mono chrome (the "app" plate). */
function ui(s: S, a: number) {
  const { c } = s;
  const x0 = 70, y0 = 60, w = W - 140, h = H - 120;
  c.strokeStyle = col('graphite', 0.7 * a); c.lineWidth = 2; c.strokeRect(x0, y0, w, h);
  c.fillStyle = col('ink2', 0.85 * a); c.fillRect(x0, y0, w, 44);
  ['blood', 'acid', 'signal'].forEach((k2, i) => { c.fillStyle = col(k2, 0.8 * a); c.beginPath(); c.arc(x0 + 26 + i * 24, y0 + 22, 7, 0, TAU); c.fill(); });
  note(c, s.sh.o.plateLabel ?? `${BRAND.titleA.toLowerCase()}.app — dashboard`, x0 + w / 2, y0 + 28, 0.7 * a, 16, 'ash', 'center');
  rule(c, x0 + 230, y0 + 44, x0 + 230, y0 + h, 1, col('graphite', 0.6 * a), 1);
  ['Overview', 'Leads', 'Deals', 'Properties', 'Team', 'Reports'].forEach((lb, i) => note(c, lb, x0 + 24, y0 + 96 + i * 44, (i === s.sh.idx % 6 ? 0.95 : 0.5) * a, 18, i === s.sh.idx % 6 ? 'signal' : 'ash'));
}
/** Halftone: a dot screen whose dots swell toward a light source. */
function halftone(s: S, a: number) {
  const { c, t } = s;
  const lx = W * (0.3 + 0.1 * Math.sin(t * 0.3)), ly = H * 0.35;
  for (let y = 20; y < H; y += 26) for (let x = 20 + ((y / 26) % 2) * 13; x < W; x += 26) {
    const d = Math.hypot(x - lx, y - ly) / W, r = clamp(1 - d * 1.5) * 9;
    if (r < 0.6) continue;
    c.fillStyle = col(s.paper ? 'blood' : 'graphite', 0.55 * a); c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill();
  }
}
/** Contour: topographic iso-lines with index contours and spot heights. */
function contour(s: S, a: number) {
  const { c, t } = s;
  const k = K(s);
  for (let L = 0; L < 26; L++) {
    c.strokeStyle = col(L % 5 ? k : (s.paper ? 'blood' : 'signal'), (L % 5 ? 0.3 : 0.45) * a); c.lineWidth = L % 5 ? 1 : 2; c.beginPath();
    for (let x = -20; x <= W + 20; x += 12) { const y = L * 46 + 40 * noise1(x * 0.004 + L * 0.37, 3) + 70 * Math.sin(x * 0.002 + L * 0.2 + t * 0.02); x < 0 ? c.moveTo(x, y) : c.lineTo(x, y); }
    c.stroke();
  }
  for (let i = 0; i < 6; i++) note(c, `▲ ${Math.round(120 + hash(i, 4) * 900)}`, 160 + hash(i, 1) * (W - 320), 150 + hash(i, 2) * (H - 300), 0.55 * a, 14, s.paper ? 'blood' : 'ash');
}
/** Terminal: faint columns of tokens with a blinking cursor. */
function terminal(s: S, a: number) {
  const { c, t } = s;
  setFont(c, F.mono(400), 18); c.textAlign = 'left';
  const toks = (s.sh.o.plateTokens as string[] | undefined) ?? ['run', 'ok', 'build', 'retry', 'push', '200', '0x1f', 'true', 'null', 'next', 'yield', 'await', 'map', 'sync', 'done'];
  for (let r = 0; r < 34; r++) {
    const y = 60 + r * 30, n = Math.floor(hash(r, 1) * 14) + 4;
    let line = '';
    for (let i = 0; i < n; i++) line += toks[Math.floor(hash(r, i, Math.floor(t * 2 + r * 0.3)) * toks.length)] + ' ';
    c.fillStyle = col(r % 7 ? 'graphite' : 'signal', (r % 7 ? 0.45 : 0.4) * a); c.fillText('$ ' + line, 80, y);
  }
  if (Math.floor(t * 2) % 2) { c.fillStyle = col('signal', 0.8 * a); c.fillRect(80, 60 + 34 * 30, 12, 20); }
}
/** Stamped paper: rubber stamps scattered at angles (bureaucracy). */
function stamps(s: S, a: number) {
  const { c } = s;
  const words = s.sh.o.plateStamps ?? ['APPROVED', 'RECEIVED', 'PAID', 'FILED', 'COPY'];
  for (let i = 0; i < 9; i++) {
    const x = 180 + hash(i, 1) * (W - 360), y = 140 + hash(i, 2) * (H - 280), r = (hash(i, 3) - 0.5) * 0.7;
    c.save(); c.translate(x, y); c.rotate(r);
    c.strokeStyle = col(s.paper ? 'blood' : 'graphite', 0.4 * a); c.lineWidth = 4; c.strokeRect(-130, -38, 260, 76);
    setFont(c, F.mono(700), 34); c.textAlign = 'center'; c.fillStyle = col(s.paper ? 'blood' : 'graphite', 0.4 * a); c.fillText(words[i % words.length]!, 0, 12);
    c.restore();
  }
}
const PLATES: Record<string, (s: S, a: number) => void> = { guilloche, ledger, blueprint, scope, engrave, ui, halftone, contour, terminal, stamps };
export const PLATE_KINDS = Object.keys(PLATES);
/** Draw the shot's plate (if any) in screen space; fades in over the first 0.25 s of the shot. */
export function drawPlate(s: S) {
  const kind = s.sh.o.plate as string | undefined;
  if (!kind || !PLATES[kind]) return;
  if (kind === 'ledger' && !s.sh.o.plateDark) { s.paper = true; s.bg.paper = 1; } // ledgers are ink on bone paper (unless { plateDark: true })
  let a = Math.min(1.6, (s.sh.o.plateAlpha ?? 1) * (s.paper ? 1 : 1.6)) * prog(s.lt, 0, 0.25); // dark plates need more line contrast
  const cut = s.sh.o.plateLines != null ? s.sh.lines[s.sh.o.plateLines] : undefined; // plate only behind the first N lines
  if (cut) a *= 1 - prog(s.t, cut.start - 0.25, cut.start + 0.1);
  if (a <= 0.001) return;
  s.c.save(); s.c.setTransform(1, 0, 0, 1, 0, 0);
  if (s.g) { s.g.save(); s.g.setTransform(1, 0, 0, 1, 0, 0); }
  PLATES[kind]!(s, a);
  s.c.restore(); if (s.g) s.g.restore();
}
void mix;
