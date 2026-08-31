"""Round fifteen: archive stops being a page, and comic stops being flat.

Two owner notes, and they pull in opposite directions.

ARCHIVE. The page silhouette says "one file", and a .zip is not one file - it
is a container, closer to a folder than to a sheet. So archive leaves the page
family entirely: ten CONTAINER silhouettes, landscape rather than portrait,
still wearing the black chip and the extension so it stays a member of the set.
Shapes are drawn in a neutral mid-slate here for the same reason round fourteen
was: colour is a separate question and judging a shape through a colour answers
neither. There is one deliberate exception at the end of the section, in the
chosen yellow, because that colour has a problem worth seeing rather than
reading about.

COMIC. Same layout, but the page carries actual comic-book ARTWORK rather than
one flat colour - panels, halftone, sunbursts, speed lines. That makes comic
the ONE kind in the set that is not two colours, which has a consequence worth
stating: it cannot be live-tinted by the picker the way the others are, because
there is no single page colour to tint. Its ground colour is baked per
candidate instead.

Nothing is carved anywhere: every mark sits on a solid shape.

    python round15.py <outdir>
"""
import pathlib
import sys

from PIL import Image, ImageChops, ImageDraw

from icons import S
from round12 import CHIP, INK, font, page_mask
from round5 import g

NEUTRAL = (126, 138, 160)
CHOSEN_YELLOW = (255, 255, 0)

# Comic's ink box. Classic four-colour process, plus the paper it was printed on.
PAPER = (243, 234, 212)
RED = (214, 58, 48)
YELLOW = (247, 196, 44)
BLUE = (46, 110, 196)
MAGENTA = (178, 62, 119)   # the owner's picked comic colour, kept in the box


# Archive wears the chip LOW. On the page kinds it sits top-left over blank
# paper, but every container's identity lives at its top - a folder's tab, a
# box's flaps, a case's handle - and a chip there hides the one feature that
# says which container it is.
CHIP_A = (0.8, 10.8, 9.6, 14.6)


def _label_at(n, text, chip):
    """round12.label_layout, for a chip that is not round12's."""
    centre = (chip[0] + chip[2]) / 2, (chip[1] + chip[3]) / 2
    fh = (chip[3] - chip[1]) * 0.62
    room = g(n, (chip[2] - chip[0]) * 0.86)
    f = font(g(n, fh))
    while f.getlength(text) > room and fh > 0.6:
        fh *= 0.92
        f = font(g(n, fh))
    return (g(n, centre[0]), g(n, centre[1])), f


def _chip_and_label(ink, body, n, ext, chip=CHIP):
    """The chip, and the extension knocked out of it. Shared by both sections."""
    K = tuple(INK) + (255,)
    ImageDraw.Draw(ink).rounded_rectangle(
        [g(n, chip[0]), g(n, chip[1]), g(n, chip[2]), g(n, chip[3])],
        radius=g(n, 0.7), fill=K)
    (tx, ty), f = _label_at(n, ext, chip)
    cut = Image.new("L", (n, n), 0)
    ImageDraw.Draw(cut).text((tx, ty), ext, font=f, fill=255, anchor="mm")
    ink.putalpha(ImageChops.subtract(ink.getchannel("A"), cut))
    if body is not None:
        body.putalpha(ImageChops.lighter(body.getchannel("A"), cut))


# ======================================================================= archive
# Containers, laid out landscape in x 1.5..14.5, y 4.0..15.0 - deliberately a
# different footprint from the portrait page, so a zip never reads as a sheet.
AX0, AY0, AX1, AY1 = 1.5, 3.2, 14.5, 14.6


def _folder_body(d, n, fill, tab=True):
    if tab:
        d.rounded_rectangle([g(n, AX0), g(n, AY0), g(n, AX0 + 5.2), g(n, AY0 + 2.0)],
                            radius=g(n, 0.5), fill=fill)
    d.rounded_rectangle([g(n, AX0), g(n, AY0 + 1.2), g(n, AX1), g(n, AY1)],
                        radius=g(n, 0.9), fill=fill)


