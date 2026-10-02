#!/usr/bin/env bash
# QA for a delivered file: probe, full decode, frame count vs master duration, loudness, key frames, checksums.
#   ./qa.sh <video.mp4>     -> qa/ (report.md + artefacts)
set -euo pipefail
P=$(cd "$(dirname "$0")" && pwd); V=$(realpath "$1"); Q="$P/qa"; mkdir -p "$Q/frames"
M=$(cat "$P/analysis/work/MASTER")
ffprobe -v error -show_format -show_streams -of json "$V" > "$Q/ffprobe.json"
ffmpeg -v error -i "$V" -f null - 2> "$Q/decode.txt" || true
NF=$(ffprobe -v error -count_frames -select_streams v:0 -show_entries stream=nb_read_frames -of csv=p=0 "$V")
python3 - "$Q" "$V" "$M" "$NF" <<'PY'
import json, sys, subprocess
Q, V, M, NF = sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4])
j = json.load(open(f'{Q}/ffprobe.json')); v = next(s for s in j['streams'] if s['codec_type'] == 'video'); a = next(s for s in j['streams'] if s['codec_type'] == 'audio')
num, den = map(int, v['r_frame_rate'].split('/')); fps = num / den
md = float(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', M]))
vd = NF / fps; dec = open(f'{Q}/decode.txt').read().strip()
ok = v['width'] == 1920 and v['height'] == 1080 and v['codec_name'] == 'h264' and a['codec_name'] == 'aac' and int(a['channels']) == 2 and abs(vd - md) <= 1 / fps + 1e-6 and not dec
r = f"""# QA — {V.split('/')[-1]}

| check | result |
|---|---|
| video | {v['codec_name']} {v['width']}x{v['height']} @ {fps:g} fps, {v.get('pix_fmt')} |
| audio | {a['codec_name']} {a['channels']} ch @ {a['sample_rate']} Hz |
| frames | {NF} = {vd:.3f} s |
| master | {md:.3f} s ({M}) — difference {abs(vd - md) * 1000:.1f} ms (limit: one frame, {1000 / fps:.1f} ms) |
| full decode | {'passed (no errors)' if not dec else 'ERRORS — see decode.txt'} |
| **overall** | **{'PASS' if ok else 'FAIL'}** |
"""
open(f'{Q}/report.md', 'w').write(r); print(r)
PY
ffmpeg -v error -y -i "$V" -af ebur128=peak=true -f null - 2>&1 | grep -A12 "Summary" > "$Q/loudness.txt" || true
ffmpeg -v error -y -i "$V" -vf "fps=1/10,scale=480:-1,tile=6x4" -frames:v 1 "$Q/contact-sheet.jpg"
sha256sum "$V" "$M" > "$Q/SHA256SUMS.txt"
