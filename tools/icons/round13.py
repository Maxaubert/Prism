"""Round thirteen: video, on the settled construction.

The owner picked round twelve's SATURATED PAGE + BLACK CHIP + EXTENSION, so
that is fixed here and no longer up for judgement. What is up for judgement is
video's glyph and video's colour, both of which he rejected: the play triangle
(a play button is what a player draws, not what a file is) and the turquoise.

So the round is two questions kept apart, because asking both at once means
neither can be answered. Section one is ten glyphs in ONE colour. Section two
is one glyph in six colours. Every candidate carries its extension label -
there are no blank ones, by instruction.

The construction, the page proportion and the chip all come from round12 by
import rather than by copy, so there is one definition of the thing that was
agreed and this file only says what is new.

Nothing is carved: every sprocket, stripe and lens is drawn in the PAGE colour
on top of a solid shape, so a hole can never eat the silhouette.

    python round13.py <outdir>
    python mockups.py round13 <outdir>
"""
import pathlib
import sys

from round12 import CHIP, INK, Kind, _spec, build, contrast_note
from round5 import g

# The glyph box: below the overhanging chip, and a little wider than round12's
# because here the glyph IS the question rather than one element among several.
BOX = (3.8, 7.0, 12.2, 14.0)


# ------------------------------------------------------------------- glyphs
def strip_h(d, n, box, col, hole=None):
    """A film strip lying flat: the oldest mark for moving pictures there is."""
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    d.rounded_rectangle([g(n, x0), g(n, y0), g(n, x1), g(n, y1)],
                        radius=g(n, w * 0.06), fill=col)
    hw, hh = w * 0.115, h * 0.19
    for i in range(4):
        cx = x0 + w * 0.09 + i * w * 0.245
        for cy in (y0 + h * 0.13, y1 - h * 0.13 - hh):
            d.rounded_rectangle([g(n, cx), g(n, cy), g(n, cx + hw), g(n, cy + hh)],
                                radius=g(n, hw * 0.3), fill=hole)


def clapper(d, n, box, col, hole=None):
    """A clapperboard. The diagonal stripes are the whole recognition."""
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    top = y0 + h * 0.34
    d.rounded_rectangle([g(n, x0), g(n, top), g(n, x1), g(n, y1)],
                        radius=g(n, w * 0.05), fill=col)
    d.rounded_rectangle([g(n, x0), g(n, y0), g(n, x1), g(n, y0 + h * 0.27)],
                        radius=g(n, w * 0.04), fill=col)
    for i in range(3):
        sx = x0 + w * (0.10 + i * 0.30)
        d.polygon([(g(n, sx), g(n, y0)), (g(n, sx + w * 0.10), g(n, y0)),
                   (g(n, sx + w * 0.03), g(n, y0 + h * 0.27)),
                   (g(n, sx - w * 0.07), g(n, y0 + h * 0.27))], fill=hole)


def reel(d, n, box, col, hole=None):
    """A film reel: a disc with holes. Round, where everything else is square."""
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    r = min(w, h) / 2
    cx, cy = x0 + w / 2, y0 + h / 2
    d.ellipse([g(n, cx - r), g(n, cy - r), g(n, cx + r), g(n, cy + r)], fill=col)
    d.ellipse([g(n, cx - r * 0.20), g(n, cy - r * 0.20),
               g(n, cx + r * 0.20), g(n, cy + r * 0.20)], fill=hole)
    for dx, dy in ((0, -1), (0, 1), (-1, 0), (1, 0)):
        ox, oy = cx + dx * r * 0.55, cy + dy * r * 0.55
        rr = r * 0.21
        d.ellipse([g(n, ox - rr), g(n, oy - rr), g(n, ox + rr), g(n, oy + rr)], fill=hole)


def camcorder(d, n, box, col, hole=None):
    """A camera body with a lens barrel: the object that makes the file."""
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    d.rounded_rectangle([g(n, x0), g(n, y0 + h * 0.22), g(n, x0 + w * 0.68), g(n, y1)],
                        radius=g(n, w * 0.07), fill=col)
    d.polygon([(g(n, x0 + w * 0.70), g(n, y0 + h * 0.40)),
               (g(n, x1), g(n, y0 + h * 0.22)),
               (g(n, x1), g(n, y1)),
               (g(n, x0 + w * 0.70), g(n, y0 + h * 0.82))], fill=col)
    rr = h * 0.17
    ox, oy = x0 + w * 0.30, y0 + h * 0.61
    d.ellipse([g(n, ox - rr), g(n, oy - rr), g(n, ox + rr), g(n, oy + rr)], fill=hole)


