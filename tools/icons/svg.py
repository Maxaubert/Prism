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
from round15 import AX0, AX1, AY0, AY1, CHIP_A, folder_zip, folder_zip_ink
from round17 import quarter
from round18 import CREAM, CX, CY, INK_A, LEMON_A, PINK_A, _frame, _ink_splat, _splat

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
# And the MONOCHROME half of ko, stated rather than sliced off the front of
# it. The app used to take `ko.split(/(?=M)/).slice(0, 2)` to get the fold and
# band when a language mark replaced the kind's own, which is positional: it
# is right only while the fold and band are exactly the first two subpaths,
# and a third leading subpath would silently drop half a fold rather than
# fail. The emitter knows the answer, so it says it.
L_KOBAND = "koBand"
# And the fold and band as rectangles that BLEED past the silhouette, to be
# drawn inside a clip. See bleed_path().
L_BLEED = "bleed"


def u(v):
    return round(v * SCALE, 2)


class ColourRecorder:
    """Records the ImageDraw calls with their ACTUAL fill, in draw order.

    `Recorder` maps a fill onto one of three LAYERS, which is all a monochrome
    icon needs. The comic is not monochrome: it is a keylined sunburst under a
    halftone under a splat, and every one of those exists to be a different
    colour from the one beside it. So this one keeps the colour.

    Ops are grouped into runs of the same fill afterwards. An alternating
    sunburst therefore emits one path per wedge, which is more paths than a
    hand-written version would use and is the price of the artwork being
    REPLAYED rather than redrawn - the .ico and the tree cannot drift.
    """

    def __init__(self):
        self.ops = []

    def _add(self, kind, params, fill):
        if fill is None:
            return
        self.ops.append((tuple(fill), kind, params))

    def rectangle(self, xy, fill=None, **_):
        self._add("rect", (*xy, 0.0), fill)

    def rounded_rectangle(self, xy, radius=0.0, fill=None, **_):
        self._add("rect", (*xy, float(radius)), fill)

    def polygon(self, xy, fill=None, **_):
        self._add("poly", tuple(xy), fill)

    def ellipse(self, xy, fill=None, **_):
        self._add("ellipse", tuple(xy), fill)

    def text(self, *a, **k):
        raise NotImplementedError("BAM is emitted as <text>, like the extension")


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


def bleed_path():
    """The fold and the band as RECTANGLES that overrun the page on every side.

    Meant to be drawn behind a MASK of `body`, and that pairing is the whole
    point: THE SILHOUETTE IS DEFINED EXACTLY ONCE, by the clip, and everything
    inside it is opaque. Both artefacts the coloured scheme kept producing come
    from breaking that.

    Painting the band OVER the page leaves a hairline of page colour around the
    outside, because the two share a curved outer edge and the page's own
    partial coverage survives underneath the band's. Painting them as ABUTTING
    regions instead leaves a seam, because two antialiased edges meeting at 50%
    each composite to 75% rather than 100% - MEASURED at 239 pixels of seam per
    icon on a 256px render, so it is not theoretical. Monochrome shows neither,
    because there the band is painted in the row's own background and both
    artefacts are background-coloured.

    Masking removes the question. The rectangles carry no rounded corner and no
    diagonal of their own - the fold's hypotenuse and the band's two bottom
    corners come from the mask, so they cannot disagree with the page by
    construction - and every edge that would otherwise have been shared now
    falls outside the mask entirely.

    A MASK RATHER THAN A CLIP PATH, measured: Chromium applies clip-path to each
    child and composites the results, so two children that both reach the
    outline double-composite there and the edge lands at 75% where the path
    itself gives 50%. A mask applies to the group's finished result. Against the
    bare silhouette: mask 0 pixels different, clip-path 79, clip-path inside an
    opacity layer 39.
    """
    o = 2.0
    fold = rect_path(PX1 - CUT, PY0 - o, PX1 + o, PY0 + CUT)
    band = rect_path(PX0 - o, BAND[1], PX1 + o, PY1 + o)
    return f"{fold} {band}"


