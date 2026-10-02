#!/usr/bin/env bash
# Scaffold a kinetic-typography video project from this template.
#   ./new-project.sh <dest-dir>
# Then follow WORKFLOW.md: lock the audio + lyrics -> timing (swap-audio.sh or analysis/prep.sh) -> brand/palette/script/shots
# -> contact sheets -> review.sh rounds -> render-full.sh -> qa.sh.
# Use a folder name WITHOUT a version number (renders are versioned inside out/, the project is not).
set -euo pipefail
T=$(cd "$(dirname "$0")" && pwd); D=$1
[ -e "$D" ] && { echo "exists: $D"; exit 1; }
mkdir -p "$D"/{analysis,out/wip,out/review,out/final,qa,data,audio}
rsync -a --exclude node_modules --exclude dist "$T/app" "$D/"
rsync -a --exclude .venv --exclude __pycache__ --exclude work --exclude candidates "$T/analysis/" "$D/analysis/"
cp "$T"/{LICENSE,LICENSE-pdoom-engine,render-full.sh,review.sh,swap-audio.sh,qa.sh,WORKFLOW.md} "$D/"
cp "$T/examples/lyrics.txt" "$D/lyrics.txt"
cp "$T/examples/sections.txt" "$D/sections.txt"
(cd "$D/app" && bun install >/dev/null)
(cd "$D/analysis" && uv sync -q)
echo "scaffolded $D — next: edit lyrics.txt + sections.txt, then ./swap-audio.sh <master.wav> (see WORKFLOW.md)"
