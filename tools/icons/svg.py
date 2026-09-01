"""The seven icons as SVG, monochrome, for Prism's own tree rows, search and archive panel.

THE WHOLE ICON, not a glyph. The page silhouette, the folded corner, the black
chip and the mark on it - the same composition the .ico ships - drawn in one
colour instead of seven. An earlier cut of this file emitted the bare glyphs
and that was wrong: the owner asked for the actual icons, just not colourful.

HOW THE SHAPES GET HERE. The glyph bodies are not redrawn: `Recorder`
duck-types the four ImageDraw calls the glyph functions use and records them
instead of rasterising, so the SAME functions that draw the .ico frames emit
the path data. The page, the fold and the chip are built from round12's own
constants (PX0/PY0/PX1/PY1, CUT, CHIP) rather than copied numbers, so a change
to the icon's proportions moves both outputs together.

THREE LAYERS, because a monochrome version of a two-colour icon needs one more
than the icon does:

    body  the page silhouette          -> the ink
    ko    fold, chip, and the mark     -> THE BACKGROUND BEHIND THE ICON
    hi    knockouts inside the mark    -> the ink again, painted over ko

`ko` TAKES THE BACKGROUND, NOT A PANEL TOKEN, and that distinction is the whole
correctness of this approach. Paint it from a fixed --p-panel and the icon is
right on a flat panel and wrong everywhere else: on a SELECTED row, whose fill
is the accent, the chip and fold come out as a rectangle of panel colour that
does not belong to the icon. Paint it with the same colour `ink_for` was handed
and the knockouts always match what is actually behind them - flat panel,
accent fill, tinted theme, anything built later. One value feeds both: measure
the row's resolved background once, derive the ink from it, and paint ko with
it.

`hi` exists because some marks have detail punched back out to the page colour -
the clapperboard's stripes, the comic splat's core. In the colour icon those
are simply the page showing through; in a flat monochrome stack they have to be
painted back on top. Four of the seven have no `hi` and return "".

Everything is on a 24x24 viewBox with NO refitting: the icon's own 16-unit grid
is scaled by 1.5, so the composition keeps the margins and the chip overhang it
was designed with rather than being stretched to the edges.

THE EXTENSION LABEL IS REQUIRED, and it is the FILE'S OWN extension - a .rar
says RAR, a .7z says 7Z - not a fixed word per kind. It is not a path: turning a
font into outlines here would freeze it while the app's own type moved on, so
`label` gives placement plus a size PER CHARACTER COUNT and the caller renders
<text> in the app's font. The sizes are measured against the chip with the same
bold face the .ico uses, so ZIP, WEBM and a five-character extension all fit
without spilling; pick by `len(ext)`.

COMIC IS REDUCED, deliberately. Its shipped icon is a keylined pop-art sunburst
with a warm halftone under a splat, and every one of those elements exists to
be a DIFFERENT COLOUR from the one beside it. Flattened to one colour they
become a grey rectangle. What survives monochrome is the splat, so that is what
this emits, and it is the only kind whose in-app mark is not a faithful
reduction of its icon.

    python svg.py            # the paths, ready to paste
    python svg.py --check <dir>   # write them as .svg files to look at
"""
import math
import pathlib
import sys

from final_icons import BOX as FINAL_BOX
from langs import BARE_ONLY, EXTS, MARKS
from round12 import CHIP, CUT, PX0, PX1, PY0, PY1, on_page
from round12 import lines as doc_lines
from round13 import clapper
from round14 import GLYPHS as R14
from round15 import AX0, AX1, AY1, CHIP_A, folder_zip, folder_zip_ink
from round17 import quarter
from round18 import _splat

SCALE = 1.5          # 16 grid units -> a 24x24 viewBox
# Where a page kind's mark sits - IMPORTED, not restated. This file used to
# hold its own copy of the numbers, which is exactly how round15/16/17/18 each
# ended up with a stale page rectangle: a second copy does not fail, it drifts.
BOX = FINAL_BOX
BODY, KO, HI = "body", "ko", "hi"
# The KO layer split in two, so a COLOURED icon can paint them differently:
# BAND is the fold and the label band, MARK is the glyph on the page. Monochrome
# does not care - it paints both in one ink and goes on using KO - so these are
# additive and nothing reading body/ko/hi has to change.
L_BAND, L_MARK = "band", "mark"


def u(v):
    return round(v * SCALE, 2)