def arch_bleed_path():
    """The same for the container, which has no fold.

    The top comes from CHIP_A the way `arch_band_path` does, NOT from
    ARCH_BAND: that constant is built from the page's chip height and lands
    0.28 units higher, so taking it would have made the coloured band taller
    than the monochrome one on the archive alone.
    """
    o = 2.0
    return rect_path(AX0 - o, AY1 - (CHIP_A[3] - CHIP_A[1]), AX1 + o, AY1 + o)


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
       "document": "DOCX", "image": "JPG", "video": "MP4",
       # Not a kind: the disc is its own SHAPE for one extension (round 33).
       "iso": "ISO"}


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
              L_BAND: [fold_path(), band_path_clipped()],
              L_KOBAND: [fold_path(), band_path()],
              L_BLEED: [bleed_path()], L_MARK: []}
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
              L_BAND: [arch_band_path_clipped()],
              L_KOBAND: [arch_band_path()],
              L_BLEED: [arch_bleed_path()], L_MARK: []}
    for lay, op, p in r.ops:
        d = op_path(op, p)
        layers[lay].append(d)
        # The container's own silhouette is the BODY; everything the recorder
        # put in KO after the band is the zip seam and pull, which is the mark.
        if lay == KO:
            layers[L_MARK].append(d)
    return layers


# ------------------------------------------------------------------- the disc
# THE .ISO IS A DISC IN THE APP (owner, 2026-09-03, round 33 pick). It is filed
# as an archive - it opens read-only through 7-Zip like a .7z - and in Explorer
# the Prism.Iso class keeps the container artwork, because the owner said to
# leave Explorer alone where it already used the archive icon. In the tree it
# is a disc: one silhouette with its hole knocked out, the extension on the
# same foot band every kind wears, clipped to the circle. Nothing else on it -
# at 16px each extra mark costs a pixel the hole needs (rounds 33's ring and
# sheen both fell to that).
DISC = (0.5, 0.5, 15.5, 15.5)
DISC_C, DISC_R = 8.0, 7.5
DISC_HOLE = 2.1
DISC_BAND = (DISC[0] + 1.2, DISC[3] - BAND_H, DISC[2] - 1.2, DISC[3])


def disc_band_path():
    """The foot band, overshooting the disc for the reason band_path gives."""
    o = 0.6
    return rect_path(DISC[0] - o, DISC_BAND[1], DISC[2] + o, DISC[3] + o)


def disc_band_path_clipped():
    """The same band kept inside the circle: a chord, its arc along the foot."""
    y0 = DISC_BAND[1]
    dx = (DISC_R ** 2 - (y0 - DISC_C) ** 2) ** 0.5
    a, b, yy, R = u(DISC_C - dx), u(DISC_C + dx), u(y0), u(DISC_R)
    # Left point to right point by way of the bottom: on a y-down canvas that
    # is the anticlockwise sweep (0), and under half a turn (large-arc 0).
    return f"M{a} {yy}A{R} {R} 0 0 0 {b} {yy}Z"


