"""Word-level forced alignment of a reviewed line transcript to the Demucs vocal stem (torchaudio MMS_FA).

Input  (env TRANSCRIPT, default ../transcript.json): [{"text": str, "start": approx_s, "end": approx_s, "section"?: str}, ...]
       Approximate cues only need to be within ~3 s; they seed chained windows so repeated choruses can't swap.
Output ../data/lyrics.json in the engine schema (lines[].words[] {w,start,end,conf}).
Env: MASTER (recorded in notes). OFFSETS='t0:delta,...' shifts cues at/after t0 by delta (for re-spliced masters).
"""
import json, os, re
import numpy as np, torch, torchaudio

phr = json.load(open(os.environ.get('TRANSCRIPT', '../transcript.json')))
offs = [tuple(map(float, x.split(':'))) for x in os.environ.get('OFFSETS', '').split(',') if x]
for p in phr:
    p.setdefault('section', '')
    for t0, dlt in offs:
        if p['start'] >= t0: p['start'] += dlt; p['end'] += dlt
wav, sr = torchaudio.load('work/stems/htdemucs/master/vocals.wav'); wav = wav.mean(0, keepdim=True)
B = torchaudio.pipelines.MMS_FA; model = B.get_model(with_star=True).eval(); dic = B.get_dict(star='*'); SR = B.sample_rate
wav = torchaudio.functional.resample(wav, sr, SR); DUR = wav.shape[1] / SR
norm = lambda w: re.sub(r"[^a-z]", '', w.lower().replace('’', "'")) or 'a'

chunks, cur = [], []
for p in phr:
    if cur and (p['section'] != cur[-1]['section'] or (len(cur) >= (10 if os.environ.get('NODRIFT') else 6)) or p['start'] - cur[-1]['end'] > 3): chunks.append(cur); cur = []
    cur.append(p)
if cur: chunks.append(cur)
lines, prev_end, drift = [], 0.0, 0.0
for ch in chunks:
    if os.environ.get('NODRIFT'):  # independent windows around the reviewed cues (no error carried between chunks)
        ci = chunks.index(ch); nxt = chunks[ci + 1][0]['start'] if ci + 1 < len(chunks) else DUR
        t0 = max(0.0, ch[0]['start'] - 2.5, prev_end - 0.05); t1 = min(DUR, ch[-1]['end'] + 3.0, nxt + 0.6)
    else:
        t0 = max(0.0, prev_end - 0.15, ch[0]['start'] + drift - 4.0); t1 = min(DUR, ch[-1]['end'] + drift + 3.0)
    nw = sum(len(p['text'].split()) for p in ch)
    t1 = min(DUR, max(t1, t0 + 0.3 * nw + 2.0))  # never a window too short for its words (CTC needs frames >= tokens)
    print(f"chunk {ch[0]['section']} {ch[0]['text'][:28]!r}: window {t0:.2f}-{t1:.2f} drift {drift:+.2f}")
    seg = wav[:, int(t0 * SR):int(t1 * SR)]
    with torch.inference_mode(): em, _ = model(seg)
    em = torch.log_softmax(em, -1)
    words = [(li, w) for li, p in enumerate(ch) for w in p['text'].split()]
    toks = [[dic[c] for c in norm(w)] for _, w in words]
    flat = torch.tensor([[dic['*']] + [t for tk in toks for t in tk] + [dic['*']]], dtype=torch.int32)
    ali, sc = torchaudio.functional.forced_align(em, flat, blank=0)
    sp = [x for x in torchaudio.functional.merge_tokens(ali[0], sc[0].exp()) if x.token != dic['*']]
    r = seg.shape[1] / em.shape[1] / SR; out = [[] for _ in ch]; k = 0
    for (li, w), tk in zip(words, toks):
        s_ = sp[k:k + len(tk)]; k += len(tk)
        out[li].append({'w': w, 'start': round(t0 + s_[0].start * r, 3), 'end': round(t0 + s_[-1].end * r, 3), 'conf': round(float(np.mean([x.score for x in s_])), 3)})
    prev_end = out[-1][-1]['end']; drift = out[0][0]['start'] - ch[0]['start']
    for p, ws in zip(ch, out): lines.append({'text': p['text'], 'section': p['section'], 'start': ws[0]['start'], 'end': ws[-1]['end'], 'words': ws, 'cue': [p['start'], p['end']]})

for L in lines:  # stranded near-zero-confidence words snap back next to their predecessor
    ws = L['words']
    for i in range(1, len(ws)):
        if ws[i]['conf'] < 0.05 and ws[i]['start'] - ws[i - 1]['end'] > 0.7:
            d = ws[i]['end'] - ws[i]['start']; ws[i]['start'] = round(ws[i - 1]['end'] + 0.04, 3); ws[i]['end'] = round(ws[i]['start'] + min(d, 0.5), 3)
json.dump({'lines': lines, 'notes': f"MMS_FA forced alignment on the htdemucs vocal stem of {os.environ.get('MASTER', '?')}; cue = transcript cue."}, open('../data/lyrics.raw.json', 'w'))
print(len(lines), 'lines;', sum(len(L['words']) for L in lines), 'words; low-confidence (<0.05):', sum(1 for L in lines for w in L['words'] if w['conf'] < 0.05))