class Recorder:
    """Records the ImageDraw calls the glyph functions make, per layer."""

    def __init__(self, ko_ink, hi_ink, body_ink=None):
        self.inks = {id(ko_ink): KO, id(hi_ink): HI}
        if body_ink is not None:
            self.inks[id(body_ink)] = BODY
        self.ops = []

    def _layer(self, fill):
        """Map a fill to a layer, defaulting UNKNOWN colours to the knockout.

        Dropping them was the old behaviour and it fails silently: the code
        glyph's accent bar is drawn in Prism's indigo rather than in the ink
        sentinel, and it simply vanished from the SVG. In-app everything is one
        colour anyway, so an unrecognised fill belongs with the ink - a bar that
        would have gone missing is now just monochrome, which is the point.
        """
        return self.inks.get(id(fill), KO)

    def rectangle(self, xy, fill=None, **_):
        if (lay := self._layer(fill)):
            self.ops.append((lay, "rect", (*xy, 0.0)))

    def rounded_rectangle(self, xy, radius=0.0, fill=None, **_):
        if (lay := self._layer(fill)):
            self.ops.append((lay, "rect", (*xy, float(radius))))

    def polygon(self, xy, fill=None, **_):
        if (lay := self._layer(fill)):
            self.ops.append((lay, "poly", tuple(xy)))

    def ellipse(self, xy, fill=None, **_):
        if (lay := self._layer(fill)):
            self.ops.append((lay, "ellipse", tuple(xy)))

    def arc(self, *a, **k):
        raise NotImplementedError("arc has no path emitter; add one before using it")

    def bitmap(self, *a, **k):
        raise NotImplementedError(
            "a rotated bitmap cannot be recorded as a path - see _react_layers")

    def text(self, *a, **k):
        raise NotImplementedError("the label is emitted as <text>, not as a path")


# ------------------------------------------------------------------- paths
def rect_path(x0, y0, x1, y1, r=0.0):
    a, b, c, d = u(x0), u(y0), u(x1), u(y1)
    r = round(min(r * SCALE, (c - a) / 2, (d - b) / 2), 2)
    if r <= 0.05:
        return f"M{a} {b}H{c}V{d}H{a}Z"
    return (f"M{round(a + r, 2)} {b}H{round(c - r, 2)}A{r} {r} 0 0 1 {c} {round(b + r, 2)}"
            f"V{round(d - r, 2)}A{r} {r} 0 0 1 {round(c - r, 2)} {d}"
            f"H{round(a + r, 2)}A{r} {r} 0 0 1 {a} {round(d - r, 2)}"
            f"V{round(b + r, 2)}A{r} {r} 0 0 1 {round(a + r, 2)} {b}Z")


def ellipse_path(x0, y0, x1, y1):
    """An ellipse, wound CLOCKWISE like every rectangle and polygon here.

    The direction is not cosmetic. A layer is one <path> of several subpaths
    under the default nonzero fill rule, and two subpaths wound OPPOSITE ways
    cancel where they overlap. The quarter note is exactly that overlap - a
    stem rectangle sitting on a head ellipse - and with the arcs sweeping the
    other way it came out with a quadrant punched out of the note head, on a
    shape that is solid in the .ico the very same functions draw.
    """
    a, b, c, d = u(x0), u(y0), u(x1), u(y1)
    rx, ry, cy = round((c - a) / 2, 2), round((d - b) / 2, 2), round((b + d) / 2, 2)
    return f"M{a} {cy}A{rx} {ry} 0 1 1 {c} {cy}A{rx} {ry} 0 1 1 {a} {cy}Z"


def poly_path(pts):
    return (f"M{u(pts[0][0])} {u(pts[0][1])}"
            + "".join(f"L{u(x)} {u(y)}" for x, y in pts[1:]) + "Z")


def op_path(op, p):
    if op == "rect":
        return rect_path(*p)
    if op == "ellipse":
        return ellipse_path(*p)
    return poly_path(p)


def page_path(r=1.0):
    """The page: a rounded rectangle with its top-right corner cut for the fold."""
    a, b, c, d = u(PX0), u(PY0), u(PX1), u(PY1)
    rr, cut = round(r * SCALE, 2), u(PX1 - CUT)
    return (f"M{round(a + rr, 2)} {b}H{cut}L{c} {u(PY0 + CUT)}"
            f"V{round(d - rr, 2)}A{rr} {rr} 0 0 1 {round(c - rr, 2)} {d}"
            f"H{round(a + rr, 2)}A{rr} {rr} 0 0 1 {a} {round(d - rr, 2)}"
            f"V{round(b + rr, 2)}A{rr} {rr} 0 0 1 {round(a + rr, 2)} {b}Z")


