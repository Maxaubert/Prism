"""Round seventeen: the last two kinds. Audio's notehead, and comic, properly inked.

AUDIO. The owner's note is exact: the notehead is too wide. It was an ellipse
0.75 of the glyph box across and 0.46 down - about 2:1 - and a real notehead is
nearer 1.4:1. Flat and wide reads as a spoon rather than a note. So the note
candidates here are drawn to musical proportions, and the round carries the
other ways of saying "sound" beside them so the note is chosen rather than
assumed.

COMIC, third attempt, and this time with a theory rather than more shapes.
Rounds fifteen and sixteen drew flat polygon bursts and they read as clip art.
What was missing is that comic art is INKED: a black keyline around every
coloured shape, Ben-Day dots for tone, and lettering set inside the burst. That
is the whole visual language, and none of the previous candidates had any of
it. The keyline is drawn by stamping the shape once in ink slightly larger and
once in colour on top - never by dilating an alpha channel, which is the
technique the owner rejected for the rest of the set and which would eat these
silhouettes anyway.

Both kinds keep the two-layer split, so the picker still tints them: audio is a
tintable page with ink on it, comic is a tintable ground with baked artwork.

    python round17.py <outdir>
"""
import pathlib
import sys

from PIL import Image, ImageDraw

from icons import S
from round12 import CHIP, INK, Kind, _spec, build_layers, font, page_mask
from round15 import BLUE, PAPER, RED, YELLOW, _label_at
from round16 import LIGHT, LIGHTER, SHADE, _jag
from round5 import g

BOX = (3.8, 7.0, 12.2, 14.0)
INK_A = tuple(INK) + (255,)
PAPER_A = PAPER + (255,)
RED_A, YELLOW_A, BLUE_A = RED + (255,), YELLOW + (255,), BLUE + (255,)
CX, CY = 8.0, 9.2


# ========================================================================= audio
def _head(d, box, n, col, cx, cy, w):
    """A notehead at musical proportions: 1.4 wide to 1 tall, not 2 to 1."""
    h = w / 1.4
    d.ellipse([g(n, cx - w / 2), g(n, cy - h / 2), g(n, cx + w / 2), g(n, cy + h / 2)], fill=col)


def _stem(d, n, x, y0, y1, t, col):
    d.rectangle([g(n, x), g(n, y0), g(n, x + t), g(n, y1)], fill=col)


def eighth(d, n, box, col, _k=None):
    """An eighth note, notehead sized like a notehead."""
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    hw = w * 0.50
    hx, hy = x0 + hw / 2 + w * 0.02, y1 - (hw / 1.4) / 2
    t = w * 0.15
    sx = hx + hw / 2 - t
    _stem(d, n, sx, y0, hy, t, col)
    d.polygon([(g(n, sx + t), g(n, y0)), (g(n, x1), g(n, y0 + h * 0.22)),
               (g(n, x1), g(n, y0 + h * 0.46)), (g(n, sx + t), g(n, y0 + h * 0.26))], fill=col)
    _head(d, box, n, col, hx, hy, hw)


def sixteenth(d, n, box, col, _k=None):
    """Two flags: unmistakably a note, and slightly busier."""
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    hw = w * 0.48
    hx, hy = x0 + hw / 2 + w * 0.02, y1 - (hw / 1.4) / 2
    t = w * 0.15
    sx = hx + hw / 2 - t
    _stem(d, n, sx, y0, hy, t, col)
    for i in range(2):
        oy = y0 + h * 0.24 * i
        d.polygon([(g(n, sx + t), g(n, oy)), (g(n, x1), g(n, oy + h * 0.20)),
                   (g(n, x1), g(n, oy + h * 0.40)), (g(n, sx + t), g(n, oy + h * 0.22))],
                  fill=col)
    _head(d, box, n, col, hx, hy, hw)


def quarter(d, n, box, col, _k=None):
    """No flag at all: the quietest note, and the one that never smudges."""
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    hw = w * 0.56
    hx, hy = x0 + hw / 2 + w * 0.08, y1 - (hw / 1.4) / 2
    t = w * 0.17
    _stem(d, n, hx + hw / 2 - t, y0, hy, t, col)
    _head(d, box, n, col, hx, hy, hw)


