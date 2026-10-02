// Kinetic plate library: multi-line plates where the WORDS ARE THE OBJECTS (pdoom: "the words are part of the image, not
// subtitles"). Each plate spans several lines (3–8), keeps earlier lines readable, and moves the camera through the type.
// Every label/trigger is an option (no client content). Use from project/script.ts like any shot: ['strips', 6, {...}].
// See scenes/kinetic/README.md for when to use which.
//
//   signs       words stand up as signs along a ground track, the camera travels through them; optional lift-off after
//               line `liftLine` (later lines lie across the fields, read from the air)        o: liftLine, hud, label
//   maptype     low flyover of an engraved plat; the lines are map lettering; nouns stand up    o: stand (regex), pins (regex), stamp, label
//   strips      each line is typed on a card that slams into a rack; earlier cards stay legible o: code, label, stamps[]
//   press       letterpress: sorts drop in as sung, the platen prints the line onto the sheet  o: run (last line runs the press), runWord, label
//   pixels      one tile (house) → a row → the screen fills; each sung word of the last line is spelled in lit windows
//   trajectory  the lyric rides a spark's path (glyphs on the tangent)                      o: shapes[] (level|loop|dip|zig|steps|climb|curl|jitter), label
//   skywrite    each line written across the sky in smoke (single-stroke), finished before the line ends   o: label, font
//   courses     each line carved into a stone course stacking upward                         o: cap (capstone text), years (line index)
//   document    a typed page; `margin` line indices are handwritten in the margin; `strike` regex struck; optional ticket for
//               the last line (o.ticket: regex of the word after which the rest prints on a ticket)   o: title, sub, margin[], strike, ticket
//   tickets     one word (or the phrase after `after`) per ticket, stacking                  o: after, prior, header
//   detonate    pdoom's outro detonation: hero words held over a radial streak burst + rings on the drop; re-fires per bar;
//               collapses to a point at the end                                              o: dropAt, words[], to {x,y}
import { W, H } from '../../engine/gl';
import type { Line, Word } from '../../engine/lyrics';
import { clamp, ease, hash, lerp, mulberry32, noise1, prog, pulse, TAU } from '../../engine/util';
import { A, CAP, col, heat, mix, rule, setFont, sizeFor, applyCam, snapCam, clean } from '../kit';
import { cam, word, txt, type S } from '../shots';
import { F, measure } from '../../engine/type';
import { strokeText, drawStrokeText, writtenLength, type StrokeFontName, type StrokeText } from '../../engine/stroke';
import { wrow, fitW, engrave, rectP, eblock, stampT, sheet, SMALLW } from './tk';
import { gp, gpath, gline, gword, type GCam } from './ground';
import { BRAND } from '../../project/brand';

const FLAT = { x: W / 2, y: H / 2, z: 1, r: 0 };
const flat = (s: S) => { applyCam(s.c, FLAT); applyCam(s.g, FLAT); };
const cur = (L: Line[], t: number) => { let k = 0; L.forEach((l, i) => { if (t >= l.start - 0.15) k = i; }); return k; };
const lastW = (l: Line) => l.words[l.words.length - 1]!;
const mono = (c: CanvasRenderingContext2D, text: string, x: number, y: number, a: number, size = 18, k = 'ash', align: CanvasTextAlign = 'left') => { if (a <= 0 || !text) return; setFont(c, F.mono(600), size); c.textAlign = align; c.textBaseline = 'alphabetic'; c.fillStyle = col(k, 0.9 * a); c.fillText(text, x, y); };
function track(t: number, keys: [number, number][]) {
  if (t <= keys[0]![0]) return keys[0]![1];
  for (let i = 1; i < keys.length; i++) { const [t1, v1] = keys[i]!, [t0, v0] = keys[i - 1]!; if (t <= t1) return lerp(v0, v1, ease.inOutCubic((t - t0) / Math.max(1e-3, t1 - t0))); }
  return keys[keys.length - 1]![1];
}

// ================================================================== signs
function signs(s: S) {
  const { t, sh, c, g } = s;
  const L = sh.lines as Line[], LL = sh.o.liftLine ?? -1, nG = LL >= 0 ? LL + 1 : L.length;
  s.bg.grid = 0; s.bg.stars = 0.25; s.bg.glow = 0.3; s.bg.gy = 0.35; s.bg.warm = 1.2;
  const WS = 52, HM = 8;
  const wz: { w: Word; Z: number; X: number; li: number }[] = [];
  let zc = 300;
  L.slice(0, nG).forEach((l, i) => { l.words.forEach((w, j) => { wz.push({ w, Z: zc, X: j % 2 ? 6 : -6, li: i }); zc += WS; }); zc += 140; });
  const ZA = (i: number) => zc + 520 + (i - nG) * 640;
  const tLift = LL >= 0 ? lastW(L[LL]!).start : 1e9;
  const zk: [number, number][] = [[sh.start, 300 - 420]];
  for (const q of wz) zk.push([q.w.start - 0.05, q.Z - 160]);
  L.forEach((l, i) => { if (i >= nG) zk.push([l.end - 0.1, ZA(i) - 560]); });
  zk.sort((p, q) => p[0] - q[0]); zk.push([sh.end, L.length > nG ? ZA(L.length - 1) - 520 : zc]);
  const lift = prog(t, tLift - 0.1, tLift + 1.6, ease.inOutCubic);
  const k: GCam = { x: 0, z: track(t, zk), h: lerp(5.5, 330, lift), y0: lerp(560, 300, lift), f: 1150, roll: 0.02 * Math.sin(lift * Math.PI) };
  const gr = c.createLinearGradient(0, 0, 0, k.y0); gr.addColorStop(0, col('ink', 0)); gr.addColorStop(1, col('blood', 0.35)); c.fillStyle = gr; c.fillRect(0, 0, W, k.y0);
  c.fillStyle = col('ink2', 1); c.fillRect(0, k.y0, W, H - k.y0 + 10);
  for (let gx = -40; gx <= 40; gx++) { c.strokeStyle = col('graphite', 0.25 + 0.3 * lift); c.lineWidth = 1; gpath(c, k, [[gx * 120, k.z + 2], [gx * 120, k.z + 6000]]); c.stroke(); }
  for (let gz = Math.floor(k.z / 120); gz < Math.floor(k.z / 120) + 50; gz++) { const Z = gz * 120; if (Z < k.z + 2) continue; c.strokeStyle = col('graphite', (0.2 + 0.35 * lift) * clamp(1 - (Z - k.z) / 6000)); gpath(c, k, [[-4800, Z], [4800, Z]]); c.stroke(); }
  const RZ1 = zc + 300;
  c.fillStyle = mix('ink', 'graphite', 0.22); gpath(c, k, [[-30, Math.max(k.z + 1, -200)], [30, Math.max(k.z + 1, -200)], [30, RZ1], [-30, RZ1]], true); c.fill();
  for (let z = Math.ceil(k.z / 60) * 60; z < RZ1 && z < k.z + 2500; z += 60) { c.fillStyle = col('bone', 0.8); gpath(c, k, [[-0.6, z], [0.6, z], [0.6, z + 30], [-0.6, z + 30]], true); c.fill(); }
  for (let z = Math.ceil(k.z / 40) * 40; z < RZ1 && z < k.z + 2500; z += 40) for (const X of [-31, 31]) { const p = gp(k, X, z, 0.4); if (!p) continue; const r = clamp(700 / p.d, 1.5, 14), on = 0.5 + 0.5 * Math.sin(t * 9 - z * 0.05); c.fillStyle = col('signal', 0.6 + 0.4 * on); c.beginPath(); c.arc(p.x, p.y, r, 0, TAU); c.fill(); g.fillStyle = col('signal', 0.35 * on); g.beginPath(); g.arc(p.x, p.y, r * 3, 0, TAU); g.fill(); }
  for (let n = wz.length - 1; n >= 0; n--) {
    const q = wz[n]!, l = L[q.li]!; if (q.Z < k.z + 4 || q.Z > k.z + 1400) continue;
    const nx = wz[n + 1] && wz[n + 1]!.li === q.li ? wz[n + 1]!.w.start : l.end + 0.2;
    const up = clamp(prog(t, q.w.start - 0.35, q.w.start + 0.05, ease.outBack)) * (1 - prog(t, nx - 0.05, nx + 0.3, ease.inOutCubic));
    const h = clamp((t - q.w.start + 0.06) / 0.2) * (1 - clamp((t - q.w.end - 0.1) / 0.6)), near = clamp((q.Z - k.z - 25) / 45); if (near <= 0) continue;
    gword(s, k, txt(q.w), q.X, q.Z, HM, up, t < q.w.start - 0.06 ? col('bone', 0.5 * near) : mix('bone', 'signal', h, near), { glow: h * up * near });
  }
  L.forEach((l, i) => { if (i >= nG) { const Z = ZA(i); if (Z >= k.z + 4) gline(s, k, l.words, 40, Z, 170, 900, { stand: () => 0, fam: A(62, 900) }); } });
  flat(s);
  if (sh.o.hud) { mono(c, sh.o.label ?? '', 120, H - 64, 1, 18, lift > 0.05 ? 'signal' : 'ash'); mono(c, `ALT ${Math.round(k.h * 3.28)} FT`, W - 120, H - 100, 1, 26, 'bone', 'right'); }
}

