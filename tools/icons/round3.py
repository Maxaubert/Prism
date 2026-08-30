"""Round three: archive as a bound stack, audio as one properly joined note.

Round two settled code (chevrons). Archive was rejected wholesale in favour of
WinRAR's bound stack of volumes, drawn in Prism's palette. The notes were
right in idea and wrong in construction: head and stem were two shapes laid
over each other, so the join showed. Here the stem's left edge is tangent to
the rotated head's right extremity and its foot sits on the head's centre
line, where the head covers it, and both carry the same fill so there is no
seam to misalign.
"""
import math

from PIL import Image, ImageDraw

from icons import S, DARK, WHITE, GREY, ACCENT, ACCENT_HI, tile, done

TILT = 20  # degrees, the engraved notehead angle


def note(img, n, hx, hy, rx, ry, body, flag=None, flags=1, stem_top=0.16, curve=False):
    """One note as a single joined glyph: head, stem, optional flag(s).

    The stem rises from the head's RIGHT extremity (where a real stem attaches)
    and stops at the head's centre line, so the head covers the joint entirely.
    Head and stem share `body`, so nothing can look misaligned.
    """
    th = math.radians(TILT)
    # Half-width of the rotated ellipse: where the stem must sit.
    half = math.hypot(rx * math.cos(th), ry * math.sin(th))
    w = n * 0.075
    sx1 = hx + half
    sx0 = sx1 - w
    top = n * stem_top

    layer = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    ld = ImageDraw.Draw(layer)
    ld.rectangle([sx0, top, sx1, hy], fill=body)
    ImageDraw.Draw(layer).ellipse([0, 0, 0, 0])  # no-op, keeps draw alive
    img.alpha_composite(layer)

    # The head goes on last so it owns the joint.
    pad = int(max(rx, ry) * 2)
    hw, hh = int(rx * 2) + pad, int(ry * 2) + pad
    head = Image.new("RGBA", (hw, hh), (0, 0, 0, 0))
    ImageDraw.Draw(head).ellipse([pad / 2, pad / 2, pad / 2 + rx * 2, pad / 2 + ry * 2], fill=body)
    head = head.rotate(TILT, resample=Image.BICUBIC, expand=True)
    img.alpha_composite(head, (int(hx - head.width / 2), int(hy - head.height / 2)))

    if flag:
        d = ImageDraw.Draw(img)
        for i in range(flags):
            oy = i * n * 0.17
            if curve:
                d.polygon([(sx1, top + oy), (sx1 + n * 0.25, top + n * 0.13 + oy),
                           (sx1 + n * 0.23, top + n * 0.38 + oy), (sx1 + n * 0.17, top + n * 0.22 + oy),
                           (sx1, top + n * 0.15 + oy)], fill=flag)
            else:
                d.polygon([(sx1, top + oy), (sx1 + n * 0.24, top + n * 0.15 + oy),
                           (sx1 + n * 0.24, top + n * 0.30 + oy), (sx1, top + n * 0.15 + oy)], fill=flag)


# -------------------------------------------------------------------- audio
def note_eighth(size):
    """The engraved eighth: white note, indigo flag."""
    img, d, n = tile(size)
    note(img, n, n * 0.40, n * 0.70, n * 0.20, n * 0.145, WHITE, ACCENT_HI)
    return done(img, size)


def note_curved(size):
    """The same note with a curved flag, the way it is actually drawn."""
    img, d, n = tile(size)
    note(img, n, n * 0.40, n * 0.70, n * 0.20, n * 0.145, WHITE, ACCENT_HI, curve=True)
    return done(img, size)


def note_indigo(size):
    """Weighting inverted: the note is the accent, the flag is white."""
    img, d, n = tile(size)
    note(img, n, n * 0.40, n * 0.70, n * 0.21, n * 0.155, ACCENT_HI, WHITE)
    return done(img, size)


def note_sixteenth(size):
    """Two flags: more musical, more to lose at 16px."""
    img, d, n = tile(size)
    note(img, n, n * 0.40, n * 0.72, n * 0.195, n * 0.14, WHITE, ACCENT_HI, flags=2, stem_top=0.14)
    return done(img, size)


def note_quarter_waves(size):
    """No flag at all: a plain note, with the accent as sound coming off it."""
    img, d, n = tile(size)
    note(img, n, n * 0.34, n * 0.70, n * 0.195, n * 0.14, WHITE)
    w = int(n * 0.055)
    for i, r in enumerate((0.13, 0.24)):
        box = [n * (0.60 - r), n * (0.42 - r), n * (0.60 + r), n * (0.42 + r)]
        d.arc(box, start=-55, end=55, fill=ACCENT_HI, width=w)
    return done(img, size)


