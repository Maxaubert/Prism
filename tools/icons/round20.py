"""Round twenty: comic, split into a BACKGROUND and a SUBJECT.

Three notes from the owner, and they resolve into one change of structure.

He liked the radiating-wedge candidate, and named what he liked about it: the
DUAL-COLOUR BACKGROUND. Not the subject on it - the ground behind it. He also
said round nineteen's fourteen new compositions were bad (deleted, and the file
with them), and that round eighteen's eleven are all much the same. And he
asked for ACTUAL COMIC ARTWORK rather than more abstract bursts.

All of that says the same thing: background and subject were tangled together,
so every candidate was a whole picture and picking one meant accepting both
halves. They are two axes here. Section one varies the BACKGROUND with one
subject held constant; section two varies the SUBJECT on the background he
liked. Pick one from each and they combine.

The artwork is drawn as comic artwork rather than as symbols: a masked face, a
shield, a rocket, a skull, a robot, a skyline with someone flying over it. All
generic - the point is the genre, and nobody's trademark belongs in a file
icon.

The GROUND stays the tintable layer, so the picker still sets the background
colour; the stripes come in two flavours, a fixed lemon and a translucent
lighten, because the first is a true two-colour ground and the second harmonises
with whatever colour is chosen.

    python round20.py <outdir>
"""
import pathlib
import sys

from round18 import (COMICS as R18, CREAM_A, CYAN, INK_A, KEY, LEMON, LEMON_A,
                     P, PINK, PINK_A, _dots, _frame, _ink_splat, _panel,
                     comic_flat)
from round5 import g

LIGHT = (255, 255, 255, 78)
SHADE = (0, 0, 0, 52)
IN = (P[0] + 1.7, P[1] + 1.7, P[2] - 1.7, P[3] - 1.7)   # inside the frame


def _ink_poly(d, n, pts, col, grow=KEY):
    cx = sum(p[0] for p in pts) / len(pts)
    cy = sum(p[1] for p in pts) / len(pts)
    k = 1.0 + grow / max(1e-6, max(abs(p[0] - cx) for p in pts))
    d.polygon([(g(n, cx + (x - cx) * k), g(n, cy + (y - cy) * k)) for x, y in pts], fill=INK_A)
    d.polygon([(g(n, x), g(n, y)) for x, y in pts], fill=col)


def _ink_round(d, n, box, radius, col, key=KEY):
    x0, y0, x1, y1 = box
    d.rounded_rectangle([g(n, x0 - key), g(n, y0 - key), g(n, x1 + key), g(n, y1 + key)],
                        radius=g(n, radius + key), fill=INK_A)
    d.rounded_rectangle([g(n, x0), g(n, y0), g(n, x1), g(n, y1)],
                        radius=g(n, radius), fill=col)


def _ink_ellipse(d, n, box, col, key=KEY):
    x0, y0, x1, y1 = box
    d.ellipse([g(n, x0 - key), g(n, y0 - key), g(n, x1 + key), g(n, y1 + key)], fill=INK_A)
    d.ellipse([g(n, x0), g(n, y0), g(n, x1), g(n, y1)], fill=col)


# ==================================================================== backgrounds
def bg_flat(d, n):
    pass


def _wedges(d, n, col, count=9, cx=8.0, cy=14.4):
    from math import cos, pi, sin
    for i in range(count):
        a0 = pi * (0.02 + i * (0.96 / count))
        a1 = a0 + pi * (0.48 / count)
        d.polygon([(g(n, cx), g(n, cy)),
                   (g(n, cx - 15 * cos(a0)), g(n, cy - 15 * sin(a0))),
                   (g(n, cx - 15 * cos(a1)), g(n, cy - 15 * sin(a1)))], fill=col)


def bg_wedges(d, n):
    """The one he liked: radiating wedges in a second colour."""
    _wedges(d, n, LEMON_A)


def bg_wedges_light(d, n):
    """The same rays as a lightening, so they suit any background colour."""
    _wedges(d, n, LIGHT, 11)


def _stripes(d, n, col, w=1.15, gap=1.15, slant=3.4):
    x = P[0] - 6.0
    while x < P[2] + 6.0:
        d.polygon([(g(n, x), g(n, P[3])), (g(n, x + slant), g(n, P[1])),
                   (g(n, x + slant + w), g(n, P[1])), (g(n, x + w), g(n, P[3]))], fill=col)
        x += w + gap


