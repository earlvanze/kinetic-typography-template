"""Per-take timing from Suno's own word alignment (TAKE/native-timing.json, fetched with the user's approval).
Suno times are song time; the captured WAV has a constant recorder lead-in, measured here as the median difference
against pass-1 forced alignment (robust: only words that agree within 0.4 s of the median are used).
Merged tokens ("upSomeone", "[Verse 1]Wake") are split; the second word's start is estimated from pass 1.
Lines where Suno's alignment visibly fails (>= 3 words within 0.35 s, or < 60% of words matched) fall back to pass 1.
Reads ../data/lyrics.raw.json (pass 1 on the take's as-sung sheet); writes ../data/lyrics.json."""
import json, os, re, difflib, statistics
D = os.environ['TAKE']
nd = json.load(open(f'{D}/native-timing.json'))['data']
P1 = json.load(open('../data/lyrics.raw.json')); lines = P1['lines']
norm = lambda w: re.sub(r"[^a-z]", '', w.lower().replace('’', "'"))
nat = []  # (word, start or None, end)
for x in nd['aligned_words']:
    bracket = '[' in x['word'] or '*' in x['word']
    parts = re.findall(r"[A-Z]?[a-z’']+|[A-Z]+(?![a-z])", re.sub(r'\[[^\]]*\]|\*+', ' ', x['word']))
    # a merged token spans [start of its first word, END of its last word]: the last word of a merged or bracket-prefixed
    # token has a reliable end but no start (marked None, estimated back from the end below)
    for k, p in enumerate(parts):
        last = k == len(parts) - 1
        nat.append((norm(p), x['start_s'] if (k == 0 and not bracket) else None, x['end_s'] if (last or len(parts) == 1) else None))
ours = [(norm(w['w']), li, wi) for li, l in enumerate(lines) for wi, w in enumerate(l['words'])]
sm = difflib.SequenceMatcher(None, [a for a, _, _ in nat], [a for a, _, _ in ours], autojunk=False)
m = {}
for a, b, n in sm.get_matching_blocks():
    for k in range(n): m[(ours[b + k][1], ours[b + k][2])] = nat[a + k]
diffs = [lines[li]['words'][wi]['start'] - v[1] for (li, wi), v in m.items() if v[1] is not None]
med = statistics.median(diffs); off = statistics.median([d for d in diffs if abs(d - med) < 0.4])
squeezed = lambda st: any(st[k + 2] - st[k] < 0.35 for k in range(len(st) - 2))
used, fell = 0, []
OV = json.load(open(f'{D}/overrides.json')) if os.path.exists(f'{D}/overrides.json') else {}
keep = set(OV.get('use_pass1', []))  # lines whose pass-1 forced alignment is kept (documented in overrides.json 'why')
for li, L in enumerate(lines):
    if L['text'] in keep: L['refined'] = 'pass1-override'; continue
    ws = L['words']; got = [m.get((li, wi)) for wi in range(len(ws))]
    st = []
    for wi, g in enumerate(got):
        if g is None: st.append(None)
        elif g[1] is not None: st.append(g[1] + off)
        elif g[2] is not None:  # line-opening word of a merged token: measured back from its reliable end
            dur = min(0.7, 0.28 * max(1, len(re.findall(r'[aeiouy]+', g[0]))) + 0.12)
            st.append(max(g[2] + off - dur, (st[-1] + 0.12) if st and st[-1] is not None else 0.0))
        else: st.append(None)
    known = [s for s in st if s is not None]
    if len(known) < 0.6 * len(ws) or squeezed(known) or any(b <= a for a, b in zip(known, known[1:])):
        fell.append((li, L['text'][:40])); continue
    # fill unknown words by interpolation between known neighbours (or pass-1 spacing at the ends)
    for wi in range(len(ws)):
        if st[wi] is None:
            p = next((k for k in range(wi - 1, -1, -1) if st[k] is not None), None); q = next((k for k in range(wi + 1, len(ws)) if st[k] is not None), None)
            st[wi] = (st[p] + (st[q] - st[p]) * (wi - p) / (q - p)) if p is not None and q is not None else (st[p] + 0.25 * (wi - p) if p is not None else st[q] - 0.25 * (q - wi))
    for wi, w in enumerate(ws): w['start'] = round(st[wi], 3)
    for wi, w in enumerate(ws): w['end'] = round(ws[wi + 1]['start'] if wi + 1 < len(ws) else max(w['start'] + 0.3, ((m.get((li, wi)) or (0, 0, None))[2] or (w['start'] + 0.3 - off)) + off), 3)
    L['refined'] = 'suno-native'; used += 1
