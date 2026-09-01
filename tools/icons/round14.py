"""Round fourteen: the four remaining kinds, and the palette, kept apart.

Settled and not re-asked here: the construction (saturated page, black chip,
extension label) and video's glyph (the clapperboard).

Two lessons from round thirteen are built in. The first: asking about shape and
colour in the same picture means neither can be answered, so every glyph below
is drawn in ONE NEUTRAL GRAPHITE and colour gets a section of its own. The
second, and the owner's own correction: the colour is HIS pick, not a default I
choose and present as settled. So the palette section is the whole palette, all
fourteen, and the kinds are for him to assign - including video's, which is
still open, and including the two I picked without asking (audio's indigo and
document's slate), which are listed as taken rather than as decided.

Nothing is carved: every hole, tooth, panel and bracket is drawn in the PAGE
colour on a solid shape, so a knockout can never eat the silhouette.

    python round14.py <outdir>
    python mockups.py round14 <outdir>
"""
import pathlib
import sys

from round12 import INK, Kind, _spec, build, contrast_note
from round5 import g

BOX = (3.8, 7.0, 12.2, 14.0)
NEUTRAL = (126, 138, 160)  # a placeholder mid-slate: shape is the only question.
                           # LIGHT on purpose - the first cut used a graphite so
                           # close to the black glyph that every shape was judged
                           # through mud at 16px. The glyph has to be legible for
                           # the section to be asking about the glyph at all.


# --------------------------------------------------------------------- image
def photo_hill(d, n, box, col, hole=None):
    """A hill and a sun inside a frame: the oldest picture mark there is."""
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    d.rounded_rectangle([g(n, x0), g(n, y0), g(n, x1), g(n, y1)],
                        radius=g(n, w * 0.07), fill=col)
    r = h * 0.13
    cx, cy = x0 + w * 0.74, y0 + h * 0.28
    d.ellipse([g(n, cx - r), g(n, cy - r), g(n, cx + r), g(n, cy + r)], fill=hole)
    d.polygon([(g(n, x0 + w * 0.08), g(n, y1 - h * 0.12)),
               (g(n, x0 + w * 0.40), g(n, y0 + h * 0.42)),
               (g(n, x0 + w * 0.72), g(n, y1 - h * 0.12))], fill=hole)


def photo_hills(d, n, box, col, hole=None):
    """Two hills, no frame: the picture without the box around it."""
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    r = h * 0.15
    cx, cy = x0 + w * 0.80, y0 + r
    d.ellipse([g(n, cx - r), g(n, cy - r), g(n, cx + r), g(n, cy + r)], fill=col)
    d.polygon([(g(n, x0), g(n, y1)), (g(n, x0 + w * 0.34), g(n, y0 + h * 0.34)),
               (g(n, x0 + w * 0.68), g(n, y1))], fill=col)
    d.polygon([(g(n, x0 + w * 0.48), g(n, y1)), (g(n, x0 + w * 0.74), g(n, y0 + h * 0.56)),
               (g(n, x1), g(n, y1))], fill=col)


def polaroid(d, n, box, col, hole=None):
    """A print with a white margin under it: a photograph as an object."""
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    d.rounded_rectangle([g(n, x0), g(n, y0), g(n, x1), g(n, y1)],
                        radius=g(n, w * 0.05), fill=col)
    d.rectangle([g(n, x0 + w * 0.10), g(n, y0 + h * 0.10),
                 g(n, x1 - w * 0.10), g(n, y0 + h * 0.62)], fill=hole)


def photo_stack(d, n, box, col, hole=None):
    """Two prints, offset: one picture is a photo, a pile is a folder of them."""
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    d.rounded_rectangle([g(n, x0 + w * 0.24), g(n, y0), g(n, x1), g(n, y1 - h * 0.28)],
                        radius=g(n, w * 0.06), fill=col)
    d.rounded_rectangle([g(n, x0 + w * 0.16), g(n, y0 + h * 0.16),
                         g(n, x1 - w * 0.16), g(n, y1 - h * 0.10)],
                        radius=g(n, w * 0.07), fill=hole)
    d.rounded_rectangle([g(n, x0), g(n, y0 + h * 0.28), g(n, x1 - w * 0.24), g(n, y1)],
                        radius=g(n, w * 0.06), fill=col)


