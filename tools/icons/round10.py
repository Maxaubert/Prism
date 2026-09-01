"""Round ten: the packed stack, belted properly.

Round nine's strap was a vertical bar laid over the layers and read as exactly
that - a line on top of the icon rather than something holding it together.
The reason is that it had no relationship to the shape underneath: same plane,
no join, nothing cut.

At icon scale the only depth cue that survives is SILHOUETTE. A shadow, a
gradient or a 0.4-unit highlight is a grey smudge at 16px. So every option
here changes the stack itself where the belt crosses it: a carved channel, a
pinched waist, a bar interrupted, a bar passing in front. The carving is real -
the glyph layer's alpha is set to zero, so the near-black tile shows through
and the gap is a genuine hole rather than a painted line.

The stack is round nine's option 2 throughout: three thick layers, barely
apart, which is the packing that was chosen.
"""
from PIL import Image, ImageDraw

from round5 import g
from round7 import TILED, canvas, finish

X0, X1 = 1.5, 14.5
TOP, H, PITCH = 2.4, 3.6, 4.2
CLEAR = (0, 0, 0, 0)


def _stack(d, n, p, cols=None):
    """Round nine's option 2: three thick layers, barely apart."""
    cols = cols or (p.body, p.alt, p.body)
    for i in range(3):
        y = g(n, TOP + i * PITCH)
        d.rounded_rectangle([g(n, X0), y, g(n, X1), y + g(n, H)], radius=g(n, 0.8), fill=cols[i])


def _carve(d, n, x0, x1, y0=1.0, y1=15.4):
    """Cut a channel clean through the layers, tile and all."""
    d.rectangle([g(n, x0), g(n, y0), g(n, x1), g(n, y1)], fill=CLEAR)


def _belt(d, n, p, x0, x1, colour=None, y0=1.4, y1=15.0):
    d.rounded_rectangle(
        [g(n, x0), g(n, y0), g(n, x1), g(n, y1)], radius=g(n, 0.6), fill=colour or p.accent
    )


# ------------------------------------------------------------------ options
def grooved(d, n, p):
    """The belt sits in a cut channel: the layers stop for it."""
    _stack(d, n, p)
    _carve(d, n, 5.9, 10.1)
    _belt(d, n, p, 6.6, 9.4)


def grooved_white(d, n, p):
    """The same cut, but the stack keeps its indigo top layer and the belt is
    the light one - the other way round from the option above."""
    _stack(d, n, p, cols=(p.accent, p.alt, p.body))
    _carve(d, n, 5.9, 10.1)
    _belt(d, n, p, 6.6, 9.4, colour=p.body)


def buckle(d, n, p):
    """A channel, a belt, and something holding it, sized to survive 16px."""
    _stack(d, n, p)
    _carve(d, n, 5.5, 10.5)
    _belt(d, n, p, 6.4, 9.6)
    d.rounded_rectangle(
        [g(n, 5.2), g(n, 6.4), g(n, 10.8), g(n, 9.8)], radius=g(n, 0.9), fill=p.body
    )
    d.rounded_rectangle([g(n, 6.6), g(n, 7.5), g(n, 9.4), g(n, 8.7)], radius=g(n, 0.4), fill=CLEAR)


def cinched(d, n, p):
    """Pulled tight: the layers pinch in where the belt crosses and bulge
    either side of it, which is what a bundle actually does."""
    _stack(d, n, p)
    # Take a wedge out of the top and bottom of each layer, narrowing toward
    # the belt, so the stack has a waist.
    for i in range(3):
        y = g(n, TOP + i * PITCH)
        yb = y + g(n, H)
        for x0, x1, w in ((4.4, 6.9, 1), (9.1, 11.6, -1)):
            pts_top = [
                (g(n, x0 if w > 0 else x1), y),
                (g(n, x1 if w > 0 else x0), y),
                (g(n, x1 if w > 0 else x0), y + g(n, 0.75)),
            ]
            d.polygon(pts_top, fill=CLEAR)
            pts_bot = [
                (g(n, x0 if w > 0 else x1), yb),
                (g(n, x1 if w > 0 else x0), yb),
                (g(n, x1 if w > 0 else x0), yb - g(n, 0.75)),
            ]
            d.polygon(pts_bot, fill=CLEAR)
    _carve(d, n, 6.2, 9.8)
    _belt(d, n, p, 6.6, 9.4)


def over_ends(d, n, p):
    """The belt goes round: past the top and bottom of the stack, with the
    layers cut where it passes in front of them."""
    _stack(d, n, p)
    _carve(d, n, 5.9, 10.1)
    _belt(d, n, p, 6.5, 9.5, y0=0.6, y1=15.4)


def threaded(d, n, p):
    """Woven: in front of the outer layers, behind the middle one."""
    _stack(d, n, p)
    _carve(d, n, 5.9, 10.1, y0=1.0, y1=6.6)
    _carve(d, n, 5.9, 10.1, y0=10.4, y1=15.4)
    _belt(d, n, p, 6.6, 9.4)
    # The middle layer, redrawn on top: the belt disappears under it.
    y = g(n, TOP + PITCH)
    d.rounded_rectangle([g(n, X0), y, g(n, X1), y + g(n, H)], radius=g(n, 0.8), fill=p.alt)


def ribbon(d, n, p):
    """A wide band rather than a strap, creased down its centre."""
    _stack(d, n, p)
    _carve(d, n, 4.8, 11.2)
    _belt(d, n, p, 5.5, 10.5)
    d.rectangle([g(n, 7.8), g(n, 1.4), g(n, 8.2), g(n, 15.0)], fill=p.alt)


def off_centre(d, n, p):
    """Where a strap actually sits on a box: a third of the way along."""
    _stack(d, n, p)
    _carve(d, n, 3.4, 7.6)
    _belt(d, n, p, 4.1, 6.9)


def _make(body_fn):
    def fn(size, p):
        img, _, n = canvas(size, p)
        layer = Image.new("RGBA", (n, n), (0, 0, 0, 0))
        body_fn(ImageDraw.Draw(layer), n, p)
        return finish(img, size, p, layer)

    return fn


CANDIDATES = {
    "archive": [
        ("grooved", "belt in a cut channel", _make(grooved)),
        ("groovedw", "same, indigo stack and a light belt", _make(grooved_white)),
        ("buckle", "channel, belt and buckle", _make(buckle)),
        ("cinched", "pulled tight, the stack has a waist", _make(cinched)),
        ("over", "the belt goes round the ends", _make(over_ends)),
        ("threaded", "woven behind the middle layer", _make(threaded)),
        ("ribbon", "a wide creased band", _make(ribbon)),
        ("off", "off centre, where a strap really sits", _make(off_centre)),
    ]
}

SIZES = (16, 20, 24, 32, 48)

FILENAMES = {"archive": "backup-2026.zip"}

SECTIONS = {
    "archive": "Round nine's option 2 (packed, three thick layers) with a belt that is part of "
    "the stack rather than a line over it. Every one of these cuts the layers where the belt "
    "crosses, because at 16px a carved channel survives and a shadow does not."
}


def main(out_dir):
    import pathlib

    out = pathlib.Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    for kind, options in CANDIDATES.items():
        for key, _label, fn in options:
            for s in SIZES:
                fn(s, TILED).save(out / f"{kind}-{key}-{s}.png")
    print(f"{sum(len(v) for v in CANDIDATES.values()) * len(SIZES)} frames -> {out}")


if __name__ == "__main__":
    import sys

    main(sys.argv[1] if len(sys.argv) > 1 else "mockups")
