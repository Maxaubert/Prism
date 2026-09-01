"""extension -> kind, read from `src/shared/fileKind.ts` rather than restated.

The icon set needs the same table the app decides file kinds with, and there is
no way to import TypeScript into Pillow. So it is PARSED, the way
`fileAssoc.test.ts` parses the installer for the mirror-image check - and the
parse is checked rather than trusted: `kinds()` refuses to return a table that
is implausibly small, because a regex that silently matches nothing would hand
every extension the wrong icon and no test would see an empty set as an error.

Why this exists at all: an .ico carries ONE label, so an icon shared by many
extensions has to print one of their names on all of them. `prism-code.ico`
said PY on 130 extensions, `prism-image.ico` said JPG on 52, and the owner
quite reasonably asked what "PY" was doing on his .log files. One icon per
extension is the only arrangement where the band tells the truth.
"""
import pathlib
import re

SRC = pathlib.Path(__file__).resolve().parents[2] / "src" / "shared" / "fileKind.ts"

# The set in fileKind.ts -> the icon kind it should wear. `pdf` is spelled as a
# literal there rather than as a set, and is added by hand below for that reason.
GROUPS = {
    "IMAGE": "image",
    "VIDEO": "video",
    "AUDIO": "audio",
    "DOC": "document",
    "TEXT": "code",
    "ARCHIVE": "archive",
    "COMIC": "comic",
}


def kinds():
    """{'png': 'image', 'py': 'code', ...} for every viewable extension."""
    src = SRC.read_text(encoding="utf-8")
    out = {}
    for group, kind in GROUPS.items():
        m = re.search(r"const " + group + r" = new Set\(\[(.*?)\]\)", src, re.S)
        if not m:
            raise SystemExit(f"fileKind.ts: no set named {group} - has it been renamed?")
        found = re.findall(r"'\.([a-z0-9]+)'", m.group(1), re.I)
        # Two, not three: COMIC really is only .cbz and .cbr, and a floor set
        # above the smallest real group is a check that fails on correct input.
        if len(found) < 2:
            raise SystemExit(f"fileKind.ts: {group} parsed as {found} - the regex is stale")
        for e in found:
            out[e.lower()] = kind
    out["pdf"] = "document"
    if len(out) < 100:
        raise SystemExit(f"only {len(out)} extensions parsed; fileKind.ts holds far more")
    return out


if __name__ == "__main__":
    k = kinds()
    print(len(k), "extensions")
    for kind in sorted(set(k.values())):
        exts = sorted(e for e, v in k.items() if v == kind)
        print(f"  {kind:9} {len(exts):>3}  {' '.join(exts[:12])}{' ...' if len(exts) > 12 else ''}")
