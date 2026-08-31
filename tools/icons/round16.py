"""Round sixteen: comic, in the direction the owner actually liked.

Round fifteen put eleven comic treatments up and two landed - the star burst
and the caped figure on a sunburst - with the rest called bad. What those two
share is worth naming, because it is the brief for this round: a RADIATING
ground and ONE bold silhouette on top of it. No panel grids, no speech
balloons, no halftone-and-a-bubble. Comics at icon size are a burst and a
figure, and everything quieter than that read as a form rather than as a comic.

So: twelve, all bursts and silhouettes, the two winners included unchanged so
the new ones are judged against them rather than in a vacuum.

THE COLOUR PICKER STILL WORKS HERE, which is the other thing that changed. In
round fifteen comic baked its ground and was the one kind that could not be
tinted. Here the art is split exactly like every other kind: the GROUND is the
tintable layer and these functions draw only the ACCENTS over it. That is why
rays and shading are TRANSLUCENT white or black rather than a hand-mixed
lighter red - a fixed tint of one ground is wrong the moment the ground
changes, while white at low alpha lightens whatever is underneath.

    python round16.py <outdir>
"""
import pathlib
import sys

from PIL import Image, ImageDraw

from icons import S
from round12 import CHIP, INK, page_mask
from round15 import BLUE, MAGENTA, PAPER, RED, YELLOW, _label_at, _rays, _star
from round5 import g

P = (3.0, 2.0, 13.0, 15.0)
CX, CY = 8.0, 9.2                 # the page's optical centre, below the chip

LIGHT = (255, 255, 255, 64)       # lightens any ground
LIGHTER = (255, 255, 255, 112)
SHADE = (0, 0, 0, 52)             # darkens any ground
INK_A = tuple(INK) + (255,)
PAPER_A = PAPER + (255,)
RED_A, YELLOW_A, BLUE_A = RED + (255,), YELLOW + (255,), BLUE + (255,)


def _jag(d, n, cx, cy, r, col, points=11, inner=0.62, twist=0.0):
    """A rougher star: uneven spokes read as an impact rather than a sheriff."""
    from math import cos, pi, sin
    pts = []
    for i in range(points * 2):
        a = pi * i / points - pi / 2 + twist
        rad = r * (1.0 if i % 2 == 0 else inner) * (0.86 if i % 3 == 0 else 1.0)
        pts.append((g(n, cx + rad * cos(a)), g(n, cy + rad * sin(a))))
    d.polygon(pts, fill=col)


def _figure(d, n, cx, foot, head_r, col, shoulder=1.6):
    """Head and shoulders down to the feet: the only body that survives 16px."""
    d.ellipse([g(n, cx - head_r), g(n, foot - 7.6), g(n, cx + head_r), g(n, foot - 7.6 + head_r * 2)],
              fill=col)
    d.polygon([(g(n, cx - shoulder - 0.8), g(n, foot)), (g(n, cx - shoulder), g(n, foot - 5.6)),
               (g(n, cx + shoulder), g(n, foot - 5.6)), (g(n, cx + shoulder + 0.8), g(n, foot))],
              fill=col)


# ------------------------------------------------------------------ the two
def art_burst(d, n):
    """Round fifteen's star burst. Kept exactly, as the thing to beat."""
    _rays(d, n, CX, CY, LIGHT, 14, 14)
    _star(d, n, CX, CY, 5.0, YELLOW_A)
    _star(d, n, CX, CY, 3.2, PAPER_A)


def art_hero(d, n):
    """Round fifteen's caped figure. Kept exactly."""
    _rays(d, n, CX, CY, LIGHT, 14, 15)
    d.polygon([(g(n, 6.4), g(n, 8.0)), (g(n, 3.8), g(n, 13.2)), (g(n, 5.4), g(n, 13.6))],
              fill=RED_A)
    d.polygon([(g(n, 9.6), g(n, 8.0)), (g(n, 12.2), g(n, 13.2)), (g(n, 10.6), g(n, 13.6))],
              fill=RED_A)
    d.ellipse([g(n, 6.9), g(n, 5.6), g(n, 9.1), g(n, 7.8)], fill=INK_A)
    d.polygon([(g(n, 4.8), g(n, 15.0)), (g(n, 6.4), g(n, 8.0)),
               (g(n, 9.6), g(n, 8.0)), (g(n, 11.2), g(n, 15.0))], fill=INK_A)