# A line-opening word estimated from a merged token ("saidEvery") must start after the previous line's last word:
# otherwise the next plate cuts in before the previous line is finished (user-reported at 1:59).
for i in range(1, len(lines)):
    a, b = lines[i - 1]['words'], lines[i]['words']
    lo = a[-1]['start'] + 0.25
    if b[0]['start'] < lo:
        nxt = b[1]['start'] if len(b) > 1 else lo + 0.5
        b[0]['start'] = round(min(lo, (a[-1]['start'] + nxt) / 2) if nxt <= lo else lo, 3)
        a[-1]['end'] = min(a[-1]['end'], b[0]['start'])
# lines still squeezed after bounding (Suno's own times are off there) join the gap-placed fallbacks
for i, L in enumerate(lines):
    st = [w['start'] for w in L['words']]
    if L.get('refined') == 'suno-native' and squeezed(st) and i not in {x for x, _ in fell}: fell.append((i, L['text'][:40] + ' [squeezed]'))
# Fallback lines are re-placed inside the gap between their native-timed neighbours (not at pass-1's possibly drifted
# times): each run of fallback lines shares the gap by syllable count, words snap to vocal note onsets.
import numpy as np
AU = json.load(open('../data/audio.json')) if os.path.exists('../data/audio.json') else {'onsets': {'vocal': []}}
von = np.array(sorted(t for t, _ in AU['onsets']['vocal']))
syl = lambda w: max(1, len(re.findall(r'[aeiouy]+', norm(w))))
def place(ws, s0, s1):
    sy = np.array([syl(w['w']) for w in ws], float); cum = np.concatenate([[0], np.cumsum(sy)])[:-1] / sy.sum(); last = s0 - 0.01
    for k, (w, f) in enumerate(zip(ws, cum)):
        want = s0 + f * (s1 - s0); cand = von[(von > last + 0.06) & (abs(von - want) <= 0.18) & (von < s1)] if len(von) else []
        st = float(cand[np.argmin(np.abs(cand - want))]) if len(cand) else max(want, last + 0.08)
        w['start'] = round(st, 3); last = st
    for k, w in enumerate(ws): w['end'] = round(ws[k + 1]['start'] if k + 1 < len(ws) else max(s1, w['start'] + 0.2), 3)
fellset = {li for li, _ in fell}
i = 0
while i < len(lines):
    if i not in fellset: i += 1; continue
    j = i
    while j < len(lines) and j in fellset: j += 1
    g0 = lines[i - 1]['words'][-1]['end'] + 0.05 if i > 0 else max(0.0, lines[i]['words'][0]['start'] - 0.5)
    g1 = lines[j]['words'][0]['start'] - 0.05 if j < len(lines) else lines[j - 1]['words'][-1]['end'] + 0.5
    if g1 - g0 < 0.3 * (j - i): g1 = g0 + 0.9 * (j - i)  # degenerate gap: keep a minimal sung span
    tot = sum(sum(syl(w['w']) for w in lines[k]['words']) for k in range(i, j)); t = g0
    for k in range(i, j):
        n = sum(syl(w['w']) for w in lines[k]['words']); span = (g1 - g0) * n / tot
        place(lines[k]['words'], t, t + span * 0.95); lines[k]['refined'] = 'gap-placed between native neighbours'; t += span
    i = j
for L in lines: L['start'], L['end'] = L['words'][0]['start'], L['words'][-1]['end']
for a, b in zip(lines, lines[1:]):
    if a['end'] > b['start'] - 0.01: a['end'] = a['words'][-1]['end'] = round(max(a['words'][-1]['start'] + 0.06, b['start'] - 0.01), 3)
bad = [i for i in range(1, len(lines)) if lines[i]['start'] < lines[i - 1]['start']]
P1['notes'] = f"Suno native word alignment (song {json.load(open(f'{D}/native-timing.json')).get('song')}, hoot_cer {nd.get('hoot_cer'):.3f}) + {off:.3f} s capture lead-in; {used} lines native, {len(fell)} lines fall back to pass-1 forced alignment: {fell}."
json.dump(P1, open('../data/lyrics.json', 'w'), indent=1)
print(f'pass-1 overrides: {sorted(keep)}'); print(f'gap-placed fallback runs between native neighbours'); print(f'native: offset {off:+.3f} s (from {len(diffs)} matched words); {used} lines native, {len(fell)} fallback; non-monotonic {bad}')
for f in fell: print('   fallback', f)
