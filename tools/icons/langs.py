"""A mark per language, for the code kind (owner pick, round 30, 2026-09-01).

The stepped bars say "this is source" and nothing else, so a React component
and a shell script were the same picture. These say which one.

TWO RULES SHAPED THE SET, and both are worth knowing before adding to it.

THE LETTERS ARE ALREADY TAKEN. The footer band carries the file's extension, so
a mark built out of letterforms - JS in a square, TS in a square, C# - prints
the same information twice and spends the only part of the icon that can say
something else. Every mark here is PICTORIAL, and the languages whose real logos
are letterforms are deliberately absent: they get the stepped bars, which is not
a demotion, because their band already says JS or TS.

WINDOWS ASSOCIATES ON EXTENSION. Docker and Git were drawn and are NOT in
`EXTS`: `Dockerfile`, `Makefile` and `.gitignore` are bare names and dotfiles,
which cannot be registered at all, so a mark for them could never appear in
Explorer. They stay for the IN-APP tree, which resolves by name and can show
them. That asymmetry is real and is recorded in CLAUDE.md, or it reads as a bug.

Everything is FILLED rather than stroked. A hairline outline is the first thing
a 16px frame throws away, and 16px is the frame that decides. Three of the marks
carry a KNOCKOUT in the page colour - the cog's bore, the cylinder's rim, the
cup's handle - and they are not decoration: without them a cog is a flower, a
cylinder is a rounded rectangle and a cup is a blob. Everything about them was
read at 16px before it was kept.
"""
import math

from PIL import Image, ImageDraw

from round12 import lines as doc_lines
from round5 import g


def _c(box):
    """The box's centre and its shorter side, which every mark scales from."""
    x0, y0, x1, y1 = box
    return (x0 + x1) / 2, (y0 + y1) / 2, min(x1 - x0, y1 - y0)


def _hole_colour(hole):
    """The knockout fill, as PIL wants it - or whatever it was, untouched.

    These marks are drawn TWICE by two different callers: the rasteriser, which
    passes real RGB tuples, and svg.py's Recorder, which passes an opaque
    sentinel and only cares WHICH argument a shape was drawn with. So anything
    that is not a three-channel colour is passed straight through rather than
    coerced, or the SVG side dies on `len()` of a sentinel.
    """
    if hole is None:
        return None
    if isinstance(hole, (tuple, list)):
        return tuple(hole) + (255,) if len(hole) == 3 else tuple(hole)
    return hole


def _rect(d, n, x0, y0, x1, y1, col):
    """A rectangle whose corners may be given in any order.

    PIL refuses x1 < x0 rather than sorting, and a mark drawn symmetrically
    about a centre produces exactly that on one of its two halves.
    """
    d.rectangle([g(n, min(x0, x1)), g(n, min(y0, y1)),
                 g(n, max(x0, x1)), g(n, max(y0, y1))], fill=col)


def react(d, n, box, col, _hole=None):
    """The atom: a nucleus and three orbits at 0, 60 and 120 degrees."""
    cx, cy, s = _c(box)
    r = s * 0.46
    for ang in (0, 60, 120):
        ring = Image.new("L", (n, n), 0)
        ImageDraw.Draw(ring).ellipse(
            [g(n, cx - r), g(n, cy - r * 0.38), g(n, cx + r), g(n, cy + r * 0.38)],
            outline=255, width=max(2, int(g(n, s * 0.085))))
        d.bitmap((0, 0), ring.rotate(ang, center=(g(n, cx), g(n, cy))), fill=col)
    d.ellipse([g(n, cx - s * 0.13), g(n, cy - s * 0.13),
               g(n, cx + s * 0.13), g(n, cy + s * 0.13)], fill=col)


