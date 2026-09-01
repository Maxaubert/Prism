"""Round twelve: the page, the fold, the chip. No tile, and no dilated edge.

The owner's brief, and two reference images, in one round. Both references are
the same construction at different temperatures: a flat PAGE with a folded
corner, a LABEL chip in a contrasting colour, one BOLD FLAT GLYPH, two colours,
and no outline stroke anywhere. One is muted (cream paper, dusty band, a
tone-on-tone note); the other is saturated (a blue page, a black chip, a black
silhouette). This round puts both ends on the same sheet.

Why a page is not the tile coming back. The near-black rounded tile was
rejected for reading as "an icon sitting on a background icon", and it did: a
rounded square is arbitrary chrome that says nothing about the file. A page
silhouette IS the file metaphor - it is what Windows, Office and 7-Zip all
draw - so it is the subject rather than a mat behind the subject.

It also answers the thing the tile was invented for. A bare white glyph is
invisible on Explorer light, which is why the tile existed at all; a page in a
MID-TONE colour carries its own contrast against #f7f7f7 and #202020 alike, and
the glyph is then a knockout ON it rather than a shape floating on the desktop.

Nothing is CARVED. Without a tile there is no stable outer silhouette for a
hole to sit in, so every mark here is drawn ON a solid shape in a contrasting
fill - the same lesson the tileless archive round learned the hard way.

Everything is on the sixteenths grid, so a 16px frame lands on whole pixels.

    python round12.py <outdir>
    python mockups.py round12 <outdir>
"""
import pathlib
import sys

from PIL import Image, ImageChops, ImageDraw, ImageFont

from icons import S
from round5 import g

# ------------------------------------------------------------------ palette
PAPER = (234, 231, 220)       # the first reference's cream
PAPER_FOLD = (212, 208, 193)  # the dog-ear, one step down
INK = (18, 20, 26)            # the second reference's black chip and silhouette
WHITE = (244, 246, 251)


def mix(a, b, t):
    return tuple(int(x + (y - x) * t) for x, y in zip(a, b))


class Kind:
    """A file kind: its two temperatures, its filename, its two glyphs."""

    def __init__(self, name, ext, muted, sat, filename, glyph, alt):
        self.name, self.ext = name, ext
        self.muted, self.sat = muted, sat
        self.filename = filename
        self.glyph, self.alt = glyph, alt

    @property
    def tone(self):
        """The tone-on-tone glyph: the band's colour sunk into the paper."""
        return mix(PAPER, self.muted, 0.45)


FONT_PATHS = ("C:/Windows/Fonts/segoeuib.ttf", "C:/Windows/Fonts/arialbd.ttf")


def font(px):
    for p in FONT_PATHS:
        try:
            return ImageFont.truetype(p, max(1, int(px)))
        except OSError:
            continue
    return ImageFont.load_default()


# --------------------------------------------------------------------- page
# 10 wide by 13 tall. MEASURED off the references rather than guessed: the
# uncropped first one is 434x570 (0.761) and the second is 408x571 (0.715),
# against 0.857 for the 12x14 this round started at - which is what read as
# stretched. 10:13 is 0.769, the closest whole-unit fit to the pair, and whole
# units are not negotiable: a half-unit edge lands on a half-covered pixel
# column at 16px, which is a soft edge in the one frame that has to be crisp.
#
# The page stands on a baseline (1 unit below, 2 above) rather than sitting
# centred. A file icon reads as an object resting on something, and the fold
# wants the air at the top anyway.
#
# IT GREW (2026-08-31). MEASURED against Explorer, not adjusted by eye: in one
# column of the owner's own screenshot, Adobe's .pdf glyph is 36px tall and our
# .cbz is 30px, which with our page at 13/16 of its frame puts that frame at
# 36.9px - so Adobe fills 97.5% of the same box and we filled 81%. A page icon
# beside a page icon is exactly where a sixth of a difference reads.
#
# 11 by 15 now. WHOLE UNITS, which is why it is not the 12 by 15.6 that would
# have held 0.769 exactly: a fractional edge lands on a half-covered pixel row
# at 16px, and 16px is the frame that has to be crisp. 11:15 is 0.733, which is
# actually CLOSER to the reference pair (0.761 and 0.715, mean 0.738) than the
# 0.769 it replaces, so the aspect moved toward the references rather than away.
#
# PX0 STAYS 3.0 on purpose: the chip overhangs to its left, and had the page
# been centred at 12 wide (2 to 14) that overhang would have had to halve to
# stay on the frame. Growing rightward and downward instead keeps it whole. The
# page is then 3 units from the left and 2 from the right, which is not off
# centre so much as balancing the overhang: the composition's own span is
# 0.8-14, centre 7.4, against a frame centre of 8 - closer to centred than the
# 6.9 it was.
PX0, PY0, PX1, PY1 = 3.0, 1.0, 14.0, 16.0
CUT = 3.0

