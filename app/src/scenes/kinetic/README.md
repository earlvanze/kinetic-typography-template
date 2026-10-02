# Kinetic plate library

**The rule this library exists for:** kinetic typography, not a lyric video. A lyric video puts a line on screen (or a
caption above/below an illustration). Here the WORDS ARE THE OBJECTS: they are runway signs, cards in a rack, metal sorts,
map lettering, a flight path, smoke, stone courses, a typed page, tickets, lit windows. Each plate spans several lines
(3–8), keeps the earlier lines readable, and moves the camera through the type. Fewer plates, more lines per plate.

Use them in `project/script.ts` like any shot; project shots (`project/shots.ts` EXTRA) override them by name.

| plate | lines | the words become… | options |
|---|---|---|---|
| `signs` | 3–6 | signs standing along a ground track as they are sung, lying back as the next rises; the camera rolls through; optional lift-off after `liftLine` (later lines lie across the fields, read from the air) | `liftLine`, `hud`, `label` |
| `maptype` | 3–5 | map lettering on an engraved plat in a low continuous flyover (lateral pan follows the sung word); chosen words stand up, pins drop | `stand` (RegExp), `pins` (RegExp), `stamp`, `label` |
| `strips` | 4–8 | cards slamming into a rack (newest at the bottom, four earlier ones still legible), each stamped on its last word | `code`, `label`, `stamps[]` |
| `press` | 3–6 | metal sorts dropping into the composing stick as sung, then printed onto a feeding sheet; the press can run on the last word | `run`, `runWord`, `label` |
| `pixels` | 2–3 | one tile → a row → the screen fills; each sung word of the last line is spelled in lit windows | — |
| `trajectory` | 4–8 | glyphs riding a spark's path (loop, dip, zig-zag into a reticle, steps, climb, curl, jitter) | `shapes[]`, `label` |
| `skywrite` | 4–8 | smoke lettering written across the sky in sync (single-stroke font), complete before the line ends | `font`, `label` |
| `courses` | 3–5 | stone courses carved letter by letter, stacking upward; optional capstone | `cap`, `years` |
| `document` | 3–7 | a typed page; some lines handwritten in the margin; words struck; the last line can print on a ticket | `title`, `sub`, `margin[]`, `strike`, `ticket` |
| `tickets` | 2–5 | one word (or the phrase after `after`) per ticket, stacking | `after`, `prior`, `header` |
| `detonate` | 1 | hero words held over pdoom's outro detonation (radial streak burst, rings per beat, flash, shake), re-firing per bar, collapsing to a point | `dropAt`, `words[]`, `to` |

Toolkit (`tk.ts`): burin engraving (`engrave`, `eblock`, `ebox`, `gear`), `stampT`, `sheet`, `typed`, world-placed Swiss
type (`wrow`, `fitW`). Ground engine (`ground.ts`): `gp`/`gpath` projection, `gword`/`gline` perspective-correct type that
can stand up. `on()` returns a hard 0 before a word starts (`ease.outBack(0)` is ~2e-16, not 0: never test `> 0` on a raw
eased value to decide whether to draw).

Checklist per plate: every line readable at half resolution; no word cut by the frame or by the next plate's cut (finish
writing before the line ends); the camera never overshoots between lines (continuous travel, not per-line jumps); the
sung word is the hot one.
