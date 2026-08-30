"""Round two: fresh archive concepts, single-note audio, wider code glyphs.

Round one settled video (film strip) and image (framed view). Archive was
rejected outright, audio kept its idea and lost its drawing, and the code
glyphs were too tall for their width. Same palette and same 4x supersample
as icons.py, so the two sheets are comparable.
"""
from PIL import Image, ImageDraw

from icons import S, DARK, WHITE, GREY, ACCENT, ACCENT_HI, tile, done


def tilted(img, cx, cy, rx, ry, angle, fill):
    """An ellipse rotated about its own centre, which PIL cannot draw directly."""
    pad = int(max(rx, ry) * 2)
    w, h = int(rx * 2) + pad, int(ry * 2) + pad
    layer = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    ImageDraw.Draw(layer).ellipse(
        [pad / 2, pad / 2, pad / 2 + rx * 2, pad / 2 + ry * 2], fill=fill
    )
    layer = layer.rotate(angle, resample=Image.BICUBIC, expand=True)
    img.alpha_composite(layer, (int(cx - layer.width / 2), int(cy - layer.height / 2)))


# ------------------------------------------------------------------ archive
def arc_compress(size):
    """What an archive IS: the same thing, squeezed."""
    img, d, n = tile(size)
    d.rounded_rectangle([n * 0.16, n * 0.42, n * 0.84, n * 0.58], radius=n * 0.035, fill=WHITE)
    w = int(n * 0.075)
    d.line([(n * 0.30, n * 0.20), (n * 0.50, n * 0.34), (n * 0.70, n * 0.20)], fill=ACCENT_HI, width=w, joint="curve")
    d.line([(n * 0.30, n * 0.80), (n * 0.50, n * 0.66), (n * 0.70, n * 0.80)], fill=ACCENT_HI, width=w, joint="curve")
    return done(img, size)


def arc_parcel(size):
    """A tied parcel: one shape, two straps, unmistakable at any size."""
    img, d, n = tile(size)
    d.rounded_rectangle([n * 0.16, n * 0.22, n * 0.84, n * 0.78], radius=n * 0.06, fill=WHITE)
    d.rectangle([n * 0.44, n * 0.22, n * 0.56, n * 0.78], fill=ACCENT)
    d.rectangle([n * 0.16, n * 0.44, n * 0.84, n * 0.56], fill=ACCENT)
    return done(img, size)


def arc_cabinet(size):
    """The filing cabinet: things put away, in order."""
    img, d, n = tile(size)
    d.rounded_rectangle([n * 0.20, n * 0.16, n * 0.80, n * 0.84], radius=n * 0.05, fill=WHITE)
    for i, col in enumerate((GREY, GREY, ACCENT)):
        y = n * (0.24 + i * 0.205)
        d.rounded_rectangle([n * 0.29, y, n * 0.71, y + n * 0.055], radius=n * 0.025, fill=col)
    return done(img, size)


def arc_vault(size):
    """A box you need the combination for: says compressed AND says locked."""
    img, d, n = tile(size)
    d.rounded_rectangle([n * 0.16, n * 0.20, n * 0.84, n * 0.80], radius=n * 0.07, fill=WHITE)
    d.ellipse([n * 0.34, n * 0.34, n * 0.66, n * 0.66], fill=DARK)
    d.ellipse([n * 0.41, n * 0.41, n * 0.59, n * 0.59], fill=ACCENT_HI)
    d.rectangle([n * 0.475, n * 0.14, n * 0.525, n * 0.36], fill=WHITE)
    return done(img, size)


def arc_clipped(size):
    """A bundle of files held together, which is what a zip is."""
    img, d, n = tile(size)
    d.rounded_rectangle([n * 0.26, n * 0.26, n * 0.80, n * 0.86], radius=n * 0.045, fill=GREY)
    d.rounded_rectangle([n * 0.18, n * 0.18, n * 0.72, n * 0.78], radius=n * 0.045, fill=WHITE)
    d.rounded_rectangle([n * 0.36, n * 0.10, n * 0.54, n * 0.40], radius=n * 0.045, outline=ACCENT_HI, width=int(n * 0.07))
    return done(img, size)