def camera(d, n, box, col, hole=None):
    """A compact camera: the thing that made the file."""
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    d.rounded_rectangle([g(n, x0 + w * 0.30), g(n, y0), g(n, x0 + w * 0.62), g(n, y0 + h * 0.20)],
                        radius=g(n, w * 0.03), fill=col)
    d.rounded_rectangle([g(n, x0), g(n, y0 + h * 0.18), g(n, x1), g(n, y1)],
                        radius=g(n, w * 0.08), fill=col)
    r = h * 0.24
    cx, cy = x0 + w / 2, y0 + h * 0.60
    d.ellipse([g(n, cx - r), g(n, cy - r), g(n, cx + r), g(n, cy + r)], fill=hole)


def aperture(d, n, box, col, hole=None):
    """A lens iris: a ring, a pupil and a blade."""
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    r = min(w, h) / 2
    cx, cy = x0 + w / 2, y0 + h / 2
    d.ellipse([g(n, cx - r), g(n, cy - r), g(n, cx + r), g(n, cy + r)], fill=col)
    d.ellipse([g(n, cx - r * 0.58), g(n, cy - r * 0.58),
               g(n, cx + r * 0.58), g(n, cy + r * 0.58)], fill=hole)
    d.polygon([(g(n, cx - r * 0.55), g(n, cy - r * 0.20)),
               (g(n, cx + r * 0.40), g(n, cy - r * 0.55)),
               (g(n, cx + r * 0.10), g(n, cy + r * 0.50))], fill=col)


def framed(d, n, box, col, hole=None):
    """A picture frame: a thick border with the picture knocked out of it."""
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    d.rounded_rectangle([g(n, x0), g(n, y0), g(n, x1), g(n, y1)],
                        radius=g(n, w * 0.06), fill=col)
    d.rounded_rectangle([g(n, x0 + w * 0.16), g(n, y0 + h * 0.18),
                         g(n, x1 - w * 0.16), g(n, y1 - h * 0.18)],
                        radius=g(n, w * 0.04), fill=hole)


def horizon(d, n, box, col, hole=None):
    """A landscape reduced to a band and a sun: the quietest of the ten."""
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    r = h * 0.20
    cx, cy = x0 + w * 0.30, y0 + h * 0.26
    d.ellipse([g(n, cx - r), g(n, cy - r), g(n, cx + r), g(n, cy + r)], fill=col)
    d.rounded_rectangle([g(n, x0), g(n, y0 + h * 0.62), g(n, x1), g(n, y0 + h * 0.80)],
                        radius=g(n, h * 0.06), fill=col)
    d.rounded_rectangle([g(n, x0 + w * 0.16), g(n, y0 + h * 0.90), g(n, x1 - w * 0.16), g(n, y1)],
                        radius=g(n, h * 0.05), fill=col)


def gallery(d, n, box, col, hole=None):
    """A grid of four pictures: an image FOLDER's worth, in one mark."""
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    d.rounded_rectangle([g(n, x0), g(n, y0), g(n, x1), g(n, y1)],
                        radius=g(n, w * 0.06), fill=col)
    for ix in (0, 1):
        for iy in (0, 1):
            cx = x0 + w * (0.10 + ix * 0.46)
            cy = y0 + h * (0.12 + iy * 0.46)
            d.rounded_rectangle([g(n, cx), g(n, cy), g(n, cx + w * 0.34), g(n, cy + h * 0.34)],
                                radius=g(n, w * 0.03), fill=hole)


def hill_wide(d, n, box, col, hole=None):
    """The framed hill again, but the frame is only the bottom two thirds."""
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    r = h * 0.16
    cx, cy = x0 + w * 0.20, y0 + r
    d.ellipse([g(n, cx - r), g(n, cy - r), g(n, cx + r), g(n, cy + r)], fill=col)
    d.rounded_rectangle([g(n, x0), g(n, y0 + h * 0.40), g(n, x1), g(n, y1)],
                        radius=g(n, w * 0.06), fill=col)
    d.polygon([(g(n, x0 + w * 0.10), g(n, y1 - h * 0.10)),
               (g(n, x0 + w * 0.44), g(n, y0 + h * 0.52)),
               (g(n, x0 + w * 0.78), g(n, y1 - h * 0.10))], fill=hole)


# ------------------------------------------------------------------- archive
def zip_folder(d, n, box, col, hole=None):
    """A zipped folder: what Windows, 7-Zip and WinRAR all reach for."""
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    d.rounded_rectangle([g(n, x0), g(n, y0), g(n, x0 + w * 0.42), g(n, y0 + h * 0.30)],
                        radius=g(n, w * 0.04), fill=col)
    d.rounded_rectangle([g(n, x0), g(n, y0 + h * 0.18), g(n, x1), g(n, y1)],
                        radius=g(n, w * 0.05), fill=col)
    cx = x0 + w * 0.46
    d.rectangle([g(n, cx), g(n, y0 + h * 0.18), g(n, cx + w * 0.09), g(n, y1)], fill=hole)
    d.rounded_rectangle([g(n, cx - w * 0.04), g(n, y0 + h * 0.56),
                         g(n, cx + w * 0.13), g(n, y0 + h * 0.86)],
                        radius=g(n, w * 0.03), fill=hole)