def fold_path():
    return poly_path([(PX1 - CUT, PY0), (PX1, PY0 + CUT), (PX1 - CUT, PY0 + CUT)])


BAND_H = CHIP[3] - CHIP[1]
BAND = (PX0, PY1 - BAND_H, PX1, PY1)
#: The same band in the CONTAINER's coordinates, for the archive.
ARCH_BAND = (AX0, AY1 - BAND_H, AX1, AY1)


def band_path():
    """The footer band as the KO layer wants it: a rectangle that OVERSHOOTS.

    The obvious version traces the page's own bottom corners, and it leaves a
    visible white arc at each of them. Two identical CURVED edges painted one
    over the other do not cancel: the page's edge pixel is part ink, the band's
    is part background, and part of part is a fringe. On a straight axis-aligned
    edge the coverage is exact and nothing shows; on a 1.5-unit radius it does,
    which is why the seam appeared at the two bottom corners and nowhere else.

    So the band's own edges are pushed OUTSIDE the page entirely, where its
    antialiasing has nothing of the icon to half-cover. It is painted in the
    row's own background, so the overshoot is background on background and
    cannot be seen - and the page's rounded corners are not lost, they are
    simply under a band that reaches past them.
    """
    o = 0.6
    return rect_path(BAND[0] - o, BAND[1], BAND[2] + o, BAND[3] + o)


def band_path_clipped():
    """The same band, kept inside the page, for the evenodd `solid` variant.

    A hole that strays outside the body is one crossing rather than two under
    evenodd, so the overshooting version would fill solid instead of cutting.
    """
    a, b, c, d = u(BAND[0]), u(BAND[1]), u(BAND[2]), u(BAND[3])
    r = round(1.0 * SCALE, 2)
    return (f"M{a} {b}H{c}V{round(d - r, 2)}A{r} {r} 0 0 1 {round(c - r, 2)} {d}"
            f"H{round(a + r, 2)}A{r} {r} 0 0 1 {a} {round(d - r, 2)}Z")


def rot_ellipse_path(cx, cy, rx, ry, deg):
    """An ellipse turned by `deg`, as two arcs.

    SVG's arc carries an x-axis-rotation, so a turned ellipse is expressible as
    a path where the Recorder's own `ellipse` op is not - the Recorder writes
    axis-aligned boxes, and a rotation cannot be recovered from one.
    """
    a = math.radians(deg)
    dx, dy = math.cos(a) * rx, math.sin(a) * rx
    x0, y0 = u(cx - dx), u(cy - dy)
    x1, y1 = u(cx + dx), u(cy + dy)
    rxu, ryu = u(rx), u(ry)
    return (f"M{x0} {y0}A{rxu} {ryu} {deg} 1 1 {x1} {y1}"
            f"A{rxu} {ryu} {deg} 1 1 {x0} {y0}Z")


def chip_path(chip=CHIP):
    return rect_path(*chip, 0.7)


def chip_path_clipped(chip=CHIP):
    """The chip with its overhang trimmed to the page's left edge.

    Only used by the single-path `solid` variant. Under fill-rule="evenodd" a
    hole that strays OUTSIDE the body is not a hole at all - it is one crossing
    instead of two, so it fills - and the chip's overhang would come out as a
    solid tab sticking off the side of the icon.
    """
    x0, y0, x1, y1 = chip
    return rect_path(max(x0, PX0), y0, x1, y1, 0.7)


def _fits(chip, chars, size_u):
    """Does a string of `chars` characters fit the chip at this size?

    Measured with the same Segoe UI Bold the .ico label uses, at a large
    multiple so rounding does not dominate. The app renders with its own face,
    so this is a close proxy rather than a promise - hence the 0.88 of the chip
    it is allowed to occupy rather than all of it.
    """
    from round12 import font
    f = font(size_u * 12)
    return f.getlength("W" * chars) / 12.0 <= (chip[2] - chip[0]) * 0.88


def label_size(chip, chars):
    """The largest size at which `chars` characters still fit, in viewBox units."""
    size = (chip[3] - chip[1]) * 0.62
    while size > 0.6 and not _fits(chip, chars, size):
        size *= 0.94
    return round(u(size), 2)