def _disc():
    hole = ellipse_path(DISC_C - DISC_HOLE, DISC_C - DISC_HOLE, DISC_C + DISC_HOLE, DISC_C + DISC_HOLE)
    # Band first, then the mark: KO is `koBand` followed by `mark`, the split
    # the app makes and the tables' own test checks.
    return {BODY: [ellipse_path(*DISC)], KO: [disc_band_path(), hole], HI: [],
            L_BAND: [disc_band_path_clipped()], L_KOBAND: [disc_band_path()],
            # What COLOURED fills, clipped by the body: the disc's whole box,
            # axis-aligned, so every curve comes from the clip alone.
            L_BLEED: [rect_path(*DISC)], L_MARK: [hole]}


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
        disc = kind == "iso"
        layers = _archive() if arch else _disc() if disc else _page_kind(PAGE_GLYPHS[kind])
        out[kind] = {k: " ".join(v) for k, v in layers.items()}
        solid = list(layers[BODY])
        # The archive's low CHIP still overhangs and still has to be clipped for
        # the evenodd variant; the page kinds' BAND is inside the page already,
        # so it is a hole exactly as drawn. The disc's band is a chord.
        if arch:
            solid += [p for p in layers[KO] if p != arch_band_path()]
            solid += [arch_band_path_clipped()]
        elif disc:
            solid += [p for p in layers[KO] if p != disc_band_path()]
            solid += [disc_band_path_clipped()]
        else:
            solid += [p for p in layers[KO] if p != band_path()]
            solid += [band_path_clipped()]
        solid += list(layers[HI])
        out[kind]["solid"] = " ".join(solid)
        out[kind]["label"] = label(ARCH_BAND if arch else DISC_BAND if disc else BAND)
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


# ------------------------------------------------------------- identity
# A COLOUR IDENTITY IS FINER THAN AN ICON SHAPE, and that gap is the whole
# reason this table exists. `.md` draws the code kind's stepped bars because it
# has no mark of its own, and `.docx` draws the same page as `.pdf` because both
# are the document kind - so under a per-KIND colour scheme a README is coloured
# as source and a Word file as a PDF. Neither is what the owner means by either
# (2026-09-01: "md isnt code in my opinion and its not txt, docx is also a
# special case").
#
# So colour is keyed HERE and drawing is keyed where it always was. Two
# identities may share every path and still take different colours; nothing
# about the shapes moves.
#
# Each row is (id, extension shown in the picker, the KIND whose page it
# borrows, the language mark laid on it or None for that kind's own).
IDENTITIES = [
    # The seven kinds, each shown with a representative extension.
    ("archive", "ZIP", "archive", None),
    # The disc: an archive by kind, its own SHAPE in the app (round 33).
    ("iso", "ISO", "iso", None),
    ("audio", "MP3", "audio", None),
    ("code", "TS", "code", None),
    ("comic", "CBZ", "comic", None),
    ("document", "ODT", "document", None),
    ("image", "JPG", "image", None),
    ("video", "MP4", "video", None),
    # The special cases: files that are not the kind they are filed under.
    # A PDF, a Word file and a spreadsheet all draw the document page, and under
    # a per-KIND scheme they were all coloured as one thing. They are not one
    # thing to anybody who has them in a folder together, so `document` is the
    # generic fallback now (an .odt, an .rtf) and the four everyone actually
    # recognises are their own.
    ("markdown", "MD", "code", None),
    ("pdf", "PDF", "document", None),
    ("word", "DOCX", "document", None),
    ("sheet", "XLSX", "document", None),
    ("slides", "PPTX", "document", None),
    ("ebook", "EPUB", "document", None),
    # And one per language mark, which are already drawn and until now were all
    # the same colour as each other and as plain source.
    ("config", "YML", "code", "config"),
    ("css", "CSS", "code", "css"),
    ("data", "JSON", "code", "data"),
    ("docker", "DOCKER", "code", "docker"),
    ("git", "GITIGNORE", "code", "git"),
    ("html", "HTML", "code", "html"),
    ("java", "JAVA", "code", "java"),
    ("prose", "TXT", "code", "prose"),
    ("python", "PY", "code", "python"),
    ("react", "TSX", "code", "react"),
    ("ruby", "RB", "code", "ruby"),
    ("shell", "SH", "code", "shell"),
    ("sql", "SQL", "code", "sql"),
    ("swift", "SWIFT", "code", "swift"),
    ("vue", "VUE", "code", "vue"),
]


