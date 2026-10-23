/**
 * "COPIED" FOR A PROGRAM'S OWN SELECTION (owner, 2026-10-16: "the copied chip
 * dont always show"). A full-screen program that asked for the mouse (Claude
 * Code's fullscreen view) draws its own selection and copies it itself,
 * through the system clipboard and not through the terminal (no OSC 52): on
 * the mouse's release with its Copy on select on, on Ctrl+C with it off. The
 * app never heard of either and said nothing. Now a press that selects (a
 * drag, or a double or triple click) is followed by a look at the clipboard's
 * text, and so is a Ctrl+C while that selection stands: changed since the
 * press, it was the program's copy, and the badge shows. The text is compared
 * and dropped, never kept or logged.
 *
 * WHILE THE PROGRAM'S SELECTION STANDS, Ctrl+C is its copy, not a "clear the
 * prompt" (owner, 2026-10-16: "highlighting text then clicking ctrl c does
 * nothing": the keep-agents-open rule had taken it). `selecting()` says so
 * from the selecting release until the next press, the next other key, or
 * the Ctrl+C that copies it.
 *
 * Pure apart from the clock and the reads it is handed, so a test holds it.
 */

/** When the clipboard is looked at after the release or the Ctrl+C: the
 *  program copies through a helper process, which takes a moment. */
export const COPY_LOOKS_MS = [150, 500, 1000] as const
/** A press that moved this far is a drag. */
export const DRAG_PX = 4

export interface AppCopyDeps {
  /** The clipboard's text now; null when it cannot be read. */
  read(): Promise<string | null>
  /** The program in front has the mouse (it draws its own selection). */
  programHasMouse(): boolean
  announce(): void
  wait?: (ms: number) => Promise<void>
}

export interface AppCopyWatch {
  down(x: number, y: number, clicks: number): void
  /** The pointer moved with the button down: a drag is read once it is one. */
  move(x: number, y: number): void
  up(x: number, y: number): void
  /** Ctrl+C reached the program: its copy, while its selection stands. */
  copyKey(): void
  /** Any other key: the program's selection is over. */
  otherKey(): void
  /** The program's own selection stands (a selecting release since the
   *  last press, key or copy). */
  selecting(): boolean
}

export function watchAppCopies(deps: AppCopyDeps): AppCopyWatch {
  const wait = deps.wait ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  let press: { x: number; y: number; clicks: number; before: Promise<string | null> | null } | null = null
  /** The selection the program holds: the clipboard as it was at its press. */
  let selection: { before: Promise<string | null> } | null = null
  /** Bumped by each press: a look from an older press stops. */
  let gen = 0
  const look = (before: Promise<string | null>): void => {
    const mine = gen
    void (async () => {
      const was = await before
      let waited = 0
      for (const at of COPY_LOOKS_MS) {
        await wait(at - waited)
        waited = at
        if (mine !== gen) return
        const now = await deps.read()
        if (now && now !== was) {
          deps.announce()
          return
        }
      }
    })()
  }
  return {
    down: (x, y, clicks) => {
      gen += 1
      selection = null
      // THE CLIPBOARD IS READ ONLY FOR A PRESS THAT SELECTS (perf review
      // 2026-10-16): it was read on EVERY press in a mouse-owning program,
      // the whole text across the bridge and Win32 clipboard calls on main's
      // thread, for every plain click. A double or triple click is known to
      // select here; a drag is known once the pointer has moved past
      // DRAG_PX with the button down (`move`), and is read then, well before
      // the release the program copies on (a read at the release could lose
      // the race with a fast copy and miss the badge).
      press = deps.programHasMouse() ? { x, y, clicks, before: clicks >= 2 ? deps.read() : null } : null
    },
    move: (x, y) => {
      const p = press
      if (!p || p.before) return
      if (Math.hypot(x - p.x, y - p.y) >= DRAG_PX) p.before = deps.read()
    },
    up: (x, y) => {
      const p = press
      press = null
      if (!p) return
      const dragged = Math.hypot(x - p.x, y - p.y) >= DRAG_PX
      if (!dragged && p.clicks < 2) return
      const before = p.before ?? deps.read()
      selection = { before }
      look(before)
    },
    copyKey: () => {
      const s = selection
      selection = null
      if (s) look(s.before)
    },
    otherKey: () => {
      selection = null
    },
    selecting: () => selection !== null
  }
}
