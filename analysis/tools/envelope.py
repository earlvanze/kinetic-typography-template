"""Print the vocal-stem energy as bars (0.1 s or --step) between two times: the quickest way to see where a word really
starts, whether a note is held, or where the vocal ends (loop points, outros).
usage: uv run python tools/envelope.py 50.5 58.6 [--step 0.1] [--stem work/stems/htdemucs/master/vocals.wav]
"""
import argparse, numpy as np, soundfile as sf
ap = argparse.ArgumentParser(); ap.add_argument('a', type=float); ap.add_argument('b', type=float); ap.add_argument('--step', type=float, default=0.1)
ap.add_argument('--stem', default='work/stems/htdemucs/master/vocals.wav'); a = ap.parse_args()
y, sr = sf.read(a.stem); y = y.mean(1) if y.ndim > 1 else y
for t in np.arange(a.a, a.b, a.step):
    s = y[int(t * sr):int((t + a.step) * sr)]; r = np.sqrt((s ** 2).mean()) if len(s) else 0
    print(f'{t:7.2f} {"#" * int(r * 300)}')
