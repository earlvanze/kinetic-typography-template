"""Pass 2 (per take): breath-snapped re-alignment (see the comment block below); BREATH=0 keeps pass-1 timing. Also marks lines listed in the take's absent.txt
(0-based line indices the take does not sing): they keep their slot (the shot script is keyed by line order) but get
`absent: true` and zero-length timing, and the director hides them.
Env: TAKE (candidate dir). Reads ../data/lyrics.json + TAKE/transcript.json (autocue spans); rewrites ../data/lyrics.json."""
import json, os, re
import numpy as np, torch, torchaudio

D = os.environ['TAKE']
J = json.load(open('../data/lyrics.json')); lines = J['lines']
cues = json.load(open(f'{D}/transcript.json'))
absent = set(int(x) for x in open(f'{D}/absent.txt').read().split()) if os.path.exists(f'{D}/absent.txt') else set()
wav, sr = torchaudio.load(f'{D}/vocals.wav'); wav = wav.mean(0, keepdim=True)
B = torchaudio.pipelines.MMS_FA; model = B.get_model(with_star=True).eval(); dic = B.get_dict(star='*'); SR = B.sample_rate
wav = torchaudio.functional.resample(wav, sr, SR); DUR = wav.shape[1] / SR
norm = lambda w: re.sub(r"[^a-z]", '', w.lower().replace('’', "'")) or 'a'


def ctc(words, t0, t1):
    t0, t1 = max(0.0, t0), min(DUR, t1)
    seg = wav[:, int(t0 * SR):int(t1 * SR)]
    with torch.inference_mode():
        em, _ = model(seg)
    em = torch.log_softmax(em, -1)
    toks = [[dic[c] for c in norm(w)] for w in words]
    flat = torch.tensor([[dic['*']] + [t for tk in toks for t in tk] + [dic['*']]], dtype=torch.int32)
    ali, sc = torchaudio.functional.forced_align(em, flat, blank=0)
    sp = [x for x in torchaudio.functional.merge_tokens(ali[0], sc[0].exp()) if x.token != dic['*']]
    r = seg.shape[1] / em.shape[1] / SR
    out, k = [], 0
    for w, tk in zip(words, toks):
        s_ = sp[k:k + len(tk)]; k += len(tk)
        out.append({'w': w, 'start': round(t0 + s_[0].start * r, 3), 'end': round(t0 + s_[-1].end * r, 3),
                    'conf': round(float(np.mean([x.score for x in s_])), 3)})
    return out


# every present line is re-aligned on its own, in order: window = its Whisper span +/-1.0 s, but never starting
# before the previous line's aligned end (monotonic by construction). Lines without a Whisper match keep pass 1.
# Breath-snapped re-alignment. Whisper locates lines to ~1-2 s but its word times score at chance against vocal onsets;
# pass 1 (chunked CTC) has good word edges but can shift whole chunks by 1-5 s. Singers breathe between lines, so each
# boundary between consecutive lines is snapped to the deepest vocal-energy dip between the two estimates (pass-1 gap and
# Whisper gap, +/-1.2 s, preferring dips near the Whisper gap), then every line is CTC-aligned alone inside its own
# breath-bounded window. Lines without a Whisper cue use the pass-1 gap only.
import soundfile as sf
vx, vsr = sf.read(f'{D}/vocals.wav'); vx = vx.mean(1) if vx.ndim > 1 else vx
hop = vsr // 100; n80 = 8
env = np.sqrt(np.convolve(vx ** 2, np.ones(hop) / hop, 'same')[::hop]); env = np.convolve(env, np.ones(n80) / n80, 'same')
env = env / (np.percentile(env, 99) + 1e-9)
pres = [i for i in range(len(lines)) if i not in absent]
def gap(i, j, src):
    if src == 'p1': return (lines[i]['end'] + lines[j]['start']) / 2
    ci, cj = cues[i], cues[j]
    if ci.get('interpolated') or cj.get('interpolated') or min(ci.get('match', 0), cj.get('match', 0)) < 0.5: return None
    return (ci['end'] + cj['start']) / 2