def monitor(d, n, box, col, hole=None):
    """A screen on a stand. What you watch it on, rather than what it is."""
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    d.rounded_rectangle([g(n, x0), g(n, y0), g(n, x1), g(n, y0 + h * 0.72)],
                        radius=g(n, w * 0.06), fill=col)
    d.rectangle([g(n, x0 + w * 0.42), g(n, y0 + h * 0.72), g(n, x0 + w * 0.58), g(n, y0 + h * 0.87)],
                fill=col)
    d.rounded_rectangle([g(n, x0 + w * 0.22), g(n, y0 + h * 0.87), g(n, x0 + w * 0.78), g(n, y1)],
                        radius=g(n, h * 0.06), fill=col)


def frame(d, n, box, col, hole=None):
    """ONE film frame, sprockets down both sides. The strip, shown close up."""
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    d.rounded_rectangle([g(n, x0), g(n, y0), g(n, x1), g(n, y1)],
                        radius=g(n, w * 0.06), fill=col)
    hw, hh = w * 0.10, h * 0.17
    for i in range(3):
        cy = y0 + h * 0.13 + i * h * 0.29
        for cx in (x0 + w * 0.06, x1 - w * 0.06 - hw):
            d.rounded_rectangle([g(n, cx), g(n, cy), g(n, cx + hw), g(n, cy + hh)],
                                radius=g(n, hw * 0.3), fill=hole)


def frames2(d, n, box, col, hole=None):
    """Two frames, offset: a single picture is a photo, two are a sequence."""
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    d.rounded_rectangle([g(n, x0 + w * 0.22), g(n, y0), g(n, x1), g(n, y1 - h * 0.26)],
                        radius=g(n, w * 0.06), fill=col)
    d.rounded_rectangle([g(n, x0 + w * 0.14), g(n, y0 + h * 0.18),
                         g(n, x1 - w * 0.14), g(n, y1 - h * 0.08)],
                        radius=g(n, w * 0.07), fill=hole)
    d.rounded_rectangle([g(n, x0), g(n, y0 + h * 0.26), g(n, x1 - w * 0.22), g(n, y1)],
                        radius=g(n, w * 0.06), fill=col)


def projector(d, n, box, col, hole=None):
    """A camera with its two reels up top: unmistakable, and the most detailed."""
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    rr = h * 0.19
    for ox in (x0 + w * 0.26, x0 + w * 0.62):
        oy = y0 + rr
        d.ellipse([g(n, ox - rr), g(n, oy - rr), g(n, ox + rr), g(n, oy + rr)], fill=col)
    d.rounded_rectangle([g(n, x0), g(n, y0 + h * 0.44), g(n, x0 + w * 0.74), g(n, y1)],
                        radius=g(n, w * 0.06), fill=col)
    d.polygon([(g(n, x0 + w * 0.76), g(n, y0 + h * 0.58)),
               (g(n, x1), g(n, y0 + h * 0.44)),
               (g(n, x1), g(n, y1)),
               (g(n, x0 + w * 0.76), g(n, y0 + h * 0.86))], fill=col)


def timeline(d, n, box, col, hole=None):
    """A track with a playhead: the shape of something that has a duration."""
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    d.rounded_rectangle([g(n, x0), g(n, y0), g(n, x1), g(n, y0 + h * 0.34)],
                        radius=g(n, h * 0.12), fill=col)
    for i in range(4):
        cx = x0 + w * 0.12 + i * w * 0.25
        d.rectangle([g(n, cx), g(n, y0 + h * 0.08), g(n, cx + w * 0.05), g(n, y0 + h * 0.26)],
                    fill=hole)
    d.rounded_rectangle([g(n, x0), g(n, y0 + h * 0.56), g(n, x1), g(n, y1)],
                        radius=g(n, h * 0.12), fill=col)
    d.rounded_rectangle([g(n, x0 + w * 0.52), g(n, y0 + h * 0.46), g(n, x0 + w * 0.66), g(n, y1 + h * 0.04)],
                        radius=g(n, w * 0.04), fill=hole)


