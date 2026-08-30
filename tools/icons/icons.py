"""Mockups for Prism's per-file-type icons.

Kind-first, in Prism's palette: a near-black rounded tile, a white glyph that
fills most of it, and ONE indigo accent. Drawn at 4x and downsampled, so the
16px rendering is what Explorer's details view would actually show.
"""
import math
from PIL import Image, ImageDraw

S = 4  # supersample
TILE_TOP = (23, 26, 36)
TILE_BOT = (13, 15, 22)
DARK = (13, 15, 22)
WHITE = (233, 237, 247)
GREY = (150, 156, 190)
ACCENT = (91, 91, 214)
ACCENT_HI = (124, 124, 240)


def tile(size):
    n = size * S
    img = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    grad = Image.new("RGBA", (n, n))
    gd = ImageDraw.Draw(grad)
    for y in range(n):
        t = y / max(1, n - 1)
        col = tuple(int(a + (b - a) * t) for a, b in zip(TILE_TOP, TILE_BOT))
        gd.line([(0, y), (n, y)], fill=col + (255,))
    mask = Image.new("L", (n, n), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, n - 1, n - 1], radius=int(n * 0.225), fill=255)
    img.paste(grad, (0, 0), mask)
    return img, ImageDraw.Draw(img), n


def done(img, size):
    return img.resize((size, size), Image.LANCZOS)


# ------------------------------------------------------------------ archive
def archive_box(size):
    img, d, n = tile(size)
    x0, y0, x1, y1 = n * 0.22, n * 0.28, n * 0.78, n * 0.76
    d.rounded_rectangle([x0, y0, x1, y1], radius=n * 0.04, fill=WHITE)
    d.rectangle([x0, y0, x1, y0 + n * 0.12], fill=ACCENT_HI)
    d.rectangle([n * 0.45, y0, n * 0.55, y1], fill=DARK)
    d.rounded_rectangle([n * 0.43, n * 0.44, n * 0.57, n * 0.58], radius=n * 0.02, fill=ACCENT)
    return done(img, size)


def archive_zipfolder(size):
    img, d, n = tile(size)
    d.polygon([(n * 0.16, n * 0.72), (n * 0.16, n * 0.28), (n * 0.44, n * 0.28), (n * 0.50, n * 0.36),
               (n * 0.84, n * 0.36), (n * 0.84, n * 0.72)], fill=WHITE)
    for i in range(5):
        y = n * (0.40 + i * 0.062)
        d.rectangle([n * 0.47, y, n * 0.57, y + n * 0.03], fill=DARK)
    d.rounded_rectangle([n * 0.45, n * 0.70, n * 0.59, n * 0.82], radius=n * 0.025, fill=ACCENT)
    return done(img, size)


def archive_layers(size):
    img, d, n = tile(size)
    for i, col in enumerate((ACCENT, GREY, WHITE)):
        y = n * (0.28 + i * 0.155)
        d.rounded_rectangle([n * 0.18, y, n * 0.82, y + n * 0.13], radius=n * 0.035, fill=col)
    return done(img, size)


def archive_crate(size):
    img, d, n = tile(size)
    d.polygon([(n * 0.5, n * 0.20), (n * 0.86, n * 0.38), (n * 0.5, n * 0.56), (n * 0.14, n * 0.38)], fill=ACCENT_HI)
    d.polygon([(n * 0.14, n * 0.38), (n * 0.5, n * 0.56), (n * 0.5, n * 0.84), (n * 0.14, n * 0.66)], fill=WHITE)
    d.polygon([(n * 0.86, n * 0.38), (n * 0.5, n * 0.56), (n * 0.5, n * 0.84), (n * 0.86, n * 0.66)], fill=GREY)
    return done(img, size)


