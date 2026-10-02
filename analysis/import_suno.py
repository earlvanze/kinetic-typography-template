"""Import native word timing (e.g. Suno aligned words already grouped into lines) instead of forced alignment.
Input (env NATIVE): [{"text": str, "words": [{"word": str, "start": s, "end": s}, ...]}, ...]
Merges dangling fragments (a line whose predecessor ends without punctuation, e.g. "...let yourself be" + "heard.").
Writes ../data/lyrics.raw.json; tidy.py finishes it."""
import json, os, re
src = json.load(open(os.environ['NATIVE']))
lines = []
for l in src:
    ws = [{'w': w['word'].strip(), 'start': round(w['start'], 3), 'end': round(w['end'], 3), 'conf': 1.0} for w in l['words'] if w['word'].strip()]
    if not ws: continue
    if lines and not re.search(r"[.!?,;:…]$", lines[-1]['text'].strip()) and len(ws) <= 2 and ws[0]['start'] - lines[-1]['end'] < 0.6:
        lines[-1]['words'] += ws; lines[-1]['text'] += ' ' + l['text'].strip(); lines[-1]['end'] = ws[-1]['end']; continue
    lines.append({'text': l['text'].strip(), 'section': l.get('section', ''), 'start': ws[0]['start'], 'end': ws[-1]['end'], 'words': ws})
json.dump({'lines': lines, 'notes': f"Native word timing imported from {os.environ['NATIVE']}."}, open('../data/lyrics.raw.json', 'w'))
print(len(src), 'source lines ->', len(lines), 'lines;', sum(len(L['words']) for L in lines), 'words')
