// Project shots (EXTRA overrides LIBRARY by name). Build bespoke shots where the words BECOME the image: they slam, stack,
// burn, ride a path, become bricks/floors/roads… Use scenes/typeset.ts (row, ride, snapVal, band) and scenes/kit.ts.
// Rules: pure functions of s.t; words land on w.start; only signal/ember/acid on the glow layer; type >= 96 px from the edges.
import { W, H } from '../engine/gl';
import { A, sizeFor } from '../scenes/kit';
import { cam, slam, txt, word, type S } from '../scenes/shots';
import { row, findW, snapVal } from '../scenes/typeset';

/** Example: the line's key word slams huge, the rest of the line sets flush-left above it; the camera pushes on the key word. */
function keyword(s: S) {
  const { t, sh } = s;
  const l = sh.lines[0]!;
  const key = findW(l, new RegExp(sh.o.key ?? '.'));
  cam(s, { x: W / 2, y: H / 2, z: snapVal(t, [sh.start, key.start - 0.05], [1, 1.06], 0.4), r: 0 });
  row(s, l.words.filter((w) => w !== key), A(100, 700), 1100, 110, W / 2, 300, { align: 'l' });
  word(s, key, txt(key), A(125, 900), sizeFor(txt(key), A(125, 900), 1500), W / 2, 620, { sc: slam(key, t, 2.0) });
}

export const EXTRA: Record<string, (s: S) => void> = { keyword };