def crate(d, n, box, col, hole=None):
    """A box with a belt around it: a parcel, which is what an archive is."""
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    d.rounded_rectangle([g(n, x0), g(n, y0), g(n, x1), g(n, y1)],
                        radius=g(n, w * 0.06), fill=col)
    d.rectangle([g(n, x0), g(n, y0 + h * 0.40), g(n, x1), g(n, y0 + h * 0.56)], fill=hole)
    d.rectangle([g(n, x0 + w * 0.42), g(n, y0), g(n, x0 + w * 0.58), g(n, y1)], fill=hole)


def layers(d, n, box, col, hole=None):
    """Three slabs: many things stored as one, without naming the container."""
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    for i in range(3):
        y = y0 + i * h * 0.36
        d.rounded_rectangle([g(n, x0), g(n, y), g(n, x1), g(n, y + h * 0.26)],
                            radius=g(n, h * 0.07), fill=col)


def squeeze(d, n, box, col, hole=None):
    """Two arrows pressing a slab: compression, said as a verb."""
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    d.rounded_rectangle([g(n, x0), g(n, y0 + h * 0.40), g(n, x1), g(n, y0 + h * 0.60)],
                        radius=g(n, h * 0.06), fill=col)
    d.polygon([(g(n, x0 + w * 0.28), g(n, y0)), (g(n, x0 + w * 0.72), g(n, y0)),
               (g(n, x0 + w * 0.50), g(n, y0 + h * 0.30))], fill=col)
    d.polygon([(g(n, x0 + w * 0.28), g(n, y1)), (g(n, x0 + w * 0.72), g(n, y1)),
               (g(n, x0 + w * 0.50), g(n, y1 - h * 0.30))], fill=col)


def zip_teeth(d, n, box, col, hole=None):
    """A zip: the teeth and the pull, with no folder under them."""
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    d.rounded_rectangle([g(n, x0 + w * 0.30), g(n, y0), g(n, x0 + w * 0.70), g(n, y1)],
                        radius=g(n, w * 0.05), fill=col)
    for i in range(3):
        y = y0 + h * (0.08 + i * 0.20)
        d.rectangle([g(n, x0 + w * 0.16), g(n, y), g(n, x0 + w * 0.34), g(n, y + h * 0.10)],
                    fill=col)
        d.rectangle([g(n, x0 + w * 0.66), g(n, y + h * 0.10),
                     g(n, x0 + w * 0.84), g(n, y + h * 0.20)], fill=col)
    d.rounded_rectangle([g(n, x0 + w * 0.36), g(n, y0 + h * 0.70),
                         g(n, x0 + w * 0.64), g(n, y1)],
                        radius=g(n, w * 0.04), fill=hole)


def parcel(d, n, box, col, hole=None):
    """A box with a lid: the container, drawn as a container."""
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    d.rounded_rectangle([g(n, x0), g(n, y0), g(n, x1), g(n, y0 + h * 0.26)],
                        radius=g(n, w * 0.04), fill=col)
    d.rounded_rectangle([g(n, x0 + w * 0.06), g(n, y0 + h * 0.34), g(n, x1 - w * 0.06), g(n, y1)],
                        radius=g(n, w * 0.05), fill=col)
    d.rectangle([g(n, x0 + w * 0.40), g(n, y0 + h * 0.44), g(n, x0 + w * 0.60), g(n, y0 + h * 0.62)],
                fill=hole)


def stack_band(d, n, box, col, hole=None):
    """A stack of files held by a band: several files, bound."""
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    d.rounded_rectangle([g(n, x0 + w * 0.10), g(n, y0), g(n, x1 - w * 0.10), g(n, y1)],
                        radius=g(n, w * 0.05), fill=col)
    for i in range(2):
        y = y0 + h * (0.16 + i * 0.46)
        d.rectangle([g(n, x0), g(n, y), g(n, x1), g(n, y + h * 0.20)], fill=col)
        d.rectangle([g(n, x0 + w * 0.36), g(n, y), g(n, x0 + w * 0.64), g(n, y + h * 0.20)],
                    fill=hole)


