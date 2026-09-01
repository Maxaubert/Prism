"""Write the per-kind .ico files the installer points each ProgID at.

Every size is DRAWN at that size rather than downsampled from one big render:
the glyphs are laid out in sixteenths of the tile, so a 16px frame drawn as
16px lands on whole pixels, while a 16px frame squeezed out of a 256px one
lands wherever LANCZOS puts it. Explorer's details view is the 16px frame, so
that is the one worth getting right.

The set is defined in final_icons.py and nowhere else. Every kind is a coloured
PAGE silhouette with a folded corner, a black chip carrying the file's
EXTENSION, and one flat glyph - no tile behind it and no outline around it,
because a mid-tone page carries its own contrast on both Explorer grounds.
ARCHIVE is a landscape container rather than a page (a zip is not one file) and
COMIC carries pop-art artwork rather than a flat fill; both exceptions are
recorded in final_icons.py with their reasons. round7.py is left in the tree as
the record of the tiled set this replaced.

The frames are stored as PNG inside the .ico, which Windows has read since
Vista and which keeps a 256px frame from costing 256KB.
"""
import pathlib
import struct
import sys
from io import BytesIO

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from final_icons import (ALL_EXTS, COLOURS, KINDS, icon_for_ext,  # noqa: E402
                         legacy)

# What Windows asks for: details/list (16), small (20/24), medium (32/40/48),
# large (64/96), extra large (128) and the jumbo/preview frame (256).
SIZES = (16, 20, 24, 32, 40, 48, 64, 96, 128, 256)

OUT = pathlib.Path(__file__).resolve().parents[2] / "build" / "icons"


def write_ico(path, frames):
    """Pack natively-rendered PNG frames into one .ico."""
    blobs = []
    for size, img in frames:
        buf = BytesIO()
        img.save(buf, format="PNG")
        blobs.append((size, buf.getvalue()))

    header = struct.pack("<HHH", 0, 1, len(blobs))
    offset = len(header) + 16 * len(blobs)
    entries, data = b"", b""
    for size, blob in blobs:
        dim = 0 if size >= 256 else size
        entries += struct.pack("<BBBBHHII", dim, dim, 0, 0, 1, 32, len(blob), offset)
        offset += len(blob)
        data += blob
    path.write_bytes(header + entries + data)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for kind in KINDS:
        # The seven are the LEGACY classes' icons now, and carry no label:
        # one of them can be the default for any of a hundred extensions.
        frames = [(s, legacy(kind, s)) for s in SIZES]
        path = OUT / f"prism-{kind}.ico"
        write_ico(path, frames)
        ext, col = COLOURS[kind]
        hexcol = f"#{col[0]:02x}{col[1]:02x}{col[2]:02x}"
        print(f"{path.name:22} {ext:5} {hexcol}  {len(SIZES)} frames"
              f"  {path.stat().st_size:>7} bytes")

    # ONE PER EXTENSION, which is the set the installer actually points at.
    # An .ico carries one baked label, so a class shared by many extensions
    # prints one of their names on all of them - prism-code.ico said PY on 130
    # of them. The seven above are kept as the canonical kind renders; nothing
    # in assoc.nsh references them any more.
    for ext in ALL_EXTS:
        path = OUT / f"prism-{ext}.ico"
        write_ico(path, [(s, icon_for_ext(ext, s)) for s in SIZES])
    total = sum((OUT / f"prism-{e}.ico").stat().st_size for e in ALL_EXTS)
    print(f"{len(ALL_EXTS)} per-extension icons, {total / 1024 / 1024:.1f} MB")


if __name__ == "__main__":
    main()