def label(chip=BAND, chars=3):
    """Placement for the <text>, since a font must not become outlines."""
    return {"x": u((chip[0] + chip[2]) / 2), "y": u((chip[1] + chip[3]) / 2),
            "size": label_size(chip, chars), "anchor": "middle",
            "baseline": "central",
            "sizes": {n: label_size(chip, n) for n in range(1, 7)}}


# ------------------------------------------------------------------- glyphs
def _play_disc_svg(d, n, box, col, hole):
    """VIDEO in-app: the same play disc the .ico draws.

    One divergence FEWER. The clapperboard needed a two-stripe cut in-app
    because three stripes are a pixel each at 14px and merge into a grey bar; a
    disc with one hole in it has nothing to lose at any size, so the .ico and
    the tree draw the same mark again.
    """
    x0, y0, x1, y1 = box
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    s = min(x1 - x0, y1 - y0)
    r = s * 0.45
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=col)
    d.polygon([(cx - s * 0.14, cy - s * 0.23), (cx + s * 0.24, cy),
               (cx - s * 0.14, cy + s * 0.23)], fill=hole)


def _code_guide(d, n, box, col, hole):
    """CODE in-app: an indent guide with rungs, not the shipped stepped bars.

    The .ico tells code from document with COLOUR - one bar in Prism's indigo.
    In-app everything is painted in a single ink, so that difference cannot
    survive, and code and document would both be three rounded bars in one
    colour: the same smudge in a 14px tree row. A vertical spine with rungs
    hanging off it is the same visual language - flat, geometric, knocked out
    of the page - and reads as STRUCTURE where three full-width bars read as
    prose. The third of the three deliberate divergences from the .ico, after
    the clapperboard's stripe count and the comic splat.
    """
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    d.rounded_rectangle([x0, y0, x0 + w * 0.13, y1], radius=w * 0.065, fill=col)
    for i, wide in enumerate((0.62, 0.86, 0.48)):
        y = y0 + i * h * 0.37
        d.rounded_rectangle([x0 + w * 0.28, y, x0 + w * (0.28 + wide * 0.72), y + h * 0.26],
                            radius=h * 0.07, fill=col)


def _comic_splat(d, n, box, col, hole):
    """COMIC in-app: the splat, which is the only part that survives one colour."""
    x0, y0, x1, y1 = box
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    r = min(x1 - x0, y1 - y0) / 2
    _splat(d, n, cx, cy, r, r * 0.53, 8, col, p=3.2, steps=72)
    _splat(d, n, cx, cy, r * 0.48, r * 0.23, 7, hole, p=3.2, phase=0.4, steps=72)


PAGE_GLYPHS = {
    "audio": quarter,
    "code": _code_guide,
    "comic": _comic_splat,
    "document": doc_lines,
    "image": dict((k, f) for k, _l, f in R14["image"][2])["hills"],
    "video": _play_disc_svg,
}
EXT = {"archive": "ZIP", "audio": "MP3", "code": "PY", "comic": "CBZ",
       "document": "DOCX", "image": "JPG", "video": "MP4"}


def _page_kind(fn):
    ko_ink, hi_ink = object(), object()
    r = Recorder(ko_ink, hi_ink)
    fn(r, 16, BOX, ko_ink, hi_ink)
    # KO keeps the OVERSHOOTING band; L_BAND takes the clipped one. The
    # overshoot exists to keep the band's antialiasing off the page's rounded
    # corners, and it is invisible only because the monochrome scheme paints the
    # band in the row's own background. Give the band a colour of its own and
    # that same overshoot reads as a label wider than the icon, which is what it
    # is. Clipped, the band's bottom corners ARE the page's, and its edge blends
    # with the page underneath it rather than with the panel, so no fringe.
    layers = {BODY: [page_path()], KO: [fold_path(), band_path()], HI: [],
              L_BAND: [fold_path(), band_path_clipped()], L_MARK: []}
    for lay, op, p in r.ops:
        d = op_path(op, p)
        layers[lay].append(d)
        if lay == KO:
            layers[L_MARK].append(d)
    return layers


def arch_band_path():
    """The archive's band. It OVERSHOOTS, for the reason band_path() does.

    Two identical curved edges painted one over the other leave a fringe, and
    the container has rounded bottom corners like the page does. Painted in the
    row's own background, so the overshoot cannot be seen.
    """
    o = 0.6
    h = CHIP_A[3] - CHIP_A[1]
    return rect_path(AX0 - o, AY1 - h, AX1 + o, AY1 + o)