def bg_diagonal(d, n):
    _stripes(d, n, LEMON_A)


def bg_diagonal_light(d, n):
    _stripes(d, n, LIGHT, 1.0, 1.0)


def bg_vertical(d, n):
    _stripes(d, n, LEMON_A, 1.25, 1.25, 0.0)


def bg_halftone(d, n):
    _dots(d, n, IN, SHADE, 1.15, 0.34)


def bg_split(d, n):
    """A flat two-tone split rather than stripes."""
    d.polygon([(g(n, P[0]), g(n, P[3])), (g(n, P[0]), g(n, 8.4)),
               (g(n, P[2]), g(n, 6.0)), (g(n, P[2]), g(n, P[3]))], fill=LEMON_A)


BACKGROUNDS = [
    ("flat", "Flat: the colour alone", bg_flat),
    ("wedges", "Radiating wedges, lemon  (the one you liked)", bg_wedges),
    ("wedgeslight", "Radiating wedges, lightened", bg_wedges_light),
    ("diagonal", "Diagonal stripes, lemon", bg_diagonal),
    ("diagonallight", "Diagonal stripes, lightened", bg_diagonal_light),
    ("vertical", "Vertical stripes, lemon", bg_vertical),
    ("halftone", "Ben-Day dots", bg_halftone),
    ("split", "Two-tone split", bg_split),
]


# ======================================================================= subjects
def sub_maskface(d, n):
    """A masked face: skull shape, mask band, eyes, jaw. The genre's own portrait."""
    _ink_round(d, n, (5.2, 5.4, 10.8, 13.4), 2.4, CREAM_A)
    _ink_poly(d, n, [(4.9, 6.6), (11.1, 6.6), (11.1, 9.6), (4.9, 9.6)], PINK_A, 0.0)
    for cx in (6.7, 9.3):
        d.polygon([(g(n, cx - 0.95), g(n, 7.5)), (g(n, cx + 0.95), g(n, 7.2)),
                   (g(n, cx + 0.95), g(n, 8.6)), (g(n, cx - 0.95), g(n, 8.9))], fill=INK_A)
    d.rectangle([g(n, 6.9), g(n, 11.4), g(n, 9.1), g(n, 12.1)], fill=INK_A)


def sub_shield(d, n):
    """A shield with a star: an emblem, and the most solid shape in the set."""
    _ink_poly(d, n, [(4.7, 5.6), (11.3, 5.6), (11.3, 10.2), (8.0, 13.7), (4.7, 10.2)],
              PINK_A, 0.0)
    _ink_splat(d, n, 8.0, 9.0, 2.5, 1.2, 5, LEMON_A, p=2.2, key=0.5)


def sub_bolt(d, n):
    """A bolt in a disc: the oldest emblem there is."""
    _ink_ellipse(d, n, (4.6, 5.8, 11.4, 12.6), LEMON_A)
    d.polygon([(g(n, 9.4), g(n, 6.6)), (g(n, 6.1), g(n, 10.0)), (g(n, 7.9), g(n, 10.0)),
               (g(n, 6.9), g(n, 12.4)), (g(n, 10.1), g(n, 8.9)), (g(n, 8.3), g(n, 8.9))],
              fill=INK_A)


def sub_rocket(d, n):
    """A rocket with fins and a porthole, flame beneath."""
    _ink_poly(d, n, [(6.3, 8.0), (8.0, 4.6), (9.7, 8.0), (9.7, 11.4), (6.3, 11.4)],
              CREAM_A, 0.0)
    _ink_poly(d, n, [(6.3, 9.2), (4.5, 12.4), (6.3, 11.9)], PINK_A, 0.0)
    _ink_poly(d, n, [(9.7, 9.2), (11.5, 12.4), (9.7, 11.9)], PINK_A, 0.0)
    d.ellipse([g(n, 7.1), g(n, 7.0), g(n, 8.9), g(n, 8.8)], fill=INK_A)
    _ink_splat(d, n, 8.0, 12.7, 1.9, 0.9, 6, LEMON_A, key=0.4)