def suitcase(d, n, box, col, hole=None):
    """A case with a handle: things packed to be carried somewhere."""
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    d.rounded_rectangle([g(n, x0 + w * 0.34), g(n, y0), g(n, x0 + w * 0.66), g(n, y0 + h * 0.22)],
                        radius=g(n, w * 0.04), fill=col)
    d.rounded_rectangle([g(n, x0), g(n, y0 + h * 0.20), g(n, x1), g(n, y1)],
                        radius=g(n, w * 0.06), fill=col)
    d.rectangle([g(n, x0 + w * 0.44), g(n, y0 + h * 0.20), g(n, x0 + w * 0.56), g(n, y1)],
                fill=hole)


def folder_teeth(d, n, box, col, hole=None):
    """A folder whose mouth is a zip: the folder and the zip in one shape."""
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    d.rounded_rectangle([g(n, x0), g(n, y0), g(n, x0 + w * 0.44), g(n, y0 + h * 0.28)],
                        radius=g(n, w * 0.04), fill=col)
    d.rounded_rectangle([g(n, x0), g(n, y0 + h * 0.16), g(n, x1), g(n, y1)],
                        radius=g(n, w * 0.05), fill=col)
    for i in range(4):
        cx = x0 + w * (0.12 + i * 0.20)
        d.rectangle([g(n, cx), g(n, y0 + h * 0.44), g(n, cx + w * 0.10), g(n, y0 + h * 0.60)],
                    fill=hole)


def cube(d, n, box, col, hole=None):
    """A packed cube seen corner-on: solid, and the least like a folder."""
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    cx = x0 + w / 2
    d.polygon([(g(n, cx), g(n, y0)), (g(n, x1), g(n, y0 + h * 0.26)),
               (g(n, cx), g(n, y0 + h * 0.52)), (g(n, x0), g(n, y0 + h * 0.26))], fill=col)
    d.polygon([(g(n, x0), g(n, y0 + h * 0.32)), (g(n, cx), g(n, y0 + h * 0.58)),
               (g(n, cx), g(n, y1)), (g(n, x0), g(n, y0 + h * 0.74))], fill=col)
    d.polygon([(g(n, x1), g(n, y0 + h * 0.32)), (g(n, cx), g(n, y0 + h * 0.58)),
               (g(n, cx), g(n, y1)), (g(n, x1), g(n, y0 + h * 0.74))], fill=hole)


# --------------------------------------------------------------------- comic
def open_book(d, n, box, col, hole=None):
    """An open book: what shipped, and a comic is a book you hold open."""
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    d.polygon([(g(n, x0), g(n, y0 + h * 0.14)), (g(n, x0 + w * 0.46), g(n, y0 + h * 0.30)),
               (g(n, x0 + w * 0.46), g(n, y1)), (g(n, x0), g(n, y1 - h * 0.16))], fill=col)
    d.polygon([(g(n, x1), g(n, y0 + h * 0.14)), (g(n, x0 + w * 0.54), g(n, y0 + h * 0.30)),
               (g(n, x0 + w * 0.54), g(n, y1)), (g(n, x1), g(n, y1 - h * 0.16))], fill=col)


def bubble(d, n, box, col, hole=None):
    """A speech balloon: the one mark that belongs to comics and nothing else."""
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    d.rounded_rectangle([g(n, x0), g(n, y0), g(n, x1), g(n, y0 + h * 0.70)],
                        radius=g(n, h * 0.22), fill=col)
    d.polygon([(g(n, x0 + w * 0.22), g(n, y0 + h * 0.62)),
               (g(n, x0 + w * 0.46), g(n, y0 + h * 0.62)),
               (g(n, x0 + w * 0.26), g(n, y1))], fill=col)


def panels(d, n, box, col, hole=None):
    """A page of panels: the layout is the form, and it reads at any size."""
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    d.rounded_rectangle([g(n, x0), g(n, y0), g(n, x1), g(n, y1)],
                        radius=g(n, w * 0.06), fill=col)
    d.rectangle([g(n, x0 + w * 0.09), g(n, y0 + h * 0.12),
                 g(n, x0 + w * 0.46), g(n, y0 + h * 0.46)], fill=hole)
    d.rectangle([g(n, x0 + w * 0.54), g(n, y0 + h * 0.12),
                 g(n, x1 - w * 0.09), g(n, y0 + h * 0.46)], fill=hole)
    d.rectangle([g(n, x0 + w * 0.09), g(n, y0 + h * 0.56),
                 g(n, x1 - w * 0.09), g(n, y1 - h * 0.12)], fill=hole)


