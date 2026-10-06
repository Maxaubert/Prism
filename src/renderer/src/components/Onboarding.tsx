import { useState, type JSX, type ReactNode } from 'react'
import { isEdited, savePreset, useStyle, useThemes, variablesFor, type Style } from '../lib/theme'
import { visibleIndices } from '../lib/themes/wall'
import { ThemeCard } from './ThemeCard'
import { ThemeWall } from './settings/ThemeWall'
import appIcon from '../assets/icon.png'

// The first-run setup: a full-window page, not a dialog. Three steps and a
// welcome (#298: the Dark / Light step and the Style step became ONE theme
// step, on the same wall Settings has, since there is no Colour mode), each one animating in on the click that brought you to it - nothing
// here plays by itself, and nothing changes until you pick it.
//
// It sits under the title bar so the window can still be moved, minimised and
// closed while it is up.

const CHECK = (
  <svg viewBox="0 0 24 24" width={22} height={22} fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M5 13l4 4L19 7" />
  </svg>
)

/* ---------- the art, drawn from the theme's own tokens ---------- */

/** The cards of the wall's row in view, still, for the sweep: the copy has to
 *  carry the page, or the wall blinks out while the window changes. */
function StillRow({ chosen }: { chosen: Style }): JSX.Element {
  const themes = useThemes()
  const at = Math.max(
    0,
    themes.findIndex((t) => t.id === chosen.id)
  )
  return (
    <div className="mt-6 grid grid-cols-6 gap-x-2 gap-y-3 p-1.5">
      {visibleIndices(themes.length, 6, at, false).map((i) => (
        <ThemeCard key={themes[i].id} st={themes[i].id === chosen.id ? chosen : themes[i]} chosen={i === at} tabbable={false} height={72} onPick={() => {}} />
      ))}
    </div>
  )
}

/** The tree, sliding in with its rows dealt after it. Decorative. */
function TreeArt(): JSX.Element {
  const widths = [62, 84, 54, 96, 70, 48, 88, 60]
  return (
    <div aria-hidden className="ob-tree absolute inset-y-0 left-0 w-[300px] border-r border-[var(--p-line)] bg-[var(--p-side)] py-6">
      {widths.map((w, i) => (
        <div
          key={i}
          className={`ob-row flex h-[34px] items-center gap-[11px] px-6 ${
            i === 3 ? 'mr-[18px] rounded-r-[10px] bg-[var(--p-accent)]' : ''
          }`}
          style={{ animationDelay: `${0.26 + i * 0.06}s` }}
        >
          <span
            className="h-[13px] w-[13px] shrink-0 rounded-[3px]"
            style={{ background: i === 3 ? 'var(--p-on-accent)' : 'var(--p-dim2)', opacity: i === 3 ? 0.95 : 0.5 }}
          />
          <span
            className="h-[7px] rounded-full"
            style={{ width: w, background: i === 3 ? 'var(--p-on-accent)' : 'var(--p-dim2)', opacity: i === 3 ? 0.95 : 0.4 }}
          />
        </div>
      ))}
    </div>
  )
}

/** Three files taking the Prism mark. Decorative. */
function FilesArt(): JSX.Element {
  const tiles = [
    { ext: 'JPG', cls: 'left-0 top-[84px] -rotate-[13deg]', delay: 0.16, badge: 0.8 },
    { ext: 'MP4', cls: 'left-[120px] top-[34px] -rotate-2', delay: 0.26, badge: 0.9 },
    { ext: 'PDF', cls: 'left-[240px] top-[84px] rotate-[11deg]', delay: 0.36, badge: 1 }
  ]
  return (
    <div aria-hidden className="absolute right-[76px] top-1/2 h-[300px] w-[380px] -translate-y-1/2">
      {tiles.map((t) => (
        <div
          key={t.ext}
          className={`ob-tile absolute h-[158px] w-[128px] rounded-2xl border border-[var(--p-line)] bg-[var(--p-preview)] ${t.cls}`}
          style={{ animationDelay: `${t.delay}s` }}
        >
          <span className="absolute left-[18px] right-[18px] top-[26px] h-[6px] rounded bg-[var(--p-dim2)] opacity-30" />
          <span className="absolute left-[18px] right-[46px] top-[40px] h-[6px] rounded bg-[var(--p-dim2)] opacity-30" />
          <span className="absolute inset-x-0 bottom-4 text-center text-[11px] font-extrabold tracking-[.16em] text-[var(--p-dim2)]">
            {t.ext}
          </span>
          <span
            className="ob-badge absolute -bottom-3.5 -right-3.5 grid h-[46px] w-[46px] place-items-center rounded-[15px] text-white"
            style={{
              background: 'linear-gradient(140deg, var(--p-accent), var(--p-accent-hi))',
              animationDelay: `${t.badge}s`
            }}
          >
            {CHECK}
          </span>
        </div>
      ))}
    </div>
  )
}