def beamed(d, n, box, col, _k=None):
    """Two notes under one beam: the mark for music rather than for one note."""
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    hw = w * 0.34
    t = w * 0.12
    for i, (hx, hy) in enumerate(((x0 + hw / 2, y1 - (hw / 1.4) / 2),
                                  (x1 - hw / 2, y1 - h * 0.26 - (hw / 1.4) / 2))):
        _stem(d, n, hx + hw / 2 - t, y0 + h * (0.0 if i else 0.14), hy, t, col)
        _head(d, box, n, col, hx, hy, hw)
    d.polygon([(g(n, x0 + hw / 2 + hw / 2 - t), g(n, y0 + h * 0.14)),
               (g(n, x1 - hw / 2 + hw / 2), g(n, y0)),
               (g(n, x1 - hw / 2 + hw / 2), g(n, y0 + h * 0.20)),
               (g(n, x0 + hw / 2 + hw / 2 - t), g(n, y0 + h * 0.34))], fill=col)


def bars(d, n, box, col, _k=None):
    """A level meter: sound with no notation in it."""
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    pitch = w / 5.0
    for i, f in enumerate((0.42, 0.76, 1.0, 0.60, 0.32)):
        bh = h * f
        cx = x0 + pitch * i
        d.rounded_rectangle([g(n, cx), g(n, y0 + (h - bh) / 2),
                             g(n, cx + pitch * 0.64), g(n, y0 + (h + bh) / 2)],
                            radius=g(n, pitch * 0.32), fill=col)


def wave(d, n, box, col, _k=None):
    """A waveform: symmetric bars about a centre line."""
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    pitch = w / 7.0
    for i, f in enumerate((0.28, 0.56, 0.88, 1.0, 0.72, 0.44, 0.24)):
        bh = h * f
        cx = x0 + pitch * i
        d.rounded_rectangle([g(n, cx + pitch * 0.16), g(n, y0 + (h - bh) / 2),
                             g(n, cx + pitch * 0.84), g(n, y0 + (h + bh) / 2)],
                            radius=g(n, pitch * 0.34), fill=col)


def speaker(d, n, box, col, _k=None):
    """A speaker cone, no waves: one solid mass."""
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    d.rectangle([g(n, x0), g(n, y0 + h * 0.32), g(n, x0 + w * 0.26), g(n, y1 - h * 0.32)],
                fill=col)
    d.polygon([(g(n, x0 + w * 0.24), g(n, y0 + h * 0.30)), (g(n, x0 + w * 0.62), g(n, y0)),
               (g(n, x0 + w * 0.62), g(n, y1)), (g(n, x0 + w * 0.24), g(n, y1 - h * 0.30))],
              fill=col)


def speaker_waves(d, n, box, col, _k=None):
    """The cone with two arcs: the most literal 'this makes sound'."""
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    d.rectangle([g(n, x0), g(n, y0 + h * 0.34), g(n, x0 + w * 0.20), g(n, y1 - h * 0.34)],
                fill=col)
    d.polygon([(g(n, x0 + w * 0.18), g(n, y0 + h * 0.32)), (g(n, x0 + w * 0.50), g(n, y0)),
               (g(n, x0 + w * 0.50), g(n, y1)), (g(n, x0 + w * 0.18), g(n, y1 - h * 0.32))],
              fill=col)
    for i, r in enumerate((0.28, 0.50)):
        d.arc([g(n, x0 + w * 0.36), g(n, y0 + h * (0.5 - r)),
               g(n, x0 + w * (0.62 + r * 0.9)), g(n, y0 + h * (0.5 + r))],
              -58, 58, fill=col, width=int(g(n, w * 0.09)))


def headphones(d, n, box, col, _k=None):
    """Headphones: a band and two cups. Listening, rather than notation."""
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    d.arc([g(n, x0 + w * 0.06), g(n, y0), g(n, x1 - w * 0.06), g(n, y0 + h * 1.15)],
          182, 358, fill=col, width=int(g(n, h * 0.20)))
    for cx in (x0 + w * 0.16, x1 - w * 0.16):
        d.rounded_rectangle([g(n, cx - w * 0.12), g(n, y0 + h * 0.48),
                             g(n, cx + w * 0.12), g(n, y1)],
                            radius=g(n, w * 0.09), fill=col)


def disc(d, n, box, col, _k=None):
    """A record: a disc with a hole. Round, where the rest are upright."""
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    r = min(w, h) / 2
    cx, cy = x0 + w / 2, y0 + h / 2
    d.ellipse([g(n, cx - r), g(n, cy - r), g(n, cx + r), g(n, cy + r)], fill=col)


