"""Round eighteen: comic, built from the owner's reference rather than from guesses.

The reference is a comic cover: a heavy black keyline frame, a masthead band, a
bright ground, and a NESTED starburst - pink outer, yellow inner, each outlined
in black. Three things in it that rounds fifteen to seventeen did not have, and
they are the whole difference:

1. THE SPIKES CURVE. The valleys between them are concave, not straight. A star
   made of triangles is a geometric star; a star whose sides bow inward is a
   splat, and that is the shape comics actually draw. It is done here with a
   radius function rather than by placing points: r = rv + (rt-rv)*|cos(k*a/2)|^p,
   sampled 360 times. p is what sharpens the tips and hollows the valleys.
2. THE KEYLINE IS FAT. Mine was about a third of a unit; the reference's is
   nearer a full one. At icon size a thin outline just muddies the edge, while a
   fat one is the drawing.
3. IT IS NESTED. Two or three bursts inside each other, each with its own
   keyline, is what gives the thing depth without any shading.

The masthead is deliberately NOT redrawn. In the reference it is a band across
the top carrying the word COMICS, and in our layout the black chip carrying the
extension already is that band, in the same place, doing the same job. Adding a
second one would be saying it twice.

Ground stays tintable, artwork stays baked, so the picker still works.

    python round18.py <outdir>
"""
import pathlib
import sys

from PIL import Image, ImageDraw

from icons import S
from round12 import CHIP, INK, font, page_mask
from round15 import _label_at
from round5 import g

# The reference's own box, sampled off it.
CYAN = (41, 196, 210)
PINK = (237, 59, 110)
LEMON = (242, 225, 92)
CREAM = (247, 242, 222)
INK_A = tuple(INK) + (255,)
PINK_A, LEMON_A, CREAM_A, CYAN_A = (PINK + (255,), LEMON + (255,),
                                    CREAM + (255,), CYAN + (255,))

P = (3.0, 2.0, 13.0, 15.0)        # the page's box
CX, CY = 8.0, 9.6                 # centre of the area below the chip
KEY = 0.80                        # keyline weight, matched to the reference


def _splat(d, n, cx, cy, rt, rv, spikes, col, p=3.2, phase=0.0, steps=360):
    """A burst whose valleys are CONCAVE, which is what makes it a splat.

    r(a) = rv + (rt-rv) * |cos(spikes*a/2)|**p. At p=1 that is a smooth flower;
    raising p pulls the sides inward and sharpens the tips, which is the shape
    the reference draws. Sampled rather than cornered, so the curve is real.
    """
    from math import cos, pi, sin
    pts = []
    for i in range(steps):
        a = 2 * pi * i / steps + phase
        m = abs(cos(spikes * a / 2)) ** p
        r = rv + (rt - rv) * m
        pts.append((g(n, cx + r * cos(a)), g(n, cy + r * sin(a))))
    d.polygon(pts, fill=col)


def _ink_splat(d, n, cx, cy, rt, rv, spikes, col, p=3.2, phase=0.0, key=KEY):
    _splat(d, n, cx, cy, rt + key, rv + key, spikes, INK_A, p, phase)
    _splat(d, n, cx, cy, rt, rv, spikes, col, p, phase)


def _frame(d, n, inset=0.85, t=0.85):
    """The cover's black border, drawn as a ring so the ground shows inside."""
    d.rectangle([g(n, P[0] + inset), g(n, P[1] + inset),
                 g(n, P[2] - inset), g(n, P[3] - inset)], fill=INK_A)
    d.rectangle([g(n, P[0] + inset + t), g(n, P[1] + inset + t),
                 g(n, P[2] - inset - t), g(n, P[3] - inset - t)], fill=(0, 0, 0, 0))


def _panel(d, n, col, inset=0.85, t=0.85):
    """The framed area filled with a colour instead of left as the ground."""
    d.rectangle([g(n, P[0] + inset + t), g(n, P[1] + inset + t),
                 g(n, P[2] - inset - t), g(n, P[3] - inset - t)], fill=col)


def _word(d, n, text, cx, cy, size_u, col, outline=INK_A, weight=0.30):
    f = font(g(n, size_u))
    if outline:
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                if dx or dy:
                    d.text((g(n, cx) + dx * g(n, weight), g(n, cy) + dy * g(n, weight)),
                           text, font=f, fill=outline, anchor="mm")
    d.text((g(n, cx), g(n, cy)), text, font=f, fill=col, anchor="mm")