def vue(d, n, box, col, hole=None):
    """A V with a second V notched out of its head.

    The notch is knocked out rather than drawn as a second shape, so the two
    chevrons cannot drift apart at any size.
    """
    cx, cy, s = _c(box)
    top, half, depth = cy - s * 0.34, s * 0.44, s * 0.72
    d.polygon([(g(n, cx - half), g(n, top)), (g(n, cx + half), g(n, top)),
               (g(n, cx), g(n, top + depth))], fill=col)
    k = _hole_colour(hole)
    if k:
        f = 0.42
        d.polygon([(g(n, cx - half * f), g(n, top)), (g(n, cx + half * f), g(n, top)),
                   (g(n, cx), g(n, top + depth * f))], fill=k)


def python(d, n, box, col, _hole=None):
    """Two interlocking hooks - the two snakes, at the only scale they survive."""
    cx, cy, s = _c(box)
    a, t = s * 0.40, s * 0.24
    d.rounded_rectangle([g(n, cx - a), g(n, cy - a), g(n, cx + t * 0.2), g(n, cy)],
                        radius=g(n, t * 0.55), fill=col)
    d.rounded_rectangle([g(n, cx - a), g(n, cy - a), g(n, cx - a + t), g(n, cy + a * 0.55)],
                        radius=g(n, t * 0.4), fill=col)
    d.rounded_rectangle([g(n, cx - t * 0.2), g(n, cy), g(n, cx + a), g(n, cy + a)],
                        radius=g(n, t * 0.55), fill=col)
    d.rounded_rectangle([g(n, cx + a - t), g(n, cy - a * 0.55), g(n, cx + a), g(n, cy + a)],
                        radius=g(n, t * 0.4), fill=col)


def cog(d, n, box, col, hole=None):
    """Rust, and configuration generally.

    SIX teeth, not eight, and a knocked-out bore: eight teeth at 16px are eight
    sub-pixel bumps that average into a circle, and a cog with no hole is a
    flower.
    """
    cx, cy, s = _c(box)
    r, tooth = s * 0.34, s * 0.15
    for i in range(6):
        a = math.radians(i * 60)
        dx, dy = math.cos(a) * r, math.sin(a) * r
        d.rounded_rectangle([g(n, cx + dx - tooth), g(n, cy + dy - tooth),
                             g(n, cx + dx + tooth), g(n, cy + dy + tooth)],
                            radius=g(n, tooth * 0.45), fill=col)
    d.ellipse([g(n, cx - r * 0.95), g(n, cy - r * 0.95),
               g(n, cx + r * 0.95), g(n, cy + r * 0.95)], fill=col)
    k = _hole_colour(hole)
    if k:
        b = r * 0.40
        d.ellipse([g(n, cx - b), g(n, cy - b), g(n, cx + b), g(n, cy + b)], fill=k)


def shield(d, n, box, col, _hole=None):
    """The HTML crest, as a silhouette."""
    cx, cy, s = _c(box)
    w, h = s * 0.40, s * 0.46
    d.polygon([(g(n, cx - w), g(n, cy - h)), (g(n, cx + w), g(n, cy - h)),
               (g(n, cx + w * 0.78), g(n, cy + h * 0.42)),
               (g(n, cx), g(n, cy + h)),
               (g(n, cx - w * 0.78), g(n, cy + h * 0.42))], fill=col)


def droplet(d, n, box, col, _hole=None):
    """A drop, for stylesheets - where a second shield would be the same picture."""
    cx, cy, s = _c(box)
    r = s * 0.34
    d.ellipse([g(n, cx - r), g(n, cy - r * 0.55), g(n, cx + r), g(n, cy + r * 1.35)],
              fill=col)
    d.polygon([(g(n, cx), g(n, cy - r * 1.5)), (g(n, cx + r * 0.86), g(n, cy + r * 0.2)),
               (g(n, cx - r * 0.86), g(n, cy + r * 0.2))], fill=col)