def disc_ring(d, n, box, col, hole=None):
    """The record with its label and spindle knocked out."""
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    r = min(w, h) / 2
    cx, cy = x0 + w / 2, y0 + h / 2
    d.ellipse([g(n, cx - r), g(n, cy - r), g(n, cx + r), g(n, cy + r)], fill=col)
    d.ellipse([g(n, cx - r * 0.40), g(n, cy - r * 0.40),
               g(n, cx + r * 0.40), g(n, cy + r * 0.40)], fill=hole)
    d.ellipse([g(n, cx - r * 0.12), g(n, cy - r * 0.12),
               g(n, cx + r * 0.12), g(n, cy + r * 0.12)], fill=col)


def note_bars(d, n, box, col, _k=None):
    """A note standing in a level meter: notation and sound in one mark."""
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    for i, f in enumerate((0.44, 0.72, 0.34)):
        bh = h * f
        cx = x0 + i * w * 0.20
        d.rounded_rectangle([g(n, cx), g(n, y1 - bh), g(n, cx + w * 0.13), g(n, y1)],
                            radius=g(n, w * 0.065), fill=col)
    hw = w * 0.34
    hx, hy = x0 + w * 0.66 + hw / 2 - w * 0.06, y1 - (hw / 1.4) / 2
    t = w * 0.12
    _stem(d, n, hx + hw / 2 - t, y0, hy, t, col)
    d.polygon([(g(n, hx + hw / 2), g(n, y0)), (g(n, x1), g(n, y0 + h * 0.18)),
               (g(n, x1), g(n, y0 + h * 0.38)), (g(n, hx + hw / 2), g(n, y0 + h * 0.22))],
              fill=col)
    _head(d, box, n, col, hx, hy, hw)


AUDIO = [
    ("eighth", "Eighth note, notehead 1.4:1", eighth),
    ("sixteenth", "Sixteenth note, two flags", sixteenth),
    ("quarter", "Quarter note, no flag", quarter),
    ("beamed", "Two notes under a beam", beamed),
    ("notebars", "Note standing in a meter", note_bars),
    ("bars", "Level meter", bars),
    ("wave", "Waveform", wave),
    ("speaker", "Speaker cone", speaker),
    ("speakerwaves", "Speaker with waves", speaker_waves),
    ("headphones", "Headphones", headphones),
    ("disc", "Record", disc),
    ("discring", "Record with a label", disc_ring),
]


def audio_layers(size, glyph, ext="MP3"):
    obj = Kind("k", ext, (0, 0, 0), (0, 0, 0), "interlude.mp3", glyph, glyph)
    spec = _spec(page=(0, 0, 0), fold=INK, band=INK, band_at="chip", glyph_col=INK,
                 glyph_box=BOX, text=ext, text_col=(0, 0, 0), sprocket=(0, 0, 0))
    return build_layers(size, obj, spec)


def audio_flat(size, glyph, colour, ext="MP3"):
    body, ink = audio_layers(size, glyph, ext)
    out = Image.new("RGBA", body.size, (0, 0, 0, 0))
    out.paste(Image.new("RGBA", body.size, tuple(colour) + (255,)), (0, 0), body)
    out.alpha_composite(ink)
    return out


# ========================================================================= comic
# Inked, which is what the last two rounds were missing. Every coloured shape is
# stamped once in ink slightly larger and once in colour on top - a KEYLINE, the
# way comic art is actually made. Not an alpha dilation: that is the technique
# the owner rejected for the rest of the set, and tileless it eats silhouettes.
def _ink_star(d, n, cx, cy, r, col, points=10, inner=0.5, key=0.55):
    from round15 import _star
    _star(d, n, cx, cy, r + key, INK_A, points, inner)
    _star(d, n, cx, cy, r, col, points, inner)


def _ink_jag(d, n, cx, cy, r, col, points=11, inner=0.6, twist=0.0, key=0.55):
    _jag(d, n, cx, cy, r + key, INK_A, points, inner, twist)
    _jag(d, n, cx, cy, r, col, points, inner, twist)


def _dots(d, n, box, col, step=1.15, r=0.30):
    x0, y0, x1, y1 = box
    for iy in range(int((y1 - y0) / step) + 1):
        for ix in range(int((x1 - x0) / step) + 1):
            cx = x0 + ix * step + (step / 2 if iy % 2 else 0)
            cy = y0 + iy * step
            if cx > x1 or cy > y1:
                continue
            d.ellipse([g(n, cx - r), g(n, cy - r), g(n, cx + r), g(n, cy + r)], fill=col)