// ================================================================== maptype
function maptype(s: S) {
  const { t, sh, c, g } = s;
  const L = sh.lines as Line[];
  s.bg.grid = 0; s.bg.stars = 0; s.bg.glow = 0.22; s.paper = true; s.bg.paper = 1;
  const stand: RegExp = sh.o.stand ?? /^$/, pins: RegExp = sh.o.pins ?? /^$/;
  const ZL = (i: number) => 900 + i * 520, LW = 560;
  const keys: [number, number][] = [[sh.start, ZL(0) - 640], ...L.map((l, i) => [l.start, ZL(i) - 470] as [number, number]), [sh.end, ZL(L.length - 1) - 330]];
  let zc = keys[0]![1]; for (let n = 1; n < keys.length; n++) { const [t0, z0] = keys[n - 1]!, [t1, z1] = keys[n]!; if (t >= t0) zc = lerp(z0, z1, clamp((t - t0) / Math.max(1e-3, t1 - t0))); }
  const li = L.reduce((m, l, i) => (t >= l.start - 0.2 ? i : m), 0), ll = L[li]!, u = clamp((t - ll.start) / Math.max(0.3, ll.end - ll.start));
  const k: GCam = { x: lerp(-LW * 0.28, LW * 0.28, ease.inOutQuad(u)), z: zc, h: 210, y0: 260, f: 1100, roll: -0.03 + 0.012 * Math.sin(t * 0.5) };
  c.fillStyle = mix('bone', 'ash', 0.08); c.fillRect(0, k.y0 - 2, W, H);
  const z0 = Math.floor(k.z / 160) * 160;
  for (let gz = z0; gz < k.z + 4200; gz += 160) for (let gx = -9; gx <= 9; gx++) {
    const X = gx * 160, Z = gz; if (Z < k.z + 6) continue; const fa = clamp(1 - (Z - k.z) / 4200);
    c.strokeStyle = col('ink', 0.35 * fa); c.lineWidth = 1.2; gpath(c, k, [[X + 14, Z + 14], [X + 146, Z + 14], [X + 146, Z + 146], [X + 14, Z + 146]], true); c.stroke();
    if (hash(gx, gz / 160) > 0.35) { c.fillStyle = col('ink', 0.18 * fa); gpath(c, k, [[X + 50, Z + 50], [X + 110, Z + 50], [X + 110, Z + 100], [X + 50, Z + 100]], true); c.fill(); }
  }
  L.forEach((l, i) => {
    const Z = ZL(i); if (Z < k.z + 6 || Z > k.z + 3200) return;
    gline(s, k, l.words, 0, Z, 62, LW, { base: 'ink', stand: (w) => (stand.test(clean(w.w)) ? clamp(prog(t, w.start - 0.05, w.start + 0.3, ease.outBack)) : 0) });
    for (const w of l.words.filter((w) => pins.test(clean(w.w)))) { const kk = prog(t, w.start, w.start + 0.4, ease.outBack); const p = gp(k, (hash(i, w.start) - 0.5) * 600, Z - 120, 60 * kk); if (p && kk > 0) { c.fillStyle = col('signal', 1); c.beginPath(); c.arc(p.x, p.y, (1100 * 9) / p.d, 0, TAU); c.fill(); g.fillStyle = col('signal', 0.5); g.beginPath(); g.arc(p.x, p.y, (1100 * 22) / p.d, 0, TAU); g.fill(); } }
  });
  flat(s);
  mono(c, sh.o.label ?? 'SURVEY · 1:2400', 120, H - 70, 1, 18, 'graphite');
  if (sh.o.stamp) stampT(s, W - 330, H - 160, sh.o.stamp, lastW(L[L.length - 1]!).start + 0.1, -0.1, 34, 'signal');
}

