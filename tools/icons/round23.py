"""Round twenty-three: the pop-art ground again, with the HALFTONE actually captured.

Two notes: the elements were not really captured, the dots least of all, and
the turquoise stars are gone. The stars are simply deleted here. The dots are
the round.

What was wrong with them. Round twenty-two drew black at 48/255 alpha, radius
0.26 of a unit, on a 1.0 pitch. That is a faint dirtying of the wedge rather
than a printed dot: at 96px it read as texture and at 16px it read as nothing.
Measured off the reference, the dots are about a fifth of their own spacing
across and clearly a different TONE, not a shadow - and the tone differs by
wedge, dark red on the red and orange on the yellow.

So two things change. The dots are bigger and far stronger, and they come in
two flavours: a neutral dark that simply deepens whatever is under it, and a
WARM one, which is what actually reproduces the reference - a translucent
red-brown reads as orange over the lemon wedge and as deep red over a red
ground, which is precisely the pair the reference has. The warm dot is still
translucent, so it still follows whatever background colour is picked.

The keyline is also fatter, because at the reference's ray count a hairline
between wedges disappears before the dots do.

    python round23.py <outdir>
"""
import pathlib
import sys
from math import cos, pi, sin

from round18 import COMICS as R18
from round18 import CREAM_A, INK_A, LEMON_A, P, PINK, _frame, comic_flat
from round21 import framed
from round5 import g

IN = (P[0] + 1.7, P[1] + 1.7, P[2] - 1.7, P[3] - 1.7)
BURST_X, BURST_Y = 8.0, 8.6

# The two dot inks. NEUTRAL just deepens; WARM is the one that reproduces the
# reference, because a translucent red-brown goes orange over lemon and deep
# red over a red ground - the reference's own pair, from one colour.
NEUTRAL = (0, 0, 0, 120)
WARM = (168, 42, 10, 150)


def _wedge(d, n, a0, a1, col, r=22.0):
    d.polygon([(g(n, BURST_X), g(n, BURST_Y)),
               (g(n, BURST_X + r * cos(a0)), g(n, BURST_Y + r * sin(a0))),
               (g(n, BURST_X + r * cos(a1)), g(n, BURST_Y + r * sin(a1)))], fill=col)


def sunburst(d, n, accent=LEMON_A, count=16, keyline=0.042):
    """Alternating wedges, black keyline between every pair.

    Interior goes black; each wedge is redrawn narrower, accent on the even ones
    and ERASED on the odd ones so the tintable ground shows through. What
    survives between them is the keyline, set as a half-angle rather than a
    stroke so it stays even at every size.
    """
    d.rectangle([g(n, IN[0]), g(n, IN[1]), g(n, IN[2]), g(n, IN[3])], fill=INK_A)
    for i in range(count):
        a0 = 2 * pi * i / count + keyline
        a1 = 2 * pi * (i + 1) / count - keyline
        _wedge(d, n, a0, a1, accent if i % 2 == 0 else (0, 0, 0, 0))


def halftone(d, n, ink=WARM, step=1.25, r=0.36):
    """Printed dots: a fifth of their spacing across, and a real tone.

    Round twenty-two had these at r=0.26 on a 1.0 pitch in black at 48 alpha,
    which is a smudge rather than a dot. These are the reference's proportions.
    """
    x0, y0, x1, y1 = IN
    for iy in range(int((y1 - y0) / step) + 2):
        for ix in range(int((x1 - x0) / step) + 2):
            cx = x0 + ix * step + (step / 2 if iy % 2 else 0)
            cy = y0 + iy * step
            if cx <= x1 and cy <= y1:
                d.ellipse([g(n, cx - r), g(n, cy - r), g(n, cx + r), g(n, cy + r)], fill=ink)


CLOUDS = (
    ((3.9, 12.4, 1.25), (5.3, 12.1, 1.00), (6.4, 12.5, 0.85)),
    ((10.1, 12.6, 0.95), (11.3, 12.2, 1.20), (12.5, 12.6, 0.95)),
)


def clouds(d, n):
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
def bg_nodots(d, n):
    sunburst(d, n)


def bg_warm(d, n):
    sunburst(d, n)
    halftone(d, n)


def bg_warm_big(d, n):
    sunburst(d, n)
    halftone(d, n, WARM, 1.55, 0.48)


def bg_warm_fine(d, n):
    sunburst(d, n)
    halftone(d, n, WARM, 1.00, 0.29)


def bg_neutral(d, n):
    sunburst(d, n)
    halftone(d, n, NEUTRAL)


def bg_neutral_big(d, n):
    sunburst(d, n)
    halftone(d, n, NEUTRAL, 1.55, 0.48)


def bg_coarse(d, n):
    sunburst(d, n, LEMON_A, 12, 0.052)
    halftone(d, n, WARM, 1.45, 0.44)


def bg_fine(d, n):
    sunburst(d, n, LEMON_A, 22, 0.030)
    halftone(d, n)


def bg_warm_clouds(d, n):
    sunburst(d, n)
    halftone(d, n)
    clouds(d, n)


def bg_light(d, n):
    """Wedges made of the ground colour itself, so nothing is pinned to lemon."""
    sunburst(d, n, (255, 255, 255, 96))
    halftone(d, n, NEUTRAL)


BACKGROUNDS = [
    ("nodots", "Wedges only, no halftone", bg_nodots),
    ("warm", "Warm halftone  (the reference's own dot)", bg_warm),
    ("warmbig", "Warm halftone, bigger dots", bg_warm_big),
    ("warmfine", "Warm halftone, finer dots", bg_warm_fine),
    ("neutral", "Neutral dark halftone", bg_neutral),
    ("neutralbig", "Neutral halftone, bigger dots", bg_neutral_big),
    ("coarse", "Fewer, fatter wedges + warm dots", bg_coarse),
    ("fine", "More, thinner wedges + warm dots", bg_fine),
    ("clouds", "Warm halftone + clouds", bg_warm_clouds),
    ("light", "Ground-colour wedges + neutral dots", bg_light),
]

HERO_BG = bg_warm


def bare(bg):
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
    "background": "No stars anywhere, as asked. The round is about the DOTS: "
                  "round twenty-two drew them at a quarter of a unit in black at "
                  "48 alpha, which is a smudge, not a printed dot. These are the "
                  "reference's proportions, and the WARM ink is the one that "
                  "actually reproduces it - one translucent red-brown that goes "
                  "orange over the lemon wedge and deep red over a red ground, "
                  "which is exactly the pair your reference has.",
    "withart": "The same ground with round eighteen's artwork on it, for "
               "comparison. A burst on a sunburst is two bursts, so the ground "
               "alone may still be the stronger answer.",
}


def caption(kind, key):
    from round12 import contrast_note
    for k, _l, fn in CANDIDATES[kind]:
        if k == key:
            return contrast_note(fn(16))
    return ""


def main(out_dir):
    out = pathlib.Path(out_dir) / "round23"
    out.mkdir(parents=True, exist_ok=True)
    for kind, cands in CANDIDATES.items():
        for key, _l, fn in cands:
            for s in SIZES + (HERO,):
                fn(s).save(out / f"{kind}-{key}-{s}.png")
    print(f"{sum(len(c) for c in CANDIDATES.values())} candidates -> {out}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else ".")
