import { useState, type JSX, type ReactNode } from 'react'
import {
  isEdited,
  savePreset,
  setMode,
  setOverride,
  stylesFor,
  useMode,
  useStyle,
  variablesFor,
  type Mode,
  type Style
} from '../lib/theme'
import { visibleThemes } from '../lib/vizStore'

// The first-run setup: a full-window page, not a dialog. Four steps and a
// welcome, each one animating in on the click that brought you to it - nothing
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

/** The two appearance cards. Shown live, and again inside the sweep, so they
 *  don't blink out while the window is changing under them. */
function ModeCards({ mode, onPick }: { mode: Mode; onPick?: (m: Mode) => void }): JSX.Element {
  return (
    <div className="mt-6 flex gap-3.5">
      {(['dark', 'light'] as Mode[]).map((m) => (
        <button
          key={m}
          onClick={onPick ? () => onPick(m) : undefined}
          aria-pressed={mode === m}
          tabIndex={onPick ? 0 : -1}
          className={`w-[166px] rounded-[14px] border p-2.5 text-left transition ${
            mode === m
              ? 'border-[var(--p-accent)] shadow-[0_0_0_2px_var(--p-accent)]'
              : 'border-[color:var(--p-line)] hover:-translate-y-0.5'
          }`}
          style={{ background: 'var(--p-hover)' }}
        >
          <ModePreview mode={m} />
          <span className="mt-2.5 block text-[13.5px] font-bold capitalize text-[var(--p-text)]">{m}</span>
          <span className="block text-[11.5px] text-[var(--p-dim2)]">
            {m === 'dark' ? 'Quiet chrome, media leads' : 'Paper white, ink black'}
          </span>
        </button>
      ))}
    </div>
  )
}

/** A miniature of the window in a mode, for the two appearance cards. */
function ModePreview({ mode }: { mode: Mode }): JSX.Element {
  const st = stylesFor(mode)[0]
  const bg = st?.bg ?? '#0b0d12'
  const side = st?.side ?? '#12151b'
  return (
    <div className="flex h-[72px] overflow-hidden rounded-[9px]">
      <div style={{ width: '32%', background: side }} />
      <div className="relative flex-1" style={{ background: bg }}>
        <div className="absolute left-[14%] right-[14%] top-[30%] h-[34%] rounded bg-[linear-gradient(140deg,#7d1f2a,#b03a2e_45%,#2c3e63)]" />
      </div>
    </div>
  )
}

/** A miniature of the app in the current style: the accent picker needs
 *  something big to change, or picking one looks like it did nothing. */
