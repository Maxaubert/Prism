"""Round nine: the archive stack, re-cut.

The three bound volumes have been the archive icon since round one and are
staying in spirit; what is up for decision is how the stack is packed, and
whether something holds it together. Packed tight, packed, as-today, airy, and
then four with a strap: down the middle, with a buckle, two of them, and the
stack tapered as though it had been compressed.

Everything is on the 16ths grid, so nothing lands between pixels at 16px, and
16px is the frame that decides it.
"""
from PIL import Image, ImageDraw

from round5 import g
from round7 import TILED, canvas, finish

# The stack every option is a variation of: full width, rounded, three colours
# from the top down unless the option says otherwise.
X0, X1 = 1.5, 14.5


def _bars(d, n, p, count, top, height, pitch, cols=None, widths=None):
    cols = cols or (p.accent, p.alt, p.body)
    for i in range(count):
        y = g(n, top + i * pitch)
        w = widths[i] if widths else (X0, X1)
        d.rounded_rectangle(
            [g(n, w[0]), y, g(n, w[1]), y + g(n, height)],
            radius=g(n, min(0.8, height / 2)),
            fill=cols[i % len(cols)],
        )


# ------------------------------------------------------------ the packing
def packed_tight(d, n, p):
    """Four layers with almost nothing between them: a solid block of stuff."""
    _bars(d, n, p, 4, 2.6, 2.6, 3.0, cols=(p.accent, p.alt, p.body, p.body))


def packed(d, n, p):
    """Three thick layers, barely apart."""
    _bars(d, n, p, 3, 2.4, 3.6, 4.2)


def as_today(d, n, p):
    """What ships: three layers, a whole unit between them."""
    _bars(d, n, p, 3, 3.0, 3.0, 4.0)


def airy(d, n, p):
    """Three thinner layers, held well apart."""
    _bars(d, n, p, 3, 2.4, 2.4, 4.8)


# -------------------------------------------------------------- the strap
def _strap(d, n, p, x0, x1, colour=None, buckle=False):
    d.rounded_rectangle(
        [g(n, x0), g(n, 1.8), g(n, x1), g(n, 15.0)], radius=g(n, 0.5), fill=colour or p.accent
    )
    if buckle:
        d.rounded_rectangle(
            [g(n, x0 - 0.9), g(n, 6.9), g(n, x1 + 0.9), g(n, 9.7)], radius=g(n, 0.6), fill=p.body
        )
        d.rounded_rectangle(
            [g(n, x0 + 0.1), g(n, 7.7), g(n, x1 - 0.1), g(n, 8.9)], radius=g(n, 0.3), fill=p.ink
        )


def belt(d, n, p):
    """One strap down the middle. The strap is the indigo, so the stack is not."""
    _bars(d, n, p, 3, 3.0, 3.0, 4.0, cols=(p.body, p.alt, p.body))
    _strap(d, n, p, 6.7, 9.3)


def belt_buckle(d, n, p):
    """The same strap, with something holding it."""
    _bars(d, n, p, 3, 3.0, 3.0, 4.0, cols=(p.body, p.alt, p.body))
    _strap(d, n, p, 6.9, 9.1, buckle=True)


def two_belts(d, n, p):
    """Bound like a parcel: two straps, off centre."""
    _bars(d, n, p, 3, 3.0, 3.0, 4.0, cols=(p.body, p.alt, p.body))
    _strap(d, n, p, 3.7, 5.7)
    _strap(d, n, p, 10.3, 12.3)


def tapered(d, n, p):
    """Compressed: each layer narrower than the one above it."""
    _bars(
        d,
        n,
        p,
        3,
        3.0,
        3.0,
        4.0,
        widths=((1.5, 14.5), (2.6, 13.4), (3.7, 12.3)),
    )


def _make(body_fn):
    def fn(size, p):
        img, _, n = canvas(size, p)
        layer = Image.new("RGBA", (n, n), (0, 0, 0, 0))
        body_fn(ImageDraw.Draw(layer), n, p)
        return finish(img, size, p, layer)

    return fn


CANDIDATES = {
    "archive": [
        ("tight", "packed tight, four layers", _make(packed_tight)),
        ("packed", "packed, three thick layers", _make(packed)),
        ("today", "as it ships today", _make(as_today)),
        ("airy", "held apart", _make(airy)),
        ("belt", "a strap down the middle", _make(belt)),
        ("buckle", "strap and buckle", _make(belt_buckle)),
        ("two", "two straps, like a parcel", _make(two_belts)),
        ("taper", "tapered, as though compressed", _make(tapered)),
    ]
}

SIZES = (16, 20, 24, 32, 48)

FILENAMES = {"archive": "backup-2026.zip"}

SECTIONS = {
    "archive": "Variations on the three bound volumes, which have been the archive icon since "
    "round one. What is up for decision is the packing, and whether something holds the stack "
    "together. 3 is what ships today."
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