def folder(d, n, fill):
    _folder_body(d, n, fill)


def folder_ink(d, n, K, T):
    pass


def folder_zip(d, n, fill):
    _folder_body(d, n, fill)


def folder_zip_ink(d, n, K, T):
    cx = (AX0 + AX1) / 2
    d.rectangle([g(n, cx - 0.55), g(n, AY0 + 1.2), g(n, cx + 0.55), g(n, AY1)], fill=K)
    for i in range(3):
        y = AY0 + 2.2 + i * 2.0
        d.rectangle([g(n, cx - 1.9), g(n, y), g(n, cx - 0.55), g(n, y + 0.8)], fill=K)
        d.rectangle([g(n, cx + 0.55), g(n, y + 1.0), g(n, cx + 1.9), g(n, y + 1.8)], fill=K)
    d.rounded_rectangle([g(n, cx - 1.3), g(n, AY1 - 3.2), g(n, cx + 1.3), g(n, AY1 - 0.6)],
                        radius=g(n, 0.6), fill=K)


def folder_stuffed(d, n, fill):
    d.rounded_rectangle([g(n, AX0 + 2.0), g(n, AY0 - 0.6), g(n, AX1 - 2.0), g(n, AY0 + 5.0)],
                        radius=g(n, 0.5), fill=fill)
    _folder_body(d, n, fill)


def folder_stuffed_ink(d, n, K, T):
    for i in range(2):
        y = AY0 + 0.4 + i * 1.4
        d.rounded_rectangle([g(n, AX0 + 3.2), g(n, y), g(n, AX1 - 3.2), g(n, y + 0.7)],
                            radius=g(n, 0.35), fill=K)


def box_flaps(d, n, fill):
    cx = (AX0 + AX1) / 2
    d.rounded_rectangle([g(n, AX0 + 0.6), g(n, AY0 + 3.4), g(n, AX1 - 0.6), g(n, AY1)],
                        radius=g(n, 0.7), fill=fill)
    # Two flaps splaying outward from the mouth, with a gap down the middle:
    # one diagonal slab across the top reads as a lid, not as an open box.
    d.polygon([(g(n, AX0 + 0.6), g(n, AY0 + 3.6)), (g(n, cx - 0.3), g(n, AY0 + 3.6)),
               (g(n, cx - 1.0), g(n, AY0 + 0.9)), (g(n, AX0 - 0.3), g(n, AY0 + 1.7))],
              fill=fill)
    d.polygon([(g(n, cx + 0.3), g(n, AY0 + 3.6)), (g(n, AX1 - 0.6), g(n, AY0 + 3.6)),
               (g(n, AX1 + 0.3), g(n, AY0 + 1.7)), (g(n, cx + 1.0), g(n, AY0 + 0.9))],
              fill=fill)


def box_flaps_ink(d, n, K, T):
    cx = (AX0 + AX1) / 2
    d.rectangle([g(n, cx - 0.4), g(n, AY0 + 3.6), g(n, cx + 0.4), g(n, AY1)], fill=K)


def box_taped(d, n, fill):
    d.rounded_rectangle([g(n, AX0), g(n, AY0), g(n, AX1), g(n, AY1)],
                        radius=g(n, 0.8), fill=fill)


def box_taped_ink(d, n, K, T):
    cx = (AX0 + AX1) / 2
    d.rectangle([g(n, AX0), g(n, AY0 + 3.6), g(n, AX1), g(n, AY0 + 4.8)], fill=K)
    d.rectangle([g(n, cx - 0.8), g(n, AY0), g(n, cx + 0.8), g(n, AY1)], fill=K)


def crate_belt(d, n, fill):
    d.rounded_rectangle([g(n, AX0), g(n, AY0), g(n, AX1), g(n, AY0 + 2.4)],
                        radius=g(n, 0.5), fill=fill)
    d.rounded_rectangle([g(n, AX0 + 0.8), g(n, AY0 + 3.0), g(n, AX1 - 0.8), g(n, AY1)],
                        radius=g(n, 0.7), fill=fill)


