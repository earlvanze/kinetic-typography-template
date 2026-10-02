"""Approximate line cues for a new take, so the forced aligner has windows to search.
Inputs: env LYRICS (../lyrics.txt: sung lines in order, [section] headers), env WHISPER (whisper.cpp -ojf word JSON).
Matches the lyric word sequence to Whisper's words (difflib, in order); each line's cue = its matched span; lines without
matches are interpolated between neighbours by word count. Cues only need to be within ~3 s (align.py refines them).
Writes env OUT (transcript.json) and prints a review of weakly matched lines (possibly not sung / sung differently)."""
import json, os, re, difflib
norm = lambda w: re.sub(r"[^a-z]", '', w.lower().replace('’', "'"))
lines, sec = [], ''
for raw in open(os.environ.get('LYRICS', '../lyrics.txt')):
    s = raw.strip()
    if not s or s.startswith('#'): continue
    if s.startswith('['): sec = s.strip('[]'); continue
    lines.append({'text': s, 'section': sec})
W = json.load(open(os.environ['WHISPER']))['transcription']
ww = [(norm(x['text']), x['offsets']['from'] / 1000, x['offsets']['to'] / 1000) for x in W if norm(x['text'])]
tw = [(li, norm(w)) for li, L in enumerate(lines) for w in L['text'].split() if norm(w)]
sm = difflib.SequenceMatcher(None, [t[1] for t in tw], [w[0] for w in ww], autojunk=False)
hits = {}
for a, b, n in sm.get_matching_blocks():
    for k in range(n): hits.setdefault(tw[a + k][0], []).append(ww[b + k])
nw = [len(L['text'].split()) for L in lines]
for li, L in enumerate(lines):
    h = hits.get(li, []); L['match'] = round(len(h) / max(1, nw[li]), 2)
    if h: L['start'], L['end'] = h[0][1], h[-1][2]
# interpolate unmatched lines (word-count weighted) between matched neighbours
known = [i for i, L in enumerate(lines) if 'start' in L]
dur = ww[-1][2] if ww else 180.0
for i, L in enumerate(lines):
    if 'start' in L: continue
    p = max([k for k in known if k < i], default=None); q = min([k for k in known if k > i], default=None)
    t0 = lines[p]['end'] if p is not None else 0.0; t1 = lines[q]['start'] if q is not None else dur
    a = sum(nw[(p + 1 if p is not None else 0):i]); b = sum(nw[(p + 1 if p is not None else 0):(q if q is not None else len(lines))])
    L['start'] = t0 + (t1 - t0) * a / max(1, b); L['end'] = t0 + (t1 - t0) * (a + nw[i]) / max(1, b); L['interpolated'] = True
for L in lines: L['start'] = round(L['start'], 2); L['end'] = round(max(L['end'], L['start'] + 0.3), 2)
json.dump(lines, open(os.environ.get('OUT', 'transcript.json'), 'w'), indent=1)
weak = [(i, L['text'], L['match']) for i, L in enumerate(lines) if L['match'] < 0.5]
print(f'autocue: {len(lines)} lines, whisper words {len(ww)}, weakly matched lines (<50% words): {len(weak)}')
for x in weak: print('   ', x)