def arc_packed(size):
    """Contents packed tight into one container: the thing itself, not a metaphor."""
    img, d, n = tile(size)
    d.rounded_rectangle([n * 0.16, n * 0.16, n * 0.84, n * 0.84], radius=n * 0.07, outline=WHITE, width=int(n * 0.075))
    d.rounded_rectangle([n * 0.28, n * 0.28, n * 0.48, n * 0.48], radius=n * 0.025, fill=WHITE)
    d.rounded_rectangle([n * 0.52, n * 0.28, n * 0.72, n * 0.48], radius=n * 0.025, fill=ACCENT_HI)
    d.rounded_rectangle([n * 0.28, n * 0.52, n * 0.72, n * 0.72], radius=n * 0.025, fill=WHITE)
    return done(img, size)


def arc_lidajar(size):
    """An archive box with its lid off, the way a storage box is drawn."""
    img, d, n = tile(size)
    d.rounded_rectangle([n * 0.18, n * 0.42, n * 0.82, n * 0.84], radius=n * 0.05, fill=WHITE)
    d.rounded_rectangle([n * 0.12, n * 0.24, n * 0.88, n * 0.40], radius=n * 0.045, fill=ACCENT_HI)
    d.rounded_rectangle([n * 0.41, n * 0.52, n * 0.59, n * 0.60], radius=n * 0.03, fill=DARK)
    return done(img, size)


def arc_intobox(size):
    """The universal archive verb: put this away."""
    img, d, n = tile(size)
    d.polygon([(n * 0.14, n * 0.54), (n * 0.34, n * 0.54), (n * 0.42, n * 0.66),
               (n * 0.58, n * 0.66), (n * 0.66, n * 0.54), (n * 0.86, n * 0.54),
               (n * 0.86, n * 0.84), (n * 0.14, n * 0.84)], fill=WHITE)
    d.rectangle([n * 0.44, n * 0.14, n * 0.56, n * 0.36], fill=ACCENT_HI)
    d.polygon([(n * 0.34, n * 0.32), (n * 0.66, n * 0.32), (n * 0.50, n * 0.50)], fill=ACCENT_HI)
    return done(img, size)


def arc_case(size):
    """A hard case: a container with a handle reads as a container instantly."""
    img, d, n = tile(size)
    d.rounded_rectangle([n * 0.36, n * 0.14, n * 0.64, n * 0.34], radius=n * 0.04, outline=ACCENT_HI, width=int(n * 0.065))
    d.rounded_rectangle([n * 0.12, n * 0.30, n * 0.88, n * 0.82], radius=n * 0.07, fill=WHITE)
    d.rectangle([n * 0.12, n * 0.50, n * 0.88, n * 0.58], fill=DARK)
    d.rounded_rectangle([n * 0.43, n * 0.46, n * 0.57, n * 0.62], radius=n * 0.03, fill=ACCENT)
    return done(img, size)


# -------------------------------------------------------------------- audio
def note_quarter(size):
    """One note, upright and geometric. Head white, stem the accent."""
    img, d, n = tile(size)
    d.rectangle([n * 0.545, n * 0.22, n * 0.625, n * 0.70], fill=ACCENT_HI)
    d.ellipse([n * 0.235, n * 0.575, n * 0.625, n * 0.825], fill=WHITE)
    return done(img, size)


def note_eighth(size):
    """The engraved note: tilted head, straight stem, one flag."""
    img, d, n = tile(size)
    d.rectangle([n * 0.555, n * 0.18, n * 0.635, n * 0.68], fill=WHITE)
    d.polygon([(n * 0.635, n * 0.18), (n * 0.86, n * 0.34), (n * 0.86, n * 0.50),
               (n * 0.635, n * 0.36)], fill=ACCENT_HI)
    tilted(img, n * 0.42, n * 0.71, n * 0.20, n * 0.145, 22, WHITE)
    return done(img, size)