def arch_band_path_clipped():
    """The same band inside the container, for the evenodd `solid` variant."""
    a, b, c, d = u(AX0), u(AY1 - (CHIP_A[3] - CHIP_A[1])), u(AX1), u(AY1)
    r = round(0.9 * SCALE, 2)
    return (f"M{a} {b}H{c}V{round(d - r, 2)}A{r} {r} 0 0 1 {round(c - r, 2)} {d}"
            f"H{round(a + r, 2)}A{r} {r} 0 0 1 {a} {round(d - r, 2)}Z")


def _archive():
    """A container rather than a page, and its label is a band like the rest."""
    body_ink, ko_ink, hi_ink = object(), object(), object()
    r = Recorder(ko_ink, hi_ink, body_ink)
    folder_zip(r, 16, body_ink)
    folder_zip_ink(r, 16, ko_ink, hi_ink)
    # Clipped for L_BAND, for the reason given in _page_kind.
    layers = {BODY: [], KO: [arch_band_path()], HI: [],
              L_BAND: [arch_band_path_clipped()], L_MARK: []}
    for lay, op, p in r.ops:
        d = op_path(op, p)
        layers[lay].append(d)
        # The container's own silhouette is the BODY; everything the recorder
        # put in KO after the band is the zip seam and pull, which is the mark.
        if lay == KO:
            layers[L_MARK].append(d)
    return layers


def _lang_layers(name):
    """One language mark, recorded into the same three layers a kind uses.

    The mark is drawn ON the page, so it belongs in KO - a hole in the paper -
    and the knockouts INSIDE it (the cog's bore, the cylinder's rim, the cup's
    handle) go to HI, painted back in the ink. That is the same contract the
    clapperboard's stripes already use, and it is why those three marks were
    drawn with a knockout rather than as outlines in the first place.
    """
    if name == "react":
        return _react_layers()
    ko_ink, hi_ink = object(), object()
    r = Recorder(ko_ink, hi_ink)
    MARKS[name](r, 16, BOX, ko_ink, hi_ink)
    layers = {BODY: [], KO: [], HI: []}
    for lay, op, pts in r.ops:
        layers[lay].append(op_path(op, pts))
    return layers


def _react_layers():
    """REACT in-app: three TURNED ellipses and a nucleus, drawn here by hand.

    The .ico builds its orbits by rotating a bitmap, which the Recorder cannot
    follow - it writes axis-aligned boxes, and a rotation cannot be recovered
    from one. SVG's arc carries an x-axis-rotation, so the same shape is one
    path each; and the orbits are FILLED here rather than stroked rings,
    because a ring at 14px is two hairlines with a gap that closes.
    """
    x0, y0, x1, y1 = BOX
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    s = min(x1 - x0, y1 - y0)
    ko = [rot_ellipse_path(cx, cy, s * 0.46, s * 0.14, deg) for deg in (0, 60, 120)]
    ko.append(rect_path(cx - s * 0.13, cy - s * 0.13, cx + s * 0.13, cy + s * 0.13,
                        s * 0.13))
    return {BODY: [], KO: ko, HI: []}


def langs_paths():
    """mark -> {ko, hi}. The page, the fold and the band come from the KIND."""
    out = {}
    for name in sorted(MARKS):
        layers = _lang_layers(name)
        out[name] = {"ko": " ".join(layers[KO]), "hi": " ".join(layers[HI])}
    return out


def icons():
    """kind -> {body, ko, hi, solid, label}. An empty layer means skip it.

    `solid` is every layer concatenated for fill-rule="evenodd": ONE path, one
    colour, and the knockouts are real holes rather than shapes painted in the
    panel colour. Use it wherever the ground behind the icon is not a flat known
    colour - a selected row's accent fill, an accent-tinted theme, anything
    built later - because a painted knockout would show the panel colour there
    while a hole shows whatever is actually behind.
    """
    out = {}
    for kind in sorted(EXT):
        arch = kind == "archive"
        layers = _archive() if arch else _page_kind(PAGE_GLYPHS[kind])
        out[kind] = {k: " ".join(v) for k, v in layers.items()}
        solid = list(layers[BODY])
        # The archive's low CHIP still overhangs and still has to be clipped for
        # the evenodd variant; the page kinds' BAND is inside the page already,
        # so it is a hole exactly as drawn.
        if arch:
            solid += [p for p in layers[KO] if p != arch_band_path()]
            solid += [arch_band_path_clipped()]
        else:
            solid += [p for p in layers[KO] if p != band_path()]
            solid += [band_path_clipped()]
        solid += list(layers[HI])
        out[kind]["solid"] = " ".join(solid)
        out[kind]["label"] = label(ARCH_BAND if arch else BAND)
        out[kind]["ext"] = EXT[kind]
    return out