def _word(d, n, text, cx, cy, size_u, col, outline=None):
    f = font(g(n, size_u))
    if outline:
        for dx, dy in ((-1, 0), (1, 0), (0, -1), (0, 1), (-1, -1), (1, -1), (-1, 1), (1, 1)):
            d.text((g(n, cx) + dx * g(n, 0.34), g(n, cy) + dy * g(n, 0.34)),
                   text, font=f, fill=outline, anchor="mm")
    d.text((g(n, cx), g(n, cy)), text, font=f, fill=col, anchor="mm")


P = (3.0, 2.0, 13.0, 15.0)


def art_pow(d, n):
    """A burst with the word in it: the single most comic-book image there is."""
    _dots(d, n, P, SHADE, 1.2, 0.32)
    _ink_jag(d, n, CX, CY, 5.6, YELLOW_A, 11, 0.58)
    _word(d, n, "POW", CX, CY, 3.1, RED_A, INK_A)


def art_bam(d, n):
    _dots(d, n, P, SHADE, 1.2, 0.32)
    _ink_jag(d, n, CX, CY, 5.6, RED_A, 10, 0.60, twist=0.2)
    _word(d, n, "BAM", CX, CY, 3.2, YELLOW_A, INK_A)


def art_star_inked(d, n):
    """Round fifteen's winner, inked and dotted. The direct comparison."""
    from round15 import _rays
    _rays(d, n, CX, CY, LIGHT, 14, 14)
    _dots(d, n, (P[0], P[1], P[2], P[1] + 5.0), SHADE, 1.1, 0.30)
    _ink_star(d, n, CX, CY, 5.0, YELLOW_A)
    _ink_star(d, n, CX, CY, 2.9, PAPER_A, key=0.35)


def art_hero_inked(d, n):
    """The other winner, inked: a red cape with a keyline, and a figure on it.

    Rebuilt. Inking it the first way made the cape's keyline and the figure the
    same black, and the two merged into one arch with a star on it. The cape is
    WIDER than the figure by a clear margin now, so red flanks the silhouette
    instead of hiding behind it.
    """
    from round15 import _rays
    _rays(d, n, CX, CY, LIGHTER, 14, 15)
    _dots(d, n, (P[0], P[1] + 7.0, P[2], P[3]), SHADE, 1.15, 0.30)
    d.polygon([(g(n, 5.5), g(n, 7.0)), (g(n, 2.9), g(n, 15.0)),
               (g(n, 13.1), g(n, 15.0)), (g(n, 10.5), g(n, 7.0))], fill=INK_A)
    d.polygon([(g(n, 6.0), g(n, 7.7)), (g(n, 3.9), g(n, 14.4)),
               (g(n, 12.1), g(n, 14.4)), (g(n, 10.0), g(n, 7.7))], fill=RED_A)
    d.ellipse([g(n, 6.6), g(n, 4.8), g(n, 9.4), g(n, 7.6)], fill=INK_A)
    d.polygon([(g(n, 6.2), g(n, 15.0)), (g(n, 6.6), g(n, 8.0)),
               (g(n, 9.4), g(n, 8.0)), (g(n, 9.8), g(n, 15.0))], fill=INK_A)
    _ink_star(d, n, CX, 10.6, 1.5, YELLOW_A, 5, 0.46, key=0.3)


def art_cowl(d, n):
    """A domino mask, inked: the one piece of costume that needs no body.

    Rebuilt. The full cowl with ears was eight polygon points of detail that
    collapsed into a dark blob on the way down; a domino mask is two shapes and
    survives, which is why round fifteen's version of it read and this one did
    not.
    """
    _dots(d, n, P, SHADE, 1.2, 0.32)
    d.rounded_rectangle([g(n, 3.3), g(n, 6.1), g(n, 12.7), g(n, 10.7)],
                        radius=g(n, 1.9), fill=INK_A)
    d.rounded_rectangle([g(n, 3.9), g(n, 6.7), g(n, 12.1), g(n, 10.1)],
                        radius=g(n, 1.5), fill=RED_A)
    for cx in (6.2, 9.8):
        d.polygon([(g(n, cx - 1.35), g(n, 8.0)), (g(n, cx + 1.35), g(n, 7.4)),
                   (g(n, cx + 1.35), g(n, 9.0)), (g(n, cx - 1.35), g(n, 9.4))],
                  fill=INK_A)