def note_accent_head(size):
    """Inverted weighting: the head carries the accent, the note carries the white."""
    img, d, n = tile(size)
    d.rectangle([n * 0.555, n * 0.20, n * 0.635, n * 0.68], fill=WHITE)
    d.polygon([(n * 0.635, n * 0.20), (n * 0.84, n * 0.35), (n * 0.84, n * 0.49),
               (n * 0.635, n * 0.36)], fill=WHITE)
    tilted(img, n * 0.42, n * 0.71, n * 0.205, n * 0.15, 22, ACCENT_HI)
    return done(img, size)


def note_hollow(size):
    """A half note: the hole survives 16px better than a flag does."""
    img, d, n = tile(size)
    d.rectangle([n * 0.585, n * 0.20, n * 0.665, n * 0.70], fill=WHITE)
    tilted(img, n * 0.44, n * 0.72, n * 0.215, n * 0.16, 22, WHITE)
    tilted(img, n * 0.44, n * 0.72, n * 0.105, n * 0.062, 22, ACCENT)
    return done(img, size)


def note_curved_flag(size):
    """A longer, curved flag: the most musical of the set, the most to lose small."""
    img, d, n = tile(size)
    d.rectangle([n * 0.545, n * 0.16, n * 0.625, n * 0.67], fill=WHITE)
    d.polygon([(n * 0.625, n * 0.16), (n * 0.88, n * 0.30), (n * 0.86, n * 0.56),
               (n * 0.80, n * 0.40), (n * 0.625, n * 0.31)], fill=ACCENT_HI)
    tilted(img, n * 0.41, n * 0.70, n * 0.205, n * 0.15, 22, WHITE)
    return done(img, size)


def note_bold(size):
    """Maximum weight, minimum detail: built for 16px first."""
    img, d, n = tile(size)
    d.rectangle([n * 0.56, n * 0.16, n * 0.68, n * 0.66], fill=WHITE)
    d.polygon([(n * 0.68, n * 0.16), (n * 0.88, n * 0.28), (n * 0.88, n * 0.46),
               (n * 0.68, n * 0.34)], fill=ACCENT_HI)
    d.ellipse([n * 0.20, n * 0.54, n * 0.68, n * 0.86], fill=WHITE)
    return done(img, size)


# --------------------------------------------------------------------- code
def code_wide(size):
    """Round one's brackets, spread wide and made short."""
    img, d, n = tile(size)
    w = int(n * 0.085)
    d.line([(n * 0.34, n * 0.34), (n * 0.13, n * 0.50), (n * 0.34, n * 0.66)], fill=WHITE, width=w, joint="curve")
    d.line([(n * 0.66, n * 0.34), (n * 0.87, n * 0.50), (n * 0.66, n * 0.66)], fill=WHITE, width=w, joint="curve")
    d.line([(n * 0.565, n * 0.28), (n * 0.435, n * 0.72)], fill=ACCENT_HI, width=w, joint="curve")
    return done(img, size)


def code_wide_heavy(size):
    """The same, with the stroke weight a 16px grid actually wants."""
    img, d, n = tile(size)
    w = int(n * 0.115)
    d.line([(n * 0.36, n * 0.33), (n * 0.14, n * 0.50), (n * 0.36, n * 0.67)], fill=WHITE, width=w, joint="curve")
    d.line([(n * 0.64, n * 0.33), (n * 0.86, n * 0.50), (n * 0.64, n * 0.67)], fill=WHITE, width=w, joint="curve")
    d.line([(n * 0.555, n * 0.30), (n * 0.445, n * 0.70)], fill=ACCENT_HI, width=w, joint="curve")
    return done(img, size)