def crate_belt_ink(d, n, K, T):
    cx = (AX0 + AX1) / 2
    d.rounded_rectangle([g(n, cx - 1.4), g(n, AY0 + 4.2), g(n, cx + 1.4), g(n, AY0 + 6.0)],
                        radius=g(n, 0.4), fill=K)


def case(d, n, fill):
    d.rounded_rectangle([g(n, AX0 + 4.6), g(n, AY0), g(n, AX1 - 4.6), g(n, AY0 + 1.8)],
                        radius=g(n, 0.5), fill=fill)
    d.rounded_rectangle([g(n, AX0), g(n, AY0 + 1.6), g(n, AX1), g(n, AY1)],
                        radius=g(n, 0.9), fill=fill)


def case_ink(d, n, K, T):
    cx = (AX0 + AX1) / 2
    d.rounded_rectangle([g(n, AX0 + 5.4), g(n, AY0 + 0.5), g(n, AX1 - 5.4), g(n, AY0 + 1.7)],
                        radius=g(n, 0.3), fill=T)
    d.rectangle([g(n, AX0), g(n, AY0 + 4.4), g(n, AX1), g(n, AY0 + 5.4)], fill=K)
    d.rounded_rectangle([g(n, cx - 1.2), g(n, AY0 + 4.0), g(n, cx + 1.2), g(n, AY0 + 5.8)],
                        radius=g(n, 0.4), fill=K)


def cube_iso(d, n, fill):
    cx = (AX0 + AX1) / 2
    d.polygon([(g(n, cx), g(n, AY0)), (g(n, AX1), g(n, AY0 + 2.8)),
               (g(n, cx), g(n, AY0 + 5.6)), (g(n, AX0), g(n, AY0 + 2.8))], fill=fill)
    d.polygon([(g(n, AX0), g(n, AY0 + 3.2)), (g(n, cx), g(n, AY0 + 6.0)),
               (g(n, cx), g(n, AY1)), (g(n, AX0), g(n, AY1 - 2.8))], fill=fill)
    d.polygon([(g(n, AX1), g(n, AY0 + 3.2)), (g(n, cx), g(n, AY0 + 6.0)),
               (g(n, cx), g(n, AY1)), (g(n, AX1), g(n, AY1 - 2.8))], fill=fill)


def cube_iso_ink(d, n, K, T):
    cx = (AX0 + AX1) / 2
    d.polygon([(g(n, AX1), g(n, AY0 + 3.2)), (g(n, cx), g(n, AY0 + 6.0)),
               (g(n, cx), g(n, AY1)), (g(n, AX1), g(n, AY1 - 2.8))], fill=K)


def stack_bound(d, n, fill):
    for i in range(3):
        y = AY0 + i * 3.7
        d.rounded_rectangle([g(n, AX0 + 1.2), g(n, y), g(n, AX1 - 1.2), g(n, y + 2.9)],
                            radius=g(n, 0.5), fill=fill)


def stack_bound_ink(d, n, K, T):
    cx = (AX0 + AX1) / 2
    d.rectangle([g(n, cx - 1.0), g(n, AY0), g(n, cx + 1.0), g(n, AY1)], fill=K)


def drawer(d, n, fill):
    d.rounded_rectangle([g(n, AX0), g(n, AY0), g(n, AX1), g(n, AY1)],
                        radius=g(n, 0.8), fill=fill)


def drawer_ink(d, n, K, T):
    cx = (AX0 + AX1) / 2
    for i in range(2):
        y = AY0 + 0.9 + i * 5.0
        d.rounded_rectangle([g(n, AX0 + 0.9), g(n, y), g(n, AX1 - 0.9), g(n, y + 4.2)],
                            radius=g(n, 0.4), fill=T)
        d.rounded_rectangle([g(n, cx - 1.6), g(n, y + 1.7), g(n, cx + 1.6), g(n, y + 2.5)],
                            radius=g(n, 0.4), fill=K)