bounds, snapped = {}, []
for i, j in zip(pres, pres[1:]):
    g1, g2 = gap(i, j, 'p1'), gap(i, j, 'wh')
    if g2 is not None and abs(g1 - g2) > 2.5: g1 = g2  # pass 1 has drifted here: search near Whisper only
    lo, hi = (min(g1, g2) - 1.2, max(g1, g2) + 1.2) if g2 is not None else (g1 - 1.2, g1 + 1.2)
    ref = g2 if g2 is not None else g1
    ks = np.arange(max(0, int(lo * 100)), min(len(env) - 1, int(hi * 100)))
    k = ks[np.argmin(env[ks] + 0.08 * np.abs(ks / 100 - ref))]
    bounds[(i, j)] = k / 100; snapped.append((i, round(g1, 2), None if g2 is None else round(g2, 2), round(k / 100, 2), round(float(env[k]), 3)))
# Inside each breath-bounded window: trim to the sung span (vocal energy > 0.12), spread word starts by syllable count,
# then snap each start to the nearest vocal note onset (+/-0.18 s, in order). Per-line CTC in tight windows squeezed words.
AU = json.load(open('../data/audio.json')) if os.path.exists('../data/audio.json') else None
von = np.array(sorted(t for t, _ in AU['onsets']['vocal'])) if AU else np.array([])
def syl(w):
    w = re.sub(r'[^a-z]', '', w.lower()); n = len(re.findall(r'[aeiouy]+', w)) - (1 if w.endswith('e') and len(w) > 3 and not w.endswith('le') else 0)
    return max(1, n)
def place(ws, s0, s1):
    sy = np.array([syl(w['w']) for w in ws], float); cum = np.concatenate([[0], np.cumsum(sy)])[:-1] / sy.sum()
    starts, lastt = [], s0 - 0.01
    for k, f in enumerate(cum):
        want = s0 + f * (s1 - s0)
        cand = von[(von > lastt + 0.06) & (von >= want - 0.18) & (von <= want + 0.18) & (von < s1)]
        st = float(cand[np.argmin(np.abs(cand - want))]) if len(cand) else max(want, lastt + 0.08)
        if k == 0:
            c0 = von[(von >= s0 - 0.12) & (von <= s0 + 0.25)]
            st = float(c0[0]) if len(c0) else s0
        starts.append(round(st, 3)); lastt = st
    for k, w in enumerate(ws):
        w['start'] = starts[k]; w['end'] = round(starts[k + 1] if k + 1 < len(ws) else max(s1, starts[k] + 0.2), 3)
GROSS_S = float(os.environ.get('GROSS_S', 2.0))
changed, prev_end = [], 0.0
if os.environ.get('BREATH', '1') == '1':
    for n, i in enumerate(pres):
        L = lines[i]
        t0 = bounds[(pres[n - 1], i)] if n else max(0.0, min(L['start'], cues[i]['start']) - 1.0)
        t1 = bounds[(i, pres[n + 1])] if n + 1 < len(pres) else max(L['end'], cues[i]['end']) + 1.5
        t0 = max(t0, prev_end)
        ks = np.arange(int(t0 * 100), max(int(t0 * 100) + 1, min(len(env), int(t1 * 100))))
        sung = ks[env[ks] > 0.12]
        s0, s1 = (sung[0] / 100, sung[-1] / 100) if len(sung) > 3 else (t0, t1)
        c_ = cues[i]; good = not c_.get('interpolated') and c_.get('match', 0) >= 0.5
        # pass 1 is kept wherever it agrees with Whisper's line position (verses keep their steady 2-bar spacing);
        # only grossly misplaced lines (> GROSS_S) or lines overlapping the previous one are re-placed in their breath window
        if (good and abs(L['start'] - c_['start']) > GROSS_S) or L['start'] < prev_end - 0.02:
            place(L['words'], s0, s1)
            changed.append((i, L['text'][:36], round(L['start'], 2), L['words'][0]['start']))
            L['refined'] = 'breath-window+onset-snap'
        prev_end = L['words'][-1]['end']
    # rebalance: a squeezed line (< 0.2 s/syllable) next to an over-long one (> 0.75 s/syllable) shares their span by syllables
    rate = lambda L: (L['words'][-1]['end'] - L['words'][0]['start']) / sum(syl(w['w']) for w in L['words'])
    for a, b in zip(pres, pres[1:]):
        A_, B_ = lines[a], lines[b]
        if (rate(A_) < 0.2 and rate(B_) > 0.75) or (rate(A_) > 0.75 and rate(B_) < 0.2):
            s0, s1 = A_['words'][0]['start'], B_['words'][-1]['end']
            na = sum(syl(w['w']) for w in A_['words']); nb = sum(syl(w['w']) for w in B_['words'])
            mid = s0 + (s1 - s0) * na / (na + nb)
            place(A_['words'], s0, mid); place(B_['words'], mid, s1)
            changed.append((a, 'rebalanced with next line', round(s0, 2), round(mid, 2)))
    json.dump(snapped, open(f'{D}/breaths.json', 'w'))
