"""Shared clean-up: words get >= 80 ms and extend across small gaps (held notes); lines never overlap.
../data/lyrics.raw.json -> ../data/lyrics.json"""
import json
J = json.load(open('../data/lyrics.raw.json')); lines = J['lines']
lines.sort(key=lambda L: L['start'])
for L in lines:
    ws = L['words']
    for i, w in enumerate(ws):
        if i + 1 < len(ws) and ws[i + 1]['start'] - w['end'] < 0.6: w['end'] = max(w['end'], ws[i + 1]['start'])
        w['end'] = round(max(w['end'], w['start'] + 0.08), 3)
    L['start'], L['end'] = ws[0]['start'], ws[-1]['end']
for a, b in zip(lines, lines[1:]):
    if a['end'] > b['start'] - 0.01: a['end'] = a['words'][-1]['end'] = round(max(a['words'][-1]['start'] + 0.06, b['start'] - 0.01), 3)
json.dump(J, open('../data/lyrics.json', 'w'), indent=1)
print('tidy:', len(lines), 'lines')
