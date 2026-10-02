"""Verify (or recover) word timing for chosen lines with MMS_FA forced alignment inside a window you trust
(bounded by reliable neighbouring lines). Prints each word's start/end and confidence. Low confidence (< ~0.05 for a whole
line) usually means the WORDS are wrong, not the timing — check the lyric text.
usage: uv run python tools/verify_fa.py --lines 12,13 --win 47.3:58.45 [--lines 21 --win 81.5:88.1 ...] [--json out.json]
       (run from analysis/; uses work/stems/htdemucs/master/vocals.wav and ../data/lyrics.json)
"""
import argparse, json, re, numpy as np, torch, torchaudio
ap = argparse.ArgumentParser(); ap.add_argument('--lines', action='append', required=True); ap.add_argument('--win', action='append', required=True); ap.add_argument('--json')
ap.add_argument('--vocals', default='work/stems/htdemucs/master/vocals.wav'); ap.add_argument('--lyrics', default='../data/lyrics.json')
a = ap.parse_args()
wav, sr = torchaudio.load(a.vocals); wav = wav.mean(0, keepdim=True)
B = torchaudio.pipelines.MMS_FA; model = B.get_model(with_star=True).eval(); dic = B.get_dict(star='*'); SR = B.sample_rate
wav = torchaudio.functional.resample(wav, sr, SR)
norm = lambda w: re.sub(r"[^a-z]", '', w.lower().replace('’', "'")) or 'a'
L = json.load(open(a.lyrics))['lines']; res = {}
for ls, win in zip(a.lines, a.win):
    idx = [int(x) for x in ls.split(',')]; t0, t1 = map(float, win.split(':'))
    seg = wav[:, int(t0 * SR):int(t1 * SR)]
    with torch.inference_mode(): em, _ = model(seg)
    em = torch.log_softmax(em, -1)
    words = [(i, w) for i in idx for w in L[i]['text'].split()]
    toks = [[dic[c] for c in norm(w)] for _, w in words]
    flat = torch.tensor([[dic['*']] + [t for tk in toks for t in tk] + [dic['*']]], dtype=torch.int32)
    ali, sc = torchaudio.functional.forced_align(em, flat, blank=0)
    sp = [x for x in torchaudio.functional.merge_tokens(ali[0], sc[0].exp()) if x.token != dic['*']]
    r = seg.shape[1] / em.shape[1] / SR; k = 0
    for (i, w), tk in zip(words, toks):
        s_ = sp[k:k + len(tk)]; k += len(tk)
        res.setdefault(i, []).append([w, round(t0 + s_[0].start * r, 3), round(t0 + s_[-1].end * r, 3), round(float(np.mean([x.score for x in s_])), 3)])
for i, ws in res.items(): print(i, L[i]['text'], '\n   ', [(w, s, round(c, 2)) for w, s, e, c in ws])
if a.json: json.dump(res, open(a.json, 'w'), indent=1)
