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

    body  the page silhouette          -> paint with currentColor
    ko    fold, chip, and the mark     -> paint with the panel colour
    hi    knockouts inside the mark    -> paint with currentColor again, over ko

`hi` exists because some marks have detail punched back out to the page colour -
the clapperboard's stripes, the comic splat's core. In the colour icon those
are simply the page showing through; in a flat monochrome stack they have to be
painted back on top. Four of the seven have no `hi` and return "".

Everything is on a 24x24 viewBox with NO refitting: the icon's own 16-unit grid
is scaled by 1.5, so the composition keeps the margins and the chip overhang it
was designed with rather than being stretched to the edges.

THE EXTENSION LABEL is not a path - it is text, and turning a font into
outlines here would freeze it. `LABEL` gives the placement and size so the
caller can render <text> with the app's own font if it wants it. At 14px it is
an unreadable smudge and the tree row already carries the file's name, so
leaving it out is reasonable; at 20px and up in the archive panel it starts to
earn its place. The chip is drawn either way.

COMIC IS REDUCED, deliberately. Its shipped icon is a keylined pop-art sunburst
with a warm halftone under a splat, and every one of those elements exists to
be a DIFFERENT COLOUR from the one beside it. Flattened to one colour they
become a grey rectangle. What survives monochrome is the splat, so that is what
this emits, and it is the only kind whose in-app mark is not a faithful
reduction of its icon.

    python svg.py            # the paths, ready to paste
    python svg.py --check <dir>   # write them as .svg files to look at
"""
import pathlib
import sys

from round12 import CHIP, CUT, PX0, PX1, PY0, PY1
from round12 import lines as doc_lines
from round13 import clapper
from round14 import GLYPHS as R14
from round15 import CHIP_A, folder_zip, folder_zip_ink
from round17 import quarter
from round18 import _splat

SCALE = 1.5          # 16 grid units -> a 24x24 viewBox
BOX = (3.8, 7.0, 12.2, 14.0)     # where a page kind's mark sits
BODY, KO, HI = "body", "ko", "hi"


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
        return self.inks.get(id(fill))

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
    a, b, c, d = u(x0), u(y0), u(x1), u(y1)
    rx, ry, cy = round((c - a) / 2, 2), round((d - b) / 2, 2), round((b + d) / 2, 2)
    return f"M{a} {cy}A{rx} {ry} 0 1 0 {c} {cy}A{rx} {ry} 0 1 0 {a} {cy}Z"


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


def label(chip=CHIP):
    """Placement for an optional <text>, since a font must not become outlines."""
    return {"x": u((chip[0] + chip[2]) / 2), "y": u((chip[1] + chip[3]) / 2),
            "size": u((chip[3] - chip[1]) * 0.62), "anchor": "middle",
            "baseline": "central"}


# ------------------------------------------------------------------- glyphs
def _clapper_two_stripes(d, n, box, col, hole):
    """VIDEO in-app: TWO clapper stripes, not three.

    At 14px three are about a pixel each and merge into a grey bar. Two fatter
    ones keep the diagonal, which is the only part that says clapperboard.
    """
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    d.rounded_rectangle([x0, y0 + h * 0.34, x1, y1], radius=w * 0.05, fill=col)
    d.rounded_rectangle([x0, y0, x1, y0 + h * 0.27], radius=w * 0.04, fill=col)
    for i in range(2):
        sx = x0 + w * (0.16 + i * 0.40)
        d.polygon([(sx, y0), (sx + w * 0.15, y0),
                   (sx + w * 0.05, y0 + h * 0.27), (sx - w * 0.10, y0 + h * 0.27)], fill=hole)


def _comic_splat(d, n, box, col, hole):
    """COMIC in-app: the splat, which is the only part that survives one colour."""
    x0, y0, x1, y1 = box
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    r = min(x1 - x0, y1 - y0) / 2
    _splat(d, n, cx, cy, r, r * 0.53, 8, col, p=3.2, steps=72)
    _splat(d, n, cx, cy, r * 0.48, r * 0.23, 7, hole, p=3.2, phase=0.4, steps=72)


PAGE_GLYPHS = {
    "audio": quarter,
    "code": dict((k, f) for k, _l, f in R14["code"][2])["bars"],
    "comic": _comic_splat,
    "document": doc_lines,
    "image": dict((k, f) for k, _l, f in R14["image"][2])["hills"],
    "video": _clapper_two_stripes,
}
EXT = {"archive": "ZIP", "audio": "MP3", "code": "PY", "comic": "CBZ",
       "document": "DOCX", "image": "JPG", "video": "MP4"}


def _page_kind(fn):
    ko_ink, hi_ink = object(), object()
    r = Recorder(ko_ink, hi_ink)
    fn(r, 16, BOX, ko_ink, hi_ink)
    layers = {BODY: [page_path()], KO: [fold_path(), chip_path()], HI: []}
    for lay, op, p in r.ops:
        layers[lay].append(op_path(op, p))
    return layers


def _archive():
    """A container rather than a page, and its chip sits low."""
    body_ink, ko_ink, hi_ink = object(), object(), object()
    r = Recorder(ko_ink, hi_ink, body_ink)
    folder_zip(r, 16, body_ink)
    folder_zip_ink(r, 16, ko_ink, hi_ink)
    layers = {BODY: [], KO: [chip_path(CHIP_A)], HI: []}
    for lay, op, p in r.ops:
        layers[lay].append(op_path(op, p))
    return layers


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
        chip = CHIP_A if kind == "archive" else CHIP
        layers = _archive() if kind == "archive" else _page_kind(PAGE_GLYPHS[kind])
        out[kind] = {k: " ".join(v) for k, v in layers.items()}
        solid = list(layers[BODY])
        solid += [p for p in layers[KO] if p != chip_path(chip)]
        solid += [chip_path_clipped(chip)] + list(layers[HI])
        out[kind]["solid"] = " ".join(solid)
        out[kind]["label"] = label(chip)
        out[kind]["ext"] = EXT[kind]
    return out


# ------------------------------------------------------------------- contrast
# Which way round the icon goes is decided from the BACKGROUND, not from a
# theme name. Prism has custom styles - void, accent-tinted grounds, whatever is
# built later - so "is the theme dark" is a question with no reliable answer,
# while "what does this background measure" always has one.
INK_LIGHT = (233, 237, 247)   # --p-text
INK_DARK = (27, 29, 34)


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


TS_HELPER = """// Which way round the icon goes, measured rather than assumed. Prism has custom
// styles, so "is the theme dark" has no reliable answer while "what does this
// background measure" always does. Pick the better of the two ratios rather
// than testing a midpoint: two colours either side of a midpoint can both be
// poor, and the better-of-two is right by construction.
const INK_LIGHT = '#e9edf7'
const INK_DARK = '#1b1d22'

