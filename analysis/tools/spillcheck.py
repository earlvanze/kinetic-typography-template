"""Check (and with --fix, repair) lines whose word list does not match their text — e.g. a line that also carries copies
of the next lines' words (an import/edit bug that silently puts the wrong words on screen). --fix truncates each line to the
words that spell its own text and clamps word ends to the next line's start.
usage: python3 tools/spillcheck.py ../data/lyrics.json [--fix]
"""
import json, re, sys
p = sys.argv[1]; fix = '--fix' in sys.argv
d = json.load(open(p)); L = d['lines']
norm = lambda s: re.sub(r"[^a-z0-9' -]", '', s.lower().replace('’', "'")).replace('-', ' ').split()
bad = 0
for i, l in enumerate(L):
    tw = norm(l['text']); ws = l['words']
    if norm(' '.join(w['w'] for w in ws)) == tw: continue
    bad += 1; print('mismatch', i, l['text'], '| words:', ' '.join(w['w'] for w in ws))
    if fix:
        acc = []
        for k, w in enumerate(ws):
            acc += norm(w['w'])
            if acc == tw: l['words'] = ws[:k + 1]; l['end'] = ws[k]['end']; break
        else: print('  cannot fix line', i)
if fix:
    for i in range(len(L) - 1):
        nx = L[i + 1]['words'][0]['start']
        if L[i]['words'][-1]['end'] > nx + 0.01: L[i]['words'][-1]['end'] = max(L[i]['words'][-1]['start'] + 0.05, nx); L[i]['end'] = L[i]['words'][-1]['end']
    json.dump(d, open(p, 'w'), indent=1)
print(f'{bad} mismatched line(s)' + (' (fixed)' if fix and bad else ''))