def archive_zippull(size):
    img, d, n = tile(size)
    d.rounded_rectangle([n * 0.22, n * 0.20, n * 0.78, n * 0.82], radius=n * 0.06, fill=WHITE)
    for i in range(7):
        y = n * (0.24 + i * 0.078)
        d.rectangle([n * 0.39, y, n * 0.61, y + n * 0.036], fill=DARK)
    d.rounded_rectangle([n * 0.43, n * 0.60, n * 0.57, n * 0.76], radius=n * 0.03, fill=ACCENT)
    return done(img, size)


# -------------------------------------------------------------------- video
def video_play(size):
    img, d, n = tile(size)
    d.polygon([(n * 0.34, n * 0.22), (n * 0.34, n * 0.78), (n * 0.80, n * 0.50)], fill=WHITE)
    return done(img, size)


def video_filmstrip(size):
    img, d, n = tile(size)
    d.rounded_rectangle([n * 0.14, n * 0.26, n * 0.86, n * 0.74], radius=n * 0.05, fill=WHITE)
    for i in range(4):
        x = n * (0.20 + i * 0.17)
        d.rounded_rectangle([x, n * 0.30, x + n * 0.075, n * 0.39], radius=n * 0.015, fill=DARK)
        d.rounded_rectangle([x, n * 0.61, x + n * 0.075, n * 0.70], radius=n * 0.015, fill=DARK)
    d.rectangle([n * 0.14, n * 0.44, n * 0.86, n * 0.56], fill=ACCENT)
    return done(img, size)


def video_clapper(size):
    img, d, n = tile(size)
    d.rounded_rectangle([n * 0.14, n * 0.42, n * 0.86, n * 0.80], radius=n * 0.05, fill=WHITE)
    d.polygon([(n * 0.14, n * 0.40), (n * 0.82, n * 0.20), (n * 0.87, n * 0.34), (n * 0.19, n * 0.54)], fill=ACCENT_HI)
    for i in range(3):
        x = n * (0.26 + i * 0.21)
        d.polygon([(x, n * 0.31), (x + n * 0.07, n * 0.29), (x + n * 0.04, n * 0.43), (x - n * 0.03, n * 0.45)],
                  fill=DARK)
    return done(img, size)


def video_framed_play(size):
    img, d, n = tile(size)
    d.rounded_rectangle([n * 0.16, n * 0.22, n * 0.84, n * 0.78], radius=n * 0.08,
                        outline=WHITE, width=int(n * 0.08))
    d.polygon([(n * 0.42, n * 0.35), (n * 0.42, n * 0.65), (n * 0.68, n * 0.50)], fill=ACCENT_HI)
    return done(img, size)


def video_play_circle(size):
    img, d, n = tile(size)
    d.ellipse([n * 0.14, n * 0.14, n * 0.86, n * 0.86], fill=WHITE)
    d.polygon([(n * 0.41, n * 0.32), (n * 0.41, n * 0.68), (n * 0.70, n * 0.50)], fill=DARK)
    d.arc([n * 0.14, n * 0.14, n * 0.86, n * 0.86], 200, 340, fill=ACCENT, width=int(n * 0.07))
    return done(img, size)


# -------------------------------------------------------------------- image
def image_framed(size):
    img, d, n = tile(size)
    d.rounded_rectangle([n * 0.16, n * 0.22, n * 0.84, n * 0.78], radius=n * 0.07, fill=WHITE)
    d.ellipse([n * 0.58, n * 0.30, n * 0.74, n * 0.46], fill=ACCENT)
    d.polygon([(n * 0.20, n * 0.74), (n * 0.42, n * 0.44), (n * 0.62, n * 0.74)], fill=DARK)
    d.polygon([(n * 0.50, n * 0.74), (n * 0.66, n * 0.53), (n * 0.82, n * 0.74)], fill=(60, 64, 84))
    return done(img, size)