def art_panel_burst(d, n):
    """A panel with a burst breaking its border: comics' oldest trick."""
    d.rectangle([g(n, P[0] + 0.8), g(n, P[1] + 1.4), g(n, P[2] - 0.8), g(n, P[3] - 1.4)],
                fill=INK_A)
    d.rectangle([g(n, P[0] + 1.4), g(n, P[1] + 2.0), g(n, P[2] - 1.4), g(n, P[3] - 2.0)],
                fill=PAPER_A)
    _dots(d, n, (P[0] + 1.4, P[1] + 2.0, P[2] - 1.4, P[3] - 2.0), (214, 58, 48, 90), 1.1, 0.34)
    _ink_jag(d, n, CX, CY, 4.9, YELLOW_A, 10, 0.58)


def art_bolt_inked(d, n):
    from round15 import _rays
    _rays(d, n, CX, CY, LIGHT, 14, 15)
    _ink_jag(d, n, CX, CY, 5.4, YELLOW_A, 12, 0.66)
    d.polygon([(g(n, 9.6), g(n, 4.6)), (g(n, 5.9), g(n, 9.9)), (g(n, 8.0), g(n, 9.9)),
               (g(n, 6.6), g(n, 13.9)), (g(n, 10.3), g(n, 8.3)), (g(n, 8.2), g(n, 8.3))],
              fill=INK_A)


def art_exclaim(d, n):
    _dots(d, n, P, SHADE, 1.2, 0.32)
    _ink_jag(d, n, CX, CY, 5.6, RED_A, 11, 0.56)
    _word(d, n, "!", CX, CY - 0.2, 6.4, YELLOW_A, INK_A)


def art_zap(d, n):
    from round15 import _rays
    _rays(d, n, CX, CY, LIGHT, 12, 14)
    _ink_jag(d, n, CX, CY, 5.7, BLUE_A, 10, 0.58, twist=0.3)
    _word(d, n, "ZAP", CX, CY, 3.0, YELLOW_A, INK_A)


def art_two_panel(d, n):
    """Two panels and a burst across the seam: a page, at icon size."""
    for i in range(2):
        y = P[1] + 1.0 + i * 6.2
        d.rectangle([g(n, P[0] + 0.8), g(n, y), g(n, P[2] - 0.8), g(n, y + 5.4)], fill=INK_A)
        d.rectangle([g(n, P[0] + 1.4), g(n, y + 0.6), g(n, P[2] - 1.4), g(n, y + 4.8)],
                    fill=PAPER_A if i else BLUE_A)
    _dots(d, n, (P[0] + 1.4, P[1] + 7.8, P[2] - 1.4, P[1] + 12.0), (46, 110, 196, 90), 1.1, 0.32)
    _ink_jag(d, n, CX, 8.4, 3.6, YELLOW_A, 10, 0.58)


def art_fist_inked(d, n):
    from round15 import _rays
    _rays(d, n, CX, CY, LIGHT, 12, 14)
    _ink_jag(d, n, CX, CY, 5.8, YELLOW_A, 10, 0.60)
    d.rounded_rectangle([g(n, 5.5), g(n, 6.8), g(n, 10.5), g(n, 11.0)],
                        radius=g(n, 1.6), fill=INK_A)
    d.ellipse([g(n, 4.5), g(n, 8.1), g(n, 7.2), g(n, 10.7)], fill=INK_A)
    d.polygon([(g(n, 6.3), g(n, 10.8)), (g(n, 9.7), g(n, 10.8)),
               (g(n, 10.3), g(n, 13.6)), (g(n, 5.7), g(n, 13.6))], fill=RED_A)


def art_banner(d, n):
    """A sunburst under a banner: a cover, reduced to two shapes."""
    from round15 import _rays
    _rays(d, n, CX, CY + 1.0, LIGHTER, 16, 15)
    _ink_star(d, n, CX, CY + 1.4, 4.4, YELLOW_A, 12, 0.62)
    d.polygon([(g(n, 2.6), g(n, 5.0)), (g(n, 13.4), g(n, 3.6)),
               (g(n, 13.4), g(n, 7.0)), (g(n, 2.6), g(n, 8.4))], fill=INK_A)
    d.polygon([(g(n, 3.2), g(n, 5.6)), (g(n, 12.8), g(n, 4.4)),
               (g(n, 12.8), g(n, 6.4)), (g(n, 3.2), g(n, 7.6))], fill=RED_A)