def prompt(d, n, box, col, _hole=None):
    """`>_` - a shell script."""
    cx, cy, s = _c(box)
    t = s * 0.13
    d.polygon([(g(n, cx - s * 0.40), g(n, cy - s * 0.30)),
               (g(n, cx - s * 0.40 + t * 1.5), g(n, cy - s * 0.36)),
               (g(n, cx - s * 0.02), g(n, cy - s * 0.02)),
               (g(n, cx - s * 0.40 + t * 1.5), g(n, cy + s * 0.32)),
               (g(n, cx - s * 0.40), g(n, cy + s * 0.26)),
               (g(n, cx - s * 0.16), g(n, cy - s * 0.02))], fill=col)
    d.rectangle([g(n, cx + s * 0.06), g(n, cy + s * 0.20),
                 g(n, cx + s * 0.42), g(n, cy + s * 0.32)], fill=col)


def braces(d, n, box, col, _hole=None):
    """{ } - JSON, YAML and the data formats.

    The arms point INWARD and the middle nub points out, which is what makes a
    pair read as braces rather than as two brackets.
    """
    cx, cy, s = _c(box)
    t, h, arm = s * 0.115, s * 0.36, s * 0.19
    for sign in (-1, 1):
        x = cx + sign * s * 0.30
        _rect(d, n, x - t / 2, cy - h, x + t / 2, cy + h, col)
        for y in (cy - h, cy + h - t):
            _rect(d, n, x, y, x - sign * arm, y + t, col)
        _rect(d, n, x, cy - t / 2, x + sign * arm * 0.7, cy + t / 2, col)


def cylinder(d, n, box, col, hole=None):
    """A database - SQL.

    The rim is KNOCKED OUT rather than drawn: three shapes in one colour merge
    into a rounded rectangle, and a rounded rectangle is not a database.
    """
    cx, cy, s = _c(box)
    w, h, e = s * 0.34, s * 0.30, s * 0.13
    d.rectangle([g(n, cx - w), g(n, cy - h), g(n, cx + w), g(n, cy + h)], fill=col)
    d.ellipse([g(n, cx - w), g(n, cy - h - e), g(n, cx + w), g(n, cy - h + e)], fill=col)
    d.ellipse([g(n, cx - w), g(n, cy + h - e), g(n, cx + w), g(n, cy + h + e)], fill=col)
    k = _hole_colour(hole)
    if k:
        for dy in (-h + e * 1.5, e * 0.2):
            d.ellipse([g(n, cx - w * 0.98), g(n, cy + dy - e * 0.62),
                       g(n, cx + w * 0.98), g(n, cy + dy + e * 0.62)], fill=k)


def cup(d, n, box, col, hole=None):
    """A wide cup with a handle and two wisps of steam - Java."""
    cx, cy, s = _c(box)
    w, h = s * 0.32, s * 0.30
    d.rounded_rectangle([g(n, cx - w), g(n, cy - h * 0.1), g(n, cx + w), g(n, cy + h)],
                        radius=g(n, s * 0.09), fill=col)
    d.ellipse([g(n, cx + w - s * 0.05), g(n, cy + h * 0.05),
               g(n, cx + w + s * 0.22), g(n, cy + h * 0.72)], fill=col)
    k = _hole_colour(hole)
    if k:
        d.ellipse([g(n, cx + w + s * 0.01), g(n, cy + h * 0.22),
                   g(n, cx + w + s * 0.15), g(n, cy + h * 0.55)], fill=k)
    d.rounded_rectangle([g(n, cx - w * 1.1), g(n, cy + h), g(n, cx + w * 1.1),
                         g(n, cy + h + s * 0.10)], radius=g(n, s * 0.04), fill=col)
    for i in (-1, 1):
        d.rounded_rectangle([g(n, cx + i * w * 0.48 - s * 0.055), g(n, cy - h * 1.35),
                             g(n, cx + i * w * 0.48 + s * 0.055), g(n, cy - h * 0.42)],
                            radius=g(n, s * 0.055), fill=col)


def branch(d, n, box, col, _hole=None):
    """Two dots and a fork - version control. IN-APP ONLY; see EXTS."""
    cx, cy, s = _c(box)
    r, t = s * 0.11, s * 0.09
    _rect(d, n, cx - s * 0.22 - t / 2, cy - s * 0.34, cx - s * 0.22 + t / 2, cy + s * 0.34, col)
    _rect(d, n, cx - s * 0.22, cy - t / 2, cx + s * 0.22, cy + t / 2, col)
    for px, py in ((cx - s * 0.22, cy - s * 0.34), (cx - s * 0.22, cy + s * 0.34),
                   (cx + s * 0.22, cy)):
        d.ellipse([g(n, px - r), g(n, py - r), g(n, px + r), g(n, py + r)], fill=col)


