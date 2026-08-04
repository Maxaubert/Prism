# Setup

Setup is a video with the UI composited over it. NSIS cannot play video, so it
plays one itself: every tick it decodes a JPEG through GDI+, alpha-blends the
screen's overlay on top, and copies the result into the bitmap a single static
control shows. There are no buttons; the same tick hit-tests the pointer.

## The pieces

| file | what it is |
|---|---|
| `over.html` | the foreground: type, buttons, the caption. The only place copy lives. |
| `make-over.cjs` | renders `over.html` into alpha overlays + `over.nsh` rectangles |
| `make-loop.cjs` | turns a source clip into the frame sequence, and makes it loop |
| `kit.nsh` | the frameless window: size, DPI, GDI+, unpacking |
| `video.nsh` | the player: decode, composite, hover, clicks, dragging |
| `pages.nsh` | the four screens, and what each click means |
| `assoc.nsh` | file type registration (offered, never taken) |
| `media/<size>/` | generated: `v/` frames, `o/` overlays. Not hand-edited. |

## Changing the words or the layout

Edit `over.html`, then regenerate both overlay sets:

```
npx electron build/installer/make-over.cjs 1440
npx electron build/installer/make-over.cjs 960
```

They write straight into `media/<size>/o`, which is what the installer packs.
Do not stage them anywhere else: an intermediate folder is a thing to forget.

## Changing the clip

```
node build/installer/make-loop.cjs "C:\path\to\clip.mp4"
```

It reports how many frames it produced; put that number in `FRAMES` in
`video.nsh`, and set `TICK` to 1000 / the clip's frame rate. The script reads
how many frames the source actually yielded and sizes the loop to fit, and
crossfades the tail into the head so the wrap is smaller than an ordinary frame
step. It prints both numbers so you can check.

## What it costs

Roughly 10 MB of frames at 800x600, plus about 3 MB of overlays. The footage
ships at one size for every display because it is defocused ink and an upscale
is invisible on it; the type is a separate overlay and renders at the display's
own resolution.
