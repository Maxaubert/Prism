---
title: Prism showcase
format: landscape
canvas: 1920x1080
duration: 35.5
music: none
frames: 7
flow: automation
storyboard: no
---

# Prism showcase

A silent trailer for the README. Real footage of the packaged app, cut against measured
marks, with the window treated as a moving object on a flat black plane and the claims
set in display type beside it.

The through-line: **the window is the hero and the type is the counterweight.** The app
never sits still under a caption. It moves aside, the words land in the space it left,
and the next move takes it back. That is the whole grammar, repeated six times, so a
viewer learns it in the first scene and reads the rest without effort.

Silent by design (`music: none`, no `SCRIPT.md`): README video autoplays muted more
often than not, and a trailer that needs sound to make sense makes none of it.

## Video direction

- **Plane.** Flat ink-black (`#08080b`), no gradient, no vignette movement. The only
  depth is the window's own shadow.
- **Chrome.** A hairline bar top and bottom. Top-left the wordmark, top-right the
  section number and name, bottom a progress hairline that advances with real elapsed
  time, so the bar is a readout rather than a decoration.
- **Type.** Segoe UI Variable Display 800, lowercase, -0.045em, 132px. Lowercase at
  that size is the graphic primitive; sentence case would read as a caption. Mono
  labels (Cascadia/Consolas) uppercase at 0.14em carry the specifics.
- **Accent.** `#5b5bd6`, the app's own indigo, used three times only: the rule under
  each display line, the progress hairline, and the split on the end card. Scarcity is
  what makes it read as the product's colour rather than the video's.
- **Motion.** One vocabulary: masked line-rise for type (`power3.out`, 0.75s, 0.08
  stagger), `power3.inOut` for every window move (1.0s), hard cuts between shots
  landing under a move so the cut is never the thing you notice.
- **Cuts.** No crossfades. The footage is continuous within a beat and cut between
  beats; the window's travel covers each seam.

## Frame 1 — open (0.0-4.8)

asset_candidates: `assets/open.mp4`

A photograph is already open when the video starts: no splash, no loading, which is the
product's actual claim. Window holds centre 1.25s, then moves to the left anchor and
scales to 0.74. Type lands right at 1.55.

- display: `open any file`
- label: `IMAGES · VIDEO · AUDIO · PDF · TEXT`

## Frame 2 — zoom (4.8-9.7)

asset_candidates: `assets/zoom.mp4`

Wheel zoom to 200%, a drag across the frame, back to fit. Window crosses to the right
anchor under the cut; type takes the left.

- display: `look closer`
- label: `FIT · ZOOM · PAN · ROTATE · FULLSCREEN`

## Frame 3 — tree (9.7-14.5)

asset_candidates: `assets/tree.mp4`

Ctrl+B, then the panel dragged wider, then a subfolder. The drag is the point: a handle
nobody drags looks like a border.

- display: `find the next one`
- label: `CTRL+B · A TREE THAT STOPS AT YOUR FOLDER`

## Frame 4 — video (14.5-20.8)

asset_candidates: `assets/video.mp4`

The only full-bleed beat. Window returns to hero scale and plays clean for 2.1s with no
type on screen, then moves left and the line lands. Giving one beat no words is what
keeps the other five from feeling like slides.

- display: `watch anything`
- label: `SEEK · SPEED · FRAME STEPS · FULLSCREEN`

## Frame 5 — audio (20.8-25.0)

asset_candidates: `assets/audio.mp4`

Cover art and the circular visualizer, running in the accent colour the style set.

- display: `listen`
- label: `COVER ART, AND A VISUALIZER IN YOUR ACCENT`

## Frame 6 — style (25.0-31.1)

asset_candidates: `assets/style.mp4`

Terminal, then light, then back to Aurora. The whole window repaints each time, which is
the payoff shot: it is not a colour picker, it is a different window.

- display: `make it yours`
- label: `STYLES · LIGHT AND DARK · ONE ACCENT`

## Frame 7 — end (31.1-35.5)

asset_candidates: `assets/rest.mp4`

The visualizer alone as the window shrinks and fades. The wordmark takes the plane, and
a single white hairline splits into three tinted lines: the prism, stated once, at the
only moment there is nothing else to look at.

- display: `prism`
- label: `GITHUB.COM/MAXAUBERT/PRISM`
- label: `FREE · WINDOWS 10 & 11 · X64`