def containers(d, n, box, col, _hole=None):
    """Stacked containers on a hull - Docker. IN-APP ONLY; see EXTS."""
    cx, cy, s = _c(box)
    b, gap = s * 0.15, s * 0.03
    for row, count in ((1, 3), (0, 4)):
        for i in range(count):
            x = cx - (count * (b + gap) - gap) / 2 + i * (b + gap)
            y = cy - s * 0.10 - row * (b + gap)
            d.rectangle([g(n, x), g(n, y), g(n, x + b), g(n, y + b)], fill=col)
    d.rounded_rectangle([g(n, cx - s * 0.42), g(n, cy + s * 0.12),
                         g(n, cx + s * 0.42), g(n, cy + s * 0.32)],
                        radius=g(n, s * 0.09), fill=col)


def prose(d, n, box, col, hole=None):
    """Full-width lines: a page of TEXT, not a page of source.

    This is the document kind's own glyph, borrowed on purpose. `.log` and
    `.txt` were getting the code mark - an indent guide, a vertical spine with
    rungs hanging off it - and at 14px a spine with rungs is not a picture of
    structure, it is two letterforms: the owner read it as "PT" and asked what
    the abbreviation meant. Prose has no indentation to draw, so drawing some
    was wrong twice over.
    """
    doc_lines(d, n, box, col, hole)


def gem(d, n, box, col, hole=None):
    """A faceted stone - Ruby.

    The crown facets are knocked out rather than drawn as lines: at 16px a
    hairline between two facets closes up and the stone becomes a hexagon, while
    a hole stays a hole.
    """
    cx, cy, s = _c(box)
    w, top, bot = s * 0.40, cy - s * 0.26, cy + s * 0.40
    d.polygon([(g(n, cx - w), g(n, top)), (g(n, cx + w), g(n, top)),
               (g(n, cx), g(n, bot))], fill=col)
    d.polygon([(g(n, cx - w), g(n, top)), (g(n, cx - w * 0.55), g(n, cy - s * 0.42)),
               (g(n, cx + w * 0.55), g(n, cy - s * 0.42)), (g(n, cx + w), g(n, top))],
              fill=col)
    k = _hole_colour(hole)
    if k:
        d.polygon([(g(n, cx - w * 0.30), g(n, top - s * 0.012)),
                   (g(n, cx + w * 0.30), g(n, top - s * 0.012)),
                   (g(n, cx + w * 0.16), g(n, cy - s * 0.40)),
                   (g(n, cx - w * 0.16), g(n, cy - s * 0.40))], fill=k)


def swoosh(d, n, box, col, _hole=None):
    """A bird's sweep - Swift."""
    cx, cy, s = _c(box)
    d.polygon([(g(n, cx - s * 0.38), g(n, cy + s * 0.34)),
               (g(n, cx + s * 0.10), g(n, cy + s * 0.10)),
               (g(n, cx + s * 0.40), g(n, cy - s * 0.36)),
               (g(n, cx + s * 0.16), g(n, cy - s * 0.02)),
               (g(n, cx + s * 0.30), g(n, cy + s * 0.30)),
               (g(n, cx - s * 0.06), g(n, cy + s * 0.16))], fill=col)


MARKS = {
    "react": react,
    "vue": vue,
    "python": python,
    "config": cog,
    "html": shield,
    "css": droplet,
    "shell": prompt,
    "data": braces,
    "sql": cylinder,
    "java": cup,
    "swift": swoosh,
    "ruby": gem,
    "prose": prose,
    # Registered nowhere: their files have no extension. In-app only.
    "git": branch,
    "docker": containers,
}