def image_stack(size):
    img, d, n = tile(size)
    d.rounded_rectangle([n * 0.30, n * 0.14, n * 0.88, n * 0.60], radius=n * 0.05, fill=GREY)
    d.rounded_rectangle([n * 0.12, n * 0.34, n * 0.70, n * 0.84], radius=n * 0.05, fill=WHITE)
    d.ellipse([n * 0.18, n * 0.40, n * 0.32, n * 0.54], fill=ACCENT)
    d.polygon([(n * 0.16, n * 0.80), (n * 0.38, n * 0.54), (n * 0.58, n * 0.80)], fill=DARK)
    return done(img, size)


def image_aperture(size):
    img, d, n = tile(size)
    d.ellipse([n * 0.16, n * 0.16, n * 0.84, n * 0.84], outline=WHITE, width=int(n * 0.09))
    d.ellipse([n * 0.35, n * 0.35, n * 0.65, n * 0.65], fill=ACCENT)
    return done(img, size)


def image_open_view(size):
    img, d, n = tile(size)
    d.ellipse([n * 0.58, n * 0.18, n * 0.80, n * 0.40], fill=ACCENT)
    d.polygon([(n * 0.10, n * 0.80), (n * 0.40, n * 0.34), (n * 0.70, n * 0.80)], fill=WHITE)
    d.polygon([(n * 0.52, n * 0.80), (n * 0.72, n * 0.50), (n * 0.92, n * 0.80)], fill=GREY)
    return done(img, size)


def image_polaroid(size):
    img, d, n = tile(size)
    d.rounded_rectangle([n * 0.16, n * 0.16, n * 0.84, n * 0.84], radius=n * 0.05, fill=WHITE)
    d.rectangle([n * 0.23, n * 0.23, n * 0.77, n * 0.63], fill=DARK)
    d.ellipse([n * 0.60, n * 0.28, n * 0.71, n * 0.39], fill=ACCENT)
    d.polygon([(n * 0.25, n * 0.61), (n * 0.42, n * 0.38), (n * 0.59, n * 0.61)], fill=GREY)
    return done(img, size)


# -------------------------------------------------------------------- audio
def audio_note(size):
    img, d, n = tile(size)
    d.rectangle([n * 0.46, n * 0.18, n * 0.55, n * 0.66], fill=WHITE)
    d.polygon([(n * 0.46, n * 0.18), (n * 0.80, n * 0.27), (n * 0.80, n * 0.41), (n * 0.46, n * 0.32)],
              fill=ACCENT_HI)
    d.ellipse([n * 0.24, n * 0.56, n * 0.55, n * 0.82], fill=WHITE)
    return done(img, size)


def audio_bars(size):
    img, d, n = tile(size)
    for i, h in enumerate((0.30, 0.54, 0.76, 0.44, 0.24)):
        x = n * (0.16 + i * 0.145)
        col = ACCENT if i == 2 else WHITE
        d.rounded_rectangle([x, n * 0.5 - n * h / 2, x + n * 0.095, n * 0.5 + n * h / 2],
                            radius=n * 0.045, fill=col)
    return done(img, size)


def audio_speaker(size):
    img, d, n = tile(size)
    d.polygon([(n * 0.18, n * 0.40), (n * 0.32, n * 0.40), (n * 0.52, n * 0.22), (n * 0.52, n * 0.78),
               (n * 0.32, n * 0.60), (n * 0.18, n * 0.60)], fill=WHITE)
    d.arc([n * 0.46, n * 0.30, n * 0.76, n * 0.70], 300, 60, fill=ACCENT, width=int(n * 0.07))
    d.arc([n * 0.52, n * 0.20, n * 0.92, n * 0.80], 300, 60, fill=ACCENT_HI, width=int(n * 0.055))
    return done(img, size)


def audio_disc(size):
    img, d, n = tile(size)
    d.ellipse([n * 0.14, n * 0.14, n * 0.86, n * 0.86], fill=WHITE)
    d.ellipse([n * 0.42, n * 0.42, n * 0.58, n * 0.58], fill=DARK)
    d.arc([n * 0.24, n * 0.24, n * 0.76, n * 0.76], 20, 160, fill=ACCENT, width=int(n * 0.06))
    return done(img, size)