# ------------------------------------------------------------------- contrast
# Which way round the icon goes is decided from the BACKGROUND, not from a
# theme name. Prism has custom styles - void, accent-tinted grounds, whatever is
# built later - so "is the theme dark" is a question with no reliable answer,
# while "what does this background measure" always has one.
# White and black, not Prism's near-white and near-black. Owner's call: the
# in-app icon is a monochrome mark rather than body text, so it takes the two
# extremes and gets the widest ratio available on any ground.
INK_LIGHT = (255, 255, 255)
INK_DARK = (0, 0, 0)


def _lum(c):
    def ch(v):
        v /= 255.0
        return v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4
    return 0.2126 * ch(c[0]) + 0.7152 * ch(c[1]) + 0.0722 * ch(c[2])


def contrast(a, b):
    la, lb = _lum(a), _lum(b)
    return (max(la, lb) + 0.05) / (min(la, lb) + 0.05)


def ink_for(bg):
    """The body colour for a given background: whichever contrasts more.

    No threshold and no midpoint test. A midpoint gets mid-tone grounds wrong -
    two colours either side of it can both be poor - whereas picking the better
    of the two ratios is right by construction and degrades gracefully when
    neither is good.
    """
    light, dark = contrast(INK_LIGHT, bg), contrast(INK_DARK, bg)
    return (INK_LIGHT, light) if light >= dark else (INK_DARK, dark)


# ------------------------------------------------------------------- colour
# THE COLOURED SCHEME (owner picks, 2026-09-01). The Settings control stopped
# being an arbitrary colour and became a switch of icon TYPES: monochrome, which
# is `ink_for` above measured against the style's own ground, or this.
#
# TWO COLOURS ARE PICKED PER KIND and the rest is derived, which is what stops a
# pick producing an illegible icon:
#
#     page   the ground the glyph sits on
#     band   the ground the extension sits in
#     mark   NOT PICKED - white or black, whichever contrasts more with `page`
#     text   NOT PICKED - white or black, whichever contrasts more with `band`
#     hi     always `page`: it is the knockout INSIDE the mark, so it is the
#            page showing through, in both schemes
#
# Resolved HERE rather than in the app because the picks are presets: the app
# would recompute the same six answers on every row. Change a pick and rerun.
SCHEME = {
    "archive": ("#8b8be2", "#1b1d22"),
    "audio": ("#69b485", "#1b1d22"),
    "code": ("#464646", "#000000"),
    "document": ("#6060ff", "#1b1d22"),
    "image": ("#ff8080", "#1b1d22"),
    "video": ("#5384df", "#1b1d22"),
}

# CODE IS THE ONE OVERRIDE (owner: "i want the glyph dark on code"). The rule
# would choose white on #464646 at 9.44:1; a dark glyph measures 2.22:1. Taken
# knowingly - the code icon is a dark editor and the owner asked for it to read
# that way - and recorded here rather than silently, because a value that does
# not follow the rule beside five that do is the thing a later reader will
# assume is a bug.
MARK_PICK = {"code": "#000000"}

# COMIC KEEPS ITS EXPLORER SCHEME (owner instruction) and cannot use the rule at
# all, because its mark is not ink on a page - it is one piece of a five-colour
# piece of artwork. The .ico's own splat is PINK on a sunburst of LEMON wedges;
# in-app there is no sunburst (a documented reduction, see the module docstring)
# and a pink splat straight onto the orange page measures 1.00:1 - the two
# colours are the same luminance, so it disappears entirely. MEASURED before
# choosing: cream on the same page is 3.42:1, and it also reads the way the
# monochrome splat reads, as light coming through a hole. The PAGE keeps the
# .ico's own colour, which is the half that makes it recognisable as the same
# icon.
COMIC = {"page": "#d2603a", "band": "#12141a", "mark": "#f7f2de", "text": "#f7f2de"}


def _hex(c):
    return "#%02x%02x%02x" % tuple(c)


def _rgb(h):
    return tuple(int(h[i:i + 2], 16) for i in (1, 3, 5))