def book_bubble(d, n, box, col, hole=None):
    """A book with a balloon on it: the form and the medium together."""
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    d.rounded_rectangle([g(n, x0), g(n, y0 + h * 0.22), g(n, x1 - w * 0.10), g(n, y1)],
                        radius=g(n, w * 0.05), fill=col)
    d.rectangle([g(n, x0), g(n, y0 + h * 0.22), g(n, x0 + w * 0.12), g(n, y1)], fill=hole)
    d.rounded_rectangle([g(n, x0 + w * 0.34), g(n, y0), g(n, x1), g(n, y0 + h * 0.42)],
                        radius=g(n, h * 0.14), fill=col)
    d.rounded_rectangle([g(n, x0 + w * 0.40), g(n, y0 + h * 0.08),
                         g(n, x1 - w * 0.08), g(n, y0 + h * 0.34)],
                        radius=g(n, h * 0.10), fill=hole)


def spine(d, n, box, col, hole=None):
    """A closed book, spine out: a volume rather than a page."""
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    d.rounded_rectangle([g(n, x0 + w * 0.16), g(n, y0), g(n, x1 - w * 0.16), g(n, y1)],
                        radius=g(n, w * 0.05), fill=col)
    d.rectangle([g(n, x0 + w * 0.16), g(n, y0 + h * 0.14),
                 g(n, x1 - w * 0.16), g(n, y0 + h * 0.24)], fill=hole)
    d.rectangle([g(n, x0 + w * 0.16), g(n, y1 - h * 0.24),
                 g(n, x1 - w * 0.16), g(n, y1 - h * 0.14)], fill=hole)


def burst(d, n, box, col, hole=None):
    """A star burst: the POW panel, which is comics and nothing else."""
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    cx, cy = x0 + w / 2, y0 + h / 2
    r, r2 = min(w, h) / 2, min(w, h) / 2 * 0.52
    pts = []
    from math import cos, pi, sin
    for i in range(16):
        a = pi * i / 8 - pi / 2
        rad = r if i % 2 == 0 else r2
        pts.append((g(n, cx + rad * cos(a)), g(n, cy + rad * sin(a) * (h / min(w, h)) * 0.86)))
    d.polygon(pts, fill=col)


def spread(d, n, box, col, hole=None):
    """Two pages side by side with a gutter: a spread, seen flat."""
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    for i in range(2):
        bx = x0 + i * w * 0.54
        d.rounded_rectangle([g(n, bx), g(n, y0), g(n, bx + w * 0.46), g(n, y1)],
                            radius=g(n, w * 0.04), fill=col)
        d.rectangle([g(n, bx + w * 0.08), g(n, y0 + h * 0.14),
                     g(n, bx + w * 0.38), g(n, y0 + h * 0.50)], fill=hole)


def panels_bubble(d, n, box, col, hole=None):
    """Panels with a balloon in the top one: the layout, plus the voice."""
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    d.rounded_rectangle([g(n, x0), g(n, y0), g(n, x1), g(n, y1)],
                        radius=g(n, w * 0.06), fill=col)
    d.rectangle([g(n, x0 + w * 0.09), g(n, y0 + h * 0.12), g(n, x1 - w * 0.09), g(n, y0 + h * 0.48)],
                fill=hole)
    d.rounded_rectangle([g(n, x0 + w * 0.16), g(n, y0 + h * 0.18),
                         g(n, x0 + w * 0.60), g(n, y0 + h * 0.40)],
                        radius=g(n, h * 0.08), fill=col)
    d.rectangle([g(n, x0 + w * 0.09), g(n, y0 + h * 0.58), g(n, x1 - w * 0.09), g(n, y1 - h * 0.12)],
                fill=hole)


def bookmark(d, n, box, col, hole=None):
    """A page with a ribbon: an issue you are part way through."""
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    d.rounded_rectangle([g(n, x0), g(n, y0), g(n, x1), g(n, y1)],
                        radius=g(n, w * 0.06), fill=col)
    d.polygon([(g(n, x0 + w * 0.58), g(n, y0)), (g(n, x0 + w * 0.84), g(n, y0)),
               (g(n, x0 + w * 0.84), g(n, y0 + h * 0.54)),
               (g(n, x0 + w * 0.71), g(n, y0 + h * 0.40)),
               (g(n, x0 + w * 0.58), g(n, y0 + h * 0.54))], fill=hole)


def stacked_issues(d, n, box, col, hole=None):
    """Three issues in a pile: a run of comics rather than one."""
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    for i in range(3):
        y = y0 + i * h * 0.35
        inset = w * 0.06 * (2 - i)
        d.rounded_rectangle([g(n, x0 + inset), g(n, y), g(n, x1 - inset), g(n, y + h * 0.28)],
                            radius=g(n, h * 0.06), fill=col)
        d.rectangle([g(n, x0 + inset + w * 0.08), g(n, y + h * 0.08),
                     g(n, x0 + inset + w * 0.30), g(n, y + h * 0.18)], fill=hole)