/** The rail of dots and the step's buttons. Rendered live, and again inside the
 *  sweep - the copy has to carry everything, or parts of the page blink out
 *  while the window is changing. */
function Footer({
  step,
  onBack,
  onNext,
  onSkip,
  last
}: {
  step: number
  onBack?: () => void
  onNext?: () => void
  onSkip?: () => void
  last?: boolean
}): JSX.Element {
  const dead = !onNext
  return (
    <div className="mt-auto flex items-center gap-3">
      <div data-ob-dots="" className="mr-1 flex gap-[7px]">
        {[0, 1, 2].map((n) => (
          <span
            key={n}
            className={`block h-[7px] rounded-full transition-all duration-300 ${
              n === step ? 'w-[26px] bg-[var(--p-accent)]' : 'w-[7px] bg-[var(--p-line)]'
            }`}
          />
        ))}
      </div>
      {step > 0 && (
        <button
          onClick={onBack}
          tabIndex={dead ? -1 : 0}
          className="rounded-[10px] border border-[color:var(--p-line)] px-4 py-2.5 text-[13.5px] font-semibold text-[var(--p-dim)]"
        >
          Back
        </button>
      )}
      <button onClick={onNext} tabIndex={dead ? -1 : 0} className="rounded-[10px] px-5 py-2.5 text-[14px] font-bold" style={ctaStyle}>
        {last ? 'Start using Prism' : 'Next'}
      </button>
      {!last && (
        <button onClick={onSkip} tabIndex={dead ? -1 : 0} className="ml-auto text-[12.5px] font-semibold text-[var(--p-dim2)]">
          Skip
        </button>
      )}
    </div>
  )
}

/** Body copy with [Ctrl] [B] drawn as key caps. A shortcut is something you
 *  press, and set as plain text mid-sentence it never looks like one. */
function Body({ text }: { text: string }): JSX.Element {
  return (
    <>
      {text.split(/(\[[^\]]+\])/g).map((part, i) =>
        part.startsWith('[') && part.endsWith(']') ? (
          <kbd
            key={i}
            className="relative -top-[1px] mx-[3px] inline-flex min-w-[2.1em] items-center justify-center rounded-[7px] border border-[color:var(--p-dim2)] bg-[var(--p-preview)] px-[7px] pb-[3px] pt-[2px] align-middle font-mono text-[12.5px] font-bold leading-none text-[var(--p-text)] shadow-[0_2px_0_var(--p-dim2),0_3px_6px_-3px_rgba(0,0,0,.45)]"
          >
            {part.slice(1, -1)}
          </kbd>
        ) : (
          part
        )
      )}
    </>
  )
}

/* ---------- the page ---------- */

const COPY = [
  { kicker: 'Appearance', head: ['Choose your look.'], body: 'Every theme is dark or light by itself. Settings has the rest.' },
  { kicker: 'The sidebar', head: ['Your folder, one key away.'], body: '[Ctrl] + [B] opens the folder you came from. Click to view, arrow to move on.' },
  { kicker: 'One last thing', head: ['Open ', 'everything', ' with Prism.'], body: 'Images, video, audio, documents. Windows asks first, nothing changes behind your back.' }
]