def audio_wave(size):
    img, d, n = tile(size)
    pts = []
    for i in range(101):
        t = i / 100
        x = n * (0.12 + t * 0.76)
        y = n * (0.5 - 0.26 * math.sin(t * math.pi * 3) * (0.35 + 0.65 * math.sin(t * math.pi)))
        pts.append((x, y))
    d.line(pts, fill=WHITE, width=int(n * 0.08), joint="curve")
    d.ellipse([n * 0.45, n * 0.45, n * 0.55, n * 0.55], fill=ACCENT)
    return done(img, size)


# ----------------------------------------------------------------- document
def doc_folded(size):
    img, d, n = tile(size)
    d.polygon([(n * 0.24, n * 0.14), (n * 0.60, n * 0.14), (n * 0.78, n * 0.32), (n * 0.78, n * 0.86),
               (n * 0.24, n * 0.86)], fill=WHITE)
    d.polygon([(n * 0.60, n * 0.14), (n * 0.78, n * 0.32), (n * 0.60, n * 0.32)], fill=GREY)
    for i in range(3):
        y = n * (0.46 + i * 0.12)
        d.rectangle([n * 0.32, y, n * 0.70, y + n * 0.05], fill=DARK)
    return done(img, size)


def doc_titled(size):
    img, d, n = tile(size)
    d.rounded_rectangle([n * 0.24, n * 0.14, n * 0.76, n * 0.86], radius=n * 0.05, fill=WHITE)
    d.rectangle([n * 0.32, n * 0.26, n * 0.68, n * 0.37], fill=ACCENT)
    for i in range(3):
        y = n * (0.48 + i * 0.13)
        d.rectangle([n * 0.32, y, n * 0.68, y + n * 0.055], fill=DARK)
    return done(img, size)


def doc_book(size):
    img, d, n = tile(size)
    d.polygon([(n * 0.10, n * 0.24), (n * 0.48, n * 0.32), (n * 0.48, n * 0.84), (n * 0.10, n * 0.76)], fill=WHITE)
    d.polygon([(n * 0.90, n * 0.24), (n * 0.52, n * 0.32), (n * 0.52, n * 0.84), (n * 0.90, n * 0.76)], fill=GREY)
    d.rectangle([n * 0.46, n * 0.30, n * 0.54, n * 0.86], fill=ACCENT)
    return done(img, size)


def doc_header(size):
    img, d, n = tile(size)
    d.rounded_rectangle([n * 0.22, n * 0.14, n * 0.78, n * 0.86], radius=n * 0.05, fill=WHITE)
    d.rectangle([n * 0.22, n * 0.14, n * 0.78, n * 0.32], fill=ACCENT)
    for i in range(4):
        y = n * (0.42 + i * 0.115)
        w = 0.48 if i < 3 else 0.28
        d.rectangle([n * 0.30, y, n * (0.30 + w), y + n * 0.05], fill=DARK)
    return done(img, size)


def doc_pages(size):
    img, d, n = tile(size)
    d.rounded_rectangle([n * 0.32, n * 0.10, n * 0.86, n * 0.72], radius=n * 0.04, fill=GREY)
    d.rounded_rectangle([n * 0.16, n * 0.26, n * 0.70, n * 0.88], radius=n * 0.04, fill=WHITE)
    d.rectangle([n * 0.24, n * 0.34, n * 0.48, n * 0.40], fill=ACCENT)
    for i in range(3):
        y = n * (0.48 + i * 0.12)
        d.rectangle([n * 0.24, y, n * 0.62, y + n * 0.05], fill=DARK)
    return done(img, size)