def identities():
    """id -> every path the picker and the app need to draw that identity.

    Composed from `icons()` and `langs_paths()` rather than restated: an
    identity is a kind's page with, optionally, a language mark in place of the
    kind's own. `ko` and `koBand` come along because MONOCHROME still has to be
    drawable per identity - a selected row falls back to it.
    """
    ic, lang = icons(), langs_paths()
    out = {}
    for ident, ext, kind, mark in IDENTITIES:
        g = ic[kind]
        m = lang[mark] if mark else None
        out[ident] = {
            "kind": kind,
            "ext": ext,
            "body": g["body"],
            "bleed": g["bleed"],
            "band": g["band"],
            "koBand": g["koBand"],
            # Monochrome's single knockout path, with the mark swapped in when
            # the identity carries one - the same composition TreeRows makes.
            "ko": f"{g['koBand']} {m['ko']}" if m else g["ko"],
            "mark": m["ko"] if m else g["mark"],
            "hi": (m["hi"] if m else g["hi"]) or "",
            "label": g["label"],
        }
    return out


# -------------------------------------------------------------- comic artwork
# THE COMIC ICON IS THE ONE EXPLORER SHOWS (owner, 2026-09-01: "the comic icon
# is also wrong use the one thats used in file explorer"), and it is COLOURED
# even while everything else is monochrome.
#
# What the app drew until now was a bare splat - a deliberate reduction, on the
# grounds that a sunburst and a halftone flatten to a grey rectangle in one ink.
# That reasoning was sound for a monochrome icon and is simply not what was
# wanted: the comic keeps its colours, so it keeps its artwork.
#
# The one substitution. `sunburst` ERASES its odd wedges to transparent so the
# tintable ground shows through, which a flat SVG cannot do inside a group -
# they are painted in the PAGE COLOUR instead, which is the same picture,
# because in-app the ground behind them is exactly that colour.
COMIC_PAGE = "#d2603a"


def _comic_ops():
    """Replay the .ico's own artwork into the colour recorder.

    Composed rather than calling `art_splat_bam` wholesale, because that ends in
    `_word`, and a word is emitted as <text> rather than as outlines - the same
    rule the extension label follows, so the app's own face is used and cannot
    freeze here while the type moves on elsewhere.
    """
    from round23 import halftone, sunburst
    r = ColourRecorder()
    _frame(r, 16)
    sunburst(r, 16)
    halftone(r, 16)
    _ink_splat(r, 16, CX, CY, 5.0, 2.6, 8, PINK_A, phase=0.2)
    return r.ops


def comic_art():
    """The artwork as ordered {fill, opacity, d}, plus the BAM lettering."""
    out = []
    for fill, op, params in _comic_ops():
        rgba = tuple(fill) + (255,) if len(fill) == 3 else tuple(fill)
        # A wedge erased to transparent is the page showing through.
        colour = COMIC_PAGE if rgba[3] == 0 else "#%02x%02x%02x" % rgba[:3]
        alpha = 1.0 if rgba[3] == 0 else round(rgba[3] / 255, 3)
        d = op_path(op, params)
        if out and out[-1]["fill"] == colour and out[-1]["opacity"] == alpha:
            out[-1]["d"] += " " + d
        else:
            out.append({"fill": colour, "opacity": alpha, "d": d})
    word = {"x": u(CX), "y": u(CY), "size": u(2.9),
            "fill": "#%02x%02x%02x" % LEMON_A[:3],
            "stroke": "#%02x%02x%02x" % INK_A[:3], "width": u(0.30 * 2)}
    return out, word


# ------------------------------------------------------------------- colour
# THE COLOURED SCHEME (owner picks, 2026-09-01, second round).
#
# PICKED PER IDENTITY: the page the glyph sits on, and THE GLYPH ITSELF. The
# first round derived the glyph from the page by contrast, which guarantees
# legibility and takes the choice away - and a pale mark on a dark page and a
# dark mark on a pale one are different icons, not two spellings of one. The
# ratio is measured and printed when this file is generated instead, so a pick
# that cannot be read says so rather than being prevented.
#
# NOT PICKED: the band is BLACK on every identity, and the extension on it is
# white or black by the same measured rule (on black, white). COMIC is not in
# here at all - its icon is artwork rather than a mark on a page and the owner
# asked for it to stay exactly as it is.
#
# THE LANGUAGE FAMILIES ARE A RULE, NOT FIFTEEN CHOICES (owner, same day: "css/
# styling follow css color scheme, html/non-scripting languages follow html
# color scheme, python/scripting languages follow python color scheme, so that
# would include java, js etc"). Three colours carry the whole language set and
# the MARK says which language it is - which is what the marks are for, and it
# means a language added later has an obvious colour rather than a new decision.
STYLING = ("#ff8080", "#ffffff")     # css, scss, less
SCRIPTING = ("#e8a13c", "#000000")   # python, js, java, ruby, shell
MARKUP = ("#222244", "#ffffff")      # html, json, xml, swift - anything not run

