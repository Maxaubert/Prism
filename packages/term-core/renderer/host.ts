import type { DetectedAgent, PluginChoice, ShellDef } from '../shared/types'
import type { DictationApi } from '../preload/dictationApi'
import type { ShownQuestion } from '../shared/questionShown'
import type { Hotkey } from './lib/dictationKey'

/**
 * THE HOST SEAM (2026-09-19, #15).
 *
 * This core is the terminal of TWO apps: Prism Terminal, where it is the whole
 * product, and Prism, where it is a panel inside a media viewer. The owner's
 * rule is that the two terminals are the same ("all should be synced, unless
 * it conflicts with one app, then you need to ask me"). So everything that IS
 * the terminal lives in this core, once, and every place the two apps
 * legitimately differ is DECLARED here as a setting the host supplies. A
 * difference that is not on this page is a fork, and a fork is what this
 * exists to end.
 *
 * Nothing in the core reads `window.prism`, imports from a host's `src/`, or
 * uses a path alias (`@shared`, `@renderer`): a consumer's bundler resolves an
 * alias against ITS OWN tree, MEASURED, silently, so the core would run the
 * host's copy of a file with no error anywhere. Relative imports only, and
 * the bridge to main is handed in, never reached for.
 */

/** What the clipboard holds right now, for the paste rule. */
export interface ClipboardRead {
  image: boolean
  text: string
  files: string[]
}

/** The bridge to the main process that the terminal needs. A host's preload
 *  builds it with `createTermApi` (core/preload/api), so the channel names and
 *  signatures exist in one place. */
export interface TermApi {
  termShells(): Promise<ShellDef[]>
  termSpawn(id: string, cwd: string, shellId?: string, resume?: string, hooks?: boolean | PluginChoice): Promise<boolean>
  termInput(id: string, data: string): void
  termResize(id: string, cols: number, rows: number): void
  termKill(id: string): void
  termPrewarm(cwd: string, shellId?: string, hooks?: boolean | PluginChoice): void
  onTermData(cb: (id: string, data: string) => void): () => void
  onTermAgent(cb: (id: string, has: boolean, kind: DetectedAgent | null) => void): () => void
  /** Ask the process poll to look NOW, past its backoff (#73). Optional so a
   *  host bridge without it still builds; the poll then finds agents late. */
  termAgentLook?(): void
  /** Ask the poll for this session's NEXT answer, sent even if unchanged.
   *  Optional like the look: without it a Codex started again between two
   *  looks waits for its title to give its keys back. */
  termAgentAgain?(id: string): void
  /** The question Claude Code's widget shows in tab `id`, for Sonara
   *  (#323). Optional: a host bridge without it simply tells no one. */
  termQuestion?(id: string, shown: ShownQuestion): void
  onTermExit(cb: (id: string) => void): () => void
  readClipboard(): ClipboardRead
  /** The same, without the page waiting on main (2026-10-15: a paste in a
   *  stalled main froze the page with it, 6 to 8 s MEASURED). Optional so an
   *  older host bridge still builds; the paste then reads synchronously. */
  readClipboardAsync?(): Promise<ClipboardRead>
  /** Text onto the clipboard through main, for when the page itself is refused
   *  (no focus). Both hosts' bridges carry it (`createTermApi`); optional so a
   *  host that has none still builds, and `copyText` then reports a failure. */
  writeClipboard?(text: string): Promise<boolean>
  /** A program's OSC 52 copy (#176), through main and capped at 1 MB.
   *  Optional so an older host bridge still builds; the copy is then dropped,
   *  as it was before. Write-only: there is no read. */
  writeClipboardFromTerm?(text: string): Promise<boolean>
  openExternal(url: string): void
  /** Paths (#99). Optional so a host bridge without them still builds; the
   *  terminal then paints and opens no paths. */
  termPathKinds?(cwd: string, texts: string[]): Promise<Array<{ kind: 'file' | 'dir'; abs: string } | null>>
  termOpenPath?(cwd: string, text: string, mode: 'open' | 'reveal'): void
}

/** How a tab marks its agent. A stored value outside these reads as the
 *  host's default (`readIndicator`). */
export type AgentIndicator = 'off' | 'minimal' | 'full'

/** The choices the strip draws: Off, Minimal and Full (Prism's own filled tab). */
export const INDICATORS: readonly AgentIndicator[] = ['off', 'minimal', 'full']

export interface TermHostConfig {
  api: TermApi

  /**
   * What a setting reads as when the user has never touched it. Per host on
   * purpose: an update must not silently change what an existing user sees,
   * and the two apps shipped different answers. Where the owner picks ONE
   * value for both, both hosts pass it and the difference is gone.
   */
  defaults: {
    /** A preset id, or 'style' where the host has styles to follow. */
    theme: string
    acrylic: boolean
    indicator: AgentIndicator
    /** A hex, or '' for "follow the theme" (see `accent`). */
    agentColor: string
    agentDoneColor: string
  }

  /**
   * Does the terminal wear the HOST's style? Prism has app styles and publishes
   * them as `--p-bg` / `--p-text` / `--p-accent-hi` on :root, so its terminal
   * can follow them (theme id 'style') and restyle when they change. Prism
   * Terminal has no styles of its own: there the terminal theme drives the
   * window, the other way round, so 'style' does not exist.
   */
  followsHostStyle: boolean