// ================================================================== strips
function strips(s: S) {
  const { t, sh, c } = s;
  const L = sh.lines as Line[], i = cur(L, t);
  s.bg.grid = 0; s.bg.glow = 0.22; s.bg.stars = 0;
  cam(s, snapCam(t, [sh.start, ...L.map((l) => l.start - 0.2)], [{ x: W / 2, y: H / 2, z: 1.0, r: -0.012 }, ...L.map((_, n) => ({ x: W / 2 + (n % 2 ? 30 : -30), y: H / 2 + 20, z: 1.02 + 0.01 * n, r: n % 2 ? 0.012 : -0.012 }))], 0.4));
  const SX = 170, SW = 1580, SH = 124, GAP = 18, BASE = 760;
  eblock(c, SX - 40, -400, 30, 1600, { shade: 0.5, step: 5 }); eblock(c, SX + SW + 10, -400, 30, 1600, { shade: 0.5, step: 5 });
  mono(c, sh.o.label ?? '', SX, 70, 1, 18, 'graphite');
  const rise = L.reduce((n, l) => n + prog(t, l.start - 0.25, l.start + 0.1, ease.outExpo), 0) - 1;
  L.forEach((l, n) => {
    const kin = prog(t, l.start - 0.3, l.start + 0.05, ease.outExpo); if (kin <= 0) return;
    const y = BASE - (rise - n) * (SH + GAP), x = SX + (1 - kin) * 1900, a = clamp(1 - (BASE - y) / (5 * (SH + GAP))); if (a <= 0.01) return;
    c.fillStyle = col('ink', 0.5 * a); c.fillRect(x + 10, y + 12, SW, SH);
    c.fillStyle = col('bone', a); c.fillRect(x, y, SW, SH);
    c.fillStyle = col(n === i ? 'signal' : 'graphite', a); c.fillRect(x, y, 14, SH);
    rule(c, x + 210, y + 10, x + 210, y + SH - 10, 1, col('ink', 0.4 * a), 2); rule(c, x + SW - 260, y + 10, x + SW - 260, y + SH - 10, 1, col('ink', 0.4 * a), 2);
    mono(c, `${sh.o.code ?? 'LN'}${String(n + 1).padStart(3, '0')}`, x + 34, y + 52, a, 26, 'ink');
    mono(c, `${Math.floor(l.start / 60)}:${(l.start % 60).toFixed(1).padStart(4, '0')}`, x + 34, y + 90, a, 18, 'graphite');
    wrow(s, l.words, x + 240, y + SH / 2, fitW(l.words, SW - 540, 92), { align: 'l', base: 'ink', hot: 'blood', alpha: a, from: 1.15 });
    const st = (sh.o.stamps as string[] | undefined)?.[n] ?? txt(lastW(l));
    stampT(s, x + SW - 130, y + SH / 2, st, lastW(l).start + 0.05, -0.08, Math.min(34, (220 / Math.max(4, st.length)) * 1.6), 'signal', a);
  });
}

// ================================================================== press
function press(s: S) {
  const { t, sh, c, g } = s;
  const L = sh.lines as Line[], i = cur(L, t);
  s.bg.grid = 0; s.bg.glow = 0.25;
  const LZ = L[L.length - 1]!, run = sh.o.run ? prog(t, lastW(LZ).start, lastW(LZ).start + 0.4) : 0;
  cam(s, { x: W / 2, y: H / 2 + 10, z: 1 + 0.04 * pulse(t, L[i]!.start, 0.2), r: -0.01 + 0.01 * Math.sin(t) });
  const pressT = (n: number) => Math.min(lastW(L[n]!).end + 0.05, L[n + 1] ? L[n + 1]!.start - 0.1 : 1e9);
  const feed = L.reduce((a, _, n) => a + prog(t, pressT(n) + 0.12, pressT(n) + 0.45, ease.outCubic), 0);
  const PX = 260, PW = 1400, PY = 470;
  sheet(c, PX, PY - 40, PW, 700, 1, 0);
  c.save(); c.beginPath(); c.rect(PX, PY - 40, PW, 700); c.clip();
  L.forEach((l, n) => { if (t < pressT(n)) return; const y = PY + 90 + (n - (feed - 1)) * 130 + 260; wrow(s, l.words, PX + PW / 2, y, fitW(l.words, PW - 140, l.words.length <= 2 ? 130 : 84), { base: 'ink', hot: 'blood', alpha: 1, from: 1 }); });
  c.restore();
  const l = L[i]!;
  if (t < pressT(i) + 0.05) {
    const fam = A(100, 900), T = l.words.map((w) => clean(w.w).toUpperCase()).join(' '), sz = Math.min(120, (PW - 80) / (T.length * 0.62)), cw = sz * 0.66;
    let x = W / 2 - (T.length * cw) / 2;
    eblock(c, x - 30, 330, T.length * cw + 60, 26, { shade: 0.6, step: 3 });
    l.words.forEach((w) => { const tx = clean(w.w).toUpperCase(); for (let j = 0; j < tx.length; j++) { const tj = w.start + (j / Math.max(1, tx.length)) * Math.max(0.12, w.end - w.start), k = prog(t, tj - 0.04, tj + 0.12, ease.outBack); if (k > 0) { const y = 330 - sz * 1.2 - 300 * (1 - Math.min(1, k)); eblock(c, x + 2, y, cw - 4, sz * 1.2, { shade: 0.45, step: 3, fill: mix('ink2', 'graphite', 0.4) }); setFont(c, fam, sz * 0.86); c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = mix('bone', 'signal', heat(w, t)); c.fillText(tx[j]!, x + cw / 2, y + sz * 0.62); } x += cw; } x += cw; });
  }
  let slamK = 0; L.forEach((_, n) => { const d = t - pressT(n); if (d > -0.05 && d < 0.3) slamK = Math.max(slamK, Math.sin(clamp((d + 0.05) / 0.35) * Math.PI)); });
  eblock(c, 360, lerp(-260, 200, slamK), 1200, 140, { shade: 0.35, step: 6, fill: mix('ink2', 'blood', 0.2 + 0.3 * slamK) });
  rule(c, 960, -400, 960, lerp(-260, 200, slamK), 1, col('bone', 0.8), 22);
  if (slamK > 0.85) { s.post.shake = [noise1(t * 80, 1) * 10, noise1(t * 80, 2) * 10]; g.fillStyle = col('ember', 0.4); g.fillRect(360, 330, 1200, 40); }
  const rw: string = sh.o.runWord ?? txt(lastW(LZ));
  if (run > 0) for (let n = 0; n < 14; n++) { const u = (t - lastW(LZ).start) * 1.6 - n * 0.12; if (u < 0 || u > 1.4) continue; c.save(); c.translate(lerp(W / 2, W + 300, u) - 200, lerp(560, -200 + (n % 4) * 120, u)); c.rotate(u * 2 + n); sheet(c, -150, -100, 300, 200, 1, 0); setFont(c, A(125, 900), Math.min(70, (240 / Math.max(3, rw.length)) * 1.6)); c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = col('blood', 1); c.fillText(rw, 0, 6); c.restore(); }
  mono(c, sh.o.label ?? '', W - 170, 80, 1, 20, 'signal', 'right');
}

