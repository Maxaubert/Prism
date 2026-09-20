import { useCallback, useEffect, useRef, useState } from 'react'
import { helpEnabled, useHelpEnabled } from 'prism-term-core/renderer/lib/helpPrefs'
import { savedShellId } from 'prism-term-core/renderer/lib/termPrefs'
import { shellOfShellId, type HelpShellChoice } from 'prism-term-core/shared/help/shells'
import { helpStandsDown } from './commandHelp'

/**
 * THE COMMAND HELP POPUP'S STATE (#175), out of App because App is long enough.
 * The popup itself is prism-term-core's; this is only when Prism lets it be up.
 *
 * It is the same layer as a question dialog and the update window, so it never
 * sits over either: it does not OPEN while one is up and it is PUT AWAY when
 * one appears (Ctrl+W still works over it, and a question mounted underneath
 * would take the focus where nobody can see it). Put away while RENDERING, not
 * in an effect: an effect would paint one frame of the popup over the question.
 */
export function useCommandHelp(opts: {
  /** The shell on screen, or null: no terminal showing means no help at all. */
  showing: string | null
  /** A question, the update window or the setup is up. */
  blocked: boolean
  /** `helpFront(...)`: what is in front right now. */
  front: string
  /** Somebody closed it by hand: the host hands the keyboard back to the shell. */
  onClosed: () => void
}): {
  /** The setting. Off means the app offers it nowhere. */
  enabled: boolean
  open: boolean
  /** The chip it opens on, decided at the press that opens it. */
  shell: HelpShellChoice
  toggle: () => void
  close: () => void
} {
  const { showing, blocked, front, onClosed } = opts
  const enabled = useHelpEnabled()
  const [open, setOpen] = useState(false)
  const [shell, setShell] = useState<HelpShellChoice>('powershell')
  const [openedOver, setOpenedOver] = useState(front)

  // WHICH SHELL EACH SESSION WAS SPAWNED WITH. The Shell setting only names what
  // the NEXT terminal launches, so a session started before it was changed
  // still speaks its old language, and the popup preselects by what is running.
  // A session spawns when its panel first mounts, which is the first time it
  // is showing, so that is when the setting is read. Ids only, a few bytes per
  // terminal ever opened in this window.
  const spawnedWith = useRef(new Map<string, string | undefined>())
  useEffect(() => {
    if (showing && !spawnedWith.current.has(showing)) spawnedWith.current.set(showing, savedShellId())
  }, [showing])

  const down = helpStandsDown({ enabled, showing, blocked, openedOver, front })
  if (open && down) setOpen(false)

  // The latest of everything, for callbacks that are registered once.
  const live = useRef({ showing, blocked, front, open, onClosed })
  useEffect(() => {
    live.current = { showing, blocked, front, open, onClosed }
  })

  const close = useCallback(() => {
    setOpen(false)
    live.current.onClosed()
  }, [])

  const toggle = useCallback(() => {
    const now = live.current
    if (now.open) {
      close()
      return
    }
    // Read fresh, not from the hook's value: the key can arrive in the same
    // tick the switch was flipped in another window.
    if (!helpEnabled() || now.showing === null || now.blocked) return
    // The language of the shell in front. There always is one here (no
    // terminal showing means no popup), so unlike Prism Terminal there is no
    // start screen to fall back from and the hand-picked chip is not stored.
    const spawned = spawnedWith.current.has(now.showing)
      ? spawnedWith.current.get(now.showing)
      : savedShellId()
    setShell(shellOfShellId(spawned))
    setOpenedOver(now.front)
    setOpen(true)
  }, [close])

  return { enabled, open: open && !down, shell, toggle, close }
}
