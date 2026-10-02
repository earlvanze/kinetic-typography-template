"""Beat grid, sections, envelopes and onsets for data/audio.json (engine schema, see app/src/engine/audio.ts)."""
import json, os, numpy as np, soundfile as sf, librosa, scipy.signal as ss
D = 'work/stems/htdemucs/master/'
mix, sr = sf.read('work/master.wav'); mix = mix.mean(1)
stem = {k: sf.read(D + k + '.wav')[0].mean(1) for k in ['vocals', 'drums', 'bass', 'other']}
dur = len(mix) / sr
FPS = 100; hop = sr // FPS

def env(x, win=0.046):
    n = int(win * sr)
    r = np.sqrt(np.convolve(x**2, np.ones(n) / n, 'same')[::hop])
    out = np.zeros_like(r); a, rl = np.exp(-1 / (0.010 * FPS)), np.exp(-1 / (0.090 * FPS)); v = 0
    for i, s in enumerate(r):
        v = a * v + (1 - a) * s if s > v else rl * v + (1 - rl) * s; out[i] = v
    return np.clip(out / (np.percentile(out, 99) + 1e-9), 0, 1)

def band(x, lo, hi):
    if lo and hi: b = ss.butter(4, [lo, hi], 'band', fs=sr, output='sos')
    elif lo: b = ss.butter(4, lo, 'high', fs=sr, output='sos')
    else: b = ss.butter(4, hi, 'low', fs=sr, output='sos')
    return ss.sosfiltfilt(b, x)

feat = {'rms': env(mix), 'low': env(band(mix, None, 150)), 'mid': env(band(mix, 150, 2000)), 'high': env(band(mix, 4000, None)),
        'vocal': env(stem['vocals']), 'drums': env(stem['drums']), 'bass': env(stem['bass']), 'other': env(stem['other'])}

# tempo: librosa beat track on drums+mix onset envelope, then fit a constant grid
oenv = librosa.onset.onset_strength(y=stem['drums'] + 0.5 * mix, sr=sr, hop_length=hop)
# Suno tempo drifts (~102-107 BPM) and the master joins two performances: use the dynamic tracker's beats
tempo, beats = librosa.beat.beat_track(onset_envelope=oenv, sr=sr, hop_length=hop, units='time', tightness=400, start_bpm=104)
grid = np.array(beats)
period = float(np.median(np.diff(grid)))
# extrapolate the grid over the drum-less head and tail
head = np.arange(grid[0] - period, -1e-6, -period)[::-1]; tail = np.arange(grid[-1] + period, dur, period)
grid = np.concatenate([head, grid, tail]); b0 = grid[0]
pk = librosa.onset.onset_detect(onset_envelope=oenv, sr=sr, hop_length=hop, units='time')
resid = np.array([np.min(np.abs(pk - x)) for x in beats])

# kick onsets (low band of drums) to pick downbeat phase: beat class (mod 4) with strongest low-band energy at
# section starts is ambiguous; use the vocal phrase starts (lines start near downbeats) + kick strength
def onsets(x, lo, hi, delta):
    e = librosa.onset.onset_strength(y=band(x, lo, hi), sr=sr, hop_length=hop)
    pk = librosa.util.peak_pick(e, pre_max=3, post_max=3, pre_avg=10, post_avg=10, delta=delta, wait=6)
    s = e[pk] / (np.percentile(e[pk], 95) + 1e-9) if len(pk) else []
    return [[round(p / FPS, 3), round(float(min(1, v)), 3)] for p, v in zip(pk, s)]
kick = onsets(stem['drums'], None, 120, 0.4); snare = onsets(stem['drums'], 1500, 5000, 0.4); hat = onsets(stem['drums'], 7000, None, 0.3)
voc = onsets(stem['vocals'], 150, 5000, 0.3)
L = json.load(open('../data/lyrics.json'))['lines']
starts = np.array([l['start'] for l in L])
best = None
for ph in range(4):
    db = grid[ph::4]
    # how many lines start within a beat before a downbeat (pickups) or on it
    d = np.min(np.abs(starts[:, None] - db[None, :]), 1)
    k = np.array([k_[0] for k_ in kick]); kd = np.min(np.abs(db[:, None] - k[None, :]), 1) if len(k) else np.ones(len(db))
    score = np.mean(d < 0.12) + 0.5 * np.mean(kd < 0.05)
    if best is None or score > best[0]: best = (score, ph)
downbeats = grid[best[1]::4]

# sections: env SECTIONS='name:first line text[:nth],...' (optional); otherwise one section per 30 s of song
secs = []
spec = [x for x in os.environ.get('SECTIONS', '').split(',') if x]
for item in spec:
    parts = item.split(':'); name, q = parts[0], parts[1]; n = int(parts[2]) if len(parts) > 2 else 0
    m = [l for l in L if l['text'].lower().startswith(q.lower())]
    if len(m) > n:
        st = m[n]['start']; secs.append({'name': name, 'start': round(float(downbeats[np.argmin(np.abs(downbeats - st))]), 3)})
if not secs: secs = [{'name': f'part{i}', 'start': float(x)} for i, x in enumerate(np.arange(0, dur, 30.0))]
secs[0]['start'] = 0.0
for a, b in zip(secs, secs[1:] + [{'start': dur}]): a['end'] = round(b['start'], 3)

out = {'duration': round(dur, 3), 'bpm': round(60 / period, 3), 'beat_period': round(period, 5), 'time_signature': 4,
       'beats': [round(float(b), 3) for b in grid], 'downbeats': [round(float(b), 3) for b in downbeats], 'sections': secs, 'fps': FPS,
       'features': {k: [round(float(v), 3) for v in a] for k, a in feat.items()},
       'onsets': {'kick': kick, 'snare': snare, 'hat': hat, 'vocal': voc},
       'notes': f'librosa dynamic beat tracking on drums+0.3*mix onset envelope (median period {period:.5f}s, beat-to-onset residual p90 {np.percentile(np.abs(resid),90)*1000:.0f} ms), grid extrapolated over the head and tail. Downbeat phase chosen by lyric line starts and kick alignment. Envelopes 100 fps, 46 ms RMS, 10/90 ms attack/release, normalized to 99th pct. Stems: htdemucs.'}
json.dump(out, open('../data/audio.json', 'w'))
print('bpm', 60 / period, 'b0', b0, 'resid p50/p90 ms', np.percentile(np.abs(resid), 50) * 1000, np.percentile(np.abs(resid), 90) * 1000, 'phase', best)
print(secs); print('kicks', len(kick), 'snares', len(snare), 'hats', len(hat), 'vocal', len(voc))