// ================================================================== pixels
const MASKS: Record<string, Uint8Array> = {};
function wordMask(text: string, cols: number, rows: number) {
  const key = `${text}|${cols}|${rows}`; if (MASKS[key]) return MASKS[key]!;
  const cv = document.createElement('canvas'); cv.width = cols; cv.height = rows; const x = cv.getContext('2d')!;
  const fam = A(62, 900); let sz = rows * 1.15; setFont(x, fam, sz); while (x.measureText(text).width > cols * 0.94 && sz > 4) { sz -= 1; setFont(x, fam, sz); }
  x.fillStyle = '#fff'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(text, cols / 2, rows / 2 + sz * 0.04);
  const d = x.getImageData(0, 0, cols, rows).data, m = new Uint8Array(cols * rows); for (let n = 0; n < cols * rows; n++) m[n] = d[n * 4]! > 110 ? 1 : 0;
  return (MASKS[key] = m);
}
function pixels(s: S) {
  const { t, sh, c, g } = s;
  const L = sh.lines as Line[], l1 = L[0]!, l2 = L.length > 2 ? L[1] : undefined, l3 = L.length > 1 ? L[L.length - 1] : undefined;
  s.bg.grid = 0; s.bg.glow = 0.22; s.bg.stars = 0.3;
  const k2 = l2 ? prog(t, l2.start - 0.2, l2.start + 0.35, ease.outExpo) : 0, k3 = l3 ? prog(t, l3.start - 0.2, l3.start + 0.6, ease.inOutCubic) : 0;
  const z = 4.2 * Math.pow(0.55 / 4.2, l2 ? k2 : k3) * Math.pow(0.26 / 0.55, k3);
  cam(s, { x: W / 2, y: lerp(H / 2 + 40, H / 2 + 120, Math.max(k2, k3)), z, r: 0 });
  const TW = 120, TH = 130, COLS = 61, ROWS = 31, cx = W / 2, cy = H / 2 + 120;
  const lit = l3 ? l3.words.reduce<Word | null>((m, w) => (t >= w.start - 0.05 ? w : m), null) : null;
  const mask = lit ? wordMask(clean(lit.w).toUpperCase(), COLS * 2, ROWS * 2) : null;
  for (let r = -15; r <= 15; r++) for (let q = -30; q <= 30; q++) {
    const dist = r === 0 && Math.abs(q) <= 4.5 ? (Math.abs(q) / 4.5) * 0.3 : 0.3 + (Math.hypot(q / 30, r / 15) / Math.SQRT2) * 0.7;
    const show = r === 0 && q === 0 ? 1 : r === 0 && q >= -4 && q <= 5 ? Math.max(k2, k3) : clamp((k3 * 1.15 - dist) * 6); if (show <= 0) continue;
    const x = cx + q * TW, y = cy + r * TH, sc = Math.min(1, show);
    c.fillStyle = mix('ink2', 'blood', 0.12 + 0.1 * hash(q, r)); c.fillRect(x - 46 * sc, y - 60 * sc, 92 * sc, 70 * sc);
    c.beginPath(); c.moveTo(x - 54 * sc, y - 58 * sc); c.lineTo(x, y - 100 * sc); c.lineTo(x + 54 * sc, y - 58 * sc); c.closePath(); c.fill();
    c.strokeStyle = col('bone', 0.55 * sc); c.lineWidth = 1.5; c.strokeRect(x - 46 * sc, y - 60 * sc, 92 * sc, 70 * sc);
    const open = r === 0 && q >= -4 && q <= 5 && l2 ? prog(t, l2.start + (q + 4) * 0.05, l2.start + 0.25 + (q + 4) * 0.05) : q === 0 && r === 0 ? prog(t, lastW(l1).start, lastW(l1).start + 0.3) : 0;
    c.fillStyle = open > 0 ? mix('ink', 'ember', open) : col('ink', 1); c.fillRect(x - 12 * sc, y - 28 * sc, 24 * sc, 38 * sc);
    for (let wy = 0; wy < 2; wy++) for (let wx = 0; wx < 2; wx++) {
      const on = mask ? mask[(r + 15) * 2 * (COLS * 2) + wy * COLS * 2 + (q + 30) * 2 + wx] === 1 : false;
      const px = x + (wx ? 14 : -34) * sc, py = y - (wy ? 34 : 54) * sc;
      c.fillStyle = on ? col('signal', 1) : col('ink', 0.9); c.fillRect(px, py, 20 * sc, 16 * sc);
      if (on) { g.fillStyle = col('signal', 0.6); g.fillRect(px - 4, py - 4, 28 * sc, 24 * sc); }
    }
  }
  const pa = 1 - Math.max(k2, k3); if (pa > 0.01) { eblock(c, cx - 190, cy - 230, 380, 90, { shade: 0.25, step: 4, fill: mix('blood', 'signal', 0.5) }); wrow(s, l1.words, cx, cy - 185, fitW(l1.words, 330, 44), { base: 'ink', hot: 'ink', alpha: pa }); }
  if (l2 && k2 > 0 && k3 < 0.5) wrow(s, l2.words, cx + 60, cy - 380, 170, { hot: 'signal', alpha: 1 - k3 * 2 });
}

