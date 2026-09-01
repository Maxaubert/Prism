"""Round eleven: the archive icon with no tile behind it.

Two things had to change together, and the second one was learned the hard way.

PALETTE. The tile has carried the contrast since round seven: a white glyph on
near-black reads on Explorer light and dark alike. Take it away and that stops
being true, so a tileless icon needs a palette that carries its own contrast.
Two do:

  DUO      indigo body, white interior detail. Indigo sits between #f7f7f7 and
           #202020 in luminance, so it separates from both grounds.
  OUTLINE  light body with a dark edge dilated from the glyph's own alpha. The
           edge holds it off white, the body holds it off dark.

NO HOLES. The first cut of this round reused the shipped icon's technique -
carve a channel by setting the glyph layer's alpha to zero - and it fell apart
at 16px. With a tile there is a stable outer silhouette, so an interior hole
reads as detail on top of it. Without one, every hole eats the silhouette, and
a zipped folder became two blobs. So nothing here is carved: the shapes are
solid and the detail is drawn IN A CONTRASTING COLOUR on top. The belt sits in
a channel of `alt` rather than in a hole, which is the tileless way to say the
same thing.

The zipped folder is the idiom Windows itself uses for a compressed folder,
and 7-Zip and WinRAR both reach for it.
"""
from PIL import Image, ImageDraw

from round5 import g
from round7 import DUO, OUTLINE, canvas, finish


# ------------------------------------------------------------------ shapes
def stack_belt(d, n, p):
    """The shipped stack, tileless: the channel is a tone, not a hole."""
    for i, col in enumerate((p.body, p.alt, p.body)):
        y = g(n, 2.4 + i * 4.2)
        d.rounded_rectangle([g(n, 1.5), y, g(n, 14.5), y + g(n, 3.6)], radius=g(n, 0.8), fill=col)
    d.rectangle([g(n, 5.9), g(n, 2.4), g(n, 10.1), g(n, 14.4)], fill=p.alt)
    d.rounded_rectangle(
        [g(n, 6.6), g(n, 1.4), g(n, 9.4), g(n, 15.0)], radius=g(n, 0.6), fill=p.ink
    )


def _folder(d, n, p):
    """The folder silhouette, solid.

    The STEP is the whole thing. A tab rising one unit above the face reads as
    a rounded rectangle with a nick in it; at 2.4 units it reads as a folder,
    and that is the difference between this working at 16px and not. The tab
    also stops well short of half width, because one that runs most of the way
    across stops looking like a tab.
    """
    d.rounded_rectangle([g(n, 0.8), g(n, 2.0), g(n, 6.8), g(n, 6.4)], radius=g(n, 1.0), fill=p.body)
    d.rounded_rectangle([g(n, 0.8), g(n, 4.4), g(n, 15.2), g(n, 14.2)], radius=g(n, 1.2), fill=p.body)


def _seam(d, n, p, y0=4.4, y1=14.2):
    d.rectangle([g(n, 7.4), g(n, y0), g(n, 8.6), g(n, y1)], fill=p.ink)


def _pull(d, n, p, y0, y1, tongue=0.0):
    d.rounded_rectangle([g(n, 6.3), g(n, y0), g(n, 9.7), g(n, y1)], radius=g(n, 0.9), fill=p.ink)
    if tongue:
        d.rounded_rectangle(
            [g(n, 7.3), g(n, y1 - 0.2), g(n, 8.7), g(n, y1 + tongue)], radius=g(n, 0.5), fill=p.ink
        )


def folder_zip(d, n, p):
    """A folder with a zip down it: teeth, seam and a pull."""
    _folder(d, n, p)
    _seam(d, n, p)
    # Teeth, staggered either side. Fat and few: at 16px they stop being
    # countable and become texture, which is the most a zip can ask for.
    for k in (5.2, 7.6):
        d.rectangle([g(n, 5.9), g(n, k), g(n, 7.4), g(n, k + 1.2)], fill=p.ink)
        d.rectangle([g(n, 8.6), g(n, k + 1.2), g(n, 10.1), g(n, k + 2.4)], fill=p.ink)
    _pull(d, n, p, 10.6, 13.4)


