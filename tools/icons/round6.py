"""Round six: archive, away from boxes and folders.

Rounds one to five worked containers (box, crate, folder, parcel, chest,
drawer, case, cube) and zippers, and every one of them was rejected. So this
round drops both families and tries marks: folding, rolling, nesting,
interlocking, funnelling, and one piece of typography. Same 16ths grid as
round five, so nothing lands between pixels.
"""
from PIL import Image, ImageDraw

from icons import S, DARK, WHITE, GREY, ACCENT, ACCENT_HI, tile, done
from round5 import g


def accordion(size):
    """Folded flat: the shape compression makes, drawn edge on."""
    img, d, n = tile(size)
    w = int(g(n, 1.8))
    pts = [(g(n, 1.5), g(n, 11)), (g(n, 5), g(n, 5)), (g(n, 8), g(n, 11)),
           (g(n, 11), g(n, 5)), (g(n, 14.5), g(n, 11))]
    d.line(pts, fill=WHITE, width=w, joint="curve")
    d.line([(g(n, 8), g(n, 11)), (g(n, 11), g(n, 5))], fill=ACCENT_HI, width=w)
    return done(img, size)


def scroll(size):
    """Rolled up, which is what compacting something looks like."""
    img, d, n = tile(size)
    d.rounded_rectangle([g(n, 3.5), g(n, 3), g(n, 12.5), g(n, 13)], radius=g(n, 0.6), fill=WHITE)
    d.rounded_rectangle([g(n, 1.5), g(n, 1.5), g(n, 14.5), g(n, 4.5)], radius=g(n, 1.5), fill=ACCENT_HI)
    d.rounded_rectangle([g(n, 1.5), g(n, 11.5), g(n, 14.5), g(n, 14.5)], radius=g(n, 1.5), fill=ACCENT_HI)
    for i in range(2):
        y = g(n, 6.5 + i * 2.2)
        d.rectangle([g(n, 5.5), y, g(n, 10.5), y + g(n, 0.8)], fill=DARK)
    return done(img, size)


def tag(size):
    """A luggage tag: a silhouette nothing else in the set owns."""
    img, d, n = tile(size)
    d.polygon([(g(n, 6), g(n, 2)), (g(n, 14), g(n, 2)), (g(n, 14), g(n, 14)),
               (g(n, 6), g(n, 14)), (g(n, 1.5), g(n, 8))], fill=WHITE)
    d.ellipse([g(n, 7), g(n, 6.5), g(n, 10), g(n, 9.5)], fill=DARK)
    d.rectangle([g(n, 11), g(n, 5), g(n, 12.5), g(n, 11)], fill=ACCENT)
    return done(img, size)


def nested(size):
    """A thing inside a thing inside a thing."""
    img, d, n = tile(size)
    d.rounded_rectangle([g(n, 1), g(n, 1), g(n, 15), g(n, 15)], radius=g(n, 1.6),
                        outline=WHITE, width=int(g(n, 1.4)))
    d.rounded_rectangle([g(n, 4), g(n, 4), g(n, 12), g(n, 12)], radius=g(n, 1.2),
                        outline=GREY, width=int(g(n, 1.4)))
    d.rounded_rectangle([g(n, 6.5), g(n, 6.5), g(n, 9.5), g(n, 9.5)], radius=g(n, 0.8), fill=ACCENT_HI)
    return done(img, size)


def comb(size):
    """The zipper as a mark of its own, with no folder underneath it."""
    img, d, n = tile(size)
    for i in range(6):
        y = g(n, 2 + i * 2.2)
        d.rounded_rectangle([g(n, 1), y, g(n, 8.6), y + g(n, 1.2)], radius=g(n, 0.3), fill=WHITE)
        d.rounded_rectangle([g(n, 7.4), y + g(n, 1.1), g(n, 15), y + g(n, 2.3)],
                            radius=g(n, 0.3), fill=GREY)
    d.rounded_rectangle([g(n, 6), g(n, 6.5), g(n, 10), g(n, 9.5)], radius=g(n, 0.7), fill=ACCENT)
    return done(img, size)


def funnel(size):
    """Many things in the top, one thing out of the bottom."""
    img, d, n = tile(size)
    for i in range(3):
        x = g(n, 1.5 + i * 4.8)
        d.rounded_rectangle([x, g(n, 1.5), x + g(n, 3.6), g(n, 5)], radius=g(n, 0.5), fill=WHITE)
    d.polygon([(g(n, 1.5), g(n, 6.5)), (g(n, 14.5), g(n, 6.5)),
               (g(n, 9.5), g(n, 10.5)), (g(n, 6.5), g(n, 10.5))], fill=GREY)
    d.rounded_rectangle([g(n, 5.5), g(n, 11.5), g(n, 10.5), g(n, 14.5)], radius=g(n, 0.6), fill=ACCENT)
    return done(img, size)