# Repeat transfer: runs of >= 3 consecutive lines whose text repeats (choruses, pre-choruses) sit on identical music, so
# their internal timing should match. The occurrence whose word starts hit the most vocal onsets is the reference; the
# others take its timing shifted by the median line-start offset. REPEATS=0 disables.
import bisect
def hit(ws):
    n = 0
    for w in ws:
        k = bisect.bisect_left(von, w['start']); n += any(abs(von[j] - w['start']) <= 0.06 for j in (k - 1, k) if 0 <= j < len(von))
    return n / max(1, len(ws))
transfers, skipped = [], []
def breath_depth(o, n):  # mean vocal energy just before each line start (lower = clearer breath = better evidence)
    return float(np.mean([env[max(0, int(lines[o + m]['words'][0]['start'] * 100) - 8):int(lines[o + m]['words'][0]['start'] * 100) - 2].mean()
                          if int(lines[o + m]['words'][0]['start'] * 100) > 10 else 1.0 for m in range(n)]))
def durs(o, n): return np.array([lines[o + m + 1]['words'][0]['start'] - lines[o + m]['words'][0]['start'] for m in range(n - 1)])
if os.environ.get('REPEATS', '1') == '1' and len(von):
    key = [re.sub(r'[^a-z]', '', L['text'].lower()) for L in lines]
    target_done = set()
    for n in range(8, 2, -1):  # longest repeats first
        for i in range(len(lines) - n + 1):
            if any((i + m) in absent for m in range(n)): continue
            group = [o for o in range(len(lines) - n + 1) if all(key[o + m] == key[i + m] and (o + m) not in absent for m in range(n))]
            group = sorted(set(group))
            if len(group) < 2: continue
            free = [o for o in group if not any((o + m) in target_done for m in range(n))]
            if not free: continue
            ref = min(group, key=lambda o: breath_depth(o, n))
            for o in free:
                if o == ref: continue
                dr, do = durs(ref, n), durs(o, n)
                if np.max(np.abs(do - dr) / np.maximum(dr, 0.5)) > 0.25:
                    skipped.append((o, n, ref)); continue
                off = float(np.median([lines[o + m]['words'][0]['start'] - lines[ref + m]['words'][0]['start'] for m in range(n)]))
                for m in range(n):
                    for wd, wr in zip(lines[o + m]['words'], lines[ref + m]['words']):
                        wd['start'] = round(wr['start'] + off, 3); wd['end'] = round(wr['end'] + off, 3)
                    lines[o + m]['refined'] = f'repeat-transfer from line {ref + m}'
                    target_done.add(o + m)
                transfers.append((o, n, ref, round(off, 2)))
            target_done.update(ref + m for m in range(n))
for i in sorted(absent):
    L = lines[i]; t = lines[i - 1]['words'][-1]['end'] if i else 0.0
    L['absent'] = True
    for w in L['words']:
        w['start'] = w['end'] = t
for L in lines:
    L['start'], L['end'] = L['words'][0]['start'], L['words'][-1]['end']
# held words extend across small gaps; present lines stay ordered and never overlap
pres = [L for L in lines if not L.get('absent')]
for L in pres:
    ws = L['words']
    for j, w in enumerate(ws):
        if j + 1 < len(ws) and ws[j + 1]['start'] - w['end'] < 0.6:
            w['end'] = max(w['end'], ws[j + 1]['start'])
        w['end'] = round(max(w['end'], w['start'] + 0.08), 3)
    L['start'], L['end'] = ws[0]['start'], ws[-1]['end']
for a, b in zip(pres, pres[1:]):
    if b['start'] < a['start']:
        print('WARN non-monotonic:', a['text'], '|', b['text'])
    if a['end'] > b['start'] - 0.01:
        a['end'] = a['words'][-1]['end'] = round(max(a['words'][-1]['start'] + 0.06, b['start'] - 0.01), 3)
J['notes'] = J.get('notes', '') + f' refine.py: {len(changed)} lines re-aligned in Whisper-anchored windows; absent lines {sorted(absent)}.'
json.dump(J, open('../data/lyrics.json', 'w'), indent=1)
print(f'refine: {len(changed)} lines re-aligned, absent {sorted(absent)}, repeat transfers {transfers}, skipped (durations differ) {skipped[:8]}')
for x in changed:
    print('   ', x)