def code_chevrons(size):
    """No slash at all: two marks, as wide as the tile allows."""
    img, d, n = tile(size)
    w = int(n * 0.115)
    d.line([(n * 0.40, n * 0.30), (n * 0.13, n * 0.50), (n * 0.40, n * 0.70)], fill=WHITE, width=w, joint="curve")
    d.line([(n * 0.60, n * 0.30), (n * 0.87, n * 0.50), (n * 0.60, n * 0.70)], fill=ACCENT_HI, width=w, joint="curve")
    return done(img, size)


def code_page_wide(size):
    """Round one's page, with the glyph rebuilt wide inside it."""
    img, d, n = tile(size)
    d.rounded_rectangle([n * 0.18, n * 0.12, n * 0.82, n * 0.88], radius=n * 0.06, fill=WHITE)
    w = int(n * 0.075)
    d.line([(n * 0.42, n * 0.38), (n * 0.28, n * 0.50), (n * 0.42, n * 0.62)], fill=DARK, width=w, joint="curve")
    d.line([(n * 0.58, n * 0.38), (n * 0.72, n * 0.50), (n * 0.58, n * 0.62)], fill=DARK, width=w, joint="curve")
    d.line([(n * 0.535, n * 0.34), (n * 0.465, n * 0.66)], fill=ACCENT, width=w, joint="curve")
    return done(img, size)


def code_page_chevrons(size):
    """Page plus two wide marks, nothing between them to close up small."""
    img, d, n = tile(size)
    d.rounded_rectangle([n * 0.18, n * 0.12, n * 0.82, n * 0.88], radius=n * 0.06, fill=WHITE)
    w = int(n * 0.085)
    d.line([(n * 0.46, n * 0.36), (n * 0.28, n * 0.50), (n * 0.46, n * 0.64)], fill=DARK, width=w, joint="curve")
    d.line([(n * 0.54, n * 0.36), (n * 0.72, n * 0.50), (n * 0.54, n * 0.64)], fill=ACCENT, width=w, joint="curve")
    return done(img, size)


def code_page_band(size):
    """Page with the accent moved to a header band, freeing the glyph to be all white."""
    img, d, n = tile(size)
    d.rounded_rectangle([n * 0.18, n * 0.12, n * 0.82, n * 0.88], radius=n * 0.06, fill=WHITE)
    d.rectangle([n * 0.18, n * 0.12, n * 0.82, n * 0.28], fill=ACCENT)
    d.rounded_rectangle([n * 0.18, n * 0.12, n * 0.82, n * 0.24], radius=n * 0.06, fill=ACCENT)
    w = int(n * 0.085)
    d.line([(n * 0.44, n * 0.44), (n * 0.29, n * 0.58), (n * 0.44, n * 0.72)], fill=DARK, width=w, joint="curve")
    d.line([(n * 0.56, n * 0.44), (n * 0.71, n * 0.58), (n * 0.56, n * 0.72)], fill=DARK, width=w, joint="curve")
    return done(img, size)


KINDS = {
    "archive": [
        ("compress", arc_compress),
        ("parcel", arc_parcel),
        ("cabinet", arc_cabinet),
        ("vault", arc_vault),
        ("clipped", arc_clipped),
        ("packed", arc_packed),
        ("lid ajar", arc_lidajar),
        ("into box", arc_intobox),
        ("case", arc_case),
    ],
    "audio": [
        ("quarter", note_quarter),
        ("eighth", note_eighth),
        ("accent head", note_accent_head),
        ("hollow", note_hollow),
        ("curved flag", note_curved_flag),
        ("bold", note_bold),
    ],
    "code": [
        ("wide", code_wide),
        ("wide heavy", code_wide_heavy),
        ("chevrons", code_chevrons),
        ("page wide", code_page_wide),
        ("page chevrons", code_page_chevrons),
        ("page band", code_page_band),
    ],
}
