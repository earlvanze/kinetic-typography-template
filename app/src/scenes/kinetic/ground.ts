// GROUND TYPE: words painted on the ground plane in true perspective (sliced into strips, each an exact affine
// of the perspective map), that flip up to stand on their sung word and lie back down after the line. The camera is a
// vehicle on that plane (rolling along a track, then climbing). Kinetic because the type IS the world the
// camera travels through: lines rush toward the lens, stand up as they are sung, pass under.
import { W, H } from '../../engine/gl';
import type { Word } from '../../engine/lyrics';
import { clamp, ease, prog, springStep } from '../../engine/util';
import { A, col, heat, mix, setFont, CAP } from '../kit';
import { measure } from '../../engine/type';
import { txt, type S } from '../shots';

export interface GCam { x: number; z: number; h: number; y0: number; f: number; roll: number }
/** Project a world point (X lateral m, Z forward m, Y up m) to the screen. null if behind the camera. */
export function gp(k: GCam, X: number, Z: number, Y = 0): { x: number; y: number; d: number } | null {
  const d = Z - k.z; if (d < 0.5) return null;
  const x = (k.f * (X - k.x)) / d, y = (k.f * (k.h - Y)) / d;
  const cr = Math.cos(k.roll), sr = Math.sin(k.roll);
  return { x: W / 2 + x * cr - y * sr, y: k.y0 + x * sr + y * cr, d };
}
/** A world-space polyline/polygon on the ground. */
export function gpath(c: CanvasRenderingContext2D, k: GCam, pts: [number, number][], close = false) {
  let started = false; c.beginPath();
  for (const [X, Z] of pts) { const p = gp(k, X, Z); if (!p) { started = false; continue; } if (!started) { c.moveTo(p.x, p.y); started = true; } else c.lineTo(p.x, p.y); }
  if (close) c.closePath();
}
/**
 * One word on the ground: centred at (X, Z), letters `Hm` metres tall (along the ground when flat), standing up by `up`
 * (0 flat → 1 vertical, facing the camera). `fill` colour; strips = perspective slices.
 */
export function gword(s: S, k: GCam, text: string, X: number, Z: number, Hm: number, up: number, fill: string, o: { fam?: string; strips?: number; glow?: number; widthM?: number } = {}) {
  const { c, g } = s;
  const fam = o.fam ?? A(125, 900), S0 = 200, wpx = measure(text, fam, S0), cap = CAP * S0;
  const mpp = (o.widthM ?? (Hm * wpx) / cap) / wpx; // metres per local px (x)
  const th = (Math.PI / 2) * clamp(up), N = o.strips ?? 10;
  const world = (lx: number, v: number) => gp(k, X + (lx - wpx / 2) * mpp, Z + v * Hm * Math.cos(th), v * Hm * Math.sin(th));
  for (const ctx of o.glow ? [c, g] : [c]) {
    ctx.save(); setFont(ctx, fam, S0); ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = ctx === g ? col('signal', 0.5 * (o.glow ?? 0)) : fill;
    for (let j = 0; j < N; j++) {
      const v0 = j / N, v1 = (j + 1) / N;
      const p00 = world(0, v0), p10 = world(wpx, v0), p01 = world(0, v1);
      if (!p00 || !p10 || !p01) continue;
      // local (lx, ly): ly = -v·cap (baseline at 0, cap top at -cap). Affine from local → screen through three points.
      const ax = (p10.x - p00.x) / wpx, ay = (p10.y - p00.y) / wpx, bx = (p01.x - p00.x) / (-(v1 - v0) * cap), by = (p01.y - p00.y) / (-(v1 - v0) * cap);
      if (!isFinite(ax + ay + bx + by)) continue;
      ctx.save(); ctx.setTransform(ax, ay, bx, by, p00.x - bx * (-v0 * cap), p00.y - by * (-v0 * cap));
      ctx.beginPath(); ctx.rect(-10, -v1 * cap - (j === N - 1 ? 60 : 0.6), wpx + 20, (v1 - v0) * cap + (j === 0 ? 50 : 1.2) + (j === N - 1 ? 60 : 0)); ctx.clip();
      ctx.fillText(text, 0, 0); ctx.restore();
    }
    ctx.restore();
  }
}
/** A lyric line laid across the ground at depth Z (centred on X), each word standing up on its start. */
export function gline(s: S, k: GCam, ws: Word[], X: number, Z: number, Hm: number, widthM: number, o: { stand?: (w: Word, i: number) => number; base?: string; gap?: number; fam?: string } = {}) {
  const { t } = s; const fam = o.fam ?? A(125, 900), gapEm = o.gap ?? 0.3;
  const wpx = ws.map((w) => measure(txt(w), fam, 200)), tot = wpx.reduce((a, b) => a + b, 0) + gapEm * 200 * (ws.length - 1), mpp = widthM / tot;
  let x = X - widthM / 2;
  ws.forEach((w, i) => {
    const wm = wpx[i]! * mpp, up = o.stand ? o.stand(w, i) : clamp(springStep(Math.max(0, t - w.start + 0.05), 3.2, 0.55)), h = heat(w, t);
    const fill = t < w.start - 0.06 ? col(o.base ?? 'bone', 0.35) : mix((o.base ?? 'bone') as any, 'signal', h);
    gword(s, k, txt(w), x + wm / 2, Z, Hm, up, fill, { widthM: wm, glow: h * up, fam });
    x += wm + gapEm * 200 * mpp;
  });
}
export const easeIO = ease.inOutCubic;
export { prog };