def folder_plain(d, n, p):
    """The same folder with no teeth: a seam and a pull.

    The honest version for 16px, where teeth are texture at best. What is left
    is the folder, a line down it and something to pull, which is all a zip has
    ever needed to say.
    """
    _folder(d, n, p)
    _seam(d, n, p)
    _pull(d, n, p, 9.4, 12.4)


def folder_tab(d, n, p):
    """Seam, pull, and a tongue hanging off the bottom of it."""
    _folder(d, n, p)
    _seam(d, n, p, y1=9.6)
    _pull(d, n, p, 8.6, 11.2, tongue=3.0)


def pouch_zip(d, n, p):
    """A closed case with the zip across it, the way a case zips shut."""
    d.rounded_rectangle([g(n, 1.0), g(n, 2.8), g(n, 15.0), g(n, 13.6)], radius=g(n, 1.6), fill=p.body)
    d.rectangle([g(n, 1.0), g(n, 7.6), g(n, 15.0), g(n, 8.8)], fill=p.ink)
    for k in (2.6, 11.4):
        d.rectangle([g(n, k), g(n, 6.2), g(n, k + 1.2), g(n, 7.6)], fill=p.ink)
        d.rectangle([g(n, k + 1.6), g(n, 8.8), g(n, k + 2.8), g(n, 10.2)], fill=p.ink)
    d.rounded_rectangle([g(n, 6.2), g(n, 6.4), g(n, 9.8), g(n, 10.0)], radius=g(n, 1.0), fill=p.ink)


def box_belt(d, n, p):
    """A parcel: one solid box, belted, with no layers to lose at 16px."""
    d.rounded_rectangle([g(n, 1.2), g(n, 2.6), g(n, 14.8), g(n, 13.8)], radius=g(n, 1.5), fill=p.body)
    d.rectangle([g(n, 6.0), g(n, 2.6), g(n, 10.0), g(n, 13.8)], fill=p.alt)
    d.rounded_rectangle([g(n, 6.7), g(n, 1.6), g(n, 9.3), g(n, 14.8)], radius=g(n, 0.6), fill=p.ink)


def _make(body_fn, pal):
    def fn(size, _=None):
        img, _d, n = canvas(size, pal)
        layer = Image.new("RGBA", (n, n), (0, 0, 0, 0))
        body_fn(ImageDraw.Draw(layer), n, pal)
        return finish(img, size, pal, layer)

    return fn


SHAPES = [
    ("stack", "the belted stack", stack_belt),
    ("box", "a belted parcel", box_belt),
    ("folder", "zipped folder, teeth and a pull", folder_zip),
    ("plain", "zipped folder, seam and a pull", folder_plain),
    ("tab", "zipped folder, pull with a tongue", folder_tab),
    ("pouch", "a case, zipped across", pouch_zip),
]

TREATMENTS = [("duo", "indigo", DUO), ("out", "light with a dark edge", OUTLINE)]

CANDIDATES = {
    "archive": [
        (f"{sk}-{tk}", f"{slabel} - {tlabel}", _make(fn, pal))
        for sk, slabel, fn in SHAPES
        for tk, tlabel, pal in TREATMENTS
    ]
}

SIZES = (16, 20, 24, 32, 48)

FILENAMES = {"archive": "backup-2026.zip"}

SECTIONS = {
    "archive": "No tile behind any of these, so the palette carries the contrast instead: "
    "<em>indigo</em> sits between Explorer's white and its near-black, and <em>light with a "
    "dark edge</em> is held off both. Nothing is carved either - without a tile there is no "
    "stable outer shape for a hole to sit in, so every mark here is drawn on a solid "
    "silhouette. Worth knowing before you pick: the other six kinds all keep their tile, so a "
    "tileless archive will not match its own family in a folder listing."
}


def main(out_dir):
    import pathlib

    out = pathlib.Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    for kind, options in CANDIDATES.items():
        for key, _label, fn in options:
            for s in SIZES:
                fn(s).save(out / f"{kind}-{key}-{s}.png")
    print(f"{sum(len(v) for v in CANDIDATES.values()) * len(SIZES)} frames -> {out}")


if __name__ == "__main__":
    import sys

    main(sys.argv[1] if len(sys.argv) > 1 else "mockups")