// ================================================================== trajectory
const SHAPES = ['level', 'loop', 'dip', 'zig', 'steps', 'climb', 'curl', 'jitter'];
let TFP: { key: string; pts: { x: number; y: number }[]; acc: number[]; lineStart: number[] } | null = null;
function tfPath(L: Line[], size: number, shapes: string[]) {
  const key = L.map((l) => l.start).join(',') + shapes.join(); if (TFP?.key === key) return TFP;
  const pts: { x: number; y: number }[] = [{ x: 0, y: 0 }], lineStart: number[] = [];
  const add = (dx: number, dy: number) => { const p = pts[pts.length - 1]!; pts.push({ x: p.x + dx, y: p.y + dy }); };
  L.forEach((l, i) => {
    lineStart.push(pts.length - 1);
    const Ln = l.words.reduce((a, w) => a + measure(txt(w) + ' ', SMALLW.test(clean(w.w)) ? A(62, 300) : A(125, 900), SMALLW.test(clean(w.w)) ? size * 0.5 : size), 0) + 200;
    const N = 80, kind = shapes[i % shapes.length]!;
    for (let n = 1; n <= N; n++) {
      const u = n / N, d = Ln / N; let ang = 0;
      if (kind === 'level') ang = 0.12 * Math.sin(u * TAU * 2);
      if (kind === 'loop') ang = u > 0.45 && u < 0.95 ? -((u - 0.45) / 0.5) * TAU : 0;
      if (kind === 'dip') ang = u < 0.35 ? 0.05 : u < 0.55 ? 0.9 : u < 0.8 ? -0.75 : 0;
      if (kind === 'zig') ang = 0.5 * Math.sin(u * 30) * (1 - u);
      if (kind === 'steps') ang = Math.floor(u * 8) % 2 ? -1.2 : 0;
      if (kind === 'climb') ang = -0.28;
      if (kind === 'curl') ang = u > 0.6 ? -(u - 0.6) * 9 : 0.08;
      if (kind === 'jitter') ang = 0.6 * Math.sin(u * 70);
      add(Math.cos(ang) * d, Math.sin(ang) * d);
    }
  });
  lineStart.push(pts.length - 1);
  const acc = [0]; for (let n = 1; n < pts.length; n++) acc.push(acc[n - 1]! + Math.hypot(pts[n]!.x - pts[n - 1]!.x, pts[n]!.y - pts[n - 1]!.y));
  return (TFP = { key, pts, acc, lineStart });
}
function atLen(P: { pts: { x: number; y: number }[]; acc: number[] }, s0: number) {
  const a = P.acc; let lo = 0, hi = a.length - 1; s0 = clamp(s0, 0, a[hi]!);
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (a[m]! <= s0) lo = m; else hi = m; }
  const p0 = P.pts[lo]!, p1 = P.pts[hi]!, u = (s0 - a[lo]!) / Math.max(1e-6, a[hi]! - a[lo]!);
  return { x: lerp(p0.x, p1.x, u), y: lerp(p0.y, p1.y, u), ang: Math.atan2(p1.y - p0.y, p1.x - p0.x) };
}
function trajectory(s: S) {
  const { t, sh, c, g } = s;
  const L = sh.lines as Line[], shapes: string[] = sh.o.shapes ?? SHAPES, SZ = 96;
  s.bg.grid = 0.35; s.bg.glow = 0.22; s.bg.stars = 0.1;
  const P = tfPath(L, SZ, shapes), fam = A(125, 900), famS = A(62, 300);
  type GW = { w: Word; s0: number; s1: number; size: number; small: boolean };
  const gws: GW[] = [];
  L.forEach((l, i) => { let s0 = P.acc[P.lineStart[i]!]! + 100; for (const w of l.words) { const small = SMALLW.test(clean(w.w)), sz = small ? SZ * 0.5 : SZ, wd = measure(txt(w), small ? famS : fam, sz); gws.push({ w, s0, s1: s0 + wd, size: sz, small }); s0 += wd + SZ * 0.3; } });
  let sp = gws[0]!.s0 - 300;
  for (const q of gws) if (t >= q.w.start) sp = lerp(q.s0, q.s1, clamp((t - q.w.start) / Math.max(0.15, q.w.end - q.w.start)));
  if (t < gws[0]!.w.start) sp = lerp(gws[0]!.s0 - 600, gws[0]!.s0, prog(t, sh.start, gws[0]!.w.start, ease.inOutCubic));
  const head = atLen(P, sp);
  cam(s, { x: head.x - 380, y: head.y + 30, z: 0.72, r: -head.ang * 0.08 });
  c.strokeStyle = col('graphite', 0.7); c.lineWidth = 2; c.setLineDash([10, 12]); c.beginPath(); let started = false; for (let n = 0; n < P.pts.length; n++) { if (P.acc[n]! < sp) continue; const p = P.pts[n]!; if (started) c.lineTo(p.x, p.y); else c.moveTo(p.x, p.y); started = true; } c.stroke(); c.setLineDash([]);
  c.strokeStyle = col('bone', 0.85); c.lineWidth = 3; c.beginPath(); for (let n = 0; n < P.pts.length && P.acc[n]! <= sp; n++) { const p = P.pts[n]!; if (n) c.lineTo(p.x, p.y); else c.moveTo(p.x, p.y); } c.lineTo(head.x, head.y); c.stroke();
  for (const q of gws) {
    if (q.s0 > sp + 40) continue;
    const f = q.small ? famS : fam; let off = 0;
    for (const ch of txt(q.w)) {
      const cw = measure(ch, f, q.size), pos = q.s0 + off + cw / 2; off += cw; if (pos > sp + 10) break;
      const p = atLen(P, pos), nx = Math.sin(p.ang), ny = -Math.cos(p.ang), lift = 26 + q.size * CAP * 0.5, born = clamp((sp - pos) / 60), h = heat(q.w, t);
      c.save(); c.translate(p.x + nx * lift, p.y + ny * lift); c.rotate(p.ang); c.scale(lerp(1.5, 1, born), lerp(1.5, 1, born));
      setFont(c, f, q.size); c.textAlign = 'center'; c.textBaseline = 'alphabetic'; c.fillStyle = mix('bone', 'signal', h); c.fillText(ch, 0, (CAP * q.size) / 2); c.restore();
    }
  }
  L.forEach((l, i) => { const kind = shapes[i % shapes.length]; const end = atLen(P, P.acc[P.lineStart[i + 1]!]!), k = prog(t, lastW(l).start, lastW(l).start + 0.4, ease.outBack); if (kind === 'zig' && k > 0) { c.strokeStyle = col('signal', k); c.lineWidth = 4; c.beginPath(); c.arc(end.x, end.y, 90 * k, 0, TAU); c.stroke(); rule(c, end.x - 130, end.y, end.x + 130, end.y, k, col('signal', 1), 3); rule(c, end.x, end.y - 130, end.x, end.y + 130, k, col('signal', 1), 3); } });
  g.fillStyle = col('signal', 0.8); g.beginPath(); g.arc(head.x, head.y, 22, 0, TAU); g.fill(); c.fillStyle = col('bone', 1); c.beginPath(); c.arc(head.x, head.y, 7, 0, TAU); c.fill();
  flat(s); mono(c, sh.o.label ?? '', 140, 80, 1, 18, 'graphite');
}

