"""Build build/icon.ico from build/icon-source.png (the APP icon, #186).

This is the icon the window, the taskbar, the installer and the uninstaller
wear. It is NOT the per-extension file icons: those are drawn by
tools/icons/build_icons.py into build/icons, one .ico per ProgID, and nothing
here touches them.

Every frame is RESAMPLED FROM THE FULL-SIZE ARTWORK with LANCZOS rather than
from the frame above it, so the 16px one - the size Explorer's details view and
the taskbar draw all day - is as sharp as the source allows instead of a copy
of a copy.

Run: python tools/make-icon.py
"""

from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / 'build' / 'icon-source.png'
OUT = ROOT / 'build' / 'icon.ico'

SIZES = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256]


def main() -> None:
    src = Image.open(SOURCE).convert('RGBA')
    if src.width != src.height:
        raise SystemExit(f'the source must be square, not {src.width}x{src.height}')
    # A source with an opaque ground would put a white card behind the icon on
    # every dark taskbar, so it is refused rather than shipped.
    if src.getchannel('A').getextrema()[0] == 255:
        raise SystemExit('the source has no transparency: the icon would carry its own background')
    frames = [src.resize((n, n), Image.LANCZOS) for n in SIZES]
    frames[-1].save(OUT, format='ICO', sizes=[(n, n) for n in SIZES])
    print(f'{OUT.relative_to(ROOT)}: {len(SIZES)} frames, {OUT.stat().st_size} bytes')


if __name__ == '__main__':
    main()
