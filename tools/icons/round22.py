"""Round twenty-two: the pop-art sunburst background, built from the owner's reference.

His reference is the classic comic ground: wedges radiating from a point,
ALTERNATING two colours, a thin BLACK KEYLINE between every one of them,
halftone dots laid over the lot, and cyan stars and white clouds on top. My
round-twenty wedges had one colour on a flat ground and no keylines at all,
which is why they read as a fan rather than as a comic page.

How the alternation is drawn, because it is the whole trick. The framed
interior is filled with BLACK first. Then every wedge is redrawn slightly
narrower: the even ones in the accent colour, the odd ones ERASED to
transparent. Erasing is what lets the tintable ground show through, so the
second colour of the pair is whatever the owner picks in the picker, and the
black that survives between the narrowed wedges is the keyline. One pass, no
strokes, and the keyline width is a single angular constant.

The dots go on afterwards as a translucent dark, so they darken the accent and
the ground alike rather than being a third colour that only suits one of them.

    python round22.py <outdir>
"""
import pathlib
import sys
from math import cos, pi, sin

from round18 import COMICS as R18
from round18 import CREAM_A, CYAN, INK_A, LEMON_A, P, PINK, _frame, comic_flat
from round21 import framed
from round5 import g

IN = (P[0] + 1.7, P[1] + 1.7, P[2] - 1.7, P[3] - 1.7)
BURST_X, BURST_Y = 8.0, 8.6      # where the rays converge, as in the reference
SKY = (86, 200, 230, 255)        # the reference's cyan stars
LIGHT = (255, 255, 255, 86)
SHADE = (0, 0, 0, 48)


def _wedge(d, n, a0, a1, col, r=22.0):
    d.polygon([(g(n, BURST_X), g(n, BURST_Y)),
               (g(n, BURST_X + r * cos(a0)), g(n, BURST_Y + r * sin(a0))),
               (g(n, BURST_X + r * cos(a1)), g(n, BURST_Y + r * sin(a1)))], fill=col)


def sunburst(d, n, accent=LEMON_A, count=18, keyline=0.030):
    """Alternating wedges with a black keyline between every pair.

    The interior goes black, then each wedge is redrawn narrower - accent on the
    even ones, ERASED on the odd ones so the tintable ground shows through. What
    is left of the black between them is the keyline, and `keyline` is its half
    width in radians rather than a stroke, so it stays even at every size.
    """
    d.rectangle([g(n, IN[0]), g(n, IN[1]), g(n, IN[2]), g(n, IN[3])], fill=INK_A)
    for i in range(count):
        a0 = 2 * pi * i / count + keyline
        a1 = 2 * pi * (i + 1) / count - keyline
        _wedge(d, n, a0, a1, accent if i % 2 == 0 else (0, 0, 0, 0))


def dots(d, n, col=SHADE, step=1.0, r=0.26):
    x0, y0, x1, y1 = IN
    for iy in range(int((y1 - y0) / step) + 1):
        for ix in range(int((x1 - x0) / step) + 1):
            cx = x0 + ix * step + (step / 2 if iy % 2 else 0)
            cy = y0 + iy * step
            if cx <= x1 and cy <= y1:
                d.ellipse([g(n, cx - r), g(n, cy - r), g(n, cx + r), g(n, cy + r)], fill=col)


def _star(d, n, cx, cy, r, col, key=0.42):
    for rad, c in ((r + key, INK_A), (r, col)):
        pts = []
        for i in range(10):
            a = pi * i / 5 - pi / 2
            rr = rad if i % 2 == 0 else rad * 0.46
            pts.append((g(n, cx + rr * cos(a)), g(n, cy + rr * sin(a))))
        d.polygon(pts, fill=c)


def stars(d, n):
    for cx, cy, r in ((4.6, 5.4, 1.15), (12.0, 6.6, 1.35), (11.2, 12.1, 1.0),
                      (5.2, 12.6, 0.85)):
        _star(d, n, cx, cy, r, SKY)


# Centres kept ABOVE the interior's bottom edge: a bump centred on or below it
# gives the joining slab a negative height, which PIL refuses outright.
CLOUDS = (
    ((3.9, 12.4, 1.25), (5.3, 12.1, 1.00), (6.4, 12.5, 0.85)),
    ((10.1, 12.6, 0.95), (11.3, 12.2, 1.20), (12.5, 12.6, 0.95)),
)


