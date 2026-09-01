"""Round twenty-one: round eighteen's artwork, on the dual-colour background.

The owner liked the RADIATING WEDGE ground from round twenty and none of the
twelve new subjects that came with it, and asked for that ground behind the
artwork he already had - round eighteen's eleven.

The one piece of plumbing worth explaining. Round eighteen's art functions each
draw the cover's black border themselves, and that border is cut by filling its
inside with TRANSPARENT so the tintable ground shows through. Drawing a striped
background first and then calling one of those functions would therefore erase
the stripes the moment the border was cut. So the border is drawn once here,
the background goes inside it, and round18._frame is swapped for a no-op while
the artwork runs. It is put back in a finally, so nothing leaks between
candidates.

Two grounds are offered for every piece. LEMON wedges are a true two-colour
background, which is what the reference had. LIGHTENED wedges are the same
pattern made from the background colour itself, so they follow whatever colour
is picked instead of pinning the icon to yellow - and they matter here because
several of these pieces are themselves lemon, and a lemon splat on lemon wedges
loses its silhouette.

    python round21.py <outdir>
"""
import pathlib
import sys

import round18
from round18 import COMICS as R18
from round18 import CYAN, PINK, _frame, comic_flat
from round20 import bg_wedges, bg_wedges_light

# Pieces whose own fill is lemon: on lemon wedges they lose their edge, so the
# lightened ground is the honest pairing for these. Recorded rather than
# silently reassigned - the owner picks, and he should see both.
LEMON_BODIED = {"pow", "boltinked", "hero", "mask", "splat_hero"}


def framed(bg, art):
    """Border once, then the ground, then the artwork with its own border off."""
    def out(d, n):
        _frame(d, n)
        bg(d, n)
        original = round18._frame
        round18._frame = lambda *a, **k: None
        try:
            art(d, n)
        finally:
            round18._frame = original
    return out


SIZES = (16, 20, 24, 32, 48)
HERO = 96

CANDIDATES = {
    "wedges": [(k, l, (lambda s, A=a: comic_flat(s, framed(bg_wedges, A), CYAN)))
               for k, l, a, _g in R18],
    "lightened": [(k, l, (lambda s, A=a: comic_flat(s, framed(bg_wedges_light, A), PINK)))
                  for k, l, a, _g in R18],
}
FILENAMES = {k: "issue-012.cbz" for k in CANDIDATES}
SECTIONS = {
    "wedges": "Round eighteen's eleven on the LEMON radiating wedge - the true "
              "two-colour ground, the one you liked. Watch the pieces that are "
              "themselves lemon: on this ground they lose their outline.",
    "lightened": "The same eleven on the LIGHTENED wedge, where the stripe is "
                 "made of the background colour itself. Quieter, it never fights "
                 "the artwork, and it follows whatever colour you pick rather "
                 "than pinning the icon to yellow.",
}


def caption(kind, key):
    from round12 import contrast_note
    for k, _l, fn in CANDIDATES[kind]:
        if k == key:
            return contrast_note(fn(16))
    return ""


def main(out_dir):
    out = pathlib.Path(out_dir) / "round21"
    out.mkdir(parents=True, exist_ok=True)
    for kind, cands in CANDIDATES.items():
        for key, _l, fn in cands:
            for s in SIZES + (HERO,):
                fn(s).save(out / f"{kind}-{key}-{s}.png")
    print(f"{sum(len(c) for c in CANDIDATES.values())} candidates -> {out}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else ".")