COMICS = [
    ("pow", "POW in an inked burst", art_pow, (91, 91, 214)),
    ("bam", "BAM in an inked burst", art_bam, (91, 91, 214)),
    ("starinked", "Round 15's star, now inked and dotted", art_star_inked, RED),
    ("heroinked", "Round 15's hero, now inked", art_hero_inked, YELLOW),
    ("cowl", "A cowl: mask, eyes, ears", art_cowl, (91, 91, 214)),
    ("panelburst", "Burst breaking a panel border", art_panel_burst, RED),
    ("boltinked", "Lightning in an inked burst", art_bolt_inked, BLUE),
    ("exclaim", "A single inked !", art_exclaim, YELLOW),
    ("zap", "ZAP in an inked burst", art_zap, RED),
    ("twopanel", "Two panels, burst across the seam", art_two_panel, (91, 91, 214)),
    ("fistinked", "Inked fist out of the burst", art_fist_inked, RED),
    ("banner", "Sunburst under a banner", art_banner, BLUE),
]


def comic_layers(size, accents, ext="CBZ"):
    n = size * S
    m = page_mask(n)
    body = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    body.paste(Image.new("RGBA", (n, n), (255, 255, 255, 255)), (0, 0), m)
    art = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    accents(ImageDraw.Draw(art), n)
    art = Image.composite(art, Image.new("RGBA", (n, n), (0, 0, 0, 0)), m)
    d = ImageDraw.Draw(art)
    d.polygon([(g(n, 10.0), g(n, 2.0)), (g(n, 13.0), g(n, 5.0)),
               (g(n, 10.0), g(n, 5.0))], fill=INK_A)
    d.rounded_rectangle([g(n, CHIP[0]), g(n, CHIP[1]), g(n, CHIP[2]), g(n, CHIP[3])],
                        radius=g(n, 0.7), fill=INK_A)
    (tx, ty), f = _label_at(n, ext, CHIP)
    d.text((tx, ty), ext, font=f, fill=PAPER_A, anchor="mm")
    return (body.resize((size, size), Image.LANCZOS),
            art.resize((size, size), Image.LANCZOS))


def comic_flat(size, accents, ground, ext="CBZ"):
    body, art = comic_layers(size, accents, ext)
    out = Image.new("RGBA", body.size, (0, 0, 0, 0))
    out.paste(Image.new("RGBA", body.size, tuple(ground) + (255,)), (0, 0), body)
    out.alpha_composite(art)
    return out


SIZES = (16, 20, 24, 32, 48)
HERO = 96
AUDIO_COLOUR = (105, 180, 133)   # the owner's #69b485
COMIC_COLOUR = (91, 91, 214)     # the owner's #5b5bd6

CANDIDATES = {
    "audio": [(k, l, (lambda s, F=fn: audio_flat(s, F, AUDIO_COLOUR))) for k, l, fn in AUDIO],
    "comic": [(k, l, (lambda s, A=a, G=gr: comic_flat(s, A, G))) for k, l, a, gr in COMICS],
}
FILENAMES = {"audio": "interlude.mp3", "comic": "issue-012.cbz"}
SECTIONS = {
    "audio": "In your green. The notehead is drawn at 1.4:1 now rather than the "
             "2:1 that made the old one read as a spoon, and the other ways of "
             "saying sound sit beside the notes so the note is chosen rather "
             "than assumed.",
    "comic": "Inked. Every coloured shape carries a black keyline, the ground "
             "carries Ben-Day dots, and several carry lettering - which is what "
             "the last two rounds were missing. Grounds shown are starting "
             "points; the picker tints them.",
}


def caption(kind, key):
    from round12 import contrast_note
    for k, _l, fn in CANDIDATES[kind]:
        if k == key:
            return contrast_note(fn(16))
    return ""


def main(out_dir):
    out = pathlib.Path(out_dir) / "round17"
    out.mkdir(parents=True, exist_ok=True)
    for key, _l, fn in AUDIO:
        for s in SIZES + (HERO,):
            audio_flat(s, fn, AUDIO_COLOUR).save(out / f"audio-{key}-{s}.png")
    for key, _l, art, gr in COMICS:
        for s in SIZES + (HERO,):
            comic_flat(s, art, gr).save(out / f"comic-{key}-{s}.png")
    print(f"{len(AUDIO)} audio + {len(COMICS)} comic -> {out}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else ".")