def pouch(d, n, fill):
    d.rounded_rectangle([g(n, AX0), g(n, AY0 + 2.0), g(n, AX1), g(n, AY1)],
                        radius=g(n, 1.0), fill=fill)
    d.polygon([(g(n, AX0), g(n, AY0 + 2.4)), (g(n, (AX0 + AX1) / 2), g(n, AY0)),
               (g(n, AX1), g(n, AY0 + 2.4))], fill=fill)


def pouch_ink(d, n, K, T):
    cx = (AX0 + AX1) / 2
    d.rectangle([g(n, AX0), g(n, AY0 + 4.4), g(n, AX1), g(n, AY0 + 5.4)], fill=K)
    for i in range(4):
        x = AX0 + 1.4 + i * 3.0
        d.rectangle([g(n, x), g(n, AY0 + 3.6), g(n, x + 1.0), g(n, AY0 + 4.4)], fill=K)
    d.rounded_rectangle([g(n, cx - 1.2), g(n, AY0 + 5.2), g(n, cx + 1.2), g(n, AY0 + 7.4)],
                        radius=g(n, 0.5), fill=K)


ARCHIVES = [
    ("folder", "Plain folder", folder, folder_ink),
    ("folderzip", "Folder with a zip seam", folder_zip, folder_zip_ink),
    ("stuffed", "Folder with pages in it", folder_stuffed, folder_stuffed_ink),
    ("boxflaps", "Box with open flaps", box_flaps, box_flaps_ink),
    ("boxtaped", "Taped box", box_taped, box_taped_ink),
    ("crate", "Lidded crate", crate_belt, crate_belt_ink),
    ("case", "Case with a handle", case, case_ink),
    ("cube", "Cube, corner on", cube_iso, cube_iso_ink),
    ("stack", "Bound stack", stack_bound, stack_bound_ink),
    ("pouch", "Zipped pouch", pouch, pouch_ink),
    ("drawer", "Drawer unit", drawer, drawer_ink),
]


def archive_layers(size, sil, inkfn, ext="ZIP"):
    n = size * S
    m = Image.new("L", (n, n), 0)
    sil(ImageDraw.Draw(m), n, 255)
    body = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    body.paste(Image.new("RGBA", (n, n), (255, 255, 255, 255)), (0, 0), m)

    K, T = tuple(INK) + (255,), (0, 0, 0, 0)
    ink = Image.new("RGBA", (n, n), T)
    inkfn(ImageDraw.Draw(ink), n, K, T)
    ink = Image.composite(ink, Image.new("RGBA", (n, n), T), m)
    _chip_and_label(ink, body, n, ext, CHIP_A)
    return (body.resize((size, size), Image.LANCZOS),
            ink.resize((size, size), Image.LANCZOS))


def archive_flat(size, sil, inkfn, colour, ext="ZIP"):
    body, ink = archive_layers(size, sil, inkfn, ext)
    out = Image.new("RGBA", body.size, (0, 0, 0, 0))
    out.paste(Image.new("RGBA", body.size, tuple(colour) + (255,)), (0, 0), body)
    out.alpha_composite(ink)
    return out


# ========================================================================= comic
# The page silhouette stays - the owner asked for THIS layout with a comic
# background, not a different shape - and the flat fill becomes artwork.
def _halftone(d, n, box, col, step=1.3, r=0.34):
    x0, y0, x1, y1 = box
    rows = int((y1 - y0) / step) + 1
    cols = int((x1 - x0) / step) + 1
    for iy in range(rows):
        for ix in range(cols):
            cx = x0 + ix * step + (step / 2 if iy % 2 else 0)
            cy = y0 + iy * step
            if cx > x1 or cy > y1:
                continue
            d.ellipse([g(n, cx - r), g(n, cy - r), g(n, cx + r), g(n, cy + r)], fill=col)