  /**
   * Does the panel paint the ground? True: the panel box paints `--p-bg` and
   * xterm's canvas is clear, so the strip under the last row (xterm sizes
   * itself in whole rows) is the theme's and every pixel gets one coat. False:
   * the host paints behind the panel itself (Prism's dock does), and the
   * canvas carries the ground as it always did there.
   */
  paintsGround: boolean

  /**
   * What an agent-indicator colour is when the user has NOT picked one: the
   * host's own accent for "working", and a green that reads on its ground for
   * "finished". The tab strip is the host's chrome, so the accent is the
   * host's to name: Prism Terminal derives its chrome from the terminal theme,
   * Prism takes it from the app style. `failed` (#131) is the theme's red on
   * the host's ground; absent, the core's own red (`FAILED_RED`).
   */
  themedAgentColors(themeId: string): { working: string; finished: string; question?: string; failed?: string }

  /**
   * What "Acrylic" means as a TERMINAL setting: the window material belongs to
   * the host's STYLE, and the row only decides whether the terminal lets it show
   * through; the theme Background has no alpha, since two alphas over one sheet
   * of glass would fight (owner, 2026-09-19).
   */
  acrylic: { kind: 'style' }

  /**
   * A chord the HOST owns even while a shell has the keyboard. xterm must not
   * also feed it to the pty: left to xterm, Ctrl+` became a NUL byte, which
   * counted as the user typing. Everything the host does not claim is the
   * shell's, so claim little: plain Ctrl+W is delete-word in every readline.
   */
  ownsKey(e: KeyboardEvent): boolean

  /**
   * DICTATION (#13). Optional: a host that has not wired main's half simply
   * leaves it out, and every dictation surface renders nothing. `api` is the
   * bridge (`createDictationApi` in the host's preload). `canDictate` answers
   * "is there a shell in front to paste into RIGHT NOW": always, given a tab,
   * in Prism Terminal; only while the terminal panel is showing in Prism,
   * where the same window is mostly a media viewer and Right Alt over a film
   * must do nothing.
   */
  dictation?: {
    api: DictationApi
    canDictate(): boolean
    /**
     * The key a user who never picked one dictates with (2026-10-23). Absent:
     * the core's DEFAULT_HOTKEY, Ctrl+Win (Prism Terminal's global key). Prism
     * keeps Right Alt, its documented key: core 0.43.0 moved the built-in
     * default, and Prism, which never saves one, moved with it silently, so
     * Right Alt over its terminal stopped dictating (Prism #429). A saved key
     * always wins; this is only what "nothing saved" and the reset mean.
     */
    defaultHotkey?: Hotkey
  }

  /**
   * A PATH CLICKED IN THE TERMINAL (#99), for a host that opens files itself.
   * Prism has a viewer and an explorer of its own, so a click there should
   * land in Prism (owner, 2026-09-29). Answer true when the host took it;
   * false, or absent, and main opens it the Windows way (the app Windows
   * gives a file, Explorer for a folder, never a program run).
   */
  openPath?(target: { abs: string; kind: 'file' | 'dir'; mode: 'open' | 'reveal' }): boolean

  /**
   * RIGHT CLICKS TO PROGRAMS (Flare #49, DIFF-22; owner, 2026-10-22: "right
   * click should just open the menu not paste in the input"). Present: the
   * host's "Send right clicks to programs" setting, read at every right press;
   * false (its default) keeps a right press, its release and a right drag from
   * a program that reads the mouse (`lib/termRightClick.ts`), so Claude Code
   * never pastes on the click that opens the menu. Absent: xterm forwards them
   * as it always did (Prism, until it adopts it), so an update changes nothing
   * there.
   */
  rightClickReports?(): boolean
}

let host: TermHostConfig | null = null

/** Called once by the host, before anything in the core renders. */
export function configureTermCore(config: TermHostConfig): void {
  host = config
}

/** Null where the host has not wired dictation: callers render nothing. */
export function dictationHost(): NonNullable<TermHostConfig['dictation']> | null {
  return host?.dictation ?? null
}

export function termHost(): TermHostConfig {
  if (!host) throw new Error('prism-term-core: configureTermCore() has not been called by the host')
  return host
}

/** The bridge to main. */
export const termApi = (): TermApi => termHost().api

/** What an unset setting reads as when NO host has spoken: a unit test, or a
 *  store read at import time. Prism Terminal's own answers. */
const NEUTRAL: TermHostConfig['defaults'] = {
  theme: 'prism',
  acrylic: false,
  indicator: 'minimal',
  agentColor: '',
  agentDoneColor: ''
}

export const hostDefaults = (): TermHostConfig['defaults'] => host?.defaults ?? NEUTRAL
export const followsHostStyle = (): boolean => host?.followsHostStyle ?? false
export const paintsGround = (): boolean => host?.paintsGround ?? true
/** Whether a right press reaches a program that reads the mouse
 *  (`rightClickReports`): yes where the host has not declared it. */
export const hostSendsRightClicks = (): boolean => host?.rightClickReports?.() ?? true

/** For tests, and for a host that tears down. */
export function resetTermCore(): void {
  host = null
}
