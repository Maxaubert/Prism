"""The seven glyphs as SVG paths, for Prism's own tree rows, search and archive panel.

In-app they are MONOCHROME and GLYPH ONLY: no page silhouette, no black chip,
no extension label. At 14px in a tree row a page plus a chip plus a label is a
smudge, and the row already carries the file's name.

HOW THE SHAPES GET HERE, because it is the whole point of the file. They are
not redrawn. `Recorder` duck-types the handful of ImageDraw calls the glyph
functions use - rectangle, rounded_rectangle, polygon, ellipse - and records
them instead of rasterising, so the SAME functions that draw the .ico frames
emit the path data. There is one definition of each mark and the two outputs
cannot drift.

TWO LAYERS, matching what Prism's existing in-app glyphs do: `body` is the
solid mass, `ko` is the detail knocked out of it. The caller paints body with
currentColor and ko with the panel colour, which is what keeps these legible at
14px without a single stroke. Kinds whose mark has no interior detail return an
empty `ko`, and the caller should skip the element rather than paint nothing.

Everything is emitted on a 24x24 viewBox. Each glyph is recorded at its natural
geometry and then FITTED to the box from its own measured bounds, which is what
lets archive - whose folder was laid out around a chip that is not here - fill
the frame like the rest.

TWO DELIBERATE SIMPLIFICATIONS, invited rather than assumed, and the same trade
as four text lines becoming three:

- VIDEO's clapperboard has three diagonal stripes in the .ico. At 14px those
  are about a pixel each and merge into a grey bar, so the in-app mark has TWO
  fatter ones.
- COMIC is a bare splat. The shipped icon is a keylined sunburst with a warm
  halftone and BAM lettered into it; none of that is a 14px mark, and reducing
  it faithfully gives a coloured smudge. The splat silhouette with an inner
  knockout is what survives, and it still reads as a comic burst.

    python svg.py           # the paths, ready to paste
    python svg.py --check   # render each path back out and eyeball it
"""
import sys
from math import cos, pi, sin

from round12 import lines as doc_lines
from round14 import GLYPHS as R14
from round15 import folder_zip, folder_zip_ink
from round17 import quarter
from round18 import _splat

VIEW = 24.0
MARGIN = 0.25

BODY, KO = "body", "ko"


class Recorder:
    """Records the ImageDraw calls the glyph functions make, per layer."""

    def __init__(self, body_ink, ko_ink):
        self.body_ink, self.ko_ink = body_ink, ko_ink
        self.ops = []

    def _layer(self, fill):
        if fill is self.body_ink:
            return BODY
        if fill is self.ko_ink:
            return KO
        return None  # a colour we were not told about: dropped, not guessed

    def rectangle(self, xy, fill=None, **_):
        layer = self._layer(fill)
        if layer:
            x0, y0, x1, y1 = xy
            self.ops.append((layer, "rect", (x0, y0, x1, y1, 0.0)))

    def rounded_rectangle(self, xy, radius=0.0, fill=None, **_):
        layer = self._layer(fill)
        if layer:
            x0, y0, x1, y1 = xy
            self.ops.append((layer, "rect", (x0, y0, x1, y1, float(radius))))

    def polygon(self, xy, fill=None, **_):
        layer = self._layer(fill)
        if layer:
            self.ops.append((layer, "poly", tuple(xy)))

    def ellipse(self, xy, fill=None, **_):
        layer = self._layer(fill)
        if layer:
            x0, y0, x1, y1 = xy
            self.ops.append((layer, "ellipse", (x0, y0, x1, y1)))

    # Never used by the seven, but present so an unexpected call fails loudly
    # rather than silently dropping part of a glyph.
    def arc(self, *a, **k):
        raise NotImplementedError("arc has no path emitter; the glyph needs one")

    def text(self, *a, **k):
        raise NotImplementedError("text does not belong in an in-app glyph")


def _points(ops):
    for _layer, op, p in ops:
        if op == "poly":
            for x, y in p:
                yield x, y
        else:
            yield p[0], p[1]
            yield p[2], p[3]


def _fit(ops):
    """Map the recorded geometry onto the viewBox from its own bounds."""
    xs = [x for x, _ in _points(ops)]
    ys = [y for _, y in _points(ops)]
    x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
    span = max(x1 - x0, y1 - y0) or 1.0
    s = (VIEW - 2 * MARGIN) / span
    dx = MARGIN + (VIEW - 2 * MARGIN - (x1 - x0) * s) / 2 - x0 * s
    dy = MARGIN + (VIEW - 2 * MARGIN - (y1 - y0) * s) / 2 - y0 * s
    return (lambda x: round(x * s + dx, 2)), (lambda y: round(y * s + dy, 2)), s