def _rays(d, n, cx, cy, col, count=12, length=16):
    from math import cos, pi, sin
    for i in range(count):
        a0 = 2 * pi * i / count
        a1 = a0 + pi / count
        d.polygon([(g(n, cx), g(n, cy)),
                   (g(n, cx + length * cos(a0)), g(n, cy + length * sin(a0))),
                   (g(n, cx + length * cos(a1)), g(n, cy + length * sin(a1)))], fill=col)


def _star(d, n, cx, cy, r, col, points=10, inner=0.5):
    from math import cos, pi, sin
    pts = []
    for i in range(points * 2):
        a = pi * i / points - pi / 2
        rad = r if i % 2 == 0 else r * inner
        pts.append((g(n, cx + rad * cos(a)), g(n, cy + rad * sin(a))))
    d.polygon(pts, fill=col)


def _bubble(d, n, box, col):
    x0, y0, x1, y1 = box
    d.rounded_rectangle([g(n, x0), g(n, y0), g(n, x1), g(n, y1 - (y1 - y0) * 0.26)],
                        radius=g(n, (y1 - y0) * 0.30), fill=col)
    d.polygon([(g(n, x0 + (x1 - x0) * 0.22), g(n, y1 - (y1 - y0) * 0.34)),
               (g(n, x0 + (x1 - x0) * 0.52), g(n, y1 - (y1 - y0) * 0.34)),
               (g(n, x0 + (x1 - x0) * 0.26), g(n, y1))], fill=col)


P = (3.0, 2.0, 13.0, 15.0)   # the page's own box, from round12


def art_panels(d, n):
    d.rectangle([g(n, 0), g(n, 0), g(n, 16), g(n, 16)], fill=PAPER)
    cols = (RED, YELLOW, BLUE)
    for i, c in enumerate(cols):
        y = P[1] + 0.6 + i * 4.2
        d.rounded_rectangle([g(n, P[0] + 0.6), g(n, y), g(n, P[2] - 0.6), g(n, y + 3.6)],
                            radius=g(n, 0.3), fill=c)


def art_panels_halftone(d, n):
    art_panels(d, n)
    _halftone(d, n, (P[0] + 1.0, P[1] + 1.0, P[2] - 1.0, P[1] + 4.0), YELLOW, 1.1, 0.30)


def art_burst(d, n):
    d.rectangle([g(n, 0), g(n, 0), g(n, 16), g(n, 16)], fill=RED)
    _rays(d, n, 8, 9, (231, 96, 86), 14, 14)
    _star(d, n, 8, 9, 5.0, YELLOW)
    _star(d, n, 8, 9, 3.2, PAPER)


def art_sunburst_bubble(d, n):
    d.rectangle([g(n, 0), g(n, 0), g(n, 16), g(n, 16)], fill=YELLOW)
    _rays(d, n, 8, 9, (252, 216, 108), 16, 15)
    _bubble(d, n, (P[0] + 0.8, P[1] + 2.6, P[2] - 0.8, P[1] + 9.4), PAPER)


def art_halftone_bubble(d, n):
    d.rectangle([g(n, 0), g(n, 0), g(n, 16), g(n, 16)], fill=PAPER)
    _halftone(d, n, (P[0], P[1], P[2], P[3]), RED, 1.25, 0.36)
    _bubble(d, n, (P[0] + 0.7, P[1] + 3.0, P[2] - 0.7, P[1] + 9.6), (255, 255, 255))


def art_speedlines(d, n):
    d.rectangle([g(n, 0), g(n, 0), g(n, 16), g(n, 16)], fill=BLUE)
    for i in range(7):
        y = P[1] + 0.4 + i * 1.9
        d.polygon([(g(n, P[0]), g(n, y)), (g(n, P[2]), g(n, y - 1.0)),
                   (g(n, P[2]), g(n, y - 0.2)), (g(n, P[0]), g(n, y + 0.8))],
                  fill=(120, 168, 230))
    _star(d, n, 8, 9.5, 4.2, YELLOW, 8, 0.46)


