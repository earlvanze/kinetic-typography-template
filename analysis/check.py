import json, numpy as np, soundfile as sf
L = json.load(open('../data/lyrics.json'))['lines']
x, sr = sf.read('work/stems/htdemucs/master/vocals.wav'); x = x.mean(1)
hop = sr // 100
rms = np.sqrt(np.convolve(x**2, np.ones(hop*4)/(hop*4), 'same')[::hop]); rms /= np.percentile(rms, 99)
def e(a, b): return rms[int(a*100):max(int(a*100)+1, int(b*100))].mean()
bad = []
for l in L:
    s = l['start']; inside = e(s, s+0.35); before = e(s-0.5, s-0.1); during = e(s, l['end'])
    if during < 0.08 or inside < 0.06: bad.append((l['text'], s, round(before,2), round(inside,2), round(during,2)))
print('suspect lines:', len(bad)); [print(b) for b in bad]
for l in L[:8]: print(l['start'], l['end'], l['text'], [ (w['w'], w['start']) for w in l['words']])
print('vocal energy 0-16s (0.5s bins):', [round(e(i/2, i/2+0.5),2) for i in range(32)])
