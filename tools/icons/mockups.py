"""A round of icon mockups as a page, because 16px is judged on a screen.

Takes the round module to render:

    python mockups.py round9 <outdir>

so a new round is a new round file and never a new copy of this one. The round
module supplies CANDIDATES, SIZES, FILENAMES and SECTIONS.

Deliberately quiet chrome: the icons are the subject, and a comparison sheet
that competes with what it is comparing is a worse sheet. Every icon is shown
at its TRUE size on both Explorer grounds first - that is the decision - with a
magnified 16px frame underneath only so the pixel landing can be checked.
"""
import importlib
import pathlib
import sys

HEAD = """<meta charset="utf-8">
<title>Prism icons</title>
<style>
  :root { color-scheme: dark; --bg:#141519; --panel:#1b1d22; --line:#2b2e36;
          --text:#e9edf7; --dim:#8b90a0; --accent:#7c7cf0; }
  * { box-sizing: border-box }
  body { margin:0; background:var(--bg); color:var(--text);
         font:14px/1.5 -apple-system,"Segoe UI Variable Text","Segoe UI",system-ui,sans-serif; }
  header { padding:28px 32px 8px; }
  h1 { margin:0 0 6px; font-size:19px; font-weight:650; letter-spacing:-.01em }
  header p { margin:0; color:var(--dim); max-width:62ch }
  h2 { margin:36px 32px 4px; font-size:15px; font-weight:650; text-transform:uppercase;
       letter-spacing:.09em; color:var(--accent) }
  h2 + p { margin:0 32px 14px; color:var(--dim); max-width:70ch }
  .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(430px,1fr));
          gap:14px; padding:0 32px 8px }
  .card { background:var(--panel); border:1px solid var(--line); border-radius:12px;
          padding:14px 16px 16px }
  .name { display:flex; align-items:baseline; gap:9px; margin-bottom:12px }
  .num { display:grid; place-items:center; width:22px; height:22px; flex:0 0 auto;
         border-radius:6px; background:var(--accent); color:#0d0f16;
         font-size:12px; font-weight:750; font-variant-numeric:tabular-nums }
  .what { font-weight:600 }
  .grounds { display:flex; gap:10px }
  .ground { flex:1; border-radius:8px; padding:11px 12px; border:1px solid var(--line) }
  .dark { background:#202020 }
  .light { background:#f7f7f7; border-color:#dcdcdc }
  .sizes { display:flex; align-items:flex-end; gap:11px; height:52px }
  .row { display:flex; align-items:center; gap:7px; margin-top:11px;
         font:12px/1 "Segoe UI",system-ui,sans-serif; white-space:nowrap;
         overflow:hidden; text-overflow:ellipsis }
  .dark .row { color:#e6e6e6 } .light .row { color:#1b1b1b }
  .zoom { margin-top:11px; display:flex; gap:10px; align-items:center }
  .zoom img { image-rendering:pixelated; width:96px; height:96px; border-radius:6px }
  .zoom .cap { color:var(--dim); font-size:11.5px; line-height:1.4 }
  .hero { display:flex; gap:10px; margin-bottom:12px }
  .hero div { flex:1; display:grid; place-items:center; padding:10px 0;
              border-radius:8px; border:1px solid var(--line) }
  .measure { margin-top:10px; color:var(--dim); font-size:11.5px;
             font-variant-numeric:tabular-nums }
  footer { color:var(--dim); padding:26px 32px 44px; max-width:74ch }
  code { background:#262932; padding:1px 5px; border-radius:4px; font-size:12.5px }
</style>
"""


def card(mod, kind, i, key, label, dirname):
    def imgs():
        return "".join(
            f'<img src="{dirname}/{kind}-{key}-{s}.png" width="{s}" height="{s}" alt="">'
            for s in mod.SIZES
        )

    fname = mod.FILENAMES[kind]
    small = f'<img src="{dirname}/{kind}-{key}-16.png" width="16" height="16" alt="">'

    # Optional, so every earlier round renders exactly as it did before.
    hero_px = getattr(mod, "HERO", None)
    hero = ""
    if hero_px:
        h = f'<img src="{dirname}/{kind}-{key}-{hero_px}.png" width="{hero_px}" height="{hero_px}" alt="">'
        hero = f'<div class="hero"><div class="dark">{h}</div><div class="light">{h}</div></div>'
    fn_cap = getattr(mod, "caption", None)
    measure = f'<div class="measure">{fn_cap(kind, key)}</div>' if fn_cap else ""

    return f"""
  <div class="card">
    <div class="name"><span class="num">{i}</span><span class="what">{label.replace("|", "<br>")}</span></div>
    {hero}
    <div class="grounds">
      <div class="ground dark">
        <div class="sizes">{imgs()}</div>
        <div class="row">{small}{fname}</div>
      </div>
      <div class="ground light">
        <div class="sizes">{imgs()}</div>
        <div class="row">{small}{fname}</div>
      </div>
    </div>
    <div class="zoom">
      <img src="{dirname}/{kind}-{key}-16.png" alt="16px, magnified">
      <div class="cap">16px, magnified 6x.<br>Every size is drawn at that size,<br>never downsampled.</div>
    </div>
    {measure}
  </div>"""


def main(module, out_dir, dirname=None):
    mod = importlib.import_module(module)
    dirname = dirname or module
    out = pathlib.Path(out_dir)
    title = module.replace("round", "round ")
    parts = [
        HEAD,
        f"""<header>
  <h1>Prism file icons, {title}</h1>
  <p>Each option is shown at its true size on Explorer's dark and light grounds,
  then as a details-view row, which is the frame that decides it. Pick by number.</p>
</header>""",
    ]
    for kind, blurb in mod.SECTIONS.items():
        parts.append(f"<h2>{kind}</h2><p>{blurb}</p><div class='grid'>")
        for i, (key, label, _fn) in enumerate(mod.CANDIDATES[kind], 1):
            parts.append(card(mod, kind, i, key, label, dirname))
        parts.append("</div>")
    parts.append(
        """<footer>Sizes shown are 16, 20, 24, 32 and 48; the shipped <code>.ico</code>
  also carries 40, 64, 96, 128 and 256. Every size is drawn at that size, never
  downsampled from one big render.</footer>"""
    )
    (out / "index.html").write_text("\n".join(parts), encoding="utf-8")
    print(out / "index.html")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else ".", *sys.argv[3:])
