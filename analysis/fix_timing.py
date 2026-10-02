"""Apply reviewed per-take timing fixes (<candidate>/timing-fixes.json) to ../data/lyrics.json.
Fix kinds: {"line", "word", "start"} pins one onset; {"line", "words": [[s,e],...]} sets every word;
{"line", "template": j, "start", "end"?} copies line j's relative word timing (same lyric sung elsewhere) to start at `start`."""
import json, sys
fx = json.load(open(sys.argv[1]))['fixes']
d = json.load(open('../data/lyrics.json')); L = d['lines']
orig = json.loads(json.dumps(L))
for f in fx:
    ws = L[f['line']]['words']
    if 'template' in f:
        tw = orig[f['template']]['words']; t0 = tw[0]['start']
        assert len(tw) == len(ws), (f, len(tw), len(ws))
        for w, s in zip(ws, tw): w['start'] = round(f['start'] + s['start'] - t0, 3); w['end'] = round(f['start'] + s['end'] - t0, 3)
        if 'end' in f: ws[-1]['end'] = f['end']
    elif 'words' in f:
        assert len(f['words']) == len(ws), f
        for w, (s, e) in zip(ws, f['words']): w['start'], w['end'] = s, e
    else:
        w = ws[f['word']]; w['start'] = f['start']; w['end'] = max(w['end'], f['start'] + 0.1)
    L[f['line']]['start'] = ws[0]['start']; L[f['line']]['end'] = ws[-1]['end']; L[f['line']]['refined'] = 'reviewed fix: ' + f.get('why', '')
json.dump(d, open('../data/lyrics.json', 'w'), indent=1)
print(f"fix_timing: {len(fx)} fixes applied")
