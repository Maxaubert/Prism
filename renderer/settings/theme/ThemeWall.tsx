import { useEffect, useMemo, useRef, useState, type JSX, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { followsHostStyle, hostDefaults, hostOwnsWindowAcrylic } from '../../host'
import {
  applyCustomExtras,
  customTermTheme,
  setTermThemeId,
  termThemeId,
  useCustomTermTheme,
  useTermAcrylic,
  useTermThemeId,
  withGroundAlpha,
  type CustomTermTheme
} from '../../lib/termLook'
import { resolveCustomTheme, resolveTermTheme, watchTermTheme, TERM_PRESETS } from '../../lib/termTheme'
import { orderTermThemes } from '../../lib/themeOrder'
import type { AlphaRange } from '../../lib/colour'
import { SEE_THROUGH_MAX } from '../../lib/seeThrough'
import { ColourField } from '../ColourPicker'
import ThemeSwitchAsk from '../../components/ThemeSwitchAsk'
import { ANSI_KEYS, cardAnsi, paletteOf, pickPreset, presetLook } from './palette'
import { saveAsCustom, useNoAcrylic, useTermSetup } from './useTermSetup'

// THE THEME WALL, once for both layouts of the theme section (2026-10-05):
// the cards, Show all, the switch question and the colour editor. Extracted
// from TerminalAppearance.tsx unchanged; the legacy section and the grouped
// cards one both draw this.

/** A theme as a miniature terminal: prompt, coloured ls output, cursor. The
 *  point is the SYNTAX colours - a swatch row says nothing about how a real
 *  session will read. Every card paints itself with its OWN palette, never the
 *  chrome's tokens: the chrome is whichever theme is selected, and a wall of
 *  cards wearing that would be one theme drawn forty times. */
export function TermThemeCard({
  id,
  name,
  on,
  bg,
  fg,
  cursor,
  ansi,
  onPick,
  onEdit
}: {
  id: string
  name: string
  on: boolean
  bg: string
  fg: string
  cursor: string
  ansi: { green: string; yellow: string; blue: string; cyan: string; red: string }
  onPick: () => void
  /** Rendered as a pencil on the SELECTED card only. */
  onEdit?: () => void
}): JSX.Element {
  // The pencil is a real button BESIDE the card's, laid over its label row
  // (code review 2026-09-24, #28): nested inside the card's button it was
  // flattened into the card's name, and could not be reached as a control.
  return (
    <div className="relative w-[196px]">
      <button
        data-term-card={id}
        aria-pressed={on}
        onClick={onPick}
        className={`group flex w-[196px] flex-col overflow-hidden rounded-md border text-left transition-colors ${
          on
            ? 'border-[color:var(--p-accent-hi)] ring-1 ring-[var(--p-accent-solid,var(--p-accent))]/45'
            : 'border-[color:var(--p-line)] hover:border-[color:var(--p-divider)]'
        }`}
      >
        <div
          className="h-[92px] w-full px-2.5 py-2 font-[Consolas,'Cascadia_Mono',monospace] text-[10.5px] leading-[1.5]"
          style={{ background: bg, color: fg }}
        >
          <div>
            <span style={{ color: ansi.green }}>you@pc</span>
            <span style={{ color: fg }}>:</span>
            <span style={{ color: ansi.blue }}>~/app</span>
            <span style={{ color: ansi.red }}>$</span> ls
            <span className="ml-[1px] inline-block h-[11px] w-[6px] translate-y-[2px]" style={{ background: cursor }} />
          </div>
          <div>
            <span style={{ color: ansi.blue }}>src</span>  <span style={{ color: ansi.blue }}>docs</span>{'  '}
            <span style={{ color: ansi.green }}>run.sh</span>
          </div>
          <div>
            <span style={{ color: ansi.yellow }}>notes.md</span>  <span style={{ color: ansi.cyan }}>a.link</span>
          </div>
          <div style={{ color: fg }}>12 files</div>
        </div>
        {/* ONE HEIGHT FOR EVERY LABEL ROW (owner, 2026-09-22: "when I click a
            theme ... the ui shifts a bit"). The pencil is 20px, taller than the
            name's line, so the selected card grew and took its row of the wall
            with it: picking a theme in another row moved everything below. The
            row is fixed at a height that holds the pencil, whether it is there
            or not. */}
        <div
          className={`flex h-8 items-center justify-between border-t px-2.5 text-[11.5px] font-semibold ${
            on ? 'border-[color:var(--p-accent-hi)]/40 text-[var(--p-accent-hi)]' : 'border-[color:var(--p-line)] text-[var(--p-text)]'
          }`}
        >
          <span>{name}</span>
        </div>
      </button>
      {/* Only the SELECTED theme wears the pencil: editing starts from what
          you are using, and saving lands in the Custom slot. */}
      {on && onEdit && (
        <button
          data-edit-theme={id}
          className="absolute bottom-1.5 right-2.5 grid h-5 w-5 place-items-center rounded text-[var(--p-accent-hi)] hover:bg-[var(--p-hover)]"
          title="Edit colours, saved as Custom"
          aria-label={`Edit ${name}`}
          onClick={onEdit}
        >
          <svg viewBox="0 0 24 24" width={11} height={11} fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M15 5l4 4L8 20H4v-4z" />
          </svg>
        </button>
      )}
    </div>
  )
}

/** The Tabby-style editor: every colour of a theme, individually, with the
 *  live preview beside them. Save lands in the single Custom slot. */
function TermThemeEditor({
  seed,
  bgAlpha,
  onSave,
  onCancel
}: {
  seed: CustomTermTheme
  /** What the Background's alpha may be: the window's see-through where the
   *  terminal owns the window acrylic, nothing where the style does (#114). */
  bgAlpha: AlphaRange & { alphaDisabled?: boolean }
  onSave: (t: CustomTermTheme) => void
  onCancel: () => void
}): JSX.Element {
  const [draft, setDraft] = useState<CustomTermTheme>(seed)
  // A MODAL THAT HOLDS THE KEYBOARD (code review 2026-09-24, #28). Opened from
  // the pencil by keyboard, the focus stayed behind the backdrop: Escape did
  // nothing (it was heard only inside) and Tab walked the cards under it, where
  // Enter picked a theme beneath the open editor. So the first field takes the
  // focus, Escape is heard from the window as ThemeSwitchAsk hears it, Tab
  // stays inside, and the focus goes back to where it came from on close.
  const panel = useRef<HTMLDivElement>(null)
  const cancel = useRef(onCancel)
  useEffect(() => {
    cancel.current = onCancel
  })
  useEffect(() => {
    const back = document.activeElement as HTMLElement | null
    panel.current?.querySelector<HTMLElement>('input, button')?.focus()
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      // An Escape aimed at a colour picker inside the editor is the picker's
      // (#112): this listener is native and on the window, so it hears the key
      // before the picker does, and would close the editor behind it.
      if ((e.target as Element | null)?.closest?.('[data-colour-popover]')) return
      e.preventDefault()
      e.stopPropagation()
      cancel.current()
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      back?.focus?.()
    }
  }, [])
  const trapTab = (e: ReactKeyboardEvent): void => {
    if (e.key !== 'Tab' || e.ctrlKey || e.altKey || e.metaKey) return
    if ((e.target as Element | null)?.closest?.('[data-colour-popover]')) return
    const all = [...(panel.current?.querySelectorAll<HTMLElement>('input, button, [tabindex="0"]') ?? [])].filter(
      (el) => !el.hasAttribute('disabled')
    )
    if (!all.length) return
    const i = all.indexOf(document.activeElement as HTMLElement)
    const next = e.shiftKey ? (i <= 0 ? all.length - 1 : i - 1) : i === -1 || i === all.length - 1 ? 0 : i + 1
    e.preventDefault()
    all[next].focus()
  }
  const set = (k: string, v: string | undefined): void =>
    setDraft((d) =>
      k === 'bg' || k === 'fg' || k === 'cursor' || k === 'selection'
        ? { ...d, [k]: v }
        : { ...d, ansi: { ...d.ansi, [k]: v ?? '#888888' } }
    )
  // EVERY COLOUR CARRIES AN ALPHA (#112). The Background's IS the window's
  // see-through where the terminal owns the window acrylic (#114, in place of
  // the Opacity slider), at least 30% as the slider was, and inert while
  // acrylic is off; where the style owns the glass (Prism) it has none.
  // Escape in a picker puts the draft back (no onRevert: the well's opening
  // value is written back).
  const well = (
    label: string,
    key: string,
    value: string,
    more: AlphaRange & { alphaDisabled?: boolean; onRevert?: () => void } = {}
  ): JSX.Element => (
    <div key={key} className="flex items-center justify-between gap-2 text-[11px] text-[var(--p-dim)]">
      <span className="w-[86px] truncate">{label}</span>
      <ColourField label={label} value={value} onChange={(v) => set(key, v)} {...more} />
    </div>
  )
  // The selection shows what is drawn until one is chosen: the cursor AS
  // DRAWN (composited and floored, which a see-through cursor is) at 55, the
  // terminal's own derivation, so a nudge starts from what was on screen.
  // Its alpha stops at 254/255, since xterm draws an OPAQUE selection at 0.3
  // (ThemeService, issue 2737) and what is picked must be what is drawn.
  // Escape on a selection never chosen leaves it unchosen. The preview card
  // draws the same resolution: raw alphas would show a 30% foreground the
  // terminal floors to 4.5:1.
  const chosenSelection = draft.selection
  const drawn = useMemo(() => resolveCustomTheme(draft), [draft])
  return (
    // A popup, not an inline section: below the card grid the editor sat out
    // of view. data-owns-escape keeps App's window Escape away; the backdrop
    // and Escape both cancel.
    <div
      data-theme-editor
      data-owns-escape
      className="fixed inset-0 z-50 grid place-items-center bg-black/50 backdrop-blur-[3px]"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onCancel()
      }}
      onKeyDown={trapTab}
      role="dialog"
      aria-modal="true"
      aria-label="Edit terminal colours"
    >
      <div ref={panel} className="max-h-[85vh] overflow-y-auto rounded-lg border border-[color:var(--p-divider)] bg-[var(--p-side-flat)] p-5 shadow-[0_18px_48px_rgba(0,0,0,.55)]">
        <div className="mb-3 text-[13px] font-bold text-[var(--p-text)]">Edit colours</div>
        <div className="flex flex-wrap items-start gap-6">
          <div className="grid grid-cols-2 gap-x-6 gap-y-1.5">
            {well('Background', 'bg', draft.bg, bgAlpha)}
            {well('Foreground', 'fg', draft.fg)}
            {well('Cursor', 'cursor', draft.cursor)}
            {well('Selection', 'selection', chosenSelection ?? drawn.selectionBackground, {
              alphaMax: 254 / 255,
              onRevert: () => set('selection', chosenSelection)
            })}
            {ANSI_KEYS.map((k) => well(k, k, draft.ansi[k] ?? '#888888'))}
          </div>
          <TermThemeCard
            id="custom-preview"
            name="Custom"
            on
            bg={drawn.background}
            fg={drawn.foreground}
            cursor={drawn.cursor}
            ansi={cardAnsi(drawn as unknown as Record<string, string>)}
            onPick={() => {}}
          />
        </div>
        <div className="mt-4 flex gap-2">
          <button
            data-save-custom
            className="h-8 rounded-lg bg-[var(--p-accent)] px-4 text-[12px] font-semibold text-[var(--p-on-accent)] hover:brightness-110"
            onClick={() => onSave(draft)}
          >
            Save as Custom
          </button>
          <button
            className="h-8 rounded-lg border border-[color:var(--p-line)] px-4 text-[12px] font-semibold text-[var(--p-text)] transition-colors hover:border-[color:var(--p-divider)]"
            onClick={onCancel}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

