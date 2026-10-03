#!/usr/bin/env bash
# Re-time automatically: rebuild data/lyrics.json + data/audio.json whenever their inputs change
# (lyrics.txt, the master, sections.txt, captions, timing fixes). review.sh and render-full.sh call this first, so editing
# lyrics.txt and re-rendering is enough. Picks the best pipeline available:
#   full — Demucs + whisper.cpp + MMS_FA forced alignment (swap-audio.sh); needs whisper-cli + WHISPER_MODEL + uv deps
#   lite — analysis/timing_lite.py: caption-cue windows + vocal-band onset snapping (~±0.15 s); needs an .srt of the song
#          (SRT=<file>, or the first of captions/*.srt, source/captions/*.srt). No ML weights, no network.
#   ./retime.sh            re-time if stale        ./retime.sh --force    always
#   ./retime.sh --check    exit 1 if stale         RETIME_MODE=full|lite  force a pipeline     NO_RETIME=1  skip (callers)
# Reviewed per-line pins: analysis/timing-fixes.json (lite) or <take cache>/timing-fixes.json (full); see fix_timing.py.
set -euo pipefail
P=$(cd "$(dirname "$0")" && pwd); cd "$P"
[ "${NO_RETIME:-}" = 1 ] && exit 0
ARG=${1:-}
sha() { if command -v sha256sum >/dev/null; then sha256sum "$@"; else shasum -a 256 "$@"; fi; }
M=$(cat analysis/work/MASTER 2>/dev/null || true)
[ -n "$M" ] && [ -f "$M" ] || { echo "retime: no master recorded (analysis/work/MASTER); run ./swap-audio.sh <take> or write its path there"; exit 1; }
if [ -z "${SRT:-}" ]; then for f in captions/*.srt source/captions/*.srt; do [ -f "$f" ] && { SRT=$(cd "$(dirname "$f")" && pwd)/$(basename "$f"); break; }; done; fi
INPUTS=(lyrics.txt "$M"); for f in sections.txt analysis/timing-fixes.json "${SRT:-}"; do [ -n "$f" ] && [ -f "$f" ] && INPUTS+=("$f"); done
STAMP=$( (sha "${INPUTS[@]}" | cut -c1-64; echo "${RETIME_MODE:-auto}") | sha | cut -c1-16)
CUR=$(cat data/.timing-stamp 2>/dev/null || true)
fresh() { [ "$STAMP" = "$CUR" ] && [ -s data/lyrics.json ] && [ -s data/audio.json ]; }
if [ "$ARG" = --check ]; then fresh && { echo "timing up to date"; exit 0; } || { echo "timing stale"; exit 1; }; fi
if [ "$ARG" != --force ] && fresh; then exit 0; fi

MODE=${RETIME_MODE:-}
if [ -z "$MODE" ]; then
  if command -v whisper-cli >/dev/null && [ -n "${WHISPER_MODEL:-}" ] && [ -f "${WHISPER_MODEL:-}" ]; then MODE=full
  elif [ -n "${SRT:-}" ]; then MODE=lite
  else echo "retime: lyrics/master changed but no pipeline is available: install whisper.cpp + set WHISPER_MODEL (full), or provide captions via SRT=<file.srt> (lite)"; exit 1; fi
fi
echo "retime ($MODE): inputs changed, re-timing…"
mkdir -p data audio analysis/work
case "$MODE" in
  full)
    W="$P/analysis/work/retime-master.wav"
    case "$M" in *.wav) W="$M";; *) ffmpeg -v error -y -i "$M" -ar 44100 -c:a pcm_s16le "$W";; esac
    ./swap-audio.sh "$W" --redo
    echo "$M" > analysis/work/MASTER ;;   # keep the original master as the one render-full.sh muxes
  lite)
    (cd analysis && MASTER="$M" SRT="$SRT" LYRICS="$P/lyrics.txt" uv run --no-project --with librosa --with soundfile --with scipy --with numpy python timing_lite.py 2>&1 | grep -v -i warn)
    [ -f analysis/timing-fixes.json ] && (cd analysis && python3 fix_timing.py timing-fixes.json)
    ffmpeg -v error -y -i "$M" -c:a aac -b:a 256k audio/master.m4a ;;
  *) echo "retime: unknown RETIME_MODE=$MODE"; exit 1 ;;
esac
(cd analysis && python3 tools/spillcheck.py ../data/lyrics.json | tail -3) || true
echo "$STAMP" > data/.timing-stamp
echo "retime: data/lyrics.json + data/audio.json updated"
