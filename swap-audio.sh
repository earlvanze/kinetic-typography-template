#!/usr/bin/env bash
# Hot-swap the song's audio. Timing for every take is cached by checksum, so switching back is instant.
#   ./swap-audio.sh <take.wav>            # use this take (analyses it on first use: stems, whisper cues, alignment, beats)
#   ./swap-audio.sh <take.wav> --redo     # re-analyse even if cached
#   ./swap-audio.sh --list                # cached takes and which one is active
# Per take (optional): <cache>/lyrics.txt = what this take actually sings ([section] headers, # comments); otherwise
# ../lyrics.txt is used. <cache>/native-timing.json (Suno aligned_lyrics response) makes Suno's own word timing the
# primary source (analysis/native.py), with pass-1 forced alignment as the fallback for lines Suno misaligns.
# <cache>/absent.txt lists line indices to hide (rarely needed with a per-take sheet).
# Outputs used by the renderer: data/lyrics.json, data/audio.json, audio/master.m4a; the active master is recorded in
# analysis/work/MASTER (+ .sha256), which render-full.sh muxes. The shot script is keyed by line ORDER, so all shots re-time.
set -euo pipefail
P=$(cd "$(dirname "$0")" && pwd); A=$P/analysis; C=$A/candidates
if [ "${1:-}" = --list ]; then
  act=$(cut -c1-12 "$A/work/MASTER.sha256" 2>/dev/null || true)
  for d in "$C"/*/; do [ -d "$d" ] || continue; k=$(basename "$d"); m=""; [ "${k%%-*}" = "$act" ] && m="  <- active"; echo "$k  $(cat "$d/MASTER")$m"; done; exit 0
fi
M=$(realpath "$1"); REDO=${2:-}
KEY=$(sha256sum "$M" | cut -c1-12); D="$C/$KEY-$(basename "${M%.*}")"
if [ "$REDO" = --redo ] || [ ! -s "$D/lyrics.json" ] || [ ! -s "$D/audio.json" ]; then
  mkdir -p "$D"; echo "$M" > "$D/MASTER"; sha256sum "$M" > "$D/MASTER.sha256"
  cd "$A"; mkdir -p work
  ffmpeg -v error -y -i "$M" -ar 44100 -c:a pcm_s16le work/master.wav
  ffmpeg -v error -y -i "$M" -c:a aac -b:a 256k "$D/master.m4a"
  if [ ! -s "$D/vocals.wav" ] || [ "$REDO" = --redo ]; then
    rm -rf work/stems; uv run python -m demucs -n htdemucs -d cpu -j 8 -o work/stems work/master.wav 2>&1 | tail -1
    cp work/stems/htdemucs/master/*.wav "$D/"
  else mkdir -p work/stems/htdemucs/master && cp "$D"/{vocals,drums,bass,other}.wav work/stems/htdemucs/master/; fi
  ffmpeg -v error -y -i "$D/vocals.wav" -ac 1 -ar 16000 work/vocals16.wav
  whisper-cli -m "${WHISPER_MODEL:?set WHISPER_MODEL to a ggml whisper model}" -f work/vocals16.wav -t 12 -ml 1 -sow -ojf -of "$D/whisper-words" --dtw medium.en -l en --suppress-nst >/dev/null 2>"$D/whisper.log"
  LYR=../lyrics.txt; [ -s "$D/lyrics.txt" ] && LYR="$D/lyrics.txt"
  LYRICS="$LYR" WHISPER="$D/whisper-words.json" OUT="$D/transcript.json" uv run python autocue.py | tee "$D/autocue.txt"
  MASTER="$M" TRANSCRIPT="$D/transcript.json" uv run python align.py 2>&1 | grep -v -i "warn\|forced_align" | tee "$D/align.txt"
  uv run python tidy.py
  if [ -s "$D/native-timing.json" ]; then cp ../data/lyrics.raw.json ../data/lyrics.raw.json.bak; TAKE="$D" uv run python native.py | tee "$D/native.txt"
  else TAKE="$D" uv run python refine.py 2>&1 | grep -v -i "warn\|forced_align" | tee "$D/refine.txt"; fi
  [ -s "$D/timing-fixes.json" ] && python3 fix_timing.py "$D/timing-fixes.json"
  SECTIONS="${SECTIONS:-$(cat "$P/sections.txt")}" uv run python analyze.py 2>&1 | grep -v -i warn | tee "$D/analyze.txt"
  uv run python check.py | tee "$D/check.txt" | head -20
  cp ../data/lyrics.json ../data/audio.json "$D/"
fi
cp "$D/lyrics.json" "$D/audio.json" "$P/data/"; cp "$D/master.m4a" "$P/audio/master.m4a"
mkdir -p "$A/work"; cp "$D/MASTER" "$D/MASTER.sha256" "$A/work/"
echo "active take: $M  (cache $D)"; grep -h "weakly\|suspect" "$D/autocue.txt" "$D/check.txt" 2>/dev/null || true
