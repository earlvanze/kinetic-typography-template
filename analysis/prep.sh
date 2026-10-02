#!/usr/bin/env bash
# Regenerate everything audio-dependent from ONE locked master WAV.
#   analysis/prep.sh <master.wav> align   <transcript.json>   # forced alignment from a reviewed line transcript
#   analysis/prep.sh <master.wav> native  <native-lines.json> # import native word timing (e.g. Suno), then check
# Writes audio/master.m4a (preview), data/lyrics.json, data/audio.json; records the master path + sha256 in analysis/work/.
# Optional env: OFFSETS (align), SECTIONS (analyze).
set -euo pipefail
M=$(realpath "$1"); MODE=${2:-align}; SRC=$(realpath "${3:-../transcript.json}")
cd "$(dirname "$0")"
mkdir -p work ../audio ../data
echo "$M" > work/MASTER; sha256sum "$M" > work/MASTER.sha256
ffmpeg -v error -y -i "$M" -ar 44100 -c:a pcm_s16le work/master.wav
ffmpeg -v error -y -i "$M" -c:a aac -b:a 256k ../audio/master.m4a
[ -f work/stems/htdemucs/master/vocals.wav ] && [ work/stems/htdemucs/master/vocals.wav -nt work/master.wav ] || \
  uv run python -m demucs -n htdemucs -j 8 -o work/stems work/master.wav 2>&1 | tail -1
if [ "$MODE" = native ]; then NATIVE="$SRC" uv run python import_suno.py
else MASTER="$M" TRANSCRIPT="$SRC" uv run python align.py 2>&1 | grep -v -i "warn\|forced_align"; fi
uv run python tidy.py
uv run python analyze.py 2>&1 | grep -v -i warn
uv run python check.py | head -20