export function Onboarding({ onDone }: { onDone: () => void }): JSX.Element {
  const [step, setStep] = useState(-1) // -1 is the welcome
  // A still of the window as it is now, held over the top while the real one
  // changes underneath and then wiped away.
  const [leaving, setLeaving] = useState<{ style: Style; step: number } | null>(null)
  useStyle() // repaint the page's own tokens with the theme

  // A pick that changes dark to light (or back) restyles the whole app, so it
  // gets a transition of its own: a copy of this page in the theme on screen
  // crosses the window, and the theme underneath only changes once it is
  // opaque. Doing it halfway through was what made the title bar jump a beat
  // after the rest. A pick within a mode, and an arrow's preview, just paint.
  const commitWith = (from: Style, to: Style, commit: () => void): void => {
    if (from.mode === to.mode || leaving) {
      if (!leaving) commit()
      return
    }
    setLeaving({ style: from, step })
    // Not the next frame: the still fades in over the window it is a picture
    // of, and only once it is opaque does the theme change behind it.
    window.setTimeout(commit, 170)
    window.setTimeout(() => setLeaving(null), 1380)
  }

  const go = (n: number): void => {
    if (leaving) return
    setStep(n)
  }

  // An edit made here is an edit to a shipped theme, and edits are lost the
  // moment a style card is clicked in Settings. Keeping it as a preset of its
  // own means the choice survives - and the style it came from is still there,
  // unchanged, to go back to.
  const finish = (): void => {
    if (isEdited()) savePreset()
    onDone()
  }

  if (step < 0) {
    return (
      <Shell>
        <div className="grid h-full place-items-center px-10 text-center">
          <div className="flex flex-col items-center">
            {/* The app's own icon, not a coloured square standing in for it:
                this is the first thing anyone sees of Prism, and it should be
                the same mark they will find on the taskbar. */}
            <img
              src={appIcon}
              alt=""
              className="ob-logo h-[84px] w-[84px] rounded-[24px]"
              draggable={false}
            />
            <h1 className="ob-in-1 mt-7 text-[60px] font-extrabold leading-none tracking-[-.05em] text-[var(--p-text)]">
              Welcome to Prism
            </h1>
            <button className="ob-in-2 mt-9 rounded-[10px] px-7 py-3 text-[15px] font-bold" onClick={() => go(0)} style={ctaStyle}>
              Get started
            </button>
          </div>
        </div>
      </Shell>
    )
  }

  const c = COPY[step]
  const last = step === 2

  return (
    <Shell>
      {step === 1 && <TreeArt />}
      {step === 2 && <FilesArt />}

      <div className={`ob-deal absolute inset-0 z-20 flex flex-col px-[62px] py-[52px] ${step === 1 ? 'pl-[372px]' : ''}`}>
        <div className="text-[11px] font-extrabold uppercase tracking-[.22em] text-[var(--p-accent-hi)]">{c.kicker}</div>
        <h1 className="mt-3.5 max-w-[15ch] text-[58px] font-extrabold leading-[.98] tracking-[-.045em] text-[var(--p-text)]">
          {c.head.map((part, i) => (
            <span key={i} className={i === 1 ? 'text-[var(--p-dim2)]' : ''}>
              {part}
            </span>
          ))}
        </h1>
        <p className="mt-4 max-w-[40ch] text-[15.5px] leading-relaxed text-[var(--p-dim)]">
          <Body text={c.body} />
        </p>

        {step === 0 && (
          // THE SAME WALL AS SETTINGS, the whole page wide: the window itself
          // is the preview, so there is no picture of one beside it.
          <div className="mt-6" data-onboarding-wall="">
            <ThemeWall height={72} commitWith={commitWith} />
          </div>
        )}

        {last && (
          <div className="mt-6">
            <button
              onClick={() => void window.prism.openDefaultApps()}
              className="rounded-[10px] border border-[color:var(--p-line)] px-4 py-2.5 text-[13.5px] font-bold text-[var(--p-text)] transition hover:border-[color:var(--p-dim2)]"
            >
              Choose Prism in Windows
            </button>
          </div>
        )}

        <Footer
          step={step}
          last={last}
          onBack={() => go(step - 1)}
          onNext={() => (last ? finish() : go(step + 1))}
          onSkip={() => go(2)}
        />
      </div>

      {leaving && <Sweep style={leaving.style} step={leaving.step} />}
    </Shell>
  )
}

const ctaStyle = { background: 'var(--p-accent)', color: 'var(--p-on-accent)' }

/**
 * The window as it will look, crossing over the window as it looks now.
 *
 * It covers the title bar too - sweeping only the page below it was what made
 * the bar change colour a beat late - and it carries the step's own words, so
 * nothing blanks out while the sweep is travelling.
 */
function Sweep({ style, step }: { style: Style; step: number }): JSX.Element {
  // Flat colours: a still laid over the window has no desktop behind it to be
  // glass against. It is a picture of where you were, so nothing has to arrive.
  const vars = variablesFor(style, true)
  const c = COPY[step]
  return (
    // The still stops at the title bar. Drawn opaque it was a dark slab where
    // dark glass had been; drawn translucent it doubled up with the real bar
    // underneath, which comes to the same thing. The bar is left alone and
    // glides its own colour instead (see TopBar).
    <div
      aria-hidden
      className="ob-sweep pointer-events-none fixed inset-x-0 bottom-0 top-9 z-[60]"
      style={vars}
    >
      <div
        className="p-wash absolute inset-0 flex flex-col px-[62px] py-[52px]"
        style={{ backgroundColor: 'var(--p-bg)' }}
      >
        <div className="text-[11px] font-extrabold uppercase tracking-[.22em] text-[var(--p-accent-hi)]">{c.kicker}</div>
        <h1 className="mt-3.5 max-w-[15ch] text-[58px] font-extrabold leading-[.98] tracking-[-.045em] text-[var(--p-text)]">
          {c.head.map((part, i) => (
            <span key={i} className={i === 1 ? 'text-[var(--p-dim2)]' : ''}>
              {part}
            </span>
          ))}
        </h1>
        <p className="mt-4 max-w-[40ch] text-[15.5px] leading-relaxed text-[var(--p-dim)]">
          <Body text={c.body} />
        </p>
        {step === 0 && <StillRow chosen={style} />}
        <Footer step={step} />
      </div>
    </div>
  )
}

/** The page itself: everything below the title bar, in the app's own colours. */
function Shell({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div className="p-wash fixed inset-x-0 bottom-0 top-9 z-50 overflow-hidden bg-[var(--p-bg)]">{children}</div>
  )
}
