"""Round four: archive only, built around the folder with a zipper.

Every earlier archive attempt was rejected and the one that landed was round
one's zip folder, which is also what Windows itself draws for a compressed
folder. So this round works that shape properly: where the zipper runs, how
open it is, and what the pull looks like, plus three departures (pouch,
envelope, perspective) to check the direction against something else.

The teeth are the hard part at 16px: many fine teeth blur into a grey smear,
so these use FEW chunky nubs, which resolve into a legible seam instead.
"""
from PIL import Image, ImageDraw

from icons import S, DARK, WHITE, GREY, ACCENT, ACCENT_HI, tile, done


def folder(d, n, fill=WHITE, top=0.22, bottom=0.80):
    """The classic folder silhouette: tab, then body."""
    d.rounded_rectangle([n * 0.12, n * top, n * 0.46, n * (top + 0.14)], radius=n * 0.035, fill=fill)
    d.rounded_rectangle([n * 0.12, n * (top + 0.06), n * 0.88, n * bottom], radius=n * 0.06, fill=fill)


def seam(d, n, a, b, thick=0.062, teeth=7, col=DARK, tooth=WHITE):
    """A zipper seam from a to b.

    A zipper's TEETH are the light parts and the channel between them is the
    dark part, so the teeth are drawn in the folder's own colour crossing a
    dark channel, alternating which side they reach further on. Drawing them
    dark (round four's first attempt) makes a black rod with spikes.
    """
    (x0, y0), (x1, y1) = a, b
    vertical = abs(y1 - y0) > abs(x1 - x0)
    t = n * thick
    reach, stub, half = t * 1.15, t * 0.25, n * 0.019
    if vertical:
        d.rectangle([x0 - t / 2, y0, x0 + t / 2, y1], fill=col)
        step = (y1 - y0) / teeth
        for i in range(teeth):
            y = y0 + step * (i + 0.5)
            left, right = (reach, stub) if i % 2 else (stub, reach)
            d.rounded_rectangle([x0 - left, y - half, x0 + right, y + half],
                                radius=n * 0.008, fill=tooth)
    else:
        d.rectangle([x0, y0 - t / 2, x1, y0 + t / 2], fill=col)
        step = (x1 - x0) / teeth
        for i in range(teeth):
            x = x0 + step * (i + 0.5)
            up, down = (reach, stub) if i % 2 else (stub, reach)
            d.rounded_rectangle([x - half, y0 - up, x + half, y0 + down],
                                radius=n * 0.008, fill=tooth)


def pull(d, n, cx, cy, w=0.115, h=0.20, col=ACCENT):
    """The slider: a body with a narrow tongue, which is what says zip."""
    d.rounded_rectangle([cx - n * w / 2, cy - n * h * 0.28, cx + n * w / 2, cy + n * h * 0.2],
                        radius=n * 0.026, fill=col)
    d.rounded_rectangle([cx - n * w * 0.17, cy + n * h * 0.12, cx + n * w * 0.17, cy + n * h * 0.62],
                        radius=n * 0.018, fill=col)


# ---------------------------------------------------------------- variants
def zip_center(size):
    """Windows' compressed folder, drawn properly: seam down the middle, pull at the foot."""
    img, d, n = tile(size)
    folder(d, n)
    seam(d, n, (n * 0.50, n * 0.30), (n * 0.50, n * 0.66), teeth=5)
    pull(d, n, n * 0.50, n * 0.68)
    return done(img, size)


def zip_open(size):
    """Half unzipped, with the contents showing through the gap."""
    img, d, n = tile(size)
    folder(d, n)
    d.rounded_rectangle([n * 0.42, n * 0.52, n * 0.58, n * 0.80], radius=n * 0.03, fill=DARK)
    d.rounded_rectangle([n * 0.45, n * 0.56, n * 0.55, n * 0.80], radius=n * 0.02, fill=ACCENT_HI)
    seam(d, n, (n * 0.50, n * 0.29), (n * 0.50, n * 0.50), teeth=3)
    pull(d, n, n * 0.50, n * 0.52, col=ACCENT)
    return done(img, size)


def zip_across(size):
    """The seam runs the other way, which keeps the folder's width readable."""
    img, d, n = tile(size)
    folder(d, n)
    seam(d, n, (n * 0.16, n * 0.56), (n * 0.66, n * 0.56), teeth=5)
    pull(d, n, n * 0.72, n * 0.56)
    return done(img, size)


def zip_pull_only(size):
    """No teeth at all: a plain folder and one unmistakable slider."""
    img, d, n = tile(size)
    folder(d, n)
    d.rectangle([n * 0.475, n * 0.30, n * 0.525, n * 0.56], fill=DARK)
    pull(d, n, n * 0.50, n * 0.60, w=0.20, h=0.24)
    return done(img, size)


