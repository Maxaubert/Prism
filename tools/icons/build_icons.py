"""Write the six per-kind .ico files the installer points each ProgID at.

Every size is DRAWN at that size rather than downsampled from one big render:
the glyphs are laid out in sixteenths of the tile, so a 16px frame drawn as
16px lands on whole pixels, while a 16px frame squeezed out of a 256px one
lands wherever LANCZOS puts it. Explorer's details view is the 16px frame, so
that is the one worth getting right.

The glyphs sit on the near-black rounded tile, which is the look every mockup
round was judged on and which carries its own contrast, so the icons read the
same on Explorer light and dark without depending on either.

The frames are stored as PNG inside the .ico, which Windows has read since
Vista and which keeps a 256px frame from costing 256KB.
"""
import pathlib
import struct
import sys
from io import BytesIO

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from round7 import KIND_GLYPHS, TILED  # noqa: E402

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
    for kind, fn in KIND_GLYPHS:
        frames = [(s, fn(s, TILED)) for s in SIZES]
        path = OUT / f"prism-{kind}.ico"
        write_ico(path, frames)
        print(f"{path.name:24} {len(SIZES)} frames  {path.stat().st_size:>7} bytes")


if __name__ == "__main__":
    main()