// ================================================================== skywrite
let SKY: { key: string; st: StrokeText[] } | null = null;
function skywrite(s: S) {
  const { t, sh, c, g } = s;
  const L = sh.lines as Line[], i = cur(L, t), font: StrokeFontName = sh.o.font ?? 'readable';
  s.bg.grid = 0; s.bg.glow = 0.3; s.bg.stars = 0; s.bg.warm = 1.4; s.bg.gy = 0.2;
  const key = L.map((l) => l.text).join('|') + font;
  if (SKY?.key !== key) SKY = { key, st: L.map((l) => { const tx = l.words.map((w) => clean(w.w).toUpperCase()).join(' '), w0 = strokeText(tx, font, 150, 4).width; return strokeText(tx, font, Math.min(170, (150 * 1650) / w0), 4); }) };
  const LY = (n: number) => n * 300, cy = snapCam(t, [sh.start, ...L.map((l) => l.start - 0.25)], [{ x: 0, y: 60, z: 1, r: 0 }, ...L.map((_, n) => ({ x: 0, y: LY(n) + 60, z: 1, r: 0 }))], 0.7).y;
  cam(s, { x: W / 2, y: H / 2 + cy, z: 0.95, r: -0.02 });
  const sky = c.createLinearGradient(0, H / 2 + cy - 700, 0, H / 2 + cy + 700); sky.addColorStop(0, col('ink', 0)); sky.addColorStop(1, col('blood', 0.3)); c.fillStyle = sky; c.fillRect(-200, H / 2 + cy - 700, W + 400, 1400);
  L.forEach((l, n) => {
    const st = SKY!.st[n]!, x0 = W / 2 - st.width / 2, y0 = H / 2 + LY(n) + 60, ct: [number, number][] = [];
    l.words.forEach((w, wi) => { const tx = clean(w.w).toUpperCase(), dd = Math.max(0.15, (w.end - w.start) * 0.75); for (let j = 0; j < tx.length; j++) ct.push([w.start + (j / tx.length) * dd, w.start + ((j + 1) / tx.length) * dd]); if (wi < l.words.length - 1) ct.push([w.end, w.end]); });
    const span = Math.max(0.5, l.end - l.start), kq = (span - 0.35) / span, tq = t < l.start ? t : l.start + (t - l.start) / kq;
    const len = writtenLength(st, ct, tq); if (len <= 0) return;
    const drift = Math.min(1, Math.max(0, t - l.end) / 4);
    c.save(); c.translate(x0 + 30 * drift, y0 - 20 * drift); c.lineCap = 'round'; c.lineJoin = 'round';
    c.strokeStyle = col('bone', 0.18 * (1 - 0.4 * drift)); c.lineWidth = 26 + 30 * drift; drawStrokeText(c, st, len);
    c.strokeStyle = col('bone', 0.95 - 0.35 * drift); c.lineWidth = 13 + 4 * drift; const head = drawStrokeText(c, st, len); c.restore();
    if (head && n === i && len < st.total) { const hx = x0 + head.x, hy = y0 + head.y; c.save(); c.translate(hx, hy); c.rotate(head.angle); c.fillStyle = col('signal', 1); c.beginPath(); c.moveTo(34, 0); c.lineTo(-20, -8); c.lineTo(-20, 8); c.closePath(); c.fill(); c.restore(); g.fillStyle = col('signal', 0.5); g.beginPath(); g.arc(hx, hy, 30, 0, TAU); g.fill(); }
  });
  flat(s); mono(c, sh.o.label ?? '', 140, H - 70, 1, 18, 'ash');
}

// ================================================================== courses
function courses(s: S) {
  const { t, sh, c, g } = s;
  const L = sh.lines as Line[];
  s.bg.grid = 0; s.bg.glow = 0.25; s.bg.stars = 0.4;
  const CH = 190, BY = 900;
  const cy = snapCam(t, [sh.start, ...L.map((l) => l.start - 0.25)], [{ x: 0, y: 0, z: 1, r: 0 }, ...L.map((_, n) => ({ x: 0, y: -n * CH * 0.8, z: 1, r: 0 }))], 0.7).y;
  cam(s, { x: W / 2, y: H / 2 + cy - 80, z: 1, r: 0.01 * Math.sin(t * 0.7) });
  eblock(c, 160, BY, 1600, 80, { shade: 0.5, step: 5 });
  L.forEach((l, n) => {
    const k = prog(t, l.start - 0.35, l.start + 0.05, ease.outCubic); if (k <= 0) return;
    const w = 1500 - n * 140, x = W / 2 - w / 2, y = BY - (n + 1) * CH - 500 * (1 - k);
    engrave(c, rectP(x, y, w, CH - 10), [x, y, x + w, y + CH], (px, py) => 0.25 + 0.35 * ((py - y) / CH) + 0.15 * ((px - x) / w), { step: 6, angle: 0.02, fill: mix('ink2', 'graphite', 0.35), rim: 2 });
    const sz = fitW(l.words, w - 120, 110);
    wrow(s, l.words, W / 2 + 2, y + CH / 2 + 3, sz, { base: 'ink', hot: 'ink', alpha: 0.9 }); wrow(s, l.words, W / 2, y + CH / 2, sz, { base: 'bone', hot: 'signal' });
    for (const wd of l.words) { const d = t - wd.start; if (d > 0 && d < 0.25) for (let m = 0; m < 10; m++) { const a = hash(m, Math.floor(t * 30)) * TAU; g.fillStyle = col('ember', 0.8); g.fillRect(W / 2 + (hash(m, 9) - 0.5) * w * 0.6 + Math.cos(a) * 30, y + CH / 2 + Math.sin(a) * 30, 4, 4); } }
  });
  if (sh.o.years != null && L[sh.o.years] && t > L[sh.o.years]!.start) mono(c, `STANDS TO ${new Date().getFullYear() + Math.floor((t - L[sh.o.years]!.start) * 160)}`, W - 160, BY - (sh.o.years + 1) * CH - 20, 1, 22, 'signal', 'right');
  if (sh.o.cap) { const LZ = L[L.length - 1]!, k = prog(t, lastW(LZ).start, lastW(LZ).start + 0.4, ease.outBack); if (k > 0) { const y = BY - L.length * CH; c.fillStyle = mix('blood', 'signal', 0.5); c.beginPath(); c.moveTo(W / 2 - 300 * k, y); c.lineTo(W / 2 + 300 * k, y); c.lineTo(W / 2, y - 220 * k); c.closePath(); c.fill(); setFont(c, A(125, 900), 90 * k); c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = col('ink', 0.9); c.fillText(sh.o.cap, W / 2, y - 70 * k); g.fillStyle = col('signal', 0.5 * k); g.beginPath(); g.arc(W / 2, y - 80, 200, 0, TAU); g.fill(); } }
}