def _dots(d, n, box, col, step=1.15, r=0.30):
    x0, y0, x1, y1 = box
    for iy in range(int((y1 - y0) / step) + 1):
        for ix in range(int((x1 - x0) / step) + 1):
            cx = x0 + ix * step + (step / 2 if iy % 2 else 0)
            cy = y0 + iy * step
            if cx <= x1 and cy <= y1:
                d.ellipse([g(n, cx - r), g(n, cy - r), g(n, cx + r), g(n, cy + r)], fill=col)


# ---------------------------------------------------------------- candidates
def art_reference(d, n):
    """The reference itself, on our layout: framed ground, pink splat, lemon core."""
    _frame(d, n)
    _ink_splat(d, n, CX, CY, 4.9, 2.5, 8, PINK_A)
    _ink_splat(d, n, CX, CY, 2.5, 1.15, 7, LEMON_A, phase=0.4, key=0.5)


def art_reference_cyan(d, n):
    """The reference with its own cyan panel, so the ground frames it instead."""
    _frame(d, n)
    _panel(d, n, CYAN_A)
    _ink_splat(d, n, CX, CY, 4.9, 2.5, 8, PINK_A)
    _ink_splat(d, n, CX, CY, 2.5, 1.15, 7, LEMON_A, phase=0.4, key=0.5)


def art_splat_only(d, n):
    """No frame: the splat alone, filling the page. The loudest of the set."""
    _ink_splat(d, n, CX, CY, 5.8, 3.0, 9, PINK_A, key=0.9)
    _ink_splat(d, n, CX, CY, 3.0, 1.4, 7, LEMON_A, phase=0.4, key=0.55)


def art_splat_triple(d, n):
    """Three nested: depth with no shading at all."""
    _frame(d, n)
    _ink_splat(d, n, CX, CY, 5.0, 2.7, 9, INK_A, key=0.0)
    _ink_splat(d, n, CX, CY, 4.4, 2.3, 9, PINK_A, key=0.0)
    _ink_splat(d, n, CX, CY, 2.9, 1.4, 8, LEMON_A, phase=0.35, key=0.45)
    _ink_splat(d, n, CX, CY, 1.5, 0.7, 6, CREAM_A, phase=0.7, key=0.3)


def art_splat_pow(d, n):
    """The splat with the word set into it, the way a sound effect is lettered."""
    _frame(d, n)
    _ink_splat(d, n, CX, CY, 5.0, 2.6, 8, LEMON_A)
    _word(d, n, "POW", CX, CY, 2.9, PINK_A)


def art_splat_bam(d, n):
    _frame(d, n)
    _ink_splat(d, n, CX, CY, 5.0, 2.6, 8, PINK_A, phase=0.2)
    _word(d, n, "BAM", CX, CY, 2.9, LEMON_A)


def art_splat_offset(d, n):
    """A big splat and a small one: the second is what stops it being a symbol."""
    _frame(d, n)
    _ink_splat(d, n, 7.2, 10.2, 4.3, 2.2, 8, PINK_A)
    _ink_splat(d, n, 7.2, 10.2, 2.1, 1.0, 7, LEMON_A, phase=0.4, key=0.45)
    _ink_splat(d, n, 11.0, 6.3, 1.8, 0.9, 7, LEMON_A, phase=0.9, key=0.45)


def art_splat_dots(d, n):
    """Ben-Day dots behind the splat: the printed texture, at last."""
    _frame(d, n)
    _dots(d, n, (P[0] + 1.9, P[1] + 1.9, P[2] - 1.9, P[3] - 1.9), (0, 0, 0, 58), 1.15, 0.32)
    _ink_splat(d, n, CX, CY, 4.9, 2.5, 8, PINK_A)
    _ink_splat(d, n, CX, CY, 2.5, 1.15, 7, LEMON_A, phase=0.4, key=0.5)


def art_splat_bolt(d, n):
    """A bolt struck through the splat."""
    _frame(d, n)
    _ink_splat(d, n, CX, CY, 5.0, 2.6, 9, LEMON_A)
    d.polygon([(g(n, 9.5), g(n, 5.9)), (g(n, 6.0), g(n, 10.5)), (g(n, 8.1), g(n, 10.5)),
               (g(n, 6.8), g(n, 13.6)), (g(n, 10.2), g(n, 8.9)), (g(n, 8.1), g(n, 8.9))],
              fill=INK_A)