# ---------------------------------------------------------------------- code
def indent_bars(d, n, box, col, hole=None):
    """The shipped glyph: bars at stepped indents, which is what source looks like."""
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    rows = ((0.00, 0.74), (0.22, 1.00), (0.00, 0.56))
    for i, (a, b) in enumerate(rows):
        y = y0 + i * h * 0.37
        d.rounded_rectangle([g(n, x0 + w * a), g(n, y), g(n, x0 + w * b), g(n, y + h * 0.26)],
                            radius=g(n, h * 0.07), fill=col)


def chevrons(d, n, box, col, hole=None):
    """Angle brackets: the most literal mark for code there is."""
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    t = h * 0.20
    for sgn, bx in ((1, x0), (-1, x1)):
        d.polygon([(g(n, bx + sgn * w * 0.06), g(n, y0 + h * 0.50)),
                   (g(n, bx + sgn * w * 0.34), g(n, y0)),
                   (g(n, bx + sgn * w * 0.34 + sgn * w * 0.14), g(n, y0 + t * 0.5)),
                   (g(n, bx + sgn * w * 0.22), g(n, y0 + h * 0.50)),
                   (g(n, bx + sgn * w * 0.34 + sgn * w * 0.14), g(n, y1 - t * 0.5)),
                   (g(n, bx + sgn * w * 0.34), g(n, y1))], fill=col)


def chevron_slash(d, n, box, col, hole=None):
    """Brackets with a slash between them: the same, said harder."""
    chevrons(d, n, box, col, hole)
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    d.polygon([(g(n, x0 + w * 0.58), g(n, y0)), (g(n, x0 + w * 0.74), g(n, y0)),
               (g(n, x0 + w * 0.44), g(n, y1)), (g(n, x0 + w * 0.28), g(n, y1))], fill=col)


def _bracket_pair(d, n, box, col, hole, radius_f):
    """A facing bracket pair, drawn as a slab with its middle knocked out.

    Both sides are built from explicit left/right coordinates rather than from
    a signed offset: mirroring by sign produces a reversed rectangle on the
    right-hand side, which PIL refuses outright.
    """
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    arm, stem = w * 0.34, w * 0.13
    for left in (True, False):
        if left:
            ox0, ox1 = x0, x0 + arm
            kx0, kx1 = x0 + stem, x0 + arm + w * 0.05
        else:
            ox0, ox1 = x1 - arm, x1
            kx0, kx1 = x1 - arm - w * 0.05, x1 - stem
        d.rounded_rectangle([g(n, ox0), g(n, y0), g(n, ox1), g(n, y1)],
                            radius=g(n, w * radius_f), fill=col)
        d.rectangle([g(n, kx0), g(n, y0 + h * 0.20), g(n, kx1), g(n, y1 - h * 0.20)],
                    fill=hole)


def braces(d, n, box, col, hole=None):
    """Curly braces: a block, which is what a program is made of."""
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    _bracket_pair(d, n, box, col, hole, 0.13)
    for cx0, cx1 in ((x0 - w * 0.02, x0 + w * 0.16), (x1 - w * 0.16, x1 + w * 0.02)):
        d.rounded_rectangle([g(n, cx0), g(n, y0 + h * 0.42), g(n, cx1), g(n, y0 + h * 0.58)],
                            radius=g(n, w * 0.03), fill=col)


def prompt(d, n, box, col, hole=None):
    """A shell prompt: an arrow and a caret, the shape of a terminal."""
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    d.polygon([(g(n, x0 + w * 0.04), g(n, y0 + h * 0.10)),
               (g(n, x0 + w * 0.46), g(n, y0 + h * 0.48)),
               (g(n, x0 + w * 0.04), g(n, y0 + h * 0.86)),
               (g(n, x0 + w * 0.04), g(n, y0 + h * 0.58)),
               (g(n, x0 + w * 0.22), g(n, y0 + h * 0.48)),
               (g(n, x0 + w * 0.04), g(n, y0 + h * 0.38))], fill=col)
    d.rounded_rectangle([g(n, x0 + w * 0.54), g(n, y1 - h * 0.24), g(n, x1), g(n, y1)],
                        radius=g(n, h * 0.06), fill=col)