def clouds(d, n):
    """Bumped white shapes along the bottom, keylined, as in the reference.

    Keyline first for every bump in the group, then every fill, then a slab
    joining them: doing it bump by bump would stamp each outline over the
    previous bump's fill and leave seams through the middle of one cloud.
    """
    for bumps in CLOUDS:
        top = min(b[1] for b in bumps)
        bottom = max(top, IN[3])
        left, right = bumps[0][0] - bumps[0][2], bumps[-1][0] + bumps[-1][2]
        for cx, cy, r in bumps:
            d.ellipse([g(n, cx - r - 0.4), g(n, cy - r - 0.4),
                       g(n, cx + r + 0.4), g(n, cy + r + 0.4)], fill=INK_A)
        d.rectangle([g(n, left - 0.4), g(n, top), g(n, right + 0.4), g(n, bottom)], fill=INK_A)
        for cx, cy, r in bumps:
            d.ellipse([g(n, cx - r), g(n, cy - r), g(n, cx + r), g(n, cy + r)], fill=CREAM_A)
        d.rectangle([g(n, left), g(n, top), g(n, right), g(n, bottom)], fill=CREAM_A)


# ------------------------------------------------------------------ grounds
def bg_plain(d, n):
    sunburst(d, n)


def bg_dots(d, n):
    sunburst(d, n)
    dots(d, n)


def bg_dots_stars(d, n):
    sunburst(d, n)
    dots(d, n)
    stars(d, n)


def bg_full(d, n):
    sunburst(d, n)
    dots(d, n)
    stars(d, n)
    clouds(d, n)


def bg_light(d, n):
    """The accent made of the background colour itself, so it follows any pick."""
    sunburst(d, n, LIGHT)
    dots(d, n)


def bg_light_stars(d, n):
    sunburst(d, n, LIGHT)
    dots(d, n)
    stars(d, n)


def bg_fine(d, n):
    """More, thinner wedges: closer to the reference's count."""
    sunburst(d, n, LEMON_A, 26, 0.022)
    dots(d, n)


def bg_coarse(d, n):
    """Fewer, fatter wedges: the only version that still reads at 16px."""
    sunburst(d, n, LEMON_A, 12, 0.040)
    dots(d, n)


BACKGROUNDS = [
    ("plain", "Alternating wedges, keylined", bg_plain),
    ("dots", "Wedges + halftone", bg_dots),
    ("dotsstars", "Wedges + halftone + stars", bg_dots_stars),
    ("full", "Wedges + halftone + stars + clouds  (the reference)", bg_full),
    ("fine", "More, thinner wedges", bg_fine),
    ("coarse", "Fewer, fatter wedges", bg_coarse),
    ("light", "Wedges made of the ground colour", bg_light),
    ("lightstars", "Ground-colour wedges + stars", bg_light_stars),
]

HERO_BG = bg_dots_stars


def bare(bg):
    """The background with no subject at all: the reference IS the picture."""
    def art(d, n):
        _frame(d, n)
        bg(d, n)
    return art


SIZES = (16, 20, 24, 32, 48)
HERO = 96

CANDIDATES = {
    "background": [(k, l, (lambda s, B=fn: comic_flat(s, bare(B), PINK)))
                   for k, l, fn in BACKGROUNDS],
    "withart": [(k, l, (lambda s, A=a: comic_flat(s, framed(HERO_BG, A), PINK)))
                for k, l, a, _g in R18],
}
FILENAMES = {k: "issue-012.cbz" for k in CANDIDATES}
SECTIONS = {
    "background": "The pop-art ground from your reference, on its own - no "
                  "subject at all, because in the reference the background IS "
                  "the picture. Wedges alternate between the accent and YOUR "
                  "background colour, with a black keyline between every one.",
    "withart": "Round eighteen's eleven on that ground. Worth deciding whether "
               "the artwork earns its place: a burst on a sunburst is two "
               "bursts, and the ground alone may say comic more clearly.",
}


def caption(kind, key):
    from round12 import contrast_note
    for k, _l, fn in CANDIDATES[kind]:
        if k == key:
            return contrast_note(fn(16))
    return ""


def main(out_dir):
    out = pathlib.Path(out_dir) / "round22"
    out.mkdir(parents=True, exist_ok=True)
    for kind, cands in CANDIDATES.items():
        for key, _l, fn in cands:
            for s in SIZES + (HERO,):
                fn(s).save(out / f"{kind}-{key}-{s}.png")
    print(f"{sum(len(c) for c in CANDIDATES.values())} candidates -> {out}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else ".")