# extension -> mark, and the .ico is PER EXTENSION rather than per language.
#
# That is not the obvious choice and it is the only honest one: the band carries
# the file's own extension, a ProgID has exactly ONE DefaultIcon, and .jsx and
# .tsx share the React mark. One icon per language would therefore have to print
# JSX on a .tsx - a label that lies is worse than no label, and the label is the
# entire reason the band exists.
#
# It costs a ProgID each, and assoc.nsh's own comment warns about that: one
# class per KIND is why the Open With menu says "Prism" once instead of listing
# thirty near-identical entries. So this list is kept SHORT deliberately - the
# extensions somebody recognises on sight - and everything else keeps the
# stepped bars, which is most of the ~150 languages Prism highlights.
#
# EVERY ONE MUST ALREADY BE VIEWABLE. fileAssoc.test.ts refuses an extension the
# installer registers and fileKind.ts cannot open, and rightly: an "Open with
# Prism" that opens nothing is worse than an absence. `.htm`, `.pyi` and `.psd1`
# were in the first draft and came out for that reason - adding them is a change
# to what Prism SUPPORTS, which is its own decision and not an icon one.
EXTS = {
    "jsx": "react", "tsx": "react",
    "vue": "vue",
    "py": "python", "pyw": "python",
    # CONFIGURATION is the cog's real subject and Rust only borrows it: a
    # project file, a lock file and a .conf are all "settings", and they are a
    # large family that would otherwise all show the generic bars.
    "rs": "config", "toml": "config", "ini": "config", "cfg": "config",
    "conf": "config", "env": "config", "editorconfig": "config",
    "properties": "config", "props": "config", "targets": "config",
    "lock": "config", "plist": "config", "inf": "config", "reg": "config",
    "nix": "config", "tf": "config", "tfvars": "config", "cmake": "config",
    "mk": "config", "sln": "config", "csproj": "config", "vbproj": "config",
    "service": "config", "desktop": "config", "resx": "config",
    "html": "html", "xhtml": "html", "svelte": "html", "astro": "html",
    "jinja": "html", "j2": "html",
    "css": "css", "scss": "css", "less": "css", "sass": "css", "styl": "css",
    "sh": "shell", "bash": "shell", "zsh": "shell", "fish": "shell",
    "ps1": "shell", "psm1": "shell", "bat": "shell", "cmd": "shell", "vbs": "shell",
    "ahk": "shell", "awk": "shell",
    "json": "data", "yaml": "data", "yml": "data", "json5": "data",
    "jsonc": "data", "xml": "data", "xsd": "data", "xsl": "data", "xslt": "data",
    "wsdl": "data", "proto": "data", "gql": "data", "graphql": "data",
    "po": "data", "pot": "data",
    "sql": "sql",
    # The cup is the JVM, not Java alone - Kotlin, Scala and Groovy are the
    # same platform and nobody mistakes a coffee cup for a language name.
    "java": "java", "kt": "java", "kts": "java", "scala": "java",
    "groovy": "java", "gradle": "java",
    "swift": "swift",
    "rb": "ruby",
    # PROSE, and the list is not a new one: it is `codeLang.isProse`'s, which
    # the editor already uses to decide there is no gutter and no language to
    # show. `iconPaths.test.ts` asserts the two agree, because two lists of the
    # same thing in two languages is how the installer fell 96 extensions
    # behind once already.
    "txt": "prose", "log": "prose", "csv": "prose", "srt": "prose", "vtt": "prose",
}

# The marks that can never reach Explorer, and why. Kept out of EXTS on purpose
# and used by the IN-APP icons, which resolve a file by NAME as well as by
# extension. Windows associates on extension alone, so `Dockerfile` and
# `.gitignore` have nothing to hang a ProgID on. The app has no such limit and
# no per-mark cost at all, so it can be more generous than Explorer - an
# asymmetry to expect rather than a bug to fix.
BARE_ONLY = {
    "git": ("gitignore", "gitattributes", "gitmodules"),
    "docker": ("dockerfile", "dockerignore"),
}

#: Every extension that gets its own .ico and ProgID, in a stable order.
SHIPPED = sorted(EXTS)
