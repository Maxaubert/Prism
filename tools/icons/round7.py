"""Round seven: the settled glyphs, drawn against a palette rather than a fixed one.

Code, document and comic were re-picked in round eight (2026-08-31); their
bodies below are that round's, and round8.py keeps every candidate.

The tile was doing the contrast work: a white glyph reads on near-black and
vanishes on Explorer's light mode. So each glyph here takes a Palette and can
be rendered tiled, bare, duotone, or white-with-an-outline, and the sheet puts
every treatment on both an Explorer-white and an Explorer-dark ground.

Everything is on the 16ths grid, so nothing lands between pixels at 16px.
"""
from PIL import Image, ImageDraw, ImageFilter

from icons import S, TILE_TOP, TILE_BOT
from round5 import g


class Palette:
    def __init__(self, body, ink, accent, alt, tile=False, edge=None):
        self.body = body      # the main mass of the glyph
        self.ink = ink        # interior detail, holes, negative shapes
        self.accent = accent  # the one indigo
        self.alt = alt        # the secondary mass
        self.tile = tile      # draw the near-black rounded tile behind it
        self.edge = edge      # outline colour, or None


TILED = Palette((233, 237, 247), (13, 15, 22), (124, 124, 240), (150, 156, 190), tile=True)
BARE = Palette((233, 237, 247), (13, 15, 22), (124, 124, 240), (150, 156, 190))
DUO = Palette((91, 91, 214), (255, 255, 255), (47, 47, 125), (140, 140, 235))
OUTLINE = Palette((245, 246, 252), (35, 38, 58), (91, 91, 214), (176, 181, 208),
                  edge=(35, 38, 58))


def canvas(size, p):
    n = size * S
    img = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    if p.tile:
        grad = Image.new("RGBA", (n, n))
        gd = ImageDraw.Draw(grad)
        for y in range(n):
            t = y / max(1, n - 1)
            col = tuple(int(a + (b - a) * t) for a, b in zip(TILE_TOP, TILE_BOT))
            gd.line([(0, y), (n, y)], fill=col + (255,))
        mask = Image.new("L", (n, n), 0)
        ImageDraw.Draw(mask).rounded_rectangle([0, 0, n - 1, n - 1], radius=int(n * 0.225), fill=255)
        img.paste(grad, (0, 0), mask)
    return img, ImageDraw.Draw(img), n


def finish(img, size, p, glyph_layer=None):
    """Add the outline (by dilating the glyph's own alpha) and downsample."""
    if p.edge and glyph_layer is not None:
        k = 2 * S + 1  # one pixel at the target size
        halo = glyph_layer.split()[3].filter(ImageFilter.MaxFilter(k))
        edge = Image.new("RGBA", img.size, p.edge + (255,))
        edge.putalpha(halo)
        out = Image.alpha_composite(edge, glyph_layer)
        img = Image.alpha_composite(img, out)
    elif glyph_layer is not None:
        img = Image.alpha_composite(img, glyph_layer)
    return img.resize((size, size), Image.LANCZOS)


def draw(size, p, body_fn):
    """The tile is not the glyph, so the glyph gets its own layer to outline."""
    img, _, n = canvas(size, p)
    layer = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    body_fn(ImageDraw.Draw(layer), n, p)
    return finish(img, size, p, layer)


# ------------------------------------------------------------------ glyphs
def _archive(d, n, p):
    """Round one's layers: three bound volumes."""
    for i, col in enumerate((p.accent, p.alt, p.body)):
        y = g(n, 3 + i * 4)
        d.rounded_rectangle([g(n, 1.5), y, g(n, 14.5), y + g(n, 3)], radius=g(n, 0.8), fill=col)


def _video(d, n, p):
    """Round one's film strip."""
    d.rounded_rectangle([g(n, 1), g(n, 3), g(n, 15), g(n, 13)], radius=g(n, 0.9), fill=p.body)
    for k in (2.5, 5, 7.5, 10, 12.5):
        d.rounded_rectangle([g(n, k), g(n, 4), g(n, k + 1.5), g(n, 5.5)], radius=g(n, 0.25), fill=p.ink)
        d.rounded_rectangle([g(n, k), g(n, 10.5), g(n, k + 1.5), g(n, 12)], radius=g(n, 0.25), fill=p.ink)
    d.rectangle([g(n, 1), g(n, 6.5), g(n, 15), g(n, 9.5)], fill=p.accent)


def _image(d, n, p):
    """Round one's framed view."""
    d.rounded_rectangle([g(n, 1.5), g(n, 2.5), g(n, 14.5), g(n, 13.5)], radius=g(n, 1.2), fill=p.body)
    d.ellipse([g(n, 9.5), g(n, 4.5), g(n, 12.5), g(n, 7.5)], fill=p.accent)
    d.polygon([(g(n, 3), g(n, 12)), (g(n, 7), g(n, 6.5)), (g(n, 11), g(n, 12))], fill=p.ink)
    d.polygon([(g(n, 8), g(n, 12)), (g(n, 10.5), g(n, 8.5)), (g(n, 13), g(n, 12))], fill=p.ink)