const lum = (hex: string): number => {
  const c = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
}

const ratio = (a: string, b: string): number => {
  const x = lum(a)
  const y = lum(b)
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}

/** The icon colour for a given background. Feed it the panel's resolved bg. */
export const inkFor = (bg: string): string =>
  ratio(INK_LIGHT, bg) >= ratio(INK_DARK, bg) ? INK_LIGHT : INK_DARK
"""


def svg_for(kind, d, px=96, fg="#e9edf7", panel="#1b1d22", with_label=True):
    lab = ""
    if with_label:
        L = d["label"]
        lab = (f'<text x="{L["x"]}" y="{L["y"]}" font-size="{L["size"]}" fill="{fg}" '
               f'text-anchor="{L["anchor"]}" dominant-baseline="{L["baseline"]}" '
               f'font-family="Segoe UI,system-ui,sans-serif" font-weight="700">{d["ext"]}</text>')
    parts = [f'<path d="{d["body"]}" fill="currentColor"/>']
    if d["ko"]:
        parts.append(f'<path d="{d["ko"]}" fill="{panel}"/>')
    if d["hi"]:
        parts.append(f'<path d="{d["hi"]}" fill="currentColor"/>')
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="{px}" '
            f'height="{px}" style="color:{fg}">{"".join(parts)}{lab}</svg>')


def main():
    ic = icons()
    if "--check" in sys.argv:
        i = sys.argv.index("--check")
        out = pathlib.Path(sys.argv[i + 1] if len(sys.argv) > i + 1 else ".")
        out.mkdir(parents=True, exist_ok=True)
        for kind, d in ic.items():
            (out / f"{kind}.svg").write_text(svg_for(kind, d), encoding="utf-8")
        print(f"wrote {len(ic)} svg files to {out}")
        return

    print("// Prism in-app icons, monochrome, 24x24 viewBox.")
    print("// Generated by tools/icons/svg.py - do not hand-edit.")
    print("//   body -> currentColor,  ko -> panel colour,  hi -> currentColor over ko.")
    print("//   An empty layer means skip that element.")
    print("export const ICON_PATHS = {")
    for kind, d in ic.items():
        print(f"  {kind}: {{")
        for k in (BODY, KO, HI, "solid"):
            print(f'    {k}: "{d[k]}",')
        L = d["label"]
        print(f'    label: {{ x: {L["x"]}, y: {L["y"]}, size: {L["size"]} }},')
        print("  },")
    print("} as const")
    print()
    print(TS_HELPER)


if __name__ == "__main__":
    main()