# The page it grew FROM. Numbers written against that rectangle - a chip, a
# glyph box, a band - are carried onto the current one by `on_page` rather than
# re-eyeballed, so the composition scales as a whole and one edit moves it all.
_WAS = (3.0, 2.0, 13.0, 15.0)


def on_page(box, keep_left=False):
    """A box drawn against the old page, expressed on the current one.

    `keep_left` pins the left edge where it is instead of scaling it, which is
    what the CHIP wants: its overhang is a fixed bite out of the frame's left
    margin, and scaling it would push it off the frame.
    """
    ox0, oy0, ox1, oy1 = _WAS
    sx = (PX1 - PX0) / (ox1 - ox0)
    sy = (PY1 - PY0) / (oy1 - oy0)
    fx = lambda v: PX0 + (v - ox0) * sx  # noqa: E731
    fy = lambda v: PY0 + (v - oy0) * sy  # noqa: E731
    x0, y0, x1, y1 = box
    return (x0 if keep_left else fx(x0), fy(y0), fx(x1), fy(y1))


def fold_points():
    """The dog-ear, as three points. Written out in five files before this."""
    return [(PX1 - CUT, PY0), (PX1, PY0 + CUT), (PX1 - CUT, PY0 + CUT)]


def page_mask(n):
    """The page silhouette: a rounded rect with the top-right corner cut off."""
    m = Image.new("L", (n, n), 0)
    d = ImageDraw.Draw(m)
    d.rounded_rectangle([g(n, PX0), g(n, PY0), g(n, PX1), g(n, PY1)],
                        radius=g(n, 1.0), fill=255)
    d.polygon([(g(n, PX1 - CUT), g(n, PY0) - 2), (g(n, PX1) + 2, g(n, PY0) - 2),
               (g(n, PX1) + 2, g(n, PY0 + CUT))], fill=0)
    return m


def draw_page(img, n, body, fold):
    """Paste the page through its mask, then lay the dog-ear on top."""
    sheet = Image.new("RGBA", (n, n), tuple(body) + (255,))
    img.paste(sheet, (0, 0), page_mask(n))
    flap = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    ImageDraw.Draw(flap).polygon(
        [(g(n, x), g(n, y)) for x, y in fold_points()],
        fill=tuple(fold) if len(fold) == 4 else tuple(fold) + (255,))
    img.alpha_composite(flap)


# ------------------------------------------------------------------- glyphs
# Each glyph draws inside a box in grid units, so the same glyph serves a page
# (small, sitting above a band) and a bare icon (large, filling the frame).
def note(d, n, box, col, _k=None):
    """An eighth note, solid. A stroked note is four hairlines at 16px."""
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    stem_w = w * 0.17
    sx = x0 + w * 0.58
    d.rectangle([g(n, sx), g(n, y0), g(n, sx + stem_w), g(n, y0 + h * 0.76)], fill=col)
    d.polygon([(g(n, sx + stem_w), g(n, y0)),
               (g(n, x1), g(n, y0 + h * 0.20)),
               (g(n, x1), g(n, y0 + h * 0.46)),
               (g(n, sx + stem_w), g(n, y0 + h * 0.26))], fill=col)
    d.ellipse([g(n, x0), g(n, y0 + h * 0.54), g(n, sx + stem_w), g(n, y1)], fill=col)