// ================================================================== ticket (shared by document + tickets)
function ticket(s: S, x: number, y: number, w: number, h: number, text: string, k: number, rot: number, hotK = 0, seq = 1, over = '') {
  const { c, g } = s; if (k <= 0) return;
  c.save(); c.translate(x + w / 2, y + h / 2 - (1 - k) * (h + 200)); c.rotate(rot); c.translate(-w / 2, -h / 2);
  const stub = w - 300;
  c.fillStyle = col('ink', 0.5); c.fillRect(14, 16, w, h);
  c.fillStyle = col('bone', 1); c.fillRect(0, 0, stub - 6, h); c.fillRect(stub + 6, 0, w - stub - 6, h);
  for (let yy = 14; yy < h; yy += 24) { c.fillStyle = col('ink', 0.3); c.beginPath(); c.arc(stub, yy, 4.5, 0, TAU); c.fill(); }
  c.fillStyle = col('blood', 1); c.fillRect(0, 0, stub - 6, 56);
  setFont(c, A(125, 900), 30); c.fillStyle = col('bone', 1); c.textAlign = 'left'; c.textBaseline = 'middle'; c.fillText(s.sh.o.header ?? 'TICKET', 30, 30);
  setFont(c, F.mono(600), 18); c.textAlign = 'right'; c.fillText(`${BRAND.titleA} ${BRAND.titleB}`, stub - 30, 30);
  mono(c, over, 30, 96, 1, 18, 'graphite');
  const fam = A(125, 900), sz = Math.min(h * 0.42, sizeFor(text, fam, stub - 90));
  setFont(c, fam, sz); c.textAlign = 'left'; c.textBaseline = 'alphabetic'; c.fillStyle = mix('ink', 'blood', hotK); c.fillText(text, 30, 110 + sz * CAP);
  for (let i = 0; i < 40; i++) { const wd = 2 + Math.floor(hash(i, seq + 4) * 6); c.fillStyle = col('ink', 0.9); c.fillRect(stub + 40 + i * 5.6, 90, wd * 0.6, h - 170); }
  mono(c, `SEQ ${String(seq).padStart(3, '0')}`, stub + 44, h - 30, 1, 16, 'ink');
  c.restore();
  if (hotK > 0.2) { g.fillStyle = col('signal', 0.12 * hotK); g.fillRect(x, y, w, h); }
}
const after = (l: Line, re: RegExp) => { const i = l.words.findIndex((w) => re.test(clean(w.w))); return i >= 0 ? l.words.slice(i + 1) : [lastW(l)]; };

// ================================================================== document
const HANDS: Record<string, StrokeText> = {};
function document_(s: S) {
  const { t, sh, c, g } = s;
  const L = sh.lines as Line[];
  s.bg.grid = 0; s.bg.glow = 0.2;
  const margin: number[] = sh.o.margin ?? [], strike: RegExp | null = sh.o.strike ?? null, tk: RegExp | null = sh.o.ticket ?? null;
  const PX = 200, PW = 1520, dy = 120, ys = L.map((_, i) => 330 + i * dy);
  cam(s, { x: W / 2, y: lerp(H / 2 + 40, H / 2 + Math.max(0, ys[ys.length - 1]! - 760), prog(t, L[0]!.start, L[L.length - 1]!.start, ease.inOutCubic)), z: 1.0, r: 0 });
  sheet(c, PX, 160, PW, Math.max(1000, ys[ys.length - 1]! + 380 - 160), 1, 0, 0);
  setFont(c, A(125, 900), 46); c.textAlign = 'left'; c.textBaseline = 'alphabetic'; c.fillStyle = col('ink', 1); c.fillText(sh.o.title ?? 'NOTES', PX + 70, 240);
  mono(c, sh.o.sub ?? '', PX + 70, 274, 1, 18, 'graphite'); rule(c, PX + 70, 290, PX + PW - 70, 290, 1, col('ink', 0.4), 2);
  const FS = 48, fam = F.mono(700);
  const typedLine = (ws: Word[], y: number, x = PX + 70) => { for (const w of ws) { const tx = clean(w.w).toUpperCase(), n = Math.floor(clamp((t - w.start + 0.03) / Math.max(0.1, (w.end - w.start) * 0.8)) * tx.length + (t >= w.start - 0.03 ? 1 : 0)); setFont(c, fam, FS); c.textAlign = 'left'; c.fillStyle = mix('ink', 'blood', heat(w, t)); c.fillText(tx.slice(0, Math.min(tx.length, n)), x, y); if (strike && strike.test(clean(w.w))) { const k = prog(t, w.end - 0.05, w.end + 0.3); if (k > 0) rule(c, x - 6, y - 16, x - 6 + (measure(tx, fam, FS) + 12) * k, y - 16, 1, col('signal', 1), 9); } x += measure(tx + ' ', fam, FS); } return x; };
  L.forEach((l, i) => {
    if (margin.includes(i)) {
      const tx = l.words.map((w) => clean(w.w).toUpperCase()).join(' '); const st = (HANDS[tx] ??= strokeText(tx, 'hscript', 110, 2)), ct: [number, number][] = [];
      l.words.forEach((w) => { const wt = clean(w.w).toUpperCase(), dd = Math.max(0.25, w.end - w.start); for (let j = 0; j < wt.length; j++) ct.push([w.start + (j / wt.length) * dd, w.start + ((j + 1) / wt.length) * dd]); ct.push([w.end, w.end]); });
      const len = writtenLength(st, ct, t); if (len <= 0) return; const ax = PX + PW - 140 - st.width;
      c.save(); c.translate(ax, ys[i]! + 20); c.rotate(-0.05); c.strokeStyle = col('signal', 1); c.lineWidth = 7; c.lineCap = 'round'; c.lineJoin = 'round'; const hd = drawStrokeText(c, st, len); c.restore();
      if (i > 0) rule(c, ax - 120, ys[i - 1]! - 8, ax - 20, ys[i]! - 10, prog(t, l.start - 0.1, l.start + 0.2), col('signal', 1), 4);
      if (hd) { g.fillStyle = col('signal', 0.4); g.beginPath(); g.arc(ax + hd.x, ys[i]! + 20 + hd.y, 18, 0, TAU); g.fill(); }
      return;
    }
    if (tk && i === L.length - 1) {
      const kw = after(l, tk), lead = l.words.filter((w) => !kw.includes(w)); typedLine(lead, ys[i]!);
      if (lead.length && t >= lastW({ ...l, words: lead } as Line).end - 0.05) { setFont(c, fam, FS); c.fillStyle = col('ink', 1); c.fillText(':', PX + 70 + measure(lead.map((w) => clean(w.w).toUpperCase() + ' ').join('').trimEnd(), fam, FS), ys[i]!); }
      ticket(s, PX + 120, ys[i]! + 40, 1280, 300, kw.map(txt).join(' '), prog(t, kw[0]!.start - 0.15, kw[0]!.start + 0.25, ease.outCubic), -0.03, heat(kw[0]!, t), 1, lead.map(txt).join(' '));
      return;
    }
    typedLine(l.words, ys[i]!);
  });
}

// ================================================================== tickets
function tickets(s: S) {
  const { t, sh } = s;
  const L = sh.lines as Line[], re: RegExp = sh.o.after ?? /^$/;
  s.bg.glow = 0.3; s.bg.grid = 0;
  const items = [...(sh.o.prior ? [{ text: sh.o.prior as string, k: 1, hot: 0, over: '' }] : []), ...L.map((l) => { const kw = sh.o.after ? after(l, re) : l.words; const lead = l.words.filter((w) => !kw.includes(w)); return { text: kw.map(txt).join(' '), k: prog(t, kw[0]!.start - 0.2, kw[0]!.start + 0.2, ease.outCubic), hot: heat(kw[0]!, t), over: lead.map(txt).join(' ') }; })];
  const n = items.length;
  cam(s, { x: W / 2, y: H / 2 + 60, z: 0.86 + 0.03 * prog(t, sh.start, sh.end), r: -0.02 });
  items.forEach((it, i) => ticket(s, W / 2 - 640 + (i - (n - 1) / 2) * 34, 120 + i * Math.min(205, 820 / n), 1280, 290, it.text, it.k, (i - (n - 1) / 2) * 0.025, it.hot, i + 1, it.over));
}