# ------------------------------------------------------------------- new ten
def art_bang(d, n):
    """A jagged impact rather than a clean star: the POW panel's own shape."""
    _rays(d, n, CX, CY, LIGHT, 12, 13)
    _jag(d, n, CX, CY, 5.4, YELLOW_A, 11, 0.58)
    _jag(d, n, CX, CY, 3.3, RED_A, 11, 0.60, twist=0.28)


def art_double(d, n):
    """Two stars nested, offset: depth with no shading, which 16px keeps."""
    _rays(d, n, CX, CY, LIGHT, 16, 14)
    _star(d, n, CX + 0.5, CY + 0.5, 5.2, INK_A, 8, 0.46)
    _star(d, n, CX - 0.2, CY - 0.3, 5.0, YELLOW_A, 8, 0.46)
    _star(d, n, CX - 0.2, CY - 0.3, 2.6, PAPER_A, 8, 0.46)


def art_bolt(d, n):
    """A lightning bolt on rays. One shape, and an unmistakable one."""
    _rays(d, n, CX, CY, LIGHT, 14, 15)
    _star(d, n, CX, CY, 5.4, YELLOW_A, 12, 0.66)
    d.polygon([(g(n, 9.4), g(n, 4.8)), (g(n, 6.1), g(n, 9.7)), (g(n, 7.9), g(n, 9.7)),
               (g(n, 6.7), g(n, 13.6)), (g(n, 10.1), g(n, 8.4)), (g(n, 8.2), g(n, 8.4))],
              fill=INK_A)


def art_flying(d, n):
    """A figure streaking up and right, cape trailing: motion, not a pose.

    Rebuilt. The first cut drew a thin diagonal body over thin speed lines and
    the whole thing read as a smudge: at this size a figure has to be ONE fat
    silhouette with a cape behind it, not limbs.
    """
    for i in range(5):
        y = P[1] + 2.2 + i * 2.4
        d.polygon([(g(n, P[0]), g(n, y)), (g(n, P[2]), g(n, y - 1.6)),
                   (g(n, P[2]), g(n, y - 0.4)), (g(n, P[0]), g(n, y + 1.2))], fill=LIGHT)
    d.polygon([(g(n, 3.4), g(n, 13.4)), (g(n, 8.0), g(n, 9.4)),
               (g(n, 9.6), g(n, 11.6)), (g(n, 4.6), g(n, 14.4))], fill=RED_A)
    d.polygon([(g(n, 6.0), g(n, 12.4)), (g(n, 10.4), g(n, 7.2)),
               (g(n, 12.4), g(n, 9.0)), (g(n, 7.8), g(n, 13.6))], fill=INK_A)
    d.ellipse([g(n, 10.2), g(n, 4.8), g(n, 13.0), g(n, 7.6)], fill=INK_A)


def art_fist(d, n):
    """A fist coming out of the burst: the most comic-book gesture there is.

    Rebuilt. The knuckle lines were knocked out of the silhouette and at 16px
    four dark gaps in a dark shape read as a set of teeth, so the fist is one
    solid mass now with a thumb on it and nothing carved into it.
    """
    _rays(d, n, CX, CY, LIGHT, 12, 14)
    _jag(d, n, CX, CY, 5.8, YELLOW_A, 10, 0.60)
    d.rounded_rectangle([g(n, 5.6), g(n, 6.9), g(n, 10.4), g(n, 10.9)],
                        radius=g(n, 1.5), fill=INK_A)
    d.ellipse([g(n, 4.7), g(n, 8.2), g(n, 7.1), g(n, 10.6)], fill=INK_A)
    d.polygon([(g(n, 6.4), g(n, 10.6)), (g(n, 9.6), g(n, 10.6)),
               (g(n, 10.2), g(n, 13.4)), (g(n, 5.8), g(n, 13.4))], fill=INK_A)