SCHEME = {
    # The kinds.
    "archive": ("#8b8be2", "#000000"),
    "iso": ("#8b8be2", "#000000"),  # a container's colour, the disc's shape
    "audio": ("#69b485", "#000000"),
    "code": SCRIPTING,
    "document": ("#464646", "#ffffff"),
    "image": ("#69b485", "#000000"),
    "video": ("#69b485", "#000000"),
    # The documents that are not each other.
    "markdown": ("#2b2b69", "#ffffff"),
    "pdf": ("#ff3b3b", "#ffffff"),
    "word": ("#6060ff", "#ffffff"),
    "sheet": ("#529f3c", "#ffffff"),
    "slides": ("#e8a13c", "#ffffff"),
    "ebook": ("#d060ff", "#ffffff"),
    # The languages, by family.
    "css": STYLING,
    "html": MARKUP,
    "data": MARKUP,
    "swift": MARKUP,
    "python": SCRIPTING,
    "java": SCRIPTING,
    "ruby": SCRIPTING,
    "shell": SCRIPTING,
    "react": SCRIPTING,
    "vue": SCRIPTING,
    # And the four that are not languages, each picked outright: a config file,
    # a plain text file, a repository and a container are not written in
    # anything, so the family rule has nothing to say about them.
    "config": ("#464646", "#ffffff"),
    "prose": ("#464646", "#ffffff"),
    "git": ("#24292e", "#ffffff"),
    "docker": ("#5b5bd6", "#ffffff"),
    # SQL is the one identity whose glyph is not black or white: a query
    # language, picked outright rather than by family.
    "sql": ("#252525", "#e8a13c"),
}

# The label ground, for every identity. Named BAND_COLOUR and not BAND: that
# name is already the band's RECTANGLE, and shadowing it silently turned the
# geometry into a string.
BAND_COLOUR = "#000000"

# WHICH IDENTITIES ACTUALLY TAKE A COLOURED PAGE (owner, 2026-09-01, third
# round: "make all icons the monochrome style in colored, but exclude comic,
# docx, pdf, pptx, xl, ebook").
#
# Everything else draws MONOCHROME even while the coloured scheme is on - one
# ink measured against the row's own ground, exactly as the monochrome scheme
# does. So "coloured" is not a repaint of the whole tree: it is a quiet tree
# with the documents picked out, which is the set where colour is doing real
# work. A folder of .docx, .xlsx and .pdf is the case where the shapes alone
# are nearly the same picture; a folder of source is not.
FULL_COLOUR = ("comic", "pdf", "word", "sheet", "slides", "ebook")

# And the two that are coloured NO MATTER WHICH SCHEME IS ON (owner, same day:
# "make the zip icon colored in even in the monochrome colro styole", and the
# comic likewise). The zip is a flat coloured page like any other; the comic is
# artwork, and is handled by COMIC_ART rather than by a page colour.
ALWAYS_COLOUR = ("archive", "iso", "comic")

