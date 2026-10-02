# Workflow: a kinetic-typography music video from any song

The bar: **kinetic typography, not a lyric video.** A lyric video puts the line on screen when it is sung. Kinetic
typography turns each phrase into an object that acts out what it says. A ledger types itself, a word is laid like
bricks, a key turns in a lock. Each set piece has its own graphic idiom, and the camera moves on the beat.

## 0. Scaffold
```sh
./new-project.sh <dest-dir>
```
Name the folder **without a version number** and version the renders inside `out/`. One project was once swept up in a
cleanup of "old versions" because of a versioned folder name.

## 1. Lock the inputs (no visuals before this)
- **One audio master** (WAV). Every audio change means re-running timing, and `swap-audio.sh` caches each take by checksum.
  If the head or tail is unusable (noise, a count-in, contamination), trim it **before** timing. For a seamless loop,
  use `tools/loop_master.py`: it cuts on beats with the same position in the bar, so the meter carries across the seam.
- **The lyric text, exactly as sung** → `lyrics.txt` with `[section]` headers (`intro`, `verse1`, `pre1`, `chorus1`,
  `bridge1`, `final1`, `outro1`, …). Prefer the **original text** (the songwriter's sheet, the generation prompt) over any
  transcription. If you have none, draft one with `tools/transcribe_windows.py`. Treat that draft as evidence and confirm
  each line by ear and with `tools/verify_fa.py`. Do not lock an uncertain line until you have resolved it from the audio.
- Write the master's path and checksum down (`analysis/work/MASTER*` does this).

## 2. Timing (`./swap-audio.sh <take.wav>`)
The pipeline runs in this order:
1. Demucs vocal stem.
2. whisper.cpp word cues → `autocue.py` (lyrics matched to cues, ±3 s is enough).
3. `align.py`: MMS_FA forced alignment per line inside its cue window.
4. `tidy.py` → `refine.py`, a breath-snapped pass 2, **or** `native.py` when the generator supplies word timing
   (`<cache>/native-timing.json`).
5. `fix_timing.py` (reviewed pins in `<cache>/timing-fixes.json`) → `analyze.py` (beats, downbeats, 100 fps envelopes,
   onsets) → `check.py`.

It writes `data/lyrics.json`, `data/audio.json` and `audio/master.m4a`.

**Check the timing; the renders only look as good as it is.** Tools for when a line is wrong:
| symptom | tool |
|---|---|
| where does the voice actually start, is the note held, where does the vocal end | `tools/envelope.py A B` |
| a line's words are off | `tools/verify_fa.py --lines N --win A:B`: align inside a window you trust (bounded by the vocal phrase seen in the envelope) |
| a repeated line (chorus) is placed wrong | `tools/xcorr.py --pair bad:good`: correlate against a well-timed sibling, then pin it |
| a section starts in the wrong place | `repeats.py`: find repeats by audio self-similarity |
| on-screen words don't match the line | `tools/spillcheck.py --fix`: a line carrying the next lines' words is an import bug |
| drift: later sections pushed seconds late | `NODRIFT=1` for `align.py`: per-section windows bounded by the previous aligned end and the next cue |

Record every pin with its evidence in `TIMING.md` and `timing-fixes.json`, so a re-run of the take reproduces it. Typical
problems: low-confidence words over held notes (the previous word's sustain eats the next onset), and whisper hallucinating
"♫" or looping on whole-file passes of sung vocals. Short windows plus `--suppress-nst` and `-mc 0` fix the latter.

## 3. Treatment (one page, `STORYBOARD.md`)
- **The central metaphor**: what the words become (a spark → circuits → a city; bricks → blocks → towers).
- **Palette** (`palette.ts`): background ink, type bone, **one signal colour** (the sung word; the only thing that blooms),
  and one rare accent owned by one motif. On paper plates, sung words stay **solid ink**. A mid-tone accent washes out at
  type sizes.
- **Type roles**: Archivo across its width axis for the voice (heavy and wide for content words, narrow and light for
  small words), Plex Mono for annotations, tallies and typed text, and Cormorant italic for a storyteller register.
- **Brand** (`brand.ts`): title, host, tagline, glow tint, background vocabulary.

## 4. The edit → `app/src/project/script.ts`
`SECTIONS` maps each base section name to `(occurrence, lineCount) => [kind, lines, opts][]`. A take that sings a different
structure therefore gets a matching edit, and repeated choruses can evolve (`n`). Rules that held up across five videos:
- **A new composition every 1–2 lines.** Give each of the song's 4–8 biggest images a bespoke shot. A chorus may recur,
  but it should grow each time.
- **Instrumentals are shots too**: `['kind', 0, { at }]` or `{ afterPrev }`. A long break needs one continuous camera that
  transforms one thing into the next (nodes → blocks → bricks laid one by one → city). Don't cut between unrelated
  pictures there.
- **Holds**: `holdAfter` keeps a big word up through a gap. `holdClamp` makes sure it never covers the next line's first
  word.
- **Transitions are motifs**: carry the last image into the next shot (the city's lit windows lift off and become the
  tokens of the next line). Let a phrase join the motif that follows it rather than cutting away.
- **Loops**: frame 0 and the last frame must be pixel-identical in composition. Draw the loop element in flat screen
  space (no shot-start punch-in), with the same size, position and background values at both ends.

Plate options any shot accepts:
- `plate: 'guilloche' | 'ledger' | 'blueprint' | 'scope' | 'engrave' | 'ui' | 'halftone' | 'contour' | 'terminal' | 'stamps'`
- Plate modifiers: `plateLabel`, `plateLines: N` (the plate only under the first N lines), `plateDark` (keep a ledger dark),
  `plateStamps`, `plateTokens`, `plateAlpha`.
- Background and hold: `bg: { paper: 1, ... }`, `wash`, `holdAfter`, `holdClamp`.

Plate rules:
- Ledgers are ink on paper by default.
- **Don't alternate dark and light every shot.** Paper is for a few set pieces (ledgers, blueprints, ballots).
- Every element on a paper plate must be paper-aware. Bone or cyan on bone is invisible. Use `base(s)` / `hotK(s)` /
  `s.paper` for every colour.
- Don't put a plate behind a shot that already draws the same idiom. A scope plate behind lanes of signal looks like noise.

## 5. Compositions → `app/src/project/shots.ts`
Project shots (`EXTRA`) override library names. **Give a project shot a name the library doesn't use.** A name collision
silently renders the other shot.

Hard rules:
- **Deterministic**: a pure function of `s.t`. No `Math.random()` and no state; use `hash`, `mulberry32` and `noise1`.
- **Sync**: words appear and highlight at `w.start` (`appear`, `heat`, `slam`). Ghost-in at 0.3 alpha about 0.45 s early
  is fine. Never run ahead of the voice. Ghost words draw at scale 1, not at slam scale, or they collide.
- **Motion**: hold, then snap (`ease.outExpo`, springs) on onsets and downbeats. No floating drift. A held note can keep
  moving after the snap: expand and pull back, and scale line widths by `1/sqrt(zoom)` so strokes stay visible.
- **Swiss setting** (`typeset.ts` `row()`): content words big and heavy, small words at half size, light and narrow, on
  the same baseline. Use a hairline rule and a mono `index · m:ss.s` annotation, and flush left or right where the layout
  has room. Centred is the default. Global flush alignment caused overlaps.
- **Readability**:
  - Type at least 96 px from the frame edges once the camera settles.
  - A scrim or `band()` behind type over busy art.
  - **A band for line 2 must not draw while line 1 is up.** Multiply it by the line-2 fade, or it dims line 1.
  - Reset the font inside loops that also call `note()`, because `note()` changes `ctx.font`.
- **Glow discipline**: only signal and ember go on the glow layer `s.g`. The glow layer is not composited on paper.
- **Timing-driven geometry**: tie events to words (`findW(l, /fly/i).start`), not to absolute seconds, so a re-timed take
  re-times the shot.

## 6. Iterate on contact sheets (cheap; CPU is fine)
```sh
cd app && bun scripts/render.ts sheet --times 4,12.5,20 --cols 4 --out ../out/wip/s1.png    # or --cuts / --from A --to B --n 16
bun scripts/render.ts stills --t 122.5 --out ../out/wip/stills                               # full-res frame to sample pixels
```
Check every shot mid-phrase and on its last word for collisions, cropped words, empty frames, unreadable contrast and
flashes. For contrast questions, sample the darkest pixel of the type in a still rather than trusting a thumbnail.

## 7. Review rounds → `./review.sh <name>`
1 sub-frame, veryfast encode, 960×540 with the master's audio. Do every feedback round at this quality, and render the
final only after the edit is approved. Only **one GPU export at a time**: a second instance times out while booting. CPU
sheets can run alongside it.

## 8. Final + QA → `./render-full.sh <name>.mp4`
This renders the segments in sequence with motion blur (`--samples auto`), concatenates them, muxes the locked master and
runs `qa.sh`. `qa/report.md` must PASS:
- H.264 1920×1080 and AAC stereo.
- Frame count within one frame of the master.
- Clean full decode.

Then look at `qa/contact-sheet.jpg`, and listen to the start, the joins and the end.

## Cut-downs (15 s / 30 s)
A short is its own video, not a trim of the long one. Give it its own `script.ts` and its own compositions:
- One shot per line.
- Bigger type.
- A running cut-chrome (index, timecode, a progress hairline).
- An ending that loops to frame 0.

Time the short audio separately. A forced alignment bounded by the vocal phrases in `tools/envelope.py` beats ASR on
short clips.

## Machine notes (headless Chromium)
- GPU: `--use-angle=gl-egl --ozone-platform=headless`. The Vulkan backend can lose its context. CPU: `--use-gl=swiftshader --disable-gpu`.
- Headless screenshots don't capture the WebGL canvas, so stills and sheets use the engine's pixel readback.
- About 40 parallel font fetches exhaust Chromium's resource pool, so fonts load in batches.
- Slow first boots: `PDOOM_BOOT_TIMEOUT_MS`.
- Scripting tip: `pkill -f <pattern>` / `pgrep -f` can match your own shell's command line and kill it. Find PIDs with
  `ps -eo pid,args | awk '/pattern/ && !/awk/'` and kill by PID.

## Kinetic plate library (`app/src/scenes/kinetic/`)

Before writing bespoke shots, reach for the plate library: `signs`, `maptype`, `strips`, `press`, `pixels`, `trajectory`,
`skywrite`, `courses`, `document`, `tickets`, `detonate` (see `app/src/scenes/kinetic/README.md`). Each spans several lines
and makes the words the objects. A plate per line with a caption row above/below a picture is a lyric video: avoid it.
