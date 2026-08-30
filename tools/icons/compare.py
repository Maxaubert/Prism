"""Every treatment on both Explorer grounds, at the sizes Explorer actually uses.

Details/list view is 16px and it is what most people look at all day, so that
is the column that decides this. 32px is the medium-icons view, 48px large.
"""
import pathlib
import sys

from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from round7 import KIND_GLYPHS, TREATMENTS  # noqa: E402

LIGHT = (255, 255, 255)   # Explorer, light mode
DARK = (32, 32, 32)       # Explorer, dark mode
PAGE = (18, 20, 27)
LABEL = (150, 156, 190)
TITLE = (233, 237, 247)

CELL = 108
PANEL_PAD = 18
LABEL_W = 300
BLOCK_H = 150


def font(sz):
    for name in ("segoeui.ttf", "arial.ttf"):
        try:
            return ImageFont.truetype(name, sz)
        except OSError:
            continue
    return ImageFont.load_default()


F_S, F_M = font(13), font(16)

panel_w = PANEL_PAD * 2 + len(KIND_GLYPHS) * CELL
W = LABEL_W + panel_w * 2 + 60
H = 60 + len(TREATMENTS) * BLOCK_H

sheet = Image.new("RGB", (W, H), PAGE)
d = ImageDraw.Draw(sheet)

d.text((26, 14), "16px is the details-view size,", font=F_S, fill=LABEL)
d.text((26, 32), "blown up 3x. 32px beside it.", font=F_S, fill=LABEL)
for i, (ground, name) in enumerate(((LIGHT, "Explorer light"), (DARK, "Explorer dark"))):
    x = LABEL_W + i * (panel_w + 30)
    d.text((x + PANEL_PAD, 26), name, font=F_S, fill=TITLE)

for r, (tname, pal) in enumerate(TREATMENTS):
    y = 52 + r * BLOCK_H
    for li, line in enumerate(tname.split("|")):
        d.text((26, y + 46 + li * 22), line, font=F_M, fill=TITLE)
    for i, ground in enumerate((LIGHT, DARK)):
        px = LABEL_W + i * (panel_w + 30)
        d.rounded_rectangle([px, y, px + panel_w, y + BLOCK_H - 18], radius=10, fill=ground)
        for c, (kind, fn) in enumerate(KIND_GLYPHS):
            cx = px + PANEL_PAD + c * CELL
            big = fn(32, pal)
            sheet.paste(big, (cx + 8, y + 20), big)
            small = fn(16, pal)
            shown = small.resize((48, 48), Image.NEAREST)
            sheet.paste(shown, (cx + 48, y + 12), shown)
            tone = (60, 60, 60) if ground == LIGHT else (170, 170, 170)
            d.text((cx + 8, y + 74), kind, font=F_S, fill=tone)

out = pathlib.Path(__file__).parent / "compare.png"
sheet.save(str(out))
print("compare", sheet.size, out.name)