def art_bust(d, n):
    """One silhouette on a radial: a character, with no cape to lose.

    Rebuilt. Head and shoulders drawn as separate pieces need a neck, and a
    neck is a one-pixel gap that closes on the way down to 16px - so this is a
    single mass, and the emblem is what stops it reading as a bottle.
    """
    _rays(d, n, CX, CY + 1.0, LIGHTER, 16, 15)
    d.ellipse([g(n, 6.2), g(n, 5.2), g(n, 9.8), g(n, 8.8)], fill=INK_A)
    d.polygon([(g(n, 4.0), g(n, 15.0)), (g(n, 5.4), g(n, 9.6)),
               (g(n, 10.6), g(n, 9.6)), (g(n, 12.0), g(n, 15.0))], fill=INK_A)
    _star(d, n, CX, 12.0, 1.7, YELLOW_A, 5, 0.46)


def art_standing(d, n):
    """The hero planted, cape behind: the cover pose.

    Rebuilt. The cape ran the full width and swallowed the figure, so the icon
    read as an arch. It is narrower than the shoulders' reach now, and the
    figure sits ON it rather than inside it.
    """
    _rays(d, n, CX, CY, LIGHT, 14, 15)
    d.polygon([(g(n, 6.0), g(n, 7.8)), (g(n, 4.4), g(n, 14.6)),
               (g(n, 11.6), g(n, 14.6)), (g(n, 10.0), g(n, 7.8))], fill=RED_A)
    d.ellipse([g(n, 6.6), g(n, 5.0), g(n, 9.4), g(n, 7.8)], fill=INK_A)
    d.polygon([(g(n, 5.6), g(n, 15.0)), (g(n, 6.4), g(n, 8.4)),
               (g(n, 9.6), g(n, 8.4)), (g(n, 10.4), g(n, 15.0))], fill=INK_A)
    _star(d, n, CX, 10.6, 1.5, YELLOW_A, 5, 0.46)


def art_impact(d, n):
    """A star with wedges driven out of it: something has just been hit."""
    for i, a in enumerate((0.4, 1.9, 3.4, 4.9)):
        from math import cos, sin
        d.polygon([(g(n, CX), g(n, CY)),
                   (g(n, CX + 15 * cos(a)), g(n, CY + 15 * sin(a))),
                   (g(n, CX + 15 * cos(a + 0.34)), g(n, CY + 15 * sin(a + 0.34)))],
                  fill=LIGHTER)
    _jag(d, n, CX, CY, 5.0, INK_A, 9, 0.56)
    _jag(d, n, CX, CY, 4.0, YELLOW_A, 9, 0.56)


def art_swoosh(d, n):
    """A cape sweeping across the frame, with a star where it snaps."""
    _rays(d, n, CX, CY, LIGHT, 12, 15)
    d.polygon([(g(n, 3.2), g(n, 12.8)), (g(n, 6.0), g(n, 7.0)), (g(n, 10.6), g(n, 5.4)),
               (g(n, 12.8), g(n, 7.4)), (g(n, 8.6), g(n, 9.4)), (g(n, 6.2), g(n, 14.2))],
              fill=INK_A)
    _star(d, n, 11.2, 11.6, 2.5, YELLOW_A, 8, 0.44)


def art_starfield(d, n):
    """One big star and three small: a burst that reads even at 16 pixels."""
    _rays(d, n, CX, CY, LIGHT, 10, 14)
    _star(d, n, 7.4, 8.6, 4.4, YELLOW_A, 8, 0.46)
    _star(d, n, 7.4, 8.6, 2.4, PAPER_A, 8, 0.46)
    for cx, cy, r in ((11.6, 5.6, 1.5), (11.9, 12.2, 1.7), (4.4, 12.6, 1.4)):
        _star(d, n, cx, cy, r, PAPER_A, 8, 0.42)


def art_shout(d, n):
    """A burst with a solid bar across it: the shape a sound effect is set in."""
    _rays(d, n, CX, CY, LIGHT, 12, 14)
    _jag(d, n, CX, CY, 5.6, YELLOW_A, 10, 0.58)
    d.polygon([(g(n, 3.6), g(n, 9.2)), (g(n, 12.4), g(n, 7.6)),
               (g(n, 12.4), g(n, 10.4)), (g(n, 3.6), g(n, 12.0))], fill=INK_A)
    d.polygon([(g(n, 4.6), g(n, 9.9)), (g(n, 11.4), g(n, 8.7)),
               (g(n, 11.4), g(n, 9.5)), (g(n, 4.6), g(n, 10.7))], fill=PAPER_A)