def bars_caret(d, n, box, col, hole=None):
    """Indent bars with a caret sitting in them: source, being edited."""
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    for i, (a, b) in enumerate(((0.00, 0.62), (0.22, 0.86), (0.00, 0.44))):
        y = y0 + i * h * 0.37
        d.rounded_rectangle([g(n, x0 + w * a), g(n, y), g(n, x0 + w * b), g(n, y + h * 0.26)],
                            radius=g(n, h * 0.07), fill=col)
    d.rectangle([g(n, x1 - w * 0.10), g(n, y0 + h * 0.37), g(n, x1), g(n, y0 + h * 0.63)], fill=col)


def hexrows(d, n, box, col, hole=None):
    """Rows of short blocks: bytes, which is what the hex view shows."""
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    for r in range(3):
        for c in range(4):
            bx = x0 + c * w * 0.26
            by = y0 + r * h * 0.37
            d.rounded_rectangle([g(n, bx), g(n, by), g(n, bx + w * 0.18), g(n, by + h * 0.24)],
                                radius=g(n, h * 0.05), fill=col)


def tag(d, n, box, col, hole=None):
    """A tag: a bracket pair closed around nothing, which is markup."""
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    d.rounded_rectangle([g(n, x0), g(n, y0), g(n, x1), g(n, y1)],
                        radius=g(n, w * 0.07), fill=col)
    d.polygon([(g(n, x0 + w * 0.34), g(n, y0 + h * 0.26)),
               (g(n, x0 + w * 0.18), g(n, y0 + h * 0.50)),
               (g(n, x0 + w * 0.34), g(n, y0 + h * 0.74))], fill=hole)
    d.polygon([(g(n, x1 - w * 0.34), g(n, y0 + h * 0.26)),
               (g(n, x1 - w * 0.18), g(n, y0 + h * 0.50)),
               (g(n, x1 - w * 0.34), g(n, y0 + h * 0.74))], fill=hole)


def brackets_sq(d, n, box, col, hole=None):
    """Square brackets around a dot: quieter than chevrons, and not an editor's."""
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    _bracket_pair(d, n, box, col, hole, 0.03)
    r = h * 0.16
    cx, cy = x0 + w / 2, y0 + h / 2
    d.ellipse([g(n, cx - r), g(n, cy - r), g(n, cx + r), g(n, cy + r)], fill=col)


def window_code(d, n, box, col, hole=None):
    """An editor window: a title bar over two indented lines."""
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    d.rounded_rectangle([g(n, x0), g(n, y0), g(n, x1), g(n, y1)],
                        radius=g(n, w * 0.06), fill=col)
    d.rectangle([g(n, x0), g(n, y0 + h * 0.26), g(n, x1), g(n, y0 + h * 0.30)], fill=hole)
    for i, (a, b) in enumerate(((0.10, 0.62), (0.26, 0.86))):
        y = y0 + h * (0.42 + i * 0.26)
        d.rounded_rectangle([g(n, x0 + w * a), g(n, y), g(n, x0 + w * b), g(n, y + h * 0.16)],
                            radius=g(n, h * 0.05), fill=hole)


# ------------------------------------------------------------------- palette
PALETTE = [
    ("indigo", "Indigo  (audio, taken)", (91, 91, 214)),
    ("crimson", "Crimson", (192, 69, 60)),
    ("vermilion", "Vermilion", (210, 96, 58)),
    ("rust", "Rust", (165, 85, 47)),
    ("amber", "Amber", (201, 138, 43)),
    ("olive", "Olive", (122, 139, 58)),
    ("forest", "Forest", (63, 125, 87)),
    ("teal", "Teal", (47, 143, 157)),
    ("royal", "Royal blue", (47, 107, 216)),
    ("slate", "Slate  (document, taken)", (88, 112, 143)),
    ("plum", "Plum", (126, 79, 168)),
    ("magenta", "Magenta", (178, 62, 119)),
    ("rose", "Rose", (194, 90, 114)),
    ("graphite", "Graphite", (74, 85, 104)),
]


def swatch(d, n, box, col, hole=None):
    """A neutral block for the palette section: colour with no shape opinion."""
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    for i in range(3):
        y = y0 + i * h * 0.37
        d.rounded_rectangle([g(n, x0), g(n, y), g(n, x1 - w * (0.0 if i < 2 else 0.42)),
                             g(n, y + h * 0.26)], radius=g(n, h * 0.07), fill=col)


