"""Round five: the zip folder rebuilt on the pixel grid, plus fresh directions.

Round four's centre seam was the right icon and the wrong construction: tab,
body, channel, teeth and pull were five shapes placed on arbitrary fractions
of the tile, so at 16px their edges landed on different subpixels and the
glyph read as parts that do not belong together.

Everything here is laid out in SIXTEENTHS of the tile (`g`), so every edge
falls on a real pixel boundary when the icon renders at 16px, and anything
meant to be symmetric is centred on 8 with an even width. The rest of the
round is archive ideas that owe nothing to the folder.
"""
from PIL import Image, ImageDraw

from icons import S, DARK, WHITE, GREY, ACCENT, ACCENT_HI, tile, done


def g(n, k):
    """A coordinate in sixteenths of the tile: one unit is one pixel at 16px."""
    return k * n / 16.0


# ------------------------------------------------- the keeper, rebuilt
def zip_folder(size):
    """Round four's centre seam, every edge on the grid, symmetric about 8."""
    img, d, n = tile(size)
    r = g(n, 0.9)
    d.rounded_rectangle([g(n, 1), g(n, 3), g(n, 7), g(n, 6)], radius=r, fill=WHITE)
    d.rounded_rectangle([g(n, 1), g(n, 4.5), g(n, 15), g(n, 13)], radius=r, fill=WHITE)
    # Channel: two units wide, so it covers whole pixels either side of centre.
    d.rectangle([g(n, 7), g(n, 5), g(n, 9), g(n, 10.5)], fill=DARK)
    for i in range(5):
        y = g(n, 5.4 + i * 1.05)
        d.rectangle([g(n, 6), y, g(n, 10), y + g(n, 0.5)], fill=WHITE)
    d.rounded_rectangle([g(n, 6), g(n, 10.4), g(n, 10), g(n, 12)], radius=g(n, 0.5), fill=ACCENT)
    d.rectangle([g(n, 7.25), g(n, 11.5), g(n, 8.75), g(n, 12.6)], fill=ACCENT)
    return done(img, size)


def zip_file(size):
    """The same zipper on a FILE rather than a folder: what a .zip actually is."""
    img, d, n = tile(size)
    d.rounded_rectangle([g(n, 2.5), g(n, 1.5), g(n, 13.5), g(n, 14.5)], radius=g(n, 0.9), fill=WHITE)
    d.rectangle([g(n, 7), g(n, 3), g(n, 9), g(n, 10)], fill=DARK)
    for i in range(6):
        y = g(n, 3.4 + i * 1.05)
        d.rectangle([g(n, 6), y, g(n, 10), y + g(n, 0.5)], fill=WHITE)
    d.rounded_rectangle([g(n, 6), g(n, 10), g(n, 10), g(n, 11.6)], radius=g(n, 0.5), fill=ACCENT)
    d.rectangle([g(n, 7.25), g(n, 11.1), g(n, 8.75), g(n, 12.4)], fill=ACCENT)
    return done(img, size)


# ------------------------------------------------------- fresh directions
def press(size):
    """Two plates pressing a stack: compression as a picture, not a metaphor."""
    img, d, n = tile(size)
    d.rounded_rectangle([g(n, 1), g(n, 2), g(n, 15), g(n, 4)], radius=g(n, 0.6), fill=ACCENT_HI)
    d.rounded_rectangle([g(n, 1), g(n, 12), g(n, 15), g(n, 14)], radius=g(n, 0.6), fill=ACCENT_HI)
    for i in range(3):
        y = g(n, 5 + i * 2.2)
        d.rounded_rectangle([g(n, 3), y, g(n, 13), y + g(n, 1.6)], radius=g(n, 0.4), fill=WHITE)
    return done(img, size)


def container(size):
    """A shipping container: corrugated, banded, unmistakably a thing that holds things."""
    img, d, n = tile(size)
    d.rounded_rectangle([g(n, 1), g(n, 4), g(n, 15), g(n, 12)], radius=g(n, 0.8), fill=WHITE)
    for k in (3, 5, 7, 9, 11, 13):
        d.rectangle([g(n, k), g(n, 4.5), g(n, k + 0.7), g(n, 11.5)], fill=DARK)
    d.rectangle([g(n, 1), g(n, 7), g(n, 15), g(n, 9)], fill=ACCENT)
    return done(img, size)


def chest(size):
    """A banded chest with a clasp: closed, and holding something."""
    img, d, n = tile(size)
    d.rounded_rectangle([g(n, 1.5), g(n, 3), g(n, 14.5), g(n, 6.5)], radius=g(n, 0.8), fill=GREY)
    d.rounded_rectangle([g(n, 1.5), g(n, 6), g(n, 14.5), g(n, 13)], radius=g(n, 0.8), fill=WHITE)
    d.rectangle([g(n, 6.5), g(n, 3), g(n, 9.5), g(n, 13)], fill=ACCENT)
    d.rounded_rectangle([g(n, 6), g(n, 7), g(n, 10), g(n, 9.5)], radius=g(n, 0.5), fill=ACCENT_HI)
    return done(img, size)


