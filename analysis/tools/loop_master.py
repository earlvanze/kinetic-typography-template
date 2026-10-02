"""Make a seamless LOOP master: trim the master at a beat at/after --start and at the beat nearest --end that has the SAME
position in the bar (so the meter carries across the seam), with short fades; then shift data/lyrics.json by -start and drop
lines past the end. Re-run analyze.py afterwards (beats/envelopes) and make the shot script end on frame 0's composition.
usage: uv run python tools/loop_master.py --master ../master.wav --start 14 --end 146 --out ../master-loop.wav
"""
import argparse, json, subprocess
ap = argparse.ArgumentParser(); ap.add_argument('--master', required=True); ap.add_argument('--start', type=float, default=0); ap.add_argument('--end', type=float, required=True)
ap.add_argument('--out', required=True); ap.add_argument('--audio', default='../data/audio.json'); ap.add_argument('--lyrics', default='../data/lyrics.json')
a = ap.parse_args()
au = json.load(open(a.audio)); beats, downs = au['beats'], au['downbeats']
phase = lambda b: min(range(4), key=lambda k: min(abs(b - d - k * (beats[1] - beats[0])) for d in downs))
s0 = next(b for b in beats if b >= a.start - 1e-6); ph = phase(s0)
cands = [b for b in beats if phase(b) == ph]
e0 = min(cands, key=lambda b: abs(b - a.end))
print(f'start beat {s0:.3f} (beat {ph + 1} of its bar) -> end beat {e0:.3f}; loop length {e0 - s0:.3f} s')
subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', a.master, '-af', f'atrim={s0}:{e0},asetpts=N/SR/TB,afade=t=in:d=0.01,afade=t=out:st={e0 - s0 - 0.12}:d=0.12', '-c:a', 'pcm_s24le', a.out], check=True)
d = json.load(open(a.lyrics)); out = []
for l in d['lines']:
    if l['start'] - s0 >= e0 - s0 - 0.2: continue
    l = dict(l); l['words'] = [dict(w, start=round(w['start'] - s0, 3), end=round(min(w['end'], e0) - s0, 3)) for w in l['words']]
    l['start'] = l['words'][0]['start']; l['end'] = l['words'][-1]['end']; out.append(l)
d['lines'] = out; json.dump(d, open(a.lyrics, 'w'), indent=1)
print(f'lyrics shifted by -{s0:.3f} s: {len(out)} lines kept. Now: echo $(realpath {a.out}) > work/MASTER, regenerate work/master.wav + stems, rerun analyze.py')