def bars(d, n, box, col, _k=None):
    """A level meter: the shape of sound without a note."""
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    pitch = w / 5.0
    for i, f in enumerate((0.45, 0.78, 1.0, 0.62, 0.34)):
        bh = h * f
        cx = x0 + pitch * i
        d.rounded_rectangle(
            [g(n, cx), g(n, y0 + (h - bh) / 2), g(n, cx + pitch * 0.64), g(n, y0 + (h + bh) / 2)],
            radius=g(n, pitch * 0.32), fill=col)


def play(d, n, box, col, _k=None):
    """A play triangle."""
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    d.polygon([(g(n, x0 + w * 0.14), g(n, y0)),
               (g(n, x0 + w * 0.14), g(n, y1)),
               (g(n, x1), g(n, y0 + h / 2))], fill=col)


def strip(d, n, box, col, hole=None):
    """A film strip: sprockets drawn in the ground colour, never punched out."""
    hole = hole or PAPER
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    d.rounded_rectangle([g(n, x0), g(n, y0), g(n, x1), g(n, y1)],
                        radius=g(n, w * 0.07), fill=col)
    hw, hh = w * 0.12, h * 0.18
    for i in range(4):
        cx = x0 + w * 0.09 + i * w * 0.24
        for cy in (y0 + h * 0.13, y1 - h * 0.13 - hh):
            d.rounded_rectangle([g(n, cx), g(n, cy), g(n, cx + hw), g(n, cy + hh)],
                                radius=g(n, hw * 0.32), fill=hole)


def lines(d, n, box, col, _k=None):
    """Three text lines, the last one short, which is what a paragraph is.

    THREE and not four, for the reason the code glyph already carries: four
    bars in this box leave a sub-pixel gap at 16px and the top two merge into
    one smudge. Three at a fatter pitch survive the details view, and three
    lines say "text" exactly as well as four.
    """
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    pitch = h / 3.0
    for i in range(3):
        wide = w if i < 2 else w * 0.58
        y = y0 + i * pitch
        d.rounded_rectangle([g(n, x0), g(n, y), g(n, x0 + wide), g(n, y + pitch * 0.55)],
                            radius=g(n, pitch * 0.27), fill=col)


def titled(d, n, box, col, _k=None):
    """A heading block over two lines: a titled page, not a paragraph."""
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    d.rounded_rectangle([g(n, x0), g(n, y0), g(n, x0 + w * 0.64), g(n, y0 + h * 0.27)],
                        radius=g(n, h * 0.10), fill=col)
    for i in range(2):
        y = y0 + h * (0.48 + i * 0.30)
        wide = w if i == 0 else w * 0.68
        d.rounded_rectangle([g(n, x0), g(n, y), g(n, x0 + wide), g(n, y + h * 0.20)],
                            radius=g(n, h * 0.09), fill=col)


KINDS = {
    # The label is the EXTENSION, not the kind. One example each is enough to
    # judge the design; the shipping path passes the real one per file type.
    "audio": Kind("audio", "MP3", (124, 106, 166), (91, 91, 214),
                  "interlude.mp3", note, bars),
    "video": Kind("video", "MP4", (84, 132, 142), (14, 140, 166),
                  "holiday-2024.mp4", play, strip),
    "document": Kind("document", "DOCX", (116, 128, 143), (88, 112, 143),
                     "contract.docx", lines, titled),
}


# --------------------------------------------------------------- treatments
# A treatment is (key, label, spec). The spec says how to build the icon; one
# renderer reads them all, so the ten differ in data rather than in code and
# the same glyph can be judged in every setting.
def _spec(**kw):
    base = dict(page=None, fold=None, band=None, band_at="bottom", text=None,
                text_col=None, glyph="glyph", glyph_col=None, glyph_box=None,
                sprocket=None)
    base.update(kw)
    return base


