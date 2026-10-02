// One timeline entry = one song section. The plate renders a shader background, then the active shot's
// typography into a Canvas2D layer plus an additive glow layer (so only gold blooms), and returns post.
import type * as THREE from 'three';
import { Scene, type Frame, type PostOverrides } from '../engine/scene';
import { FSPass, Layer2D } from '../engine/gl';
import { clamp, pulse } from '../engine/util';
import { LIBRARY, type Bg, type S, type Shot } from './shots';
import { EXTRA } from '../project/shots';
const SHOTS = { ...LIBRARY, ...EXTRA };
import { buildShots } from './director';
import { drawPlate } from './plates2d';
import { col } from './kit';
import { BRAND } from '../project/brand';

const BG = /* glsl */ `
uniform float t, paper, grid, glow, gx, gy, stars, kick, warm;
void main() {
  vec2 p = FRAG_PX;
  vec2 uv = vUv;
  // night ink with slow smoky depth
  float n = fbm(vec3(uv * vec2(3.2, 1.8), t * 0.03), 4);
  vec3 ink = mix(C_INK, C_INK2, 0.55 + 0.45 * n);
  ink += C_BLOOD * 0.05 * warm * (1.0 - uv.y);
  // floor perspective grid (architectural)
  float hor = 0.62;
  float gy2 = max(1e-3, (1.0 - uv.y) - (1.0 - hor));
  float depth = 0.12 / gy2;
  vec2 g = vec2((uv.x - 0.5) * depth * 6.0, depth * 4.0 - t * 0.35);
  vec2 gf = abs(fract(g) - 0.5);
  float gl = (1.0 - smoothstep(0.0, 0.03 * depth, min(gf.x, gf.y))) * smoothstep(hor, 0.0, uv.y) * step(uv.y, hor);
  ink += C_GRAPHITE * 0.22 * grid * gl * (1.0 - paper);
  // gold glow
  float d = length((uv - vec2(gx, gy)) * vec2(1.7778, 1.0));
  ink += C_SIGNAL * glow * (0.16 + 0.10 * kick) * exp(-d * 2.6);
  // stars
  vec2 sc = floor(p / 9.0);
  float h = hash12(sc);
  float tw = 0.5 + 0.5 * sin(t * (1.0 + h * 3.0) + h * 40.0);
  ink += C_BONE * stars * step(0.9975, h) * tw * 0.8 * smoothstep(0.75, 0.2, uv.y);
  // paper (blueprint sheets)
  vec3 pap = C_BONE * (0.94 + 0.04 * fbm(p * 0.02, 3)) - 0.015 * hash12(p);
  vec2 pg = abs(fract(p / 48.0) - 0.5) * 48.0;
  float pl = 1.0 - smoothstep(0.4, 1.4, min(pg.x, pg.y));
  vec2 pg2 = abs(fract(p / 240.0) - 0.5) * 240.0;
  float pl2 = 1.0 - smoothstep(0.6, 1.8, min(pg2.x, pg2.y));
  pap = mix(pap, C_GRAPHITE, 0.10 * pl + 0.18 * pl2);
  fragColor = vec4(mix(ink, pap, paper), 1.0);
}`;

export default class Plate extends Scene {
  bg = new FSPass(BG, {
    t: { value: 0 }, paper: { value: 0 }, grid: { value: 0 }, glow: { value: 0 }, gx: { value: 0.5 }, gy: { value: 0.5 },
    stars: { value: 0 }, kick: { value: 0 }, warm: { value: 0 },
  });
  L = new Layer2D();
  G = new Layer2D();
  shots: Shot[] = [];

  override init() {
    this.shots = buildShots(this.ctx.lyrics, this.ctx.audio, this.ctx.start, this.ctx.end);
  }

  render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, audio } = this.ctx;
    const t = f.t;
    let sh = this.shots[0]!;
    for (const x of this.shots) if (t >= x.start) sh = x;
    const bg: Bg = { paper: 0, grid: 0.6, glow: 0.35, gx: 0.5, gy: 0.45, stars: 0, warm: 0.5 };
    const post: PostOverrides = { hud: 0, grain: 0.06, vignette: 0.42, bloom: 0.5, bloomThreshold: 0.85, halation: 0.2, ca: 1.0 };
    this.L.clear(); this.G.clear();
    if (sh.o.wash) { // per-shot colour wash: [topKey, bottomKey, alpha] — varies the background between scenes
      const [ka, kb, al] = sh.o.wash as [string, string, number]; const cx = this.L.ctx;
      cx.setTransform(1, 0, 0, 1, 0, 0); const gr = cx.createLinearGradient(0, 0, 0, cx.canvas.height);
      gr.addColorStop(0, col(ka, al)); gr.addColorStop(1, col(kb, al)); cx.fillStyle = gr; cx.fillRect(0, 0, cx.canvas.width, cx.canvas.height);
    }
    const s: S = { c: this.L.ctx, g: this.G.ctx, t, lt: t - sh.start, sh, au: audio, post, bg, paper: false };
    if (sh.o.bg) Object.assign(bg, sh.o.bg); // per-shot background overrides (e.g. { paper: 1 } or a warmer dawn)
    s.paper = sh.kind === 'blueprint' || bg.paper >= 0.5;
    if (s.paper) { bg.paper = 1; }
    drawPlate(s); // the shot's graphic idiom (guilloché, ledger, blueprint, scope...) behind it
    SHOTS[sh.kind]?.(s);
    const u = this.bg.u;
    u.t!.value = t; u.paper!.value = bg.paper; u.grid!.value = bg.grid; u.glow!.value = bg.glow; u.gx!.value = bg.gx; u.gy!.value = bg.gy;
    u.stars!.value = bg.stars; u.warm!.value = bg.warm; u.kick!.value = clamp(f.a.kick);
    this.bg.render(renderer, out);
    comp.draw(renderer, this.L.upload(), out);
    if (!s.paper) comp.draw(renderer, this.G.upload(), out, { mode: 'add', tint: ((BRAND as any).glowTint ?? [1.15, 0.85, 0.5]) as [number, number, number] });
    // a hair of zoom on kicks keeps everything breathing with the drums
    post.zoom = (post.zoom ?? 1) * (1 + 0.006 * f.a.kick + 0.02 * pulse(t, sh.start, 0.08));
    return post;
  }
}