// ================================================================== detonate
function burst(s: S, cx: number, cy: number, age: number, n: number, seed: number, reach: number, fade: number) {
  const { c, g } = s; if (age < 0 || fade <= 0.01) return;
  const rnd = mulberry32(seed), grow = ease.outExpo(clamp(age / 1.4)), bone = new Path2D(), hot = new Path2D();
  for (let i = 0; i < n; i++) { const a = rnd() * TAU, sp = 0.2 + rnd() ** 2 * 1.4, r0 = rnd() * 40, len = 60 + rnd() * 380, isHot = rnd() < 0.3; const r1 = r0 + grow * sp * reach, tail = Math.max(r0, r1 - len * (0.3 + grow)), p = isHot ? hot : bone; p.moveTo(cx + Math.cos(a) * tail, cy + Math.sin(a) * tail); p.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1); }
  const fa = fade * (1 - grow * 0.4);
  c.lineCap = 'round'; c.strokeStyle = col('bone', 0.8 * fa); c.lineWidth = 1.2; c.stroke(bone); c.strokeStyle = col('ember', fa); c.lineWidth = 2; c.stroke(hot); g.strokeStyle = col('signal', 0.7 * fa); g.lineWidth = 5; g.stroke(hot);
}
function ring(s: S, cx: number, cy: number, ak: number, R0 = 1300) {
  if (ak < 0 || ak > 1.2) return; const { c, g } = s, R = ease.outCubic(ak / 1.2) * R0, a = 1 - ak / 1.2;
  c.strokeStyle = col('signal', a); c.lineWidth = 2.5 * a + 0.5; c.beginPath(); c.arc(cx, cy, R, 0, TAU); c.stroke();
  g.strokeStyle = col('signal', 0.6 * a); g.lineWidth = 14 * a; g.beginPath(); g.arc(cx, cy, R, 0, TAU); g.stroke();
}
function detonate(s: S) {
  const { t, sh, c, g, au } = s;
  const l = sh.lines[0]!, lw = lastW(l);
  const tD = sh.o.dropAt ?? au.timeOfBeat(Math.ceil(au.beatAt(lw.start + 0.2)));
  const END = sh.end, CL = Math.max(tD + 2, END - 0.9), TO = sh.o.to ?? { x: W / 2, y: H / 2 };
  const words: string[] = sh.o.words ?? (() => { const ws = l.words.filter((w) => !SMALLW.test(clean(w.w))).map(txt); return ws.length > 2 ? [ws.slice(0, -1).join(' '), ws[ws.length - 1]!] : ws; })();
  const fa = A(125, 900), fb = A(125, 300), sa = sizeFor(words[0]!, fa, 1500), sb = words[1] ? sizeFor(words[1], fb, 1400) : 0;
  const y1 = H / 2 - (sb * CAP) / 2 - 10, y2 = H / 2 + (sa * CAP) / 2 + 20;
  if (t < tD) {
    cam(s, { x: W / 2, y: H / 2, z: 1, r: 0 });
    const k = prog(t, lw.start + 0.05, tD, ease.inQuad);
    word(s, l.words[0]!, words[0]!, fa, sa, W / 2, words[1] ? y1 : H / 2, { color: col('bone', 1) });
    if (words[1]) word(s, lw, words[1], fb, sb, W / 2, y2, { hot: 'signal' });
    s.post.shake = [noise1(t * 60, 1) * 7 * k, noise1(t * 60, 2) * 7 * k]; s.post.zoom = 1 + 0.03 * k; s.bg.glow = 0.35 + 0.4 * k;
    return;
  }
  const age = t - tD, b0 = Math.round(au.beatAt(tD)), col1 = prog(t, CL, END - 0.1, ease.inCubic), bar = (b: number) => au.timeOfBeat(b);
  s.bg.grid = 0; s.bg.glow = lerp(0.6, 0.3, prog(age, 0, 2)); s.bg.stars = 0.3;
  applyCam(c, FLAT); applyCam(g, FLAT);
  const cx = lerp(W / 2, TO.x, col1), cy = lerp(H / 2, TO.y, col1), sc = Math.max(0.001, 1 - col1);
  c.save(); g.save(); for (const x of [c, g]) { x.translate(cx, cy); x.scale(sc, sc); x.translate(-W / 2, -H / 2); }
  burst(s, W / 2, H / 2, age, 2600, 99, 1400, 1 - prog(t, bar(b0 + 3.3), bar(b0 + 4)));
  for (let k = 0; k < 4; k++) ring(s, W / 2, H / 2, t - (k ? bar(b0 + k) : tD));
  for (let m = 1; m < 8; m++) { const tb = bar(b0 + 4 * m); if (tb > CL) break; burst(s, W / 2, H / 2, t - tb, 900, 99 + m, 1000, 1 - prog(t, tb + 1.2, tb + 2.2)); ring(s, W / 2, H / 2, t - tb, 1000); }
  const bk = pulse(t, au.timeOfBeat(Math.floor(au.beatAt(t))), 0.12), jit = Math.pow(0.5, age / 0.5), jx = Math.sin(t * 61) * 10 * jit, jy = Math.cos(t * 47) * 8 * jit, ws = 1 + 0.04 * bk;
  word(s, null, words[0]!, fa, sa * ws, W / 2 + jx, (words[1] ? y1 : H / 2) + jy, { color: col('bone', 1) });
  if (words[1]) word(s, null, words[1], fb, sb * ws, W / 2 + jx, y2 + jy, { color: col('signal', 1), glow: 1 });
  c.restore(); g.restore();
  s.post.flash = Math.pow(0.5, age / 0.045) * 1.2;
  s.post.shake = [Math.sin(t * 90) * 14 * Math.pow(0.5, age / 0.4), Math.cos(t * 77) * 14 * Math.pow(0.5, age / 0.4)];
  if (col1 > 0) { const k = col1 * col1; g.fillStyle = col('signal', 0.9 * k); g.beginPath(); g.arc(TO.x, TO.y, 10 + 70 * k, 0, TAU); g.fill(); c.fillStyle = col('bone', k); c.beginPath(); c.arc(TO.x, TO.y, 4 + 10 * k, 0, TAU); c.fill(); }
}

export const KINETIC: Record<string, (s: S) => void> = { signs, maptype, strips, press, pixels, trajectory, skywrite, courses, document: document_, tickets, detonate };