def art_cover(d, n):
    d.rectangle([g(n, 0), g(n, 0), g(n, 16), g(n, 16)], fill=BLUE)
    d.rectangle([g(n, P[0]), g(n, P[1]), g(n, P[2]), g(n, P[1] + 2.6)], fill=RED)
    _rays(d, n, 8, 10.5, (86, 140, 214), 12, 12)
    _star(d, n, 11.0, 6.4, 2.0, YELLOW)
    # A figure: shoulders and a head, which is all that survives shrinking.
    d.ellipse([g(n, 7.0), g(n, 7.4), g(n, 9.0), g(n, 9.4)], fill=INK)
    d.polygon([(g(n, 5.6), g(n, 15.0)), (g(n, 6.6), g(n, 9.6)),
               (g(n, 9.4), g(n, 9.6)), (g(n, 10.4), g(n, 15.0))], fill=INK)


def art_hero_sunburst(d, n):
    d.rectangle([g(n, 0), g(n, 0), g(n, 16), g(n, 16)], fill=YELLOW)
    _rays(d, n, 8, 9, (250, 226, 140), 14, 15)
    d.ellipse([g(n, 6.9), g(n, 5.6), g(n, 9.1), g(n, 7.8)], fill=INK)
    d.polygon([(g(n, 4.8), g(n, 15.0)), (g(n, 6.4), g(n, 8.0)),
               (g(n, 9.6), g(n, 8.0)), (g(n, 11.2), g(n, 15.0))], fill=INK)
    d.polygon([(g(n, 6.4), g(n, 8.0)), (g(n, 3.8), g(n, 13.0)),
               (g(n, 5.2), g(n, 13.4))], fill=RED)
    d.polygon([(g(n, 9.6), g(n, 8.0)), (g(n, 12.2), g(n, 13.0)),
               (g(n, 10.8), g(n, 13.4))], fill=RED)


def art_mask(d, n):
    d.rectangle([g(n, 0), g(n, 0), g(n, 16), g(n, 16)], fill=PAPER)
    _halftone(d, n, (P[0], P[1], P[2], P[3]), (240, 200, 190), 1.2, 0.40)
    d.rounded_rectangle([g(n, 3.8), g(n, 6.6), g(n, 12.2), g(n, 10.4)],
                        radius=g(n, 1.6), fill=RED)
    for cx in (6.1, 9.9):
        d.ellipse([g(n, cx - 1.15), g(n, 7.5), g(n, cx + 1.15), g(n, 9.5)], fill=PAPER)


def art_magenta_panels(d, n):
    """The owner's picked comic colour as the ground, since he chose it."""
    d.rectangle([g(n, 0), g(n, 0), g(n, 16), g(n, 16)], fill=MAGENTA)
    _halftone(d, n, (P[0], P[1], P[2], P[3]), (208, 108, 154), 1.3, 0.38)
    d.rounded_rectangle([g(n, P[0] + 0.7), g(n, P[1] + 0.7), g(n, P[2] - 0.7), g(n, P[1] + 5.4)],
                        radius=g(n, 0.3), fill=PAPER)
    _star(d, n, 8, 5.2, 2.4, YELLOW)
    _bubble(d, n, (P[0] + 1.2, P[1] + 7.0, P[2] - 1.2, P[1] + 12.0), PAPER)


def art_panel_action(d, n):
    d.rectangle([g(n, 0), g(n, 0), g(n, 16), g(n, 16)], fill=PAPER)
    d.rounded_rectangle([g(n, P[0] + 0.7), g(n, P[1] + 0.7), g(n, P[2] - 0.7), g(n, P[1] + 6.0)],
                        radius=g(n, 0.3), fill=BLUE)
    _rays(d, n, 8, 5.6, (104, 156, 220), 12, 8)
    _star(d, n, 8, 5.6, 2.6, YELLOW)
    d.rounded_rectangle([g(n, P[0] + 0.7), g(n, P[1] + 6.8), g(n, P[2] - 0.7), g(n, P[3] - 0.7)],
                        radius=g(n, 0.3), fill=RED)
    _bubble(d, n, (P[0] + 1.4, P[1] + 7.6, P[2] - 1.6, P[1] + 11.6), PAPER)