# --------------------------------------------------------------------- text
def text_brackets(size):
    img, d, n = tile(size)
    w = int(n * 0.09)
    d.line([(n * 0.38, n * 0.24), (n * 0.16, n * 0.50), (n * 0.38, n * 0.76)], fill=WHITE, width=w, joint="curve")
    d.line([(n * 0.62, n * 0.24), (n * 0.84, n * 0.50), (n * 0.62, n * 0.76)], fill=WHITE, width=w, joint="curve")
    d.line([(n * 0.57, n * 0.20), (n * 0.43, n * 0.80)], fill=ACCENT, width=int(n * 0.075))
    return done(img, size)


def text_page_code(size):
    img, d, n = tile(size)
    d.rounded_rectangle([n * 0.20, n * 0.14, n * 0.80, n * 0.86], radius=n * 0.05, fill=WHITE)
    w = int(n * 0.06)
    d.line([(n * 0.42, n * 0.36), (n * 0.31, n * 0.50), (n * 0.42, n * 0.64)], fill=DARK, width=w, joint="curve")
    d.line([(n * 0.58, n * 0.36), (n * 0.69, n * 0.50), (n * 0.58, n * 0.64)], fill=DARK, width=w, joint="curve")
    d.line([(n * 0.55, n * 0.32), (n * 0.45, n * 0.68)], fill=ACCENT, width=int(n * 0.05))
    return done(img, size)


def text_prompt(size):
    img, d, n = tile(size)
    w = int(n * 0.095)
    d.line([(n * 0.22, n * 0.30), (n * 0.46, n * 0.50), (n * 0.22, n * 0.70)], fill=WHITE, width=w, joint="curve")
    d.rounded_rectangle([n * 0.54, n * 0.62, n * 0.82, n * 0.71], radius=n * 0.04, fill=ACCENT)
    return done(img, size)


def text_lines(size):
    img, d, n = tile(size)
    rows = ((0.16, 0.54, WHITE), (0.28, 0.42, WHITE), (0.28, 0.56, GREY), (0.16, 0.48, ACCENT), (0.16, 0.32, WHITE))
    for i, (x, w, col) in enumerate(rows):
        y = n * (0.22 + i * 0.13)
        d.rounded_rectangle([n * x, y, n * (x + w), y + n * 0.075], radius=n * 0.037, fill=col)
    return done(img, size)


def text_page_lines(size):
    img, d, n = tile(size)
    d.rounded_rectangle([n * 0.20, n * 0.12, n * 0.80, n * 0.88], radius=n * 0.05, fill=WHITE)
    rows = ((0.28, 0.28, ACCENT), (0.28, 0.44, DARK), (0.36, 0.36, DARK), (0.36, 0.28, DARK), (0.28, 0.40, DARK))
    for i, (x, w, col) in enumerate(rows):
        y = n * (0.24 + i * 0.115)
        d.rounded_rectangle([n * x, y, n * (x + w), y + n * 0.06], radius=n * 0.028, fill=col)
    return done(img, size)


KINDS = {
    "archive": [("box", archive_box), ("zip folder", archive_zipfolder), ("layers", archive_layers),
                ("crate", archive_crate), ("zip pull", archive_zippull)],
    "video": [("play", video_play), ("film strip", video_filmstrip), ("clapper", video_clapper),
              ("framed play", video_framed_play), ("play disc", video_play_circle)],
    "image": [("framed view", image_framed), ("photo stack", image_stack), ("aperture", image_aperture),
              ("open view", image_open_view), ("polaroid", image_polaroid)],
    "audio": [("note", audio_note), ("bars", audio_bars), ("speaker", audio_speaker), ("disc", audio_disc),
              ("wave", audio_wave)],
    "document": [("folded page", doc_folded), ("titled page", doc_titled), ("book", doc_book),
                 ("header page", doc_header), ("two pages", doc_pages)],
    "text": [("brackets", text_brackets), ("page + code", text_page_code), ("prompt", text_prompt),
             ("code lines", text_lines), ("page + lines", text_page_lines)],
}