def puzzle(size):
    """Pieces that fit together, packed with nothing wasted."""
    img, d, n = tile(size)
    q = [(1, 1, WHITE), (8.5, 1, GREY), (1, 8.5, GREY), (8.5, 8.5, ACCENT_HI)]
    for x, y, col in q:
        d.rounded_rectangle([g(n, x), g(n, y), g(n, x + 6.5), g(n, y + 6.5)],
                            radius=g(n, 0.8), fill=col)
    d.ellipse([g(n, 6.5), g(n, 3), g(n, 9.5), g(n, 6)], fill=WHITE)
    d.ellipse([g(n, 6.5), g(n, 10), g(n, 9.5), g(n, 13)], fill=ACCENT_HI)
    d.ellipse([g(n, 3), g(n, 6.5), g(n, 6), g(n, 9.5)], fill=GREY)
    return done(img, size)


def squeezed(size):
    """The before and the after in one picture: loose lines, solid block."""
    img, d, n = tile(size)
    for i in range(5):
        y = g(n, 1.5 + i * 1.5)
        d.rounded_rectangle([g(n, 2), y, g(n, 14), y + g(n, 0.9)], radius=g(n, 0.3), fill=GREY)
    d.rounded_rectangle([g(n, 2), g(n, 10), g(n, 14), g(n, 14.5)], radius=g(n, 0.7), fill=WHITE)
    d.rectangle([g(n, 2), g(n, 11.5), g(n, 14), g(n, 13)], fill=ACCENT)
    return done(img, size)


def spring(size):
    """A coil under load: held small, wants to be big again."""
    img, d, n = tile(size)
    d.rounded_rectangle([g(n, 1.5), g(n, 1.5), g(n, 14.5), g(n, 3.5)], radius=g(n, 0.6), fill=ACCENT_HI)
    d.rounded_rectangle([g(n, 1.5), g(n, 12.5), g(n, 14.5), g(n, 14.5)], radius=g(n, 0.6), fill=ACCENT_HI)
    w = int(g(n, 1.3))
    pts = []
    for i in range(5):
        y = g(n, 5 + i * 1.7)
        pts += [(g(n, 3), y), (g(n, 13), y + g(n, 0.85))]
    d.line(pts, fill=WHITE, width=w, joint="curve")
    return done(img, size)


def monogram(size):
    """Say it: Z, with the accent as the stroke through it."""
    img, d, n = tile(size)
    w = int(g(n, 2.2))
    d.line([(g(n, 3), g(n, 4)), (g(n, 13), g(n, 4))], fill=WHITE, width=w)
    d.line([(g(n, 12.6), g(n, 4.4)), (g(n, 3.4), g(n, 11.6))], fill=WHITE, width=w)
    d.line([(g(n, 3), g(n, 12)), (g(n, 13), g(n, 12))], fill=ACCENT_HI, width=w)
    return done(img, size)


def crate(size):
    """A crate: braced, and obviously holding something."""
    img, d, n = tile(size)
    d.rounded_rectangle([g(n, 1.5), g(n, 3), g(n, 14.5), g(n, 13)], radius=g(n, 0.8),
                        outline=WHITE, width=int(g(n, 1.4)))
    w = int(g(n, 1.3))
    d.line([(g(n, 3), g(n, 4.5)), (g(n, 13), g(n, 11.5))], fill=ACCENT_HI, width=w)
    d.line([(g(n, 13), g(n, 4.5)), (g(n, 3), g(n, 11.5))], fill=ACCENT_HI, width=w)
    return done(img, size)


def brackets(size):
    """A set: everything between these two marks is one thing."""
    img, d, n = tile(size)
    w = int(g(n, 1.5))
    d.line([(g(n, 5), g(n, 2)), (g(n, 1.5), g(n, 2)), (g(n, 1.5), g(n, 14)), (g(n, 5), g(n, 14))],
           fill=WHITE, width=w, joint="curve")
    d.line([(g(n, 11), g(n, 2)), (g(n, 14.5), g(n, 2)), (g(n, 14.5), g(n, 14)), (g(n, 11), g(n, 14))],
           fill=WHITE, width=w, joint="curve")
    for i, col in enumerate((GREY, ACCENT, GREY)):
        y = g(n, 4.5 + i * 2.6)
        d.rounded_rectangle([g(n, 4), y, g(n, 12), y + g(n, 1.8)], radius=g(n, 0.4), fill=col)
    return done(img, size)


KINDS = {
    "folded / rolled": [
        ("accordion", accordion),
        ("scroll", scroll),
        ("squeezed", squeezed),
        ("spring", spring),
    ],
    "held / nested": [
        ("tag", tag),
        ("nested", nested),
        ("brackets", brackets),
        ("crate", crate),
    ],
    "packed / said": [
        ("comb", comb),
        ("funnel", funnel),
        ("puzzle", puzzle),
        ("monogram Z", monogram),
    ],
}