# 4 of the page's old 13 units: the 0.31 of its height that the first
# reference's band occupies, measured off the original. Derived now, so it
# holds that proportion whatever the page is.
BAND_TOP = on_page((0.0, 11.0, 0.0, 11.0))[1]
# The overhanging top-left chip of reference two. Its LEFT edge is pinned: the
# overhang is a bite out of the frame's margin rather than a part of the page,
# so it does not scale with one. Everything else does, which is also what gives
# a four or five character extension more room than it had.
CHIP = on_page((0.8, 2.8, 9.6, 6.6), keep_left=True)


def build(size, k, spec):
    n = size * S
    img = Image.new("RGBA", (n, n), (0, 0, 0, 0))

    if spec["page"] is not None:
        draw_page(img, n, spec["page"], spec["fold"])

    layer = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)

    if spec["band"] is not None and spec["band_at"] == "bottom":
        d.rectangle([g(n, PX0), g(n, BAND_TOP), g(n, PX1), g(n, PY1)],
                    fill=tuple(spec["band"]))

    box = spec["glyph_box"]
    fn = getattr(k, spec["glyph"])
    fn(d, n, box, tuple(spec["glyph_col"]), spec["sprocket"])

    # Anything drawn on the page is clipped to the page, so a band picks up the
    # rounded bottom corners and a glyph can never spill onto the desktop.
    if spec["page"] is not None:
        img.alpha_composite(Image.composite(
            layer, Image.new("RGBA", (n, n), (0, 0, 0, 0)), page_mask(n)))
    else:
        img.alpha_composite(layer)

    if spec["band"] is not None and spec["band_at"] == "chip":
        chip = Image.new("RGBA", (n, n), (0, 0, 0, 0))
        cd = ImageDraw.Draw(chip)
        cd.rounded_rectangle([g(n, CHIP[0]), g(n, CHIP[1]), g(n, CHIP[2]), g(n, CHIP[3])],
                             radius=g(n, 0.7), fill=tuple(spec["band"]))
        img.alpha_composite(chip)

    if spec["text"]:
        (tx, ty), f = label_layout(n, spec)
        ImageDraw.Draw(img).text((tx, ty), spec["text"], font=f,
                                 fill=tuple(spec["text_col"]), anchor="mm")

    return img.resize((size, size), Image.LANCZOS)


def label_layout(n, spec):
    """Where the extension sits and how big it gets, shared by both renderers.

    The label SHRINKS to fit rather than spilling: MP3 is three characters and
    WEBM is four, and a band that a longer one runs out of is a band that only
    works for the extensions it was tried on.
    """
    if spec["band_at"] == "chip":
        centre = (CHIP[0] + CHIP[2]) / 2, (CHIP[1] + CHIP[3]) / 2
        fh = (CHIP[3] - CHIP[1]) * 0.62
        room = g(n, (CHIP[2] - CHIP[0]) * 0.86)
    else:
        centre = (PX0 + PX1) / 2, (BAND_TOP + PY1) / 2
        fh = (PY1 - BAND_TOP) * 0.60
        room = g(n, (PX1 - PX0) * 0.86)
    f = font(g(n, fh))
    while f.getlength(spec["text"]) > room and fh > 0.6:
        fh *= 0.92
        f = font(g(n, fh))
    return (g(n, centre[0]), g(n, centre[1])), f