def _audio(d, n, p):
    """Round three's sixteenth note, as one joined glyph."""
    from math import cos, hypot, radians, sin
    th = radians(20)
    rx, ry = g(n, 3.1), g(n, 2.3)
    hx, hy = g(n, 6.4), g(n, 11.5)
    half = hypot(rx * cos(th), ry * sin(th))
    sx1, sx0 = hx + half, hx + half - g(n, 1.2)
    d.rectangle([sx0, g(n, 2.2), sx1, hy], fill=p.body)
    for i in range(2):
        oy = g(n, 2.7 * i)
        d.polygon([(sx1, g(n, 2.2) + oy), (sx1 + g(n, 3.8), g(n, 4.6) + oy),
                   (sx1 + g(n, 3.8), g(n, 7) + oy), (sx1, g(n, 4.6) + oy)], fill=p.accent)


def _audio_head(img, n, p):
    """The notehead goes on last so it owns the joint with the stem."""
    from math import cos, hypot, radians, sin
    rx, ry = g(n, 3.1), g(n, 2.3)
    hx, hy = g(n, 6.4), g(n, 11.5)
    pad = int(max(rx, ry) * 2)
    head = Image.new("RGBA", (int(rx * 2) + pad, int(ry * 2) + pad), (0, 0, 0, 0))
    ImageDraw.Draw(head).ellipse([pad / 2, pad / 2, pad / 2 + rx * 2, pad / 2 + ry * 2], fill=p.body)
    head = head.rotate(20, resample=Image.BICUBIC, expand=True)
    img.alpha_composite(head, (int(hx - head.width / 2), int(hy - head.height / 2)))


def _comic(d, n, p):
    """Round eight's pick: an open book.

    Drawn for the DOCUMENT column and chosen for this one, which is the right
    way round: document is the folded page now, so nothing collides, and a
    comic is a book you hold open rather than a stack of loose pictures.
    """
    d.polygon(
        [(g(n, 1.2), g(n, 3.4)), (g(n, 7.6), g(n, 4.8)), (g(n, 7.6), g(n, 14.0)), (g(n, 1.2), g(n, 12.6))],
        fill=p.body,
    )
    d.polygon(
        [(g(n, 14.8), g(n, 3.4)), (g(n, 8.4), g(n, 4.8)), (g(n, 8.4), g(n, 14.0)), (g(n, 14.8), g(n, 12.6))],
        fill=p.accent,
    )
    for i in range(2):
        y = g(n, 7.2 + i * 2.4)
        d.rounded_rectangle([g(n, 2.6), y, g(n, 6.4), y + g(n, 1.1)], radius=g(n, 0.55), fill=p.ink)


def _document(d, n, p):
    """Round eight's pick: a page with its corner turned.

    Settled at last - what shipped before this was marked provisional and had
    never actually been chosen. The fold is the oldest document mark there is,
    and it survives 16px because it is one big silhouette rather than a band
    plus four hairlines.
    """
    d.polygon(
        [
            (g(n, 2.6), g(n, 1.4)),
            (g(n, 10.2), g(n, 1.4)),
            (g(n, 13.4), g(n, 4.9)),
            (g(n, 13.4), g(n, 14.6)),
            (g(n, 2.6), g(n, 14.6)),
        ],
        fill=p.body,
    )
    d.polygon(
        [(g(n, 10.2), g(n, 1.4)), (g(n, 13.4), g(n, 4.9)), (g(n, 10.2), g(n, 4.9))], fill=p.accent
    )
    for i in range(3):
        y = g(n, 7.4 + i * 2.3)
        d.rounded_rectangle([g(n, 4.6), y, g(n, 11.4), y + g(n, 1.2)], radius=g(n, 0.6), fill=p.ink)


def _code(d, n, p):
    """Round eight's pick: the shape of code itself, nested and indented.

    The chevrons it replaces were legible but generic - every editor on the
    machine draws them. Bars at stepped indents are unmistakably source, and
    they are solid shapes at 16px rather than six thin strokes.

    THREE bars, not four, and that was measured rather than assumed: at 16px
    four bars leave a 1.1px gap, and a light bar on a near-black tile blooms
    across a gap that thin - the top two merged into one grey smudge. Three
    bars at a 4.4 pitch leave 1.8px, which survives. The indent step is what
    says "code", and three steps say it as well as four.
    """
    rows = ((1.8, 9.6, False), (5.0, 14.2, True), (1.8, 7.6, False))
    for i, (x0, x1, hot) in enumerate(rows):
        y = g(n, 3.2 + i * 4.4)
        d.rounded_rectangle(
            [g(n, x0), y, g(n, x1), y + g(n, 2.6)],
            radius=g(n, 1.3),
            fill=p.accent if hot else p.body,
        )

def _make(body_fn, after=None):
    def fn(size, p):
        img, _, n = canvas(size, p)
        layer = Image.new("RGBA", (n, n), (0, 0, 0, 0))
        body_fn(ImageDraw.Draw(layer), n, p)
        if after:
            after(layer, n, p)
        return finish(img, size, p, layer)
    return fn


KIND_GLYPHS = [
    ("archive", _make(_archive)),
    ("video", _make(_video)),
    ("image", _make(_image)),
    ("audio", _make(_audio, _audio_head)),
    ("comic", _make(_comic)),
    ("document", _make(_document)),
    ("code", _make(_code)),
]

TREATMENTS = [
    ("tile + white glyph|(what ships today)", TILED),
    ("no tile,|same colours", BARE),
    ("no tile,|indigo duotone", DUO),
    ("no tile, light glyph|+ dark edge", OUTLINE),
]