COMICS = [
    ("panels", "Three colour panels", art_panels),
    ("panelshalf", "Panels with halftone", art_panels_halftone),
    ("burst", "Star burst on red", art_burst),
    ("sunbubble", "Sunburst and a balloon", art_sunburst_bubble),
    ("halfbubble", "Halftone and a balloon", art_halftone_bubble),
    ("speed", "Speed lines and a burst", art_speedlines),
    ("cover", "Cover: title bar and a figure", art_cover),
    ("hero", "Caped figure on a sunburst", art_hero_sunburst),
    ("mask", "Domino mask on halftone", art_mask),
    ("magenta", "Your magenta, halftoned", art_magenta_panels),
    ("action", "Two panels, action and talk", art_panel_action),
]


def comic_flat(size, art, ext="CBZ"):
    """Artwork inside the page, then the fold and the chip on top.

    Comic is the ONE kind whose label is DRAWN rather than knocked out. On every
    other kind the letters are a hole with the flat page colour behind them,
    which is what keeps the set to two colours; here there is no single colour
    behind the chip - there is artwork, and where the chip overhangs the page
    there is nothing at all - so a hole would read as a rip rather than a word.
    """
    n = size * S
    art_img = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    art(ImageDraw.Draw(art_img), n)
    out = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    out.paste(art_img, (0, 0), page_mask(n))

    d = ImageDraw.Draw(out)
    K = tuple(INK) + (255,)
    d.polygon([(g(n, 10.0), g(n, 2.0)), (g(n, 13.0), g(n, 5.0)),
               (g(n, 10.0), g(n, 5.0))], fill=K)
    d.rounded_rectangle([g(n, CHIP[0]), g(n, CHIP[1]), g(n, CHIP[2]), g(n, CHIP[3])],
                        radius=g(n, 0.7), fill=K)
    (tx, ty), f = _label_at(n, ext, CHIP)
    d.text((tx, ty), ext, font=f, fill=PAPER + (255,), anchor="mm")
    return out.resize((size, size), Image.LANCZOS)


SIZES = (16, 20, 24, 32, 48)
HERO = 96


CANDIDATES = {
    "archive": [(k, l, (lambda s, S=sil, I=ink: archive_flat(s, S, I, NEUTRAL)))
                for k, l, sil, ink in ARCHIVES],
    "comic": [(k, l, (lambda s, A=art: comic_flat(s, A))) for k, l, art in COMICS],
}
FILENAMES = {"archive": "backup-2026.zip", "comic": "issue-012.cbz"}
SECTIONS = {
    "archive": "Containers, not pages. Landscape rather than portrait, and the "
               "chip sits LOW because every container's identity lives at its "
               "top. Shown in a neutral slate: colour is a separate question, "
               "and your yellow has a problem the footer measures.",
    "comic": "The same page and chip, with actual comic artwork instead of a "
             "flat fill. This is the one kind that is not two colours, so it "
             "cannot be live-tinted - its ground is baked per candidate.",
}


def caption(kind, key):
    from round12 import contrast_note
    for k, _l, fn in CANDIDATES[kind]:
        if k == key:
            return contrast_note(fn(16))
    return ""


def main(out_dir):
    out = pathlib.Path(out_dir) / "round15"
    out.mkdir(parents=True, exist_ok=True)
    for key, _l, sil, inkfn in ARCHIVES:
        for s in SIZES + (HERO,):
            archive_flat(s, sil, inkfn, NEUTRAL).save(out / f"archive-{key}-{s}.png")
        archive_flat(96, sil, inkfn, CHOSEN_YELLOW).save(out / f"archive-{key}-yellow.png")
    for key, _l, art in COMICS:
        for s in SIZES + (HERO,):
            comic_flat(s, art).save(out / f"comic-{key}-{s}.png")
    print(f"{len(ARCHIVES)} archives + {len(COMICS)} comics -> {out}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else ".")