def colours():
    """kind -> {page, band, mark, text}, every value a literal hex string."""
    out = {"comic": dict(COMIC)}
    for kind, (page, band) in SCHEME.items():
        out[kind] = {
            "page": page,
            "band": band,
            "mark": MARK_PICK.get(kind, _hex(ink_for(_rgb(page))[0])),
            "text": _hex(ink_for(_rgb(band))[0]),
        }
    return out


def colour_notes():
    """The measured ratios, printed when the file is generated.

    Not decoration: the two values that do NOT follow the rule (code's dark mark
    and comic's cream splat) are exactly the ones worth being able to see.
    """
    for kind, c in sorted(colours().items()):
        m = contrast(_rgb(c["mark"]), _rgb(c["page"]))
        t = contrast(_rgb(c["text"]), _rgb(c["band"]))
        yield f"{kind:9} mark {m:5.2f}:1 on {c['page']}   text {t:5.2f}:1 on {c['band']}"


def svg_for(kind, d, px=96, fg="#e9edf7", panel="#1b1d22", with_label=True, ext=None):
    lab = ""
    text = (ext or d["ext"]).upper()
    if with_label:
        L = dict(d["label"], size=d["label"]["sizes"][min(len(text), 6)])
        lab = (f'<text x="{L["x"]}" y="{L["y"]}" font-size="{L["size"]}" fill="{fg}" '
               f'text-anchor="{L["anchor"]}" dominant-baseline="{L["baseline"]}" '
               f'font-family="Segoe UI,system-ui,sans-serif" font-weight="700">{text}</text>')
    parts = [f'<path d="{d["body"]}" fill="currentColor"/>']
    if d["ko"]:
        parts.append(f'<path d="{d["ko"]}" fill="{panel}"/>')
    if d["hi"]:
        parts.append(f'<path d="{d["hi"]}" fill="currentColor"/>')
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="{px}" '
            f'height="{px}" style="color:{fg}">{"".join(parts)}{lab}</svg>')


HEADER = """// Prism's own file icons on a 24x24 viewBox, monochrome or coloured.
//
// GENERATED by `python tools/icons/svg.py` - do not hand-edit. The shapes are
// not redrawn there either: the same functions that draw the .ico frames are
// replayed into a path recorder, so the sidebar and Explorer cannot drift.
//
// THE LAYERS, and the order is load-bearing:
//
//     body        the page silhouette
//     ko          fold + band + mark, as ONE path  (monochrome only)
//     band, mark  the same two halves, separately  (coloured only)
//     hi          knockouts inside the mark, painted back OVER the mark
//
// `hi` is what keeps the comic splat's core and a language mark's own holes
// (the cog's bore, the cylinder's rim, the cup's handle) from filling in solid.
// Layers that are "" are skipped rather than painted, or an empty path draws
// the one beneath it twice.
//
// WHY KO AND BAND ARE BOTH HERE rather than one being derived from the other.
// `ko`'s band OVERSHOOTS the page by 0.6 units, which is what keeps its
// antialiasing off the page's rounded bottom corners - two identical curved
// edges painted one over the other leave a pale fringe, because the page's edge
// pixel is part ink and the band's is part background. That overshoot is
// invisible only while the band is painted in the row's own background, which
// is exactly what monochrome does. Give the band a colour of its own and the
// same overshoot reads as a label WIDER THAN THE ICON, so `band` carries the
// CLIPPED path instead, whose bottom corners are the page's own.
//
// MONOCHROME paints body and hi in the ink and ko in THE ROW'S OWN BACKGROUND,
// never a fixed panel token: on a selected row that background is the accent
// fill, and a panel token there would carry a rectangle of panel colour across
// it.
//
// COLOURED paints body in `page`, band in `band`, mark in `mark`, hi in `page`
// again, and THE LABEL FLIPS WITH THE BAND - monochrome sets the label in the
// ink inside a background-coloured band, coloured sets it in `text` inside a
// coloured one. Ink on ink is what happens if it does not.
//
// THE LABEL IS A FOOTER BAND (owner pick, 2026-09-01), not the corner tab it
// was. `label` gives its placement and a size per CHARACTER COUNT, measured by
// shrinking the widest glyph until it fits - which is what stops WEBM running
// out of the band where MP3 fits easily.
//
// LANG_PATHS is a mark per language, laid on the code kind's page in place of
// its stepped bars: two layers only, since the page, the fold and the band all
// come from the KIND. LANG_BY_EXT is the same table Explorer registers;
// LANG_BY_NAME is the app doing what Explorer cannot, because Windows
// associates on extension and `Dockerfile` has none.
"""