def sub_skull(d, n):
    """A skull: the villain half of the genre."""
    _ink_round(d, n, (5.3, 5.6, 10.7, 11.2), 2.5, CREAM_A)
    _ink_poly(d, n, [(6.6, 11.0), (9.4, 11.0), (9.1, 13.4), (6.9, 13.4)], CREAM_A, 0.0)
    for cx in (6.9, 9.1):
        d.ellipse([g(n, cx - 1.05), g(n, 7.3), g(n, cx + 1.05), g(n, 9.5)], fill=INK_A)
    d.polygon([(g(n, 8.0), g(n, 9.2)), (g(n, 8.8), g(n, 10.5)), (g(n, 7.2), g(n, 10.5))],
              fill=INK_A)
    for x in (7.1, 8.0, 8.9):
        d.rectangle([g(n, x - 0.28), g(n, 11.4), g(n, x + 0.28), g(n, 13.2)], fill=INK_A)


def sub_robot(d, n):
    """A robot head: antenna, visor, grille."""
    d.rectangle([g(n, 7.7), g(n, 4.2), g(n, 8.3), g(n, 6.2)], fill=INK_A)
    _ink_ellipse(d, n, (7.2, 3.4, 8.8, 5.0), PINK_A, 0.45)
    _ink_round(d, n, (4.9, 6.0, 11.1, 12.6), 1.4, CREAM_A)
    _ink_round(d, n, (6.0, 7.2, 10.0, 9.4), 0.7, INK_A, key=0.0)
    d.ellipse([g(n, 6.6), g(n, 7.8), g(n, 7.6), g(n, 8.8)], fill=LEMON_A)
    d.ellipse([g(n, 8.4), g(n, 7.8), g(n, 9.4), g(n, 8.8)], fill=LEMON_A)
    for x in (6.4, 7.4, 8.4, 9.4):
        d.rectangle([g(n, x), g(n, 10.4), g(n, x + 0.6), g(n, 11.6)], fill=INK_A)


def sub_skyline(d, n):
    """A city with someone flying over it: a whole scene, in two masses."""
    towers = ((4.6, 9.4), (6.1, 8.2), (7.6, 10.0), (9.1, 8.8), (10.6, 9.8))
    for x, top in towers:
        d.rectangle([g(n, x - 0.55), g(n, top - KEY), g(n, x + 1.15), g(n, 13.9)], fill=INK_A)
    for x, top in towers:
        d.rectangle([g(n, x - 0.35), g(n, top), g(n, x + 0.95), g(n, 13.9)], fill=PINK_A)
    for x, top in towers:
        for r in range(2):
            d.rectangle([g(n, x - 0.05), g(n, top + 0.7 + r * 1.2),
                         g(n, x + 0.45), g(n, top + 1.3 + r * 1.2)], fill=LEMON_A)
    _ink_poly(d, n, [(9.4, 5.0), (11.6, 5.9), (10.9, 7.0), (9.0, 6.2)], CREAM_A, 0.35)


def sub_glove(d, n):
    """A gloved fist with a cuff: the hand of the genre."""
    _ink_round(d, n, (5.4, 6.2, 10.6, 10.4), 1.6, PINK_A)
    _ink_ellipse(d, n, (4.4, 7.6, 6.8, 10.1), PINK_A, 0.5)
    _ink_poly(d, n, [(6.0, 10.2), (10.0, 10.2), (10.5, 13.4), (5.5, 13.4)], CREAM_A, 0.0)


def sub_cape(d, n):
    """A caped figure, cape wider than the body so both read."""
    _ink_poly(d, n, [(5.6, 6.6), (3.9, 13.6), (12.1, 13.6), (10.4, 6.6)], PINK_A, 0.0)
    d.ellipse([g(n, 6.5), g(n, 4.4), g(n, 9.5), g(n, 7.4)], fill=INK_A)
    d.polygon([(g(n, 6.3), g(n, 13.6)), (g(n, 6.7), g(n, 7.2)),
               (g(n, 9.3), g(n, 7.2)), (g(n, 9.7), g(n, 13.6))], fill=INK_A)
    _ink_splat(d, n, 8.0, 9.6, 1.4, 0.65, 5, LEMON_A, p=2.2, key=0.3)