def lens(d, n, box, col, hole=None):
    """A lens: a ring and a pupil. The quietest of the ten, and the roundest."""
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    r = min(w, h) / 2
    cx, cy = x0 + w / 2, y0 + h / 2
    d.ellipse([g(n, cx - r), g(n, cy - r), g(n, cx + r), g(n, cy + r)], fill=col)
    d.ellipse([g(n, cx - r * 0.62), g(n, cy - r * 0.62),
               g(n, cx + r * 0.62), g(n, cy + r * 0.62)], fill=hole)
    d.ellipse([g(n, cx - r * 0.30), g(n, cy - r * 0.30),
               g(n, cx + r * 0.30), g(n, cy + r * 0.30)], fill=col)


def slate(d, n, box, col, hole=None):
    """A clapper seen square on, its arm raised: the stripes without the board."""
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    d.rounded_rectangle([g(n, x0), g(n, y0 + h * 0.40), g(n, x1), g(n, y1)],
                        radius=g(n, w * 0.05), fill=col)
    d.polygon([(g(n, x0), g(n, y0 + h * 0.28)), (g(n, x1), g(n, y0)),
               (g(n, x1), g(n, y0 + h * 0.14)), (g(n, x0), g(n, y0 + h * 0.42))], fill=col)
    for i in range(3):
        cx = x0 + w * (0.14 + i * 0.29)
        d.rectangle([g(n, cx), g(n, y0 + h * 0.54), g(n, cx + w * 0.08), g(n, y0 + h * 0.86)],
                    fill=hole)


GLYPHS = [
    ("strip", "Film strip, lying flat", strip_h),
    ("frame", "One film frame, sprockets both sides", frame),
    ("clapper", "Clapperboard", clapper),
    ("slate", "Clapper square on, arm raised", slate),
    ("reel", "Film reel", reel),
    ("frames2", "Two frames, offset: a sequence", frames2),
    ("monitor", "Screen on a stand", monitor),
    ("camcorder", "Camera body and lens barrel", camcorder),
    ("projector", "Camera with its two reels", projector),
    ("timeline", "Track and playhead", timeline),
]

# --------------------------------------------------------------------- colour
# Not turquoise, by instruction, and it has to stay clear of audio's indigo and
# document's slate. Video is the one kind with a strong convention behind it:
# red is film, and every player on the machine reaches for it.
COLOURS = [
    ("crimson", "Crimson", (192, 69, 60)),
    ("vermilion", "Vermilion", (210, 96, 58)),
    ("amber", "Amber", (201, 138, 43)),
    ("forest", "Forest", (63, 125, 87)),
    ("magenta", "Magenta", (178, 62, 119)),
    ("royal", "Royal blue", (47, 107, 216)),
]
LEAD = COLOURS[0][2]

EXT = "MP4"
FILE = "holiday-2024.mp4"


def _kind(colour, glyph):
    return Kind("video", EXT, colour, colour, FILE, glyph, glyph)


def _make(colour, glyph):
    k = _kind(colour, glyph)
    spec = _spec(page=k.sat, fold=INK, band=INK, band_at="chip", glyph_col=INK,
                 glyph_box=BOX, text=k.ext, text_col=k.sat, sprocket=k.sat)
    return lambda s: build(s, k, spec)


CANDIDATES = {
    "video-glyph": [(key, label, _make(LEAD, fn)) for key, label, fn in GLYPHS],
    "video-colour": [(key, label, _make(col, strip_h)) for key, label, col in COLOURS],
}

SIZES = (16, 20, 24, 32, 48)
HERO = 96
FILENAMES = {"video-glyph": FILE, "video-colour": FILE}

SECTIONS = {
    "video-glyph": "Ten glyphs, all in crimson so the shape is the only thing "
                   "changing. No play buttons: a play triangle is what a player "
                   "draws on a control, not what a file is.",
    "video-colour": "The same glyph in six colours, so colour can be judged "
                    "without the shape moving. It has to stay clear of audio's "
                    "indigo and document's slate as well as reading on both "
                    "Explorer grounds.",
}


def caption(kind, key):
    for k, _label, fn in CANDIDATES[kind]:
        if k == key:
            return contrast_note(fn(16))
    return ""


def main(out_dir):
    out = pathlib.Path(out_dir) / "round13"
    out.mkdir(parents=True, exist_ok=True)
    for kind, cands in CANDIDATES.items():
        for key, _label, fn in cands:
            for s in SIZES + (HERO,):
                fn(s).save(out / f"{kind}-{key}-{s}.png")
    print(f"{sum(len(c) for c in CANDIDATES.values())} candidates -> {out}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else ".")