GLYPHS = {
    "image": ("JPG", "holiday.jpg", [
        ("hill", "Hill and sun, framed", photo_hill),
        ("hills", "Two hills, unframed", photo_hills),
        ("hill-wide", "Hill in a wide frame", hill_wide),
        ("polaroid", "Print with a margin", polaroid),
        ("stack", "Two prints, offset", photo_stack),
        ("framed", "Picture frame", framed),
        ("gallery", "Grid of four", gallery),
        ("camera", "Compact camera", camera),
        ("aperture", "Lens iris", aperture),
        ("horizon", "Sun over a horizon", horizon),
    ]),
    "archive": ("ZIP", "backup-2026.zip", [
        ("zipfolder", "Zipped folder", zip_folder),
        ("folderteeth", "Folder with a zip mouth", folder_teeth),
        ("crate", "Belted box", crate),
        ("parcel", "Box with a lid", parcel),
        ("layers", "Three slabs", layers),
        ("stackband", "Bound stack of files", stack_band),
        ("zipteeth", "Zip, teeth and pull", zip_teeth),
        ("squeeze", "Arrows compressing a slab", squeeze),
        ("suitcase", "Packed case", suitcase),
        ("cube", "Cube, corner on", cube),
    ]),
    "comic": ("CBZ", "issue-012.cbz", [
        ("book", "Open book", open_book),
        ("spine", "Closed book, spine out", spine),
        ("panels", "Page of panels", panels),
        ("panelsbubble", "Panels with a balloon", panels_bubble),
        ("bubble", "Speech balloon", bubble),
        ("bookbubble", "Book and balloon", book_bubble),
        ("spread", "Two-page spread", spread),
        ("issues", "Stack of issues", stacked_issues),
        ("bookmark", "Page with a ribbon", bookmark),
        ("burst", "Star burst", burst),
    ]),
    "code": ("PY", "server.py", [
        ("bars", "Stepped indent bars (shipped)", indent_bars),
        ("barscaret", "Indent bars with a caret", bars_caret),
        ("chevrons", "Angle brackets", chevrons),
        ("chevronslash", "Brackets and a slash", chevron_slash),
        ("braces", "Curly braces", braces),
        ("bracketssq", "Square brackets and a dot", brackets_sq),
        ("tag", "Markup tag", tag),
        ("prompt", "Shell prompt", prompt),
        ("window", "Editor window", window_code),
        ("hexrows", "Rows of bytes", hexrows),
    ]),
}


def _make(colour, glyph, ext, filename):
    k = Kind("k", ext, colour, colour, filename, glyph, glyph)
    spec = _spec(page=k.sat, fold=INK, band=INK, band_at="chip", glyph_col=INK,
                 glyph_box=BOX, text=k.ext, text_col=k.sat, sprocket=k.sat)
    return lambda s: build(s, k, spec)


CANDIDATES = {
    kind: [(key, label, _make(NEUTRAL, fn, ext, fname)) for key, label, fn in items]
    for kind, (ext, fname, items) in GLYPHS.items()
}
CANDIDATES["palette"] = [
    (key, label, _make(col, swatch, "EXT", "example.ext")) for key, label, col in PALETTE
]

SIZES = (16, 20, 24, 32, 48)
HERO = 96
FILENAMES = {kind: GLYPHS[kind][1] for kind in GLYPHS}
FILENAMES["palette"] = "example.ext"

SECTIONS = {
    "image": "Ten picture marks. All in the same placeholder graphite, so the "
             "only thing changing is the shape - colour is the next section, "
             "and it is yours to assign.",
    "archive": "Ten container marks. The shipped zipped folder is first, for "
               "comparison rather than because it wins.",
    "comic": "Ten. The open book is what ships now; the balloon and the panel "
             "grid are the two marks that belong to comics alone.",
    "code": "Ten. The stepped indent bars are what ships now. The chevrons are "
            "the obvious mark and were dropped once already for being what "
            "every editor on the machine draws, so they are here to be re-judged "
            "rather than assumed dead.",
    "palette": "The whole palette, on a neutral block so nothing but the colour "
               "moves. Video's colour is still open, and audio's indigo and "
               "document's slate are marked taken rather than settled - say the "
               "word and either can move. Tell me which number goes with which "
               "kind.",
}


def caption(kind, key):
    for k, _label, fn in CANDIDATES[kind]:
        if k == key:
            return contrast_note(fn(16))
    return ""


def main(out_dir):
    out = pathlib.Path(out_dir) / "round14"
    out.mkdir(parents=True, exist_ok=True)
    for kind, cands in CANDIDATES.items():
        for key, _label, fn in cands:
            for s in SIZES + (HERO,):
                fn(s).save(out / f"{kind}-{key}-{s}.png")
    print(f"{sum(len(c) for c in CANDIDATES.values())} candidates -> {out}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else ".")