def sub_raygun(d, n):
    """A ray gun, firing: pulp science fiction in one silhouette."""
    _ink_round(d, n, (4.6, 7.6, 9.6, 10.0), 0.7, CREAM_A)
    _ink_poly(d, n, [(5.4, 9.8), (7.4, 9.8), (6.6, 13.2), (4.6, 13.2)], CREAM_A, 0.0)
    _ink_ellipse(d, n, (8.6, 6.9, 11.0, 10.7), PINK_A, 0.5)
    _ink_splat(d, n, 11.6, 8.8, 1.7, 0.8, 6, LEMON_A, key=0.4)


def sub_planet(d, n):
    """A ringed planet and two stars: the cover of every space issue."""
    _ink_ellipse(d, n, (5.4, 6.2, 10.6, 11.4), PINK_A)
    _ink_poly(d, n, [(3.6, 10.4), (12.4, 7.6), (12.4, 8.9), (3.6, 11.7)], LEMON_A, 0.0)
    _ink_splat(d, n, 11.5, 12.5, 1.3, 0.6, 5, CREAM_A, p=2.2, key=0.3)
    _ink_splat(d, n, 4.7, 5.3, 1.0, 0.45, 5, CREAM_A, p=2.2, key=0.28)


def sub_star_emblem(d, n):
    """A star in a disc: the quietest subject, and the one that never smudges."""
    _ink_ellipse(d, n, (4.6, 5.8, 11.4, 12.6), CREAM_A)
    _ink_splat(d, n, 8.0, 9.2, 3.0, 1.4, 5, PINK_A, p=2.2, key=0.5)


SUBJECTS = [
    ("maskface", "Masked face", sub_maskface),
    ("shield", "Shield with a star", sub_shield),
    ("bolt", "Bolt in a disc", sub_bolt),
    ("rocket", "Rocket", sub_rocket),
    ("skull", "Skull", sub_skull),
    ("robot", "Robot head", sub_robot),
    ("skyline", "City, and someone flying over it", sub_skyline),
    ("glove", "Gloved fist", sub_glove),
    ("cape", "Caped figure", sub_cape),
    ("raygun", "Ray gun", sub_raygun),
    ("planet", "Ringed planet", sub_planet),
    ("staremblem", "Star in a disc", sub_star_emblem),
]

HERO_BG = bg_wedges        # the background he liked, used for the subject section
HERO_SUB = sub_maskface    # the subject held constant while backgrounds vary


def compose(bg, subject):
    def art(d, n):
        _frame(d, n)
        bg(d, n)
        subject(d, n)
    return art


SIZES = (16, 20, 24, 32, 48)
HERO = 96

CANDIDATES = {
    "background": [(k, l, (lambda s, B=fn: comic_flat(s, compose(B, HERO_SUB), CYAN)))
                   for k, l, fn in BACKGROUNDS],
    "subject": [(k, l, (lambda s, S=fn: comic_flat(s, compose(HERO_BG, S), PINK)))
                for k, l, fn in SUBJECTS],
    "earlier": [(k, l, (lambda s, A=a, G=gr: comic_flat(s, A, G))) for k, l, a, gr in R18],
}
FILENAMES = {k: "issue-012.cbz" for k in CANDIDATES}
SECTIONS = {
    "background": "The background on its own. Same subject on every one, so the "
                  "only thing changing is the ground. Number 2 is the radiating "
                  "wedge you liked. The lemon versions are a true two-colour "
                  "ground; the lightened ones are the same pattern made of the "
                  "background colour itself, so they suit any pick.",
    "subject": "Actual comic artwork rather than more bursts, all on the "
               "radiating-wedge ground so only the subject changes. Generic on "
               "purpose - the genre is the point, and nobody's trademark belongs "
               "in a file icon.",
    "earlier": "Round eighteen's eleven, kept for reference. Round nineteen's "
               "fourteen are deleted, as asked.",
}


def caption(kind, key):
    from round12 import contrast_note
    for k, _l, fn in CANDIDATES[kind]:
        if k == key:
            return contrast_note(fn(16))
    return ""


def main(out_dir):
    out = pathlib.Path(out_dir) / "round20"
    out.mkdir(parents=True, exist_ok=True)
    for kind, cands in CANDIDATES.items():
        for key, _l, fn in cands:
            for s in SIZES + (HERO,):
                fn(s).save(out / f"{kind}-{key}-{s}.png")
    print(f"{sum(len(c) for c in CANDIDATES.values())} candidates -> {out}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else ".")
