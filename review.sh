#!/usr/bin/env bash
# Fast REVIEW render: no motion blur (1 sub-frame), quick encode, downscaled to 960x540 with the master's audio.
# Use for every round of feedback; render the final with render-full.sh only once the edit is approved.
#   ./review.sh <name> [from=0] [to=end]      -> out/review/<name>-half.mp4
set -euo pipefail
P=$(cd "$(dirname "$0")" && pwd); NAME=$1; FROM=${2:-0}
"$P/retime.sh"   # re-time first if lyrics.txt / the master / fixes changed (NO_RETIME=1 skips)
TO=${3:-$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$(cat "$P/analysis/work/MASTER")")}
export PDOOM_GL_ARGS="${PDOOM_GL_ARGS:---use-angle=gl-egl --ozone-platform=headless}"
mkdir -p "$P/out/review"; cd "$P/app"
bun scripts/render.ts video --from "$FROM" --to "$TO" --fps 30 --samples 1 --crf 24 --preset veryfast --out "../out/review/$NAME-full.mp4" > "../out/review/$NAME.log" 2>&1
ffmpeg -v error -y -i "../out/review/$NAME-full.mp4" -vf scale=960:540 -c:v libx264 -crf 26 -preset veryfast -c:a copy "../out/review/$NAME-half.mp4"
rm -f "../out/review/$NAME-full.mp4"; echo "out/review/$NAME-half.mp4"
