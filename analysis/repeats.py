"""Find where repeated sections start by audio self-similarity (chroma + onset envelope of the full mix): a template
section (e.g. chorus 1 from t0 for dur s) is slid over a search range; the best lag = where the repeat begins."""
import sys, json, numpy as np, librosa, soundfile as sf
D = sys.argv[1]
y, sr = sf.read('work/master.wav'); y = y.mean(1).astype(np.float32)
hop = 512; fps = sr / hop
C = librosa.feature.chroma_cqt(y=y, sr=sr, hop_length=hop); C = C / (np.linalg.norm(C, axis=0, keepdims=True) + 1e-9)
O = librosa.onset.onset_strength(y=y, sr=sr, hop_length=hop); O = (O - O.mean()) / (O.std() + 1e-9)
def find(t0, dur, a, b):
    i0, n = int(t0 * fps), int(dur * fps)
    T, To = C[:, i0:i0 + n], O[i0:i0 + n]
    best = []
    for j in range(int(a * fps), int(b * fps) - n):
        sc = float((T * C[:, j:j + n]).sum() / n) + 0.15 * float(np.dot(To, O[j:j + n]) / n)
        best.append((sc, j / fps))
    best.sort(reverse=True)
    out = []
    for sc, t in best:
        if all(abs(t - u) > 2 for _, u in out): out.append((round(sc, 3), round(t, 2)))
        if len(out) == 3: break
    return out
for name, t0, dur, a, b in [(a, float(x), float(y_), float(p), float(q)) for a, x, y_, p, q in (s.split(':') for s in sys.argv[2:])]:
    print(f'{name}: template {t0}+{dur}s  best starts in [{a},{b}]: {find(t0, dur, a, b)}')