# COMIC KEEPS ITS EXPLORER SCHEME (owner instruction) and cannot use the rule at
# all, because its mark is not ink on a page - it is one piece of a five-colour
# piece of artwork. The .ico's own splat is PINK on a sunburst of LEMON wedges;
# in-app there is no sunburst (a documented reduction, see the module docstring)
# and a pink splat straight onto the orange page measures 1.00:1 - the two are
# the same luminance, so it disappears entirely. It is the same failure the
# white document page has at 1.07:1 on Explorer's light ground, arrived at from
# the opposite direction: a pair that works only because a THIRD thing sits
# between them, and in-app there is no third thing. MEASURED before choosing:
# cream on the same page is 3.42:1, and it reads the way the monochrome splat
# reads, as light coming through a hole.
COMIC = {"page": "#d2603a", "band": "#12141a", "mark": "#f7f2de", "text": "#f7f2de"}

# How much sheen the page carries, 0 to 1 (owner pick: the whole way). Drawn as
# a gradient over the page and UNDER the band, so the extension stays crisp.
GLINT = 1.0

# The extensions that are their own identity rather than their kind's. Checked
# AFTER a language mark and before the kind, so a .csv stays prose. Every one is
# a document: they all draw the same page, and under a per-KIND scheme a PDF, a
# spreadsheet and a Word file were one colour between them.
SPECIAL_EXT = {
    "iso": "iso",
    "md": "markdown", "markdown": "markdown",
    "pdf": "pdf",
    "docx": "word", "docm": "word",
    "xlsx": "sheet", "xlsm": "sheet", "xls": "sheet", "ods": "sheet",
    "pptx": "slides", "ppsx": "slides", "odp": "slides",
    "epub": "ebook",
}


def _hex(c):
    return "#%02x%02x%02x" % tuple(c)


def _rgb(h):
    return tuple(int(h[i:i + 2], 16) for i in (1, 3, 5))


def colours():
    """identity -> {page, band, mark, text}, every value a literal hex string."""
    out = {"comic": dict(COMIC)}
    for ident, (page, mark) in SCHEME.items():
        out[ident] = {"page": page, "band": BAND_COLOUR, "mark": mark,
                      "text": _hex(ink_for(_rgb(BAND_COLOUR))[0])}
    return out