def art_splat_hero(d, n):
    """A caped figure standing in the splat: the two things he liked, together."""
    _frame(d, n)
    _ink_splat(d, n, CX, CY, 5.0, 2.6, 9, LEMON_A)
    d.polygon([(g(n, 5.9), g(n, 8.2)), (g(n, 4.2), g(n, 13.8)),
               (g(n, 11.8), g(n, 13.8)), (g(n, 10.1), g(n, 8.2))], fill=INK_A)
    d.polygon([(g(n, 6.4), g(n, 8.8)), (g(n, 5.1), g(n, 13.1)),
               (g(n, 10.9), g(n, 13.1)), (g(n, 9.6), g(n, 8.8))], fill=PINK_A)
    d.ellipse([g(n, 6.8), g(n, 6.2), g(n, 9.2), g(n, 8.6)], fill=INK_A)
    d.polygon([(g(n, 6.6), g(n, 13.8)), (g(n, 6.9), g(n, 8.9)),
               (g(n, 9.1), g(n, 8.9)), (g(n, 9.4), g(n, 13.8))], fill=INK_A)


def art_splat_mask(d, n):
    """A domino mask over the splat: two shapes, both of them survive 16px."""
    _frame(d, n)
    _ink_splat(d, n, CX, CY, 5.0, 2.6, 9, LEMON_A)
    d.rounded_rectangle([g(n, 4.2), g(n, 8.0), g(n, 11.8), g(n, 11.6)],
                        radius=g(n, 1.6), fill=INK_A)
    d.rounded_rectangle([g(n, 4.8), g(n, 8.6), g(n, 11.2), g(n, 11.0)],
                        radius=g(n, 1.2), fill=PINK_A)
    for cx in (6.6, 9.4):
        d.polygon([(g(n, cx - 1.1), g(n, 9.5)), (g(n, cx + 1.1), g(n, 9.1)),
                   (g(n, cx + 1.1), g(n, 10.2)), (g(n, cx - 1.1), g(n, 10.5))], fill=INK_A)


COMICS = [
    ("reference", "The reference: framed, pink splat, lemon core", art_reference, CYAN),
    ("refpanel", "Same, with its own cyan panel", art_reference_cyan, LEMON),
    ("splatonly", "Splat alone, no frame", art_splat_only, CYAN),
    ("triple", "Three nested splats", art_splat_triple, CYAN),
    ("dots", "Splat over Ben-Day dots", art_splat_dots, CYAN),
    ("pow", "POW lettered into the splat", art_splat_pow, CYAN),
    ("bam", "BAM lettered into the splat", art_splat_bam, LEMON),
    ("offset", "A big splat and a small one", art_splat_offset, CYAN),
    ("bolt", "Bolt through the splat", art_splat_bolt, PINK),
    ("hero", "Caped figure in the splat", art_splat_hero, CYAN),
    ("mask", "Domino mask over the splat", art_splat_mask, CYAN),
]


def comic_layers(size, accents, ext="CBZ"):
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
    d.text((tx, ty), ext, font=f, fill=(247, 242, 222, 255), anchor="mm")
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
# Audio comes from round seventeen unchanged; both remaining kinds on one page.
from round17 import AUDIO, AUDIO_COLOUR, audio_flat  # noqa: E402

CANDIDATES = {
    "comic": [(k, l, (lambda s, A=a, G=gr: comic_flat(s, A, G))) for k, l, a, gr in COMICS],
    "audio": [(k, l, (lambda s, F=fn: audio_flat(s, F, AUDIO_COLOUR))) for k, l, fn in AUDIO],
}
FILENAMES = {"comic": "issue-012.cbz", "audio": "interlude.mp3"}
SECTIONS = {
    "comic": "Built from your reference: curved concave spikes, a fat keyline, "
             "and nested bursts. The masthead is deliberately missing - our "
             "black chip is already a band across the top carrying a word, in "
             "the same place, doing the same job. Look hard at the 16px column: "
             "this style is detailed, and detail is what 16px spends first.",
    "audio": "In your green. The notehead is 1.4:1 now rather than the 2:1 that "
             "made the old one read as a spoon, and the other ways of saying "
             "sound sit beside the notes so the note is chosen, not assumed.",
}


def caption(kind, key):
    from round12 import contrast_note
    for k, _l, fn in CANDIDATES[kind]:
        if k == key:
            return contrast_note(fn(16))
    return ""


def main(out_dir):
    out = pathlib.Path(out_dir) / "round18"
    out.mkdir(parents=True, exist_ok=True)
    for key, _l, art, gr in COMICS:
        for s in SIZES + (HERO,):
            comic_flat(s, art, gr).save(out / f"comic-{key}-{s}.png")
    for key, _l, fn in AUDIO:
        for s in SIZES + (HERO,):
            audio_flat(s, fn, AUDIO_COLOUR).save(out / f"audio-{key}-{s}.png")
    print(f"{len(COMICS)} comics + {len(AUDIO)} audio -> {out}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else ".")