def zip_diagonal(size):
    """A diagonal seam: the most movement, the most to lose small."""
    img, d, n = tile(size)
    folder(d, n)
    layer = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    ld = ImageDraw.Draw(layer)
    seam(ld, n, (n * 0.50, n * 0.26), (n * 0.50, n * 0.70), teeth=5)
    pull(ld, n, n * 0.50, n * 0.72)
    img.alpha_composite(layer.rotate(-32, resample=Image.BICUBIC, center=(n * 0.5, n * 0.5)))
    return done(img, size)


def zip_edge(size):
    """Teeth along the folder's opening edge, the way a case actually closes."""
    img, d, n = tile(size)
    folder(d, n, top=0.24, bottom=0.82)
    seam(d, n, (n * 0.14, n * 0.42), (n * 0.72, n * 0.42), teeth=6)
    pull(d, n, n * 0.79, n * 0.42, w=0.12, h=0.15)
    return done(img, size)


def zip_thick(size):
    """The same idea with the seam and pull scaled up for the 16px grid."""
    img, d, n = tile(size)
    folder(d, n)
    seam(d, n, (n * 0.50, n * 0.32), (n * 0.50, n * 0.64), thick=0.095, teeth=5)
    pull(d, n, n * 0.50, n * 0.66, w=0.18, h=0.22)
    return done(img, size)


def zip_accent_seam(size):
    """Accent moved onto the seam itself, so the pull can be white."""
    img, d, n = tile(size)
    folder(d, n)
    seam(d, n, (n * 0.50, n * 0.30), (n * 0.50, n * 0.64), teeth=7, col=ACCENT)
    pull(d, n, n * 0.50, n * 0.66, col=ACCENT_HI)
    return done(img, size)


def pouch(size):
    """Not a folder: a zipped pouch, in case the folder is the part that is wrong."""
    img, d, n = tile(size)
    d.rounded_rectangle([n * 0.14, n * 0.26, n * 0.86, n * 0.82], radius=n * 0.12, fill=WHITE)
    seam(d, n, (n * 0.18, n * 0.40), (n * 0.68, n * 0.40), teeth=5)
    pull(d, n, n * 0.75, n * 0.40, w=0.12, h=0.15)
    return done(img, size)


def zip_perspective(size):
    """A folder with a front panel, so the zipper sits on something with depth."""
    img, d, n = tile(size)
    d.rounded_rectangle([n * 0.12, n * 0.20, n * 0.60, n * 0.34], radius=n * 0.035, fill=GREY)
    d.rounded_rectangle([n * 0.12, n * 0.26, n * 0.88, n * 0.50], radius=n * 0.05, fill=GREY)
    d.rounded_rectangle([n * 0.12, n * 0.38, n * 0.88, n * 0.82], radius=n * 0.06, fill=WHITE)
    seam(d, n, (n * 0.50, n * 0.44), (n * 0.50, n * 0.70), teeth=4)
    pull(d, n, n * 0.50, n * 0.72, w=0.14, h=0.17)
    return done(img, size)


def envelope_zip(size):
    """A sealed envelope: a container that is closed, without borrowing the folder."""
    img, d, n = tile(size)
    d.rounded_rectangle([n * 0.12, n * 0.26, n * 0.88, n * 0.78], radius=n * 0.06, fill=WHITE)
    d.polygon([(n * 0.12, n * 0.30), (n * 0.50, n * 0.56), (n * 0.88, n * 0.30),
               (n * 0.88, n * 0.26), (n * 0.12, n * 0.26)], fill=GREY)
    seam(d, n, (n * 0.30, n * 0.66), (n * 0.62, n * 0.66), teeth=4)
    pull(d, n, n * 0.69, n * 0.66, w=0.11, h=0.14)
    return done(img, size)


def zip_two_tone(size):
    """The folder's two halves separated by the seam, one of them the accent."""
    img, d, n = tile(size)
    folder(d, n)
    d.rounded_rectangle([n * 0.52, n * 0.28, n * 0.88, n * 0.80], radius=n * 0.06, fill=ACCENT_HI)
    d.rectangle([n * 0.52, n * 0.28, n * 0.62, n * 0.80], fill=ACCENT_HI)
    seam(d, n, (n * 0.50, n * 0.30), (n * 0.50, n * 0.64), teeth=7, col=DARK)
    pull(d, n, n * 0.50, n * 0.66, col=DARK)
    return done(img, size)


KINDS = {
    "zip folder": [
        ("centre seam", zip_center),
        ("half open", zip_open),
        ("across", zip_across),
        ("pull only", zip_pull_only),
        ("diagonal", zip_diagonal),
    ],
    "zip folder 2": [
        ("edge teeth", zip_edge),
        ("thick seam", zip_thick),
        ("accent seam", zip_accent_seam),
        ("two tone", zip_two_tone),
        ("perspective", zip_perspective),
    ],
    "not a folder": [
        ("pouch", pouch),
        ("envelope", envelope_zip),
    ],
}