COMICS = [
    ("burst", "Star burst  (round 15, kept)", art_burst, RED),
    ("hero", "Caped figure on a sunburst  (round 15, kept)", art_hero, YELLOW),
    ("bang", "Jagged impact burst", art_bang, RED),
    ("double", "Two stars, offset", art_double, BLUE),
    ("bolt", "Lightning bolt on rays", art_bolt, BLUE),
    ("flying", "Figure streaking across", art_flying, RED),
    ("fist", "Fist out of the burst", art_fist, RED),
    ("bust", "Head and shoulders on a radial", art_bust, MAGENTA),
    ("standing", "Hero planted, cape wide", art_standing, BLUE),
    ("impact", "Star with wedges driven out", art_impact, RED),
    ("swoosh", "Cape sweeping across", art_swoosh, MAGENTA),
    ("starfield", "One big star and three small", art_starfield, BLUE),
    ("shout", "Burst with a sound-effect bar", art_shout, YELLOW),
]


def comic_layers(size, accents, ext="CBZ"):
    """(tintable ground, baked accents) - the same split as every other kind."""
    n = size * S
    m = page_mask(n)
    body = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    body.paste(Image.new("RGBA", (n, n), (255, 255, 255, 255)), (0, 0), m)

    art = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    accents(ImageDraw.Draw(art), n)
    art = Image.composite(art, Image.new("RGBA", (n, n), (0, 0, 0, 0)), m)

    d = ImageDraw.Draw(art)
    d.polygon([(g(n, 10.0), g(n, 2.0)), (g(n, 13.0), g(n, 5.0)),
               (g(n, 10.0), g(n, 5.0))], fill=INK_A)
    d.rounded_rectangle([g(n, CHIP[0]), g(n, CHIP[1]), g(n, CHIP[2]), g(n, CHIP[3])],
                        radius=g(n, 0.7), fill=INK_A)
    (tx, ty), f = _label_at(n, ext, CHIP)
    # Comic is the ONE kind whose label is DRAWN rather than knocked out: there
    # is no single colour behind the chip, there is artwork, and where the chip
    # overhangs the page there is nothing at all - so a hole would read as a rip.
    d.text((tx, ty), ext, font=f, fill=PAPER_A, anchor="mm")
    return (body.resize((size, size), Image.LANCZOS),
            art.resize((size, size), Image.LANCZOS))


def comic_flat(size, accents, ground, ext="CBZ"):
    body, art = comic_layers(size, accents, ext)
    out = Image.new("RGBA", body.size, (0, 0, 0, 0))
    out.paste(Image.new("RGBA", body.size, tuple(ground) + (255,)), (0, 0), body)
    out.alpha_composite(art)
    return out


SIZES = (16, 20, 24, 32, 48)
HERO = 96
CANDIDATES = {"comic": [(k, l, (lambda s, A=a, G=gr: comic_flat(s, A, G)))
                        for k, l, a, gr in COMICS]}
FILENAMES = {"comic": "issue-012.cbz"}
SECTIONS = {"comic": "Bursts and silhouettes only, which is what the two you "
                     "liked have in common. Both are here unchanged, first and "
                     "second, so the new ones are judged against them. Grounds "
                     "shown are starting points - the picker tints them."}


def caption(kind, key):
    from round12 import contrast_note
    for k, _l, fn in CANDIDATES[kind]:
        if k == key:
            return contrast_note(fn(16))
    return ""


def main(out_dir):
    out = pathlib.Path(out_dir) / "round16"
    out.mkdir(parents=True, exist_ok=True)
    for key, _l, art, gr in COMICS:
        for s in SIZES + (HERO,):
            comic_flat(s, art, gr).save(out / f"comic-{key}-{s}.png")
    print(f"{len(COMICS)} comics -> {out}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else ".")