def build_layers(size, k, spec):
    """The same icon as build(), split into a tintable PAGE and a black INK layer.

    The construction is exactly two colours - a page, and ink on top of it - and
    every knockout (a sprocket, a panel, the extension text) is an ABSENCE of ink
    rather than a third colour. That is what makes the split lossless, and it is
    what lets a sheet recolour the whole set live from one <input type="color">
    instead of baking a PNG per colour per candidate per size.

    Returns (page, ink): page is white with the silhouette in its alpha, so CSS
    can mask a background colour through it; ink is black over transparent.
    """
    n = size * S
    m = page_mask(n)
    page = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    page.paste(Image.new("RGBA", (n, n), (255, 255, 255, 255)), (0, 0), m)

    # INK's real value, not pure black: the layer carries the ink COLOUR and
    # only the page is tinted, so an approximation here is a visible constant
    # error across every mark in the set.
    K, T = tuple(INK) + (255,), (0, 0, 0, 0)
    ink = Image.new("RGBA", (n, n), T)
    d = ImageDraw.Draw(ink)
    d.polygon([(g(n, PX1 - CUT), g(n, PY0)), (g(n, PX1), g(n, PY0 + CUT)),
               (g(n, PX1 - CUT), g(n, PY0 + CUT))], fill=K)
    if spec["band"] is not None and spec["band_at"] == "bottom":
        d.rectangle([g(n, PX0), g(n, BAND_TOP), g(n, PX1), g(n, PY1)], fill=K)
    getattr(k, spec["glyph"])(d, n, spec["glyph_box"], K, T)

    # Clipped to the page BEFORE the chip, because the chip overhangs it.
    ink = Image.composite(ink, Image.new("RGBA", (n, n), T), m)
    if spec["band"] is not None and spec["band_at"] == "chip":
        ImageDraw.Draw(ink).rounded_rectangle(
            [g(n, CHIP[0]), g(n, CHIP[1]), g(n, CHIP[2]), g(n, CHIP[3])],
            radius=g(n, 0.7), fill=K)

    if spec["text"]:
        # Subtracted from the alpha rather than drawn transparent: the letters
        # have to be a HOLE in the chip so the page colour shows through them,
        # and that has to survive whatever colour is chosen later.
        (tx, ty), f = label_layout(n, spec)
        cut = Image.new("L", (n, n), 0)
        ImageDraw.Draw(cut).text((tx, ty), spec["text"], font=f, fill=255, anchor="mm")
        ink.putalpha(ImageChops.subtract(ink.getchannel("A"), cut))
        # The letters JOIN the page layer as well as cutting the ink. The chip
        # OVERHANGS the page's left edge, so part of the first character sits
        # where there is no page behind it: cutting alone would leave a hole
        # straight through to the desktop instead of a page-coloured letter.
        page.putalpha(ImageChops.lighter(page.getchannel("A"), cut))

    return (page.resize((size, size), Image.LANCZOS),
            ink.resize((size, size), Image.LANCZOS))


_on_page = on_page


def treatments(k):
    """The ten, spread from the muted reference to the saturated one."""
    # Written against the page, so they follow it when it changes size.
    on_page = _on_page((4.5, 3.8, 11.5, 10.2))    # sits above a bottom band
    full_page = _on_page((4.5, 4.6, 11.5, 12.4))  # no band, centred on the page
    chip_page = _on_page((4.0, 7.2, 12.0, 13.8))  # below the overhanging chip
    bare = (1.6, 1.4, 14.4, 14.6)       # no page at all, so nothing to match
    return [
        ("muted", "Muted page, band, tone-on-tone glyph|(reference 1)",
         _spec(page=PAPER, fold=PAPER_FOLD, band=k.muted, glyph_col=k.tone,
               glyph_box=on_page, sprocket=PAPER)),
        ("muted-word", "Muted page, band with the extension",
         _spec(page=PAPER, fold=PAPER_FOLD, band=k.muted, glyph_col=k.tone,
               glyph_box=on_page, text=k.ext, text_col=PAPER, sprocket=PAPER)),
        ("muted-white", "Muted page, band, glyph in the band colour",
         _spec(page=PAPER, fold=PAPER_FOLD, band=k.muted, glyph_col=k.muted,
               glyph_box=on_page, sprocket=PAPER)),
        ("sat-chip", "Saturated page, black chip, black glyph|(reference 2)",
         _spec(page=k.sat, fold=INK, band=INK, band_at="chip", glyph_col=INK,
               glyph_box=chip_page, sprocket=k.sat)),
        ("sat-chip-word", "Saturated page, black chip with the extension",
         _spec(page=k.sat, fold=INK, band=INK, band_at="chip", glyph_col=INK,
               glyph_box=chip_page, text=k.ext, text_col=k.sat,
               sprocket=k.sat)),
        ("sat-plain", "Saturated page, white glyph, no chip",
         _spec(page=k.sat, fold=mix(k.sat, WHITE, 0.30), glyph_col=WHITE,
               glyph_box=full_page, sprocket=k.sat)),
        ("sat-band", "Saturated page, darker band, white glyph",
         _spec(page=k.sat, fold=mix(k.sat, WHITE, 0.30), band=mix(k.sat, INK, 0.42),
               glyph_col=WHITE, glyph_box=on_page, sprocket=k.sat)),
        ("paper-only", "Cream page, coloured glyph, no band at all",
         _spec(page=PAPER, fold=PAPER_FOLD, glyph_col=k.muted,
               glyph_box=full_page, sprocket=PAPER)),
        ("bare", "No page: the glyph alone, mid-tone",
         _spec(glyph_col=k.sat, glyph_box=bare, sprocket=(0, 0, 0, 0))),
        ("bare-alt", "No page: the alternate glyph alone",
         _spec(glyph="alt", glyph_col=k.sat, glyph_box=bare, sprocket=(0, 0, 0, 0))),
    ]