def note_bold(size):
    """Heaviest strokes, biggest head: built for the 16px grid first."""
    img, d, n = tile(size)
    note(img, n, n * 0.38, n * 0.68, n * 0.235, n * 0.175, WHITE, ACCENT_HI, stem_top=0.14)
    return done(img, size)


# ------------------------------------------------------------------ archive
def volume(d, n, x0, y0, x1, y1, fill, spine=True):
    """One bound volume: a slab with a spine band down its leading edge."""
    d.rounded_rectangle([x0, y0, x1, y1], radius=n * 0.028, fill=fill)
    if spine:
        d.rectangle([x0 + n * 0.055, y0 + n * 0.012, x0 + n * 0.077, y1 - n * 0.012], fill=DARK)


def stack_layer(n, strap=False, depth=False):
    """The stack itself, drawn on its own layer so a variant can rotate it."""
    layer = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    rows = ((0.22, WHITE), (0.435, GREY), (0.65, WHITE))
    for i, (y, col) in enumerate(rows):
        inset = n * (0.015 * i)
        volume(d, n, n * 0.14 + inset, n * y, n * 0.86 - inset, n * (y + 0.155), col)
        if depth:
            d.rectangle([n * 0.14 + inset, n * (y + 0.135), n * 0.86 - inset, n * (y + 0.155)], fill=GREY)
    if strap:
        d.rectangle([n * 0.44, n * 0.16, n * 0.56, n * 0.86], fill=ACCENT)
        d.rounded_rectangle([n * 0.40, n * 0.46, n * 0.60, n * 0.60], radius=n * 0.03, fill=ACCENT_HI)
    return layer


def arc_stack(size):
    """Three bound volumes, nothing else."""
    img, d, n = tile(size)
    img.alpha_composite(stack_layer(n))
    d.rectangle([n * 0.14, n * 0.435, n * 0.86, n * 0.59], fill=ACCENT)
    volume(d, n, n * 0.14, n * 0.435, n * 0.86, n * 0.59, ACCENT)
    return done(img, size)


def arc_stack_strap(size):
    """WinRAR's shape: the stack, bound by a strap."""
    img, d, n = tile(size)
    img.alpha_composite(stack_layer(n, strap=True))
    return done(img, size)


def arc_stack_depth(size):
    """The same stack with each volume given thickness."""
    img, d, n = tile(size)
    img.alpha_composite(stack_layer(n, depth=True))
    d = ImageDraw.Draw(img)
    volume(d, n, n * 0.17, n * 0.435, n * 0.83, n * 0.59, ACCENT_HI)
    return done(img, size)


def arc_stack_tilted(size):
    """The stack at WinRAR's jaunty angle."""
    img, d, n = tile(size)
    layer = stack_layer(n).rotate(-9, resample=Image.BICUBIC, center=(n / 2, n / 2))
    img.alpha_composite(layer)
    return done(img, size)


def arc_stack_tilted_strap(size):
    """Tilted, and bound."""
    img, d, n = tile(size)
    layer = stack_layer(n, strap=True).rotate(-9, resample=Image.BICUBIC, center=(n / 2, n / 2))
    img.alpha_composite(layer)
    return done(img, size)


def arc_upright(size):
    """Volumes stood on a shelf, spines out, one leaning."""
    img, d, n = tile(size)
    for i, col in enumerate((WHITE, ACCENT_HI, WHITE)):
        x = n * (0.17 + i * 0.20)
        d.rounded_rectangle([x, n * 0.20, x + n * 0.155, n * 0.80], radius=n * 0.028, fill=col)
        d.rectangle([x + n * 0.02, n * 0.30, x + n * 0.135, n * 0.335], fill=DARK)
    lean = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    ld = ImageDraw.Draw(lean)
    ld.rounded_rectangle([n * 0.66, n * 0.24, n * 0.815, n * 0.80], radius=n * 0.028, fill=WHITE)
    ld.rectangle([n * 0.68, n * 0.34, n * 0.795, n * 0.375], fill=DARK)
    img.alpha_composite(lean.rotate(-11, resample=Image.BICUBIC, center=(n * 0.74, n * 0.80)))
    return done(img, size)


KINDS = {
    "archive": [
        ("stack", arc_stack),
        ("stack + strap", arc_stack_strap),
        ("stack depth", arc_stack_depth),
        ("tilted", arc_stack_tilted),
        ("tilted + strap", arc_stack_tilted_strap),
        ("upright", arc_upright),
    ],
    "audio": [
        ("eighth", note_eighth),
        ("curved flag", note_curved),
        ("indigo note", note_indigo),
        ("sixteenth", note_sixteenth),
        ("quarter + waves", note_quarter_waves),
        ("bold", note_bold),
    ],
}