/** Collapsed, the wall shows two rows of cards: every theme as one wall
 *  buried what came after it. */
const TWO_ROWS = 268

/**
 * The wall itself: Custom, the host's default, Follow style where the host
 * has styles, then every preset neutral-first, black to white (#157); the pencil on the chosen card;
 * Show all; the question when a pick would drop unsaved changes; the editor.
 * `onThemePicked`: a pick landed (Custom included, `id` says which; the
 * editor's save says `edited`), for a host whose own rows follow the theme
 * (Prism Terminal forgets its picked window colours, or brings Custom's back).
 * `extraDirty` / `onSaved`: the host's own unsaved changes (Prism Terminal's
 * window colours) light Save changes and ask before a pick drops them too, and
 * a save tells the host to keep them with Custom (owner, 2026-10-12: Save
 * changes "never grey when there are changes to save").
 */
export function ThemeWall({
  onThemePicked,
  extraDirty = false,
  onSaved,
  className = ''
}: {
  onThemePicked?: (id: string) => void
  extraDirty?: boolean
  onSaved?: () => void
  className?: string
}): JSX.Element {
  const themeId = useTermThemeId()
  const acrylicOn = useTermAcrylic()
  const custom = useCustomTermTheme()
  const setup = useTermSetup()
  const dirty = setup.dirty || extraDirty
  const save = (): void => {
    setup.save()
    onSaved?.()
  }
  const noAcrylic = useNoAcrylic()
  const windowAcrylic = hostOwnsWindowAcrylic()
  // The Custom card draws what the terminal draws (#113 review), not the raw
  // alphas; resolved once per saved Custom, which the store already caches.
  const customDrawn = useMemo(() => (custom ? resolveCustomTheme(custom) : null), [custom])
  // What the HOST's style looks like right now, for its card; re-read when the
  // style repaints :root. Only a host WITH styles has one (Prism).
  const [styleTheme, setStyleTheme] = useState(() => resolveTermTheme(followsHostStyle() ? 'style' : termThemeId()))
  useEffect(() => (followsHostStyle() ? watchTermTheme(setStyleTheme) : undefined), [])
  // CUSTOM LEADS THE WALL, then THE HOST'S OWN DEFAULT (owner, 2026-09-22: "it
  // should be first in the list"; then 2026-09-23: "custom should come before
  // default"). Prism Terminal's default is a preset (PT Default); Prism's is
  // 'style', which is no preset, so there Custom leads Follow style.
  const defaultPreset = TERM_PRESETS.find((p) => p.id === hostDefaults().theme)
  // Then every other preset in ONE fixed order (#157, owner 2026-10-10): the
  // neutral grounds black to white, then the coloured ones black to white,
  // measured in lib/themeOrder. Fixed, so a pick never reshuffles the wall
  // (the old light-first flip read the worn theme once for that reason).
  const sortedPresets = useMemo(
    () => orderTermThemes(TERM_PRESETS.filter((p) => p !== defaultPreset)),
    [defaultPreset]
  )
  // The editor popup, seeded from the SELECTED theme. Presets never change -
  // editing always lands in the Custom slot.
  const [editing, setEditing] = useState<CustomTermTheme | null>(null)
  // A THEME PICK, Custom included. It lands at once when nothing is unsaved;
  // with Save changes lit it asks first (ThemeSwitchAsk), since landing puts
  // the agent colours and acrylic back to the theme's own. Once
  // it lands the host hears of it (`onThemePicked`), for its own rows that
  // follow the theme.
  const [asking, setAsking] = useState<string | null>(null)
  const land = (id: string): void => {
    const saved = customTermTheme()
    if (id === 'custom' && saved) {
      setTermThemeId('custom')
      // The saved setup is more than the palette: font, agent colours,
      // acrylic come back with it when the save captured them.
      applyCustomExtras(saved)
    } else pickPreset(id)
    onThemePicked?.(id)
  }
  const pick = (id: string): void => {
    if (dirty) setAsking(id)
    else land(id)
  }
  const presetCard = (p: (typeof TERM_PRESETS)[number]): JSX.Element => {
    const t = presetLook(p.id)
    return (
      <TermThemeCard
        key={p.id}
        id={p.id}
        name={p.name}
        on={themeId === p.id}
        bg={t.background}
        fg={t.foreground}
        cursor={t.cursor}
        ansi={{
          green: t.green ?? '',
          yellow: t.yellow ?? '',
          blue: t.blue ?? '',
          cyan: t.cyan ?? '',
          red: t.red ?? ''
        }}
        onPick={() => pick(p.id)}
        onEdit={() => setEditing(withGroundAlpha(paletteOf(p.id)))}
      />
    )
  }
  // Measured at click time, so the expand can ANIMATE: max-height can't
  // tween to 'none', only to a number, and the content's real height is the
  // honest one.
  const [wallHeight, setWallHeight] = useState(TWO_ROWS)
  const allThemes = wallHeight !== TWO_ROWS
  const themeWall = useRef<HTMLDivElement>(null)
  const toggleWall = (): void => setWallHeight(allThemes ? TWO_ROWS : (themeWall.current?.scrollHeight ?? 2400))
  return (
    <>
      <div
        ref={themeWall}
        // Ease OPEN only: the transition class is present exactly when the
        // expanded height applies, so collapsing snaps shut instantly.
        className={`relative overflow-hidden ${className} ${
          allThemes
            ? 'transition-[max-height] duration-[240ms] [transition-timing-function:cubic-bezier(.16,1,.3,1)] motion-reduce:transition-none'
            : ''
        }`}
        style={{ maxHeight: wallHeight }}
      >
        <div className="flex flex-wrap gap-3">
          {custom && (
            <TermThemeCard
              id="custom"
              name="Custom"
              on={themeId === 'custom'}
              bg={customDrawn!.background}
              fg={customDrawn!.foreground}
              cursor={customDrawn!.cursor}
              ansi={cardAnsi(customDrawn as unknown as Record<string, string>)}
              onPick={() => pick('custom')}
              onEdit={() => setEditing(withGroundAlpha(paletteOf('custom')))}
            />
          )}
          {defaultPreset && presetCard(defaultPreset)}
          {followsHostStyle() && (
            <TermThemeCard
              id="style"
              name="Follow style"
              on={themeId === 'style'}
              bg={styleTheme.background}
              fg={styleTheme.foreground}
              cursor={styleTheme.cursor}
              ansi={cardAnsi(styleTheme as unknown as Record<string, string>)}
              onPick={() => pick('style')}
              onEdit={() => setEditing(paletteOf('style'))}
            />
          )}
          {sortedPresets.map(presetCard)}
        </div>
        {asking !== null && (
          <ThemeSwitchAsk
            onSave={() => {
              const to = asking
              setAsking(null)
              save()
              land(to)
            }}
            onDiscard={() => {
              const to = asking
              setAsking(null)
              land(to)
            }}
            onCancel={() => setAsking(null)}
          />
        )}
      </div>
      <div className="mt-2 flex justify-center">
        <button
          data-theme-wall-toggle
          aria-expanded={allThemes}
          aria-label={allThemes ? 'Show fewer themes' : `Show all ${TERM_PRESETS.length + (custom ? 1 : 0)} themes`}
          title={allThemes ? 'Show fewer' : 'Show all themes'}
          className="grid h-7 w-10 place-items-center rounded text-[var(--p-icon)] transition-colors hover:bg-[var(--p-hover)] hover:text-[var(--p-text)]"
          onClick={toggleWall}
        >
          <svg viewBox="0 0 24 24" width={15} height={15} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className={`transition-transform ${allThemes ? 'rotate-180' : ''}`} aria-hidden>
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>
      </div>
      {editing && (
        <TermThemeEditor
          seed={editing}
          // Opaque is the switch's off (#156): under it the Alpha stops at 95%,
          // so the field and the window always agree. Only while the Alpha is
          // live: an inert one must not clip an opaque ground it cannot move.
          bgAlpha={
            windowAcrylic
              ? {
                  alphaMin: 0.3,
                  alphaMax: acrylicOn && !noAcrylic ? SEE_THROUGH_MAX : 1,
                  alphaDisabled: !acrylicOn || noAcrylic
                }
              : { alpha: false }
          }
          onSave={(t) => {
            // The Custom slot is the WHOLE setup (code review 2026-09-24,
            // #8): saved as a bare palette, the agent colours and
            // acrylic it held were gone for good. And it is a theme pick like
            // a card's (#29), so the host forgets its own window colours and
            // the edited background is the one that shows.
            saveAsCustom(t)
            setEditing(null)
            onThemePicked?.('edited')
          }}
          onCancel={() => setEditing(null)}
        />
      )}
    </>
  )
}