# ------------------------------------------------------------------- sheet
def _lum(c):
    def ch(v):
        v /= 255.0
        return v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4
    return 0.2126 * ch(c[0]) + 0.7152 * ch(c[1]) + 0.0722 * ch(c[2])


def _ratio(a, b):
    la, lb = _lum(a), _lum(b)
    hi, lo = max(la, lb), min(la, lb)
    return (hi + 0.05) / (lo + 0.05)


def contrast_note(img):
    """What the 16px frame actually weighs against both Explorer grounds.

    The alpha-weighted mean colour of the rendered icon, measured rather than
    assumed - the tile existed because a white glyph scores about 1.1 against
    Explorer light, and the whole point of dropping it is that the replacement
    has to score on BOTH grounds without one.
    """
    px = img.convert("RGBA").load()
    tot = [0.0, 0.0, 0.0, 0.0]
    for y in range(img.height):
        for x in range(img.width):
            r, gr, b, a = px[x, y]
            w = a / 255.0
            tot[0] += r * w
            tot[1] += gr * w
            tot[2] += b * w
            tot[3] += w
    if tot[3] < 0.5:
        return "no coverage"
    mean = tuple(int(tot[i] / tot[3]) for i in range(3))
    return (f"mean ink #{mean[0]:02x}{mean[1]:02x}{mean[2]:02x} - "
            f"{_ratio(mean, (247, 247, 247)):.1f}:1 on light, "
            f"{_ratio(mean, (32, 32, 32)):.1f}:1 on dark")


CANDIDATES = {
    kind: [(key, label, (lambda s, kk=k, sp=spec: build(s, kk, sp)))
           for key, label, spec in treatments(k)]
    for kind, k in KINDS.items()
}

SIZES = (16, 20, 24, 32, 48)
HERO = 96

FILENAMES = {kind: k.filename for kind, k in KINDS.items()}

SECTIONS = {
    "audio": "An eighth note on nine settings, plus the level meter as an "
             "alternate. The muted row is your first reference; the saturated "
             "row is your second.",
    "video": "A play triangle, with the film strip as the alternate. The strip's "
             "sprockets are drawn in the ground colour rather than punched out, "
             "because a hole with no tile behind it eats the silhouette.",
    "document": "Text lines, with a titled page as the alternate. Document is "
                "the kind whose glyph competes most with the page it sits on, "
                "so the quietest treatments are worth a hard look here.",
}

def caption(kind, key):
    """The sheet asks for this per candidate; measured off the 16px frame."""
    for k, _label, fn in CANDIDATES[kind]:
        if k == key:
            return contrast_note(fn(16))
    return ""


def main(out_dir):
    out = pathlib.Path(out_dir) / "round12"
    out.mkdir(parents=True, exist_ok=True)
    for kind, cands in CANDIDATES.items():
        for key, _label, fn in cands:
            for s in SIZES + (HERO,):
                fn(s).save(out / f"{kind}-{key}-{s}.png")
    print(f"{sum(len(c) for c in CANDIDATES.values())} candidates -> {out}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else ".")