def colour_notes():
    """The measured ratios, printed when the file is generated.

    Not decoration: the glyph is PICKED now rather than derived, so nothing
    guarantees it can be seen. This is what says so.
    """
    for ident, c in sorted(colours().items()):
        m = contrast(_rgb(c["mark"]), _rgb(c["page"]))
        flag = "  <- under 2:1" if m < 2 else ""
        yield (f"{ident:9} mark {m:5.2f}:1 on {c['page']}"
               f"   text {contrast(_rgb(c['text']), _rgb(c['band'])):5.2f}:1{flag}")


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
//     body        the page silhouette - and, for COLOURED, the mask
//     bleed       fold + band as rectangles overrunning it (coloured)
//     ko          fold + band + mark, as ONE path  (monochrome only)
//     band, mark  the same two halves, separately  (coloured only)
//     koBand      ko WITHOUT the mark, for when a language mark replaces it
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
        for k in (BODY, KO, L_BAND, L_KOBAND, L_BLEED, L_MARK, HI, "solid"):
            L.append(f'    {k}: "{d[k]}",')
        lab = d["label"]
        sizes = ", ".join(f"{n}: {v}" for n, v in lab["sizes"].items())
        L.append(f'    label: {{ x: {lab["x"]}, y: {lab["y"]}, sizes: {{ {sizes} }} }},')
        L.append("  },")
    L += ["} as const", ""]

    L += [
        "// The COLOURED scheme (owner picks, 2026-09-01). Keyed by IDENTITY, which",
        "// is finer than the icon SHAPE: `.md` is not source, and a PDF, a Word file",
        "// and a spreadsheet are not one another even though they draw the same page.",
        "//",
        "// `page` and `mark` are both PICKED. The band is black on every identity and",
        "// the extension on it is white, by the same measured rule the monochrome ink",
        "// uses. `hi` is not listed: it is always `page`, in both schemes.",
        "//",
        "// The languages are a RULE rather than fifteen choices - styling follows css,",
        "// scripting follows python, everything not run follows html - so three colours",
        "// carry the set and the MARK says which language it is. Four identities are",
        "// not languages at all (config, prose, git, docker) and one is picked outright",
        "// (sql, the only glyph in the set that is neither black nor white).",
        "export const ICON_COLOURS = {",
    ]
    for ident, c in sorted(colours().items()):
        L.append(f"  {ident}: {{ page: '{c['page']}', band: '{c['band']}', "
                 f"mark: '{c['mark']}', text: '{c['text']}' }},")
    L += ["} as const", "",
          "export type IconIdentity = keyof typeof ICON_COLOURS", ""]

    L += [
        "// The identities that actually take a coloured PAGE. Everything else draws",
        "// monochrome even while the coloured scheme is on, so `coloured` is a quiet",
        "// tree with the documents picked out rather than a repaint of everything: a",
        "// folder of .docx, .xlsx and .pdf is where the shapes alone are nearly the",
        "// same picture, and a folder of source is not.",
        "export const ICON_FULL_COLOUR: readonly IconIdentity[] = [",
    ]
    for ident in FULL_COLOUR:
        L.append(f"  '{ident}',")
    L += ["]", ""]

    L += [
        "// And the identities that are coloured NO MATTER WHICH SCHEME IS ON. The zip",
        "// is a flat coloured page like any other and falls back to monochrome on a",
        "// selected row; the comic is artwork (COMIC_ART) and never does, because five",
        "// colours cannot all collide with one accent.",
        "export const ICON_ALWAYS_COLOUR: readonly IconIdentity[] = [",
    ]
    for ident in ALWAYS_COLOUR:
        L.append(f"  '{ident}',")
    L += ["]", ""]

    L += [
        "// How much sheen the page carries. Drawn as a gradient over the page and",
        "// UNDER the band, so the extension stays crisp.",
        f"export const ICON_GLINT = {GLINT}",
        "",
        "// The extensions that are their own identity rather than their kind's.",
        "// Checked AFTER a language mark and before the kind, so a .csv stays prose.",
        "export const IDENT_BY_EXT: Record<string, IconIdentity> = {",
    ]
    for ext in sorted(SPECIAL_EXT):
        L.append(f"  '{ext}': '{SPECIAL_EXT[ext]}',")
    L += ["}", ""]

    art, word = comic_art()
    L += [
        "// THE COMIC ICON'S ARTWORK, which is the one Explorer shows and is COLOURED",
        "// even while everything else is monochrome. What the app drew before was a",
        "// bare splat - a reduction made on the grounds that a sunburst and a halftone",
        "// flatten to a grey rectangle in one ink, which was sound for a monochrome",
        "// icon and simply not what was wanted: the comic keeps its colours, so it",
        "// keeps its artwork.",
        "//",
        "// Drawn in order, inside the same mask of `body` the coloured pages use, and",
        "// under the band. The odd sunburst wedges are painted in the PAGE colour",
        "// rather than erased, which a flat SVG cannot do inside a group and which is",
        "// the same picture, because the ground behind them is exactly that colour.",
        f"export const COMIC_PAGE = '{COMIC_PAGE}'",
        "",
        "export const COMIC_ART: ReadonlyArray<{ d: string; fill: string; opacity: number }> = [",
    ]
    for layer in art:
        L.append("  { d: \"%s\", fill: '%s', opacity: %s },"
                 % (layer["d"], layer["fill"], layer["opacity"]))
    L += ["]", ""]
    L += [
        "// BAM, lettered into the splat. Emitted as <text> rather than as outlines for",
        "// the reason the extension label is: turning a face into paths here freezes",
        "// it while the app's own type moves on.",
        "export const COMIC_WORD = {",
        f"  text: 'BAM', x: {word['x']}, y: {word['y']}, size: {word['size']},",
        f"  fill: '{word['fill']}', stroke: '{word['stroke']}', width: {word['width']}",
        "} as const",
        "",
    ]

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
