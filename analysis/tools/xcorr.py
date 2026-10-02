"""Place a badly timed line using a reliably timed SIBLING (the same lyric sung elsewhere, e.g. another chorus): correlate
the vocal-stem envelope of the sibling's span against the target region and report the best start. Then pin the target with a
{"line": T, "template": S, "start": <best>} entry in <take>/timing-fixes.json (applied by fix_timing.py). Confirm with verify_fa.py.
usage: uv run python tools/xcorr.py --pair 54:38 [--pair 21:58 ...] [--search 1.5]
"""
import argparse, json, numpy as np, soundfile as sf
ap = argparse.ArgumentParser(); ap.add_argument('--pair', action='append', required=True); ap.add_argument('--search', type=float, default=1.5)
ap.add_argument('--vocals', default='work/stems/htdemucs/master/vocals.wav'); ap.add_argument('--lyrics', default='../data/lyrics.json')
a = ap.parse_args()
y, sr = sf.read(a.vocals); y = y.mean(1) if y.ndim > 1 else y
hop = sr // 100; env = np.log1p(np.sqrt(np.convolve(y ** 2, np.ones(hop) / hop, 'same')[::hop]) * 50)
L = json.load(open(a.lyrics))['lines']
seg = lambda t0, t1: env[int(t0 * 100):int(t1 * 100)]
for pr in a.pair:
    tgt, src = map(int, pr.split(':'))
    S = L[src]; s0 = S['words'][0]['start']; tpl = seg(s0 - 0.3, S['end'] + 0.3); tpl = (tpl - tpl.mean()) / (tpl.std() + 1e-9)
    guess = L[tgt]['start']; best = (-9, guess)
    for off in np.arange(-a.search, a.search, 0.01):
        w = seg(guess + off - 0.3, guess + off - 0.3 + len(tpl) / 100)
        if len(w) != len(tpl): continue
        r = float((((w - w.mean()) / (w.std() + 1e-9)) * tpl).mean())
        if r > best[0]: best = (r, guess + off)
    print(f'line {tgt} (from sibling {src}): current {guess:.2f} -> best start {best[1]:.2f}  (r = {best[0]:.2f}; > 0.7 is a confident match)')
