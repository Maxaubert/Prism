"""Contact sheet: five mockups per file kind, each shown big and at 16px."""
import sys
import pathlib
from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, str(pathlib.Path(__file__).parent))
mod = sys.argv[1] if len(sys.argv) > 1 else "icons"
KINDS = __import__(mod).KINDS  # noqa: E402

BIG = 96
SMALL = 16
CELL_W = 250
CELL_H = 150
PAD = 26
BG = (18, 20, 27)
LABEL = (150, 156, 190)
TITLE = (233, 237, 247)


def font(sz):
    for name in ("segoeui.ttf", "arial.ttf"):
        try:
            return ImageFont.truetype(name, sz)
        except OSError:
            continue
    return ImageFont.load_default()


F_LABEL = font(14)
F_TITLE = font(19)

MAX_COLS = 5
# A kind with more variants than fits wraps onto a second row, still labelled once.
ROWS = []
for kind, variants in KINDS.items():
    for i in range(0, len(variants), MAX_COLS):
        ROWS.append((kind if i == 0 else "", variants[i:i + MAX_COLS], i))
rows = len(ROWS)
cols = min(MAX_COLS, max(len(v) for v in KINDS.values()))
W = PAD * 2 + 140 + cols * CELL_W
H = PAD * 2 + rows * CELL_H

sheet = Image.new("RGB", (W, H), BG)
d = ImageDraw.Draw(sheet)

for r, (kind, variants, offset) in enumerate(ROWS):
    y = PAD + r * CELL_H
    d.text((PAD, y + CELL_H // 2 - 12), kind, font=F_TITLE, fill=TITLE)
    for c, (name, fn) in enumerate(variants):
        x = PAD + 140 + c * CELL_W
        big = fn(BIG)
        sheet.paste(big, (x, y + 8), big)
        # The size that decides it: Explorer's details view.
        small = fn(SMALL)
        sheet.paste(small, (x + BIG + 22, y + 14), small)
        shown = small.resize((SMALL * 3, SMALL * 3), Image.NEAREST)
        sheet.paste(shown, (x + BIG + 22, y + 40), shown)
        d.text((x, y + BIG + 16), f"{offset + c + 1}. {name}", font=F_LABEL, fill=LABEL)
        d.text((x + BIG + 22, y + 96), "16px", font=F_LABEL, fill=(90, 96, 122))

out = pathlib.Path(__file__).parent / ("sheet.png" if mod == "icons" else f"sheet-{mod}.png")
sheet.save(str(out))
print("sheet", sheet.size, out.name)