function StyleArt(): JSX.Element {
  return (
    <div aria-hidden className="ob-tile absolute right-[86px] top-1/2 w-[400px] -translate-y-1/2" style={{ animationDelay: '.14s' }}>
      <div className="overflow-hidden rounded-[14px] border border-[var(--p-line)] shadow-[0_40px_70px_-40px_rgba(0,0,0,.85)]">
        <div className="flex h-[26px] items-center gap-1.5 px-3" style={{ background: 'var(--p-title)' }}>
          <span className="h-[7px] w-[7px] rounded-[2px]" style={{ background: 'var(--p-accent)' }} />
          <span className="h-[3px] w-[30%] rounded-full bg-[var(--p-dim2)] opacity-50" />
        </div>
        <div className="flex h-[210px]">
          <div className="flex w-[36%] flex-col gap-2.5 py-4" style={{ background: 'var(--p-side)' }}>
            {[62, 78, 54, 70, 46].map((w, i) => (
              <span
                key={i}
                className="ml-4 h-[6px] rounded-full"
                style={{
                  width: w,
                  background: i === 2 ? 'var(--p-accent)' : 'var(--p-dim2)',
                  opacity: i === 2 ? 1 : 0.45
                }}
              />
            ))}
          </div>
          <div className="relative flex-1" style={{ background: 'var(--p-bg)' }}>
            <div className="absolute left-[12%] right-[12%] top-[24%] h-[44%] rounded-md bg-[linear-gradient(140deg,#7d1f2a,#b03a2e_45%,#2c3e63)]" />
            <div className="absolute inset-x-5 bottom-5 h-[5px] overflow-hidden rounded-full" style={{ background: 'var(--p-track)' }}>
              <span className="block h-full w-[44%] rounded-full" style={{ background: 'var(--p-accent)' }} />
            </div>
          </div>
        </div>
      </div>
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
      <div className="mr-1 flex gap-[7px]">
        {[0, 1, 2, 3].map((n) => (
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

/* ---------- the page ---------- */

const COPY = [
  { kicker: 'Appearance', head: ['Dark, or ', 'light', '.'], body: 'Both ship with their own styles. Change it whenever you like.' },
  { kicker: 'The sidebar', head: ['Your folder, one key away.'], body: 'Ctrl+B opens the folder you came from. Click to view, arrow to move on.' },
  { kicker: 'Style', head: ['Make it yours.'], body: 'Pick an accent now. The rest of the style is waiting in Settings.' },
  { kicker: 'One last thing', head: ['Open ', 'everything', ' with Prism.'], body: 'Images, video, audio, documents. Windows asks first, nothing changes behind your back.' }
]

export function Onboarding({ onDone }: { onDone: () => void }): JSX.Element {
  const [step, setStep] = useState(-1) // -1 is the welcome
  // A still of the window as it is now, held over the top while the real one
  // changes underneath and then wiped away.
  const [leaving, setLeaving] = useState<{ style: Style; step: number } | null>(null)
  const mode = useMode()
  const style = useStyle()

  // Changing the mode restyles the whole app, so it gets a transition of its own:
  // a copy of this page in the incoming style crosses the window, and the style
  // underneath only changes once it has finished. Doing it halfway through was
  // what made the title bar jump a beat after the rest.
  const pickMode = (m: Mode): void => {
    if (m === mode || leaving) return
    setLeaving({ style, step })
    // Not the next frame: the still fades in over the window it is a picture of,
    // and only once it is opaque does the style change behind it. Switching
    // sooner is what put a small jump right before the wipe set off.
    window.setTimeout(() => setMode(m), 170)
    window.setTimeout(() => setLeaving(null), 1380)
  }

  const go = (n: number): void => {
    if (leaving) return
    setStep(n)
  }

  // An accent picked here is an edit to a shipped style, and edits are lost the
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
            <div
              className="ob-logo h-[84px] w-[84px] rounded-[24px]"
              style={{ background: 'linear-gradient(140deg, var(--p-accent), var(--p-accent-hi))' }}
            />
            <h1 className="ob-in-1 mt-7 text-[60px] font-extrabold leading-none tracking-[-.05em] text-[var(--p-text)]">
              Welcome to Prism
            </h1>
            <p className="ob-in-2 mt-4 text-[16.5px] text-[var(--p-dim)]">Open a file. Look at it. Move on.</p>
            <button className="ob-in-3 mt-8 rounded-[10px] px-7 py-3 text-[15px] font-bold" onClick={() => go(0)} style={ctaStyle}>
              Get started
            </button>
          </div>
        </div>
      </Shell>
    )
  }

  const c = COPY[step]
  const last = step === 3

  return (
    <Shell>
      {step === 1 && <TreeArt />}
      {step === 2 && <StyleArt />}
      {step === 3 && <FilesArt />}

      <div className={`ob-deal absolute inset-0 z-20 flex flex-col px-[62px] py-[52px] ${step === 1 ? 'pl-[372px]' : ''}`}>
        <div className="text-[11px] font-extrabold uppercase tracking-[.22em] text-[var(--p-accent-hi)]">{c.kicker}</div>
        <h1 className="mt-3.5 max-w-[15ch] text-[58px] font-extrabold leading-[.98] tracking-[-.045em] text-[var(--p-text)]">
          {c.head.map((part, i) => (
            <span key={i} className={i === 1 ? 'text-[var(--p-dim2)]' : ''}>
              {part}
            </span>
          ))}
        </h1>
        <p className="mt-4 max-w-[40ch] text-[15.5px] leading-relaxed text-[var(--p-dim)]">{c.body}</p>

        {step === 0 && <ModeCards mode={mode} onPick={pickMode} />}

        {step === 2 && (
          <div className="mt-6 flex max-w-[420px] flex-wrap gap-3">
            {visibleThemes()
              .slice(0, 10)
              .map((t) => {
                const on = t.id === style.accent
                return (
                  <button
                    key={t.id}
                    onClick={() => setOverride('accent', t.id)}
                    title={t.name}
                    aria-label={t.name}
                    aria-pressed={on}
                    className={`h-11 w-11 rounded-[14px] transition hover:-translate-y-[3px] ${
                      on ? 'ring-[2.5px] ring-[var(--p-text)]' : ''
                    }`}
                    style={{
                      // Not the whole palette: a five-stop rainbow chip that
                      // turns the app red is a promise it doesn't keep.
                      background: `linear-gradient(140deg, ${t.palette[0]}, ${t.palette[1] ?? t.palette[0]})`
                    }}
                  />
                )
              })}
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
          onSkip={() => go(3)}
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
    <div aria-hidden className="ob-sweep pointer-events-none fixed inset-0 z-[60]" style={{ ...vars, background: 'var(--p-bg)' }}>
      <div className="flex h-9 items-center gap-3 border-b border-[var(--p-divider)] bg-[var(--p-title)] px-3 text-[13px]">
        <span className="font-semibold text-[var(--p-accent-hi)]">Prism</span>
      </div>
      <div className="p-wash absolute inset-x-0 bottom-0 top-9 flex flex-col px-[62px] py-[52px]">
        <div className="text-[11px] font-extrabold uppercase tracking-[.22em] text-[var(--p-accent-hi)]">{c.kicker}</div>
        <h1 className="mt-3.5 max-w-[15ch] text-[58px] font-extrabold leading-[.98] tracking-[-.045em] text-[var(--p-text)]">
          {c.head.map((part, i) => (
            <span key={i} className={i === 1 ? 'text-[var(--p-dim2)]' : ''}>
              {part}
            </span>
          ))}
        </h1>
        <p className="mt-4 max-w-[40ch] text-[15.5px] leading-relaxed text-[var(--p-dim)]">{c.body}</p>
        {step === 0 && <ModeCards mode={style.mode} />}
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