def _rect_path(fx, fy, s, x0, y0, x1, y1, r):
    a, b, c, d = fx(x0), fy(y0), fx(x1), fy(y1)
    r = round(min(r * s, (c - a) / 2, (d - b) / 2), 2)
    if r <= 0.05:
        return f"M{a} {b}H{c}V{d}H{a}Z"
    return (f"M{round(a + r, 2)} {b}H{round(c - r, 2)}A{r} {r} 0 0 1 {c} {round(b + r, 2)}"
            f"V{round(d - r, 2)}A{r} {r} 0 0 1 {round(c - r, 2)} {d}"
            f"H{round(a + r, 2)}A{r} {r} 0 0 1 {a} {round(d - r, 2)}"
            f"V{round(b + r, 2)}A{r} {r} 0 0 1 {round(a + r, 2)} {b}Z")


def _ellipse_path(fx, fy, x0, y0, x1, y1):
    a, b, c, d = fx(x0), fy(y0), fx(x1), fy(y1)
    rx, ry = round((c - a) / 2, 2), round((d - b) / 2, 2)
    cy = round((b + d) / 2, 2)
    return (f"M{a} {cy}A{rx} {ry} 0 1 0 {c} {cy}A{rx} {ry} 0 1 0 {a} {cy}Z")


def _poly_path(fx, fy, pts):
    head = f"M{fx(pts[0][0])} {fy(pts[0][1])}"
    return head + "".join(f"L{fx(x)} {fy(y)}" for x, y in pts[1:]) + "Z"


def _emit(ops):
    fx, fy, s = _fit(ops)
    out = {BODY: [], KO: []}
    for layer, op, p in ops:
        if op == "rect":
            out[layer].append(_rect_path(fx, fy, s, *p))
        elif op == "ellipse":
            out[layer].append(_ellipse_path(fx, fy, *p))
        else:
            out[layer].append(_poly_path(fx, fy, p))
    return {k: " ".join(v) for k, v in out.items()}


# ------------------------------------------------------------------- glyphs
# n=24 so g(n, k) already lands in viewBox units before fitting.
N = 24
FULL = (0.0, 0.0, 16.0, 16.0)


def _clapper_two_stripes(d, n, box, col, hole):
    """VIDEO in-app: the clapperboard with TWO stripes instead of three.

    Three at 14px are about a pixel each and merge into a grey bar. Two fatter
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
    """COMIC in-app: the splat alone, sampled coarsely enough to paste.

    72 samples rather than the 360 the .ico uses - at 14px, and as path data in
    a JSX file, the extra 288 points cost bytes and buy nothing.
    """
    _splat(d, n, 8.0, 8.0, 7.4, 3.9, 8, col, p=3.2, steps=72)
    _splat(d, n, 8.0, 8.0, 3.6, 1.7, 7, hole, p=3.2, phase=0.4, steps=72)


def _record(fn, *, ko=True):
    body_ink, ko_ink = object(), object()
    r = Recorder(body_ink, ko_ink)
    fn(r, N, FULL, body_ink, ko_ink if ko else body_ink)
    return _emit(r.ops)


def _record_archive():
    body_ink, ko_ink = object(), object()
    r = Recorder(body_ink, ko_ink)
    folder_zip(r, N, body_ink)
    folder_zip_ink(r, N, ko_ink, None)
    return _emit(r.ops)


def glyphs():
    """kind -> {"body": d, "ko": d}. An empty ko means the mark has no detail."""
    code_bars = dict((k, f) for k, _l, f in R14["code"][2])["bars"]
    hills = dict((k, f) for k, _l, f in R14["image"][2])["hills"]
    return {
        "archive": _record_archive(),
        "audio": _record(quarter),
        "code": _record(code_bars),
        "comic": _record(_comic_splat),
        "document": _record(doc_lines),
        "image": _record(hills),
        "video": _record(_clapper_two_stripes),
    }


def main():
    gs = glyphs()
    if "--check" in sys.argv:
        import pathlib

        from PIL import Image
        out = pathlib.Path(sys.argv[sys.argv.index("--check") + 1]
                           if len(sys.argv) > sys.argv.index("--check") + 1 else ".")
        svgs = []
        for kind, d in gs.items():
            ko = (f'<path d="{d["ko"]}" fill="#1b1d22"/>' if d["ko"] else "")
            svgs.append(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" '
                        f'width="96" height="96"><path d="{d["body"]}" fill="#e9edf7"/>{ko}</svg>')
            (out / f"glyph-{kind}.svg").write_text(svgs[-1], encoding="utf-8")
        print(f"wrote {len(svgs)} svg files to {out}")
        _ = Image
        return

    print("// Prism in-app glyphs, 24x24 viewBox. Generated by tools/icons/svg.py")
    print("// body: paint with currentColor.  ko: paint with the panel colour.")
    print("export const GLYPH_PATHS = {")
    for kind, d in gs.items():
        print(f"  {kind}: {{")
        print(f'    body: "{d["body"]}",')
        print(f'    ko: "{d["ko"]}",' if d["ko"] else '    ko: "",')
        print("  },")
    print("} as const")


if __name__ == "__main__":
    main()