def bundle(size):
    """Sheets tied with a band: the plainest true statement of what an archive is."""
    img, d, n = tile(size)
    for i, col in enumerate((GREY, WHITE)):
        o = g(n, 1.2 * (1 - i))
        d.rounded_rectangle([g(n, 2) + o, g(n, 2) + o, g(n, 12) + o, g(n, 14) + o],
                            radius=g(n, 0.8), fill=col)
    d.rectangle([g(n, 1), g(n, 7), g(n, 15), g(n, 9.5)], fill=ACCENT)
    return done(img, size)


def cube(size):
    """Files packed into a solid: a stack seen as one object."""
    img, d, n = tile(size)
    d.polygon([(g(n, 8), g(n, 1.5)), (g(n, 15), g(n, 5)), (g(n, 8), g(n, 8.5)), (g(n, 1), g(n, 5))],
              fill=ACCENT_HI)
    d.polygon([(g(n, 1), g(n, 5)), (g(n, 8), g(n, 8.5)), (g(n, 8), g(n, 14.5)), (g(n, 1), g(n, 11))],
              fill=WHITE)
    d.polygon([(g(n, 15), g(n, 5)), (g(n, 8), g(n, 8.5)), (g(n, 8), g(n, 14.5)), (g(n, 15), g(n, 11))],
              fill=GREY)
    d.rectangle([g(n, 1), g(n, 8), g(n, 8), g(n, 9)], fill=DARK)
    d.rectangle([g(n, 8), g(n, 8), g(n, 15), g(n, 9)], fill=DARK)
    return done(img, size)


def lock_folder(size):
    """A folder that is closed: the other true thing about archives."""
    img, d, n = tile(size)
    r = g(n, 0.9)
    d.rounded_rectangle([g(n, 1), g(n, 3), g(n, 7), g(n, 6)], radius=r, fill=WHITE)
    d.rounded_rectangle([g(n, 1), g(n, 4.5), g(n, 15), g(n, 13)], radius=r, fill=WHITE)
    d.rounded_rectangle([g(n, 6), g(n, 5.5), g(n, 10), g(n, 9)], radius=g(n, 1.2),
                        outline=DARK, width=int(g(n, 0.9)))
    d.rounded_rectangle([g(n, 4.5), g(n, 8), g(n, 11.5), g(n, 12.5)], radius=g(n, 0.7), fill=ACCENT)
    return done(img, size)


def inward(size):
    """Four arrows pulling in: the verb every compressor puts on its button."""
    img, d, n = tile(size)
    d.rounded_rectangle([g(n, 4), g(n, 4), g(n, 12), g(n, 12)], radius=g(n, 1), fill=WHITE)
    w = int(g(n, 1.1))
    for pts in (
        [(g(n, 1), g(n, 1)), (g(n, 4.5), g(n, 4.5))],
        [(g(n, 15), g(n, 1)), (g(n, 11.5), g(n, 4.5))],
        [(g(n, 1), g(n, 15)), (g(n, 4.5), g(n, 11.5))],
        [(g(n, 15), g(n, 15)), (g(n, 11.5), g(n, 11.5))],
    ):
        d.line(pts, fill=ACCENT_HI, width=w)
    d.rectangle([g(n, 6), g(n, 7.25), g(n, 10), g(n, 8.75)], fill=ACCENT)
    return done(img, size)


def drawer(size):
    """One drawer pulled out of a cabinet: put away, and gettable again."""
    img, d, n = tile(size)
    d.rounded_rectangle([g(n, 2), g(n, 1.5), g(n, 14), g(n, 14.5)], radius=g(n, 0.9), fill=WHITE)
    d.rectangle([g(n, 2), g(n, 6), g(n, 14), g(n, 6.6)], fill=DARK)
    d.rectangle([g(n, 2), g(n, 10.4), g(n, 14), g(n, 11)], fill=DARK)
    d.rounded_rectangle([g(n, 0.5), g(n, 6.6), g(n, 15.5), g(n, 10.4)], radius=g(n, 0.6), fill=ACCENT_HI)
    d.rounded_rectangle([g(n, 6.5), g(n, 8), g(n, 9.5), g(n, 9)], radius=g(n, 0.5), fill=DARK)
    return done(img, size)


def strap_box(size):
    """A box under a strap, which is what WinRAR draws and what a parcel is."""
    img, d, n = tile(size)
    d.rounded_rectangle([g(n, 1.5), g(n, 3), g(n, 14.5), g(n, 13.5)], radius=g(n, 1), fill=WHITE)
    d.rectangle([g(n, 1.5), g(n, 6), g(n, 14.5), g(n, 7.5)], fill=DARK)
    d.rectangle([g(n, 6.5), g(n, 1.5), g(n, 9.5), g(n, 15)], fill=ACCENT)
    d.rounded_rectangle([g(n, 5.5), g(n, 8.5), g(n, 10.5), g(n, 11)], radius=g(n, 0.6), fill=ACCENT_HI)
    return done(img, size)


KINDS = {
    "the keeper": [
        ("zip folder (on grid)", zip_folder),
        ("zip file", zip_file),
    ],
    "fresh": [
        ("press", press),
        ("container", container),
        ("chest", chest),
        ("bundle", bundle),
        ("cube", cube),
    ],
    "fresh 2": [
        ("lock folder", lock_folder),
        ("inward", inward),
        ("drawer", drawer),
        ("strap box", strap_box),
    ],
}