# Where the generated file goes, resolved from THIS file rather than from the
# working directory. It used to be a hand-run slice of stdout kept in a
# scratchpad script, which is how a generated file ends up being edited by hand.
TS_PATH = pathlib.Path(__file__).resolve().parents[2] / "src/renderer/src/lib/iconPaths.ts"


def ts_source():
    ic = icons()
    L = [HEADER.rstrip("\n"), "export const ICON_PATHS = {"]
    for kind, d in ic.items():
        L.append(f"  {kind}: {{")
        for k in (BODY, KO, L_BAND, L_MARK, HI, "solid"):
            L.append(f'    {k}: "{d[k]}",')
        lab = d["label"]
        sizes = ", ".join(f"{n}: {v}" for n, v in lab["sizes"].items())
        L.append(f'    label: {{ x: {lab["x"]}, y: {lab["y"]}, sizes: {{ {sizes} }} }},')
        L.append("  },")
    L += ["} as const", ""]

    L += [
        "// The COLOURED scheme (owner picks, 2026-09-01). Two colours are picked per",
        "// kind - the ground the glyph sits on and the ground the label sits in - and",
        "// `mark` and `text` are DERIVED, each white or black by whichever contrasts",
        "// more with what it sits on, so no pick can make an illegible icon. Resolved",
        "// in the emitter because the picks are presets: recomputing the same six",
        "// answers on every tree row would be work for nothing.",
        "//",
        "// Two values deliberately do not follow that rule. CODE's mark is dark by",
        "// owner instruction (the rule would pick white at 9.44:1; dark measures",
        "// 2.22:1), because a code file is a dark editor and he asked for it to read",
        "// that way. COMIC keeps its Explorer scheme, whose splat is one piece of a",
        "// five-colour artwork rather than ink on a page - and the .ico's own pink",
        "// splat measures 1.00:1 against its own page, which only works there because",
        "// the sunburst sits between the two.",
        "//",
        "// `hi` is not listed: it is always `page`, in both schemes.",
        "export const ICON_COLOURS: Record<",
        "  keyof typeof ICON_PATHS,",
        "  { page: string; band: string; mark: string; text: string }",
        "> = {",
    ]
    for kind, c in sorted(colours().items()):
        L.append(f"  {kind}: {{ page: '{c['page']}', band: '{c['band']}', "
                 f"mark: '{c['mark']}', text: '{c['text']}' }},")
    L += ["}", ""]

    L += ["// A mark per LANGUAGE, laid on the code kind's page in place of its",
          "// stepped bars. Two layers only: the page, the fold and the band all",
          "// come from the KIND, so a language changes the mark and nothing else.",
          "export const LANG_PATHS = {"]
    for name, d in langs_paths().items():
        L.append(f'  {name}: {{ ko: "{d["ko"]}", hi: "{d["hi"]}" }},')
    L += ["} as const", ""]

    L += ["// Which mark a file gets. BY_EXT is what Explorer registers too;",
          "// BY_NAME is the app being able to do what Explorer cannot, since",
          "// Windows associates on extension and `Dockerfile` has none.",
          "export const LANG_BY_EXT: Record<string, keyof typeof LANG_PATHS> = {"]
    for ext in sorted(EXTS):
        L.append(f"  '{ext}': '{EXTS[ext]}',")
    L += ["}", ""]

    L.append("export const LANG_BY_NAME: Record<string, keyof typeof LANG_PATHS> = {")
    for mark, names in sorted(BARE_ONLY.items()):
        for nm in names:
            L.append(f"  '{nm}': '{mark}',")
            L.append(f"  '.{nm}': '{mark}',")
    L.append("}")
    return "\n".join(L) + "\n"


def main():
    if "--check" in sys.argv:
        i = sys.argv.index("--check")
        out = pathlib.Path(sys.argv[i + 1] if len(sys.argv) > i + 1 else ".")
        out.mkdir(parents=True, exist_ok=True)
        ic = icons()
        for kind, d in ic.items():
            (out / f"{kind}.svg").write_text(svg_for(kind, d), encoding="utf-8")
        print(f"wrote {len(ic)} svg files to {out}")
        return

    src = ts_source()
    if "--stdout" in sys.argv:
        print(src, end="")
        return
    TS_PATH.write_text(src, encoding="utf-8")
    print(f"wrote {TS_PATH} ({len(src)} bytes)")
    for line in colour_notes():
        print("  " + line)


if __name__ == "__main__":
    main()
