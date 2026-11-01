# Makes gradient.heic, the e2e's HEIC (#474, 2026-11-01): a 640x480 colour
# ramp with an EXIF maker of "SecretCam", so a copy can be checked for no EXIF.
# Neither the bundled ffmpeg nor ImageMagick here can WRITE a HEIC, so it is
# made once and checked in (7 KB, nothing personal in it):
#   uv run --with pillow-heif --with pillow python -I make-gradient-heic.py gradient.heic
import sys
from PIL import Image
import pillow_heif

pillow_heif.register_heif_opener()
w, h = 640, 480
im = Image.new('RGB', (w, h))
px = im.load()
for y in range(h):
    for x in range(w):
        px[x, y] = (x * 255 // w, y * 255 // h, 160)
ex = Image.Exif()
ex[0x010f] = 'SecretCam'
im.save(sys.argv[1], format='HEIF', quality=60, exif=ex.tobytes())
