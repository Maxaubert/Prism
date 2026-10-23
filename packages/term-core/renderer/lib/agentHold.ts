/**
 * A FINISHED OR FAILED MARK RAISED ON THE TAB IN FRONT WHILE THE WINDOW WAS
 * AWAY IS HELD UNTIL A TAB IS CLICKED (owner, 2026-10-21: "you go from another
 * app back into the terminal, because then you don't know which is completed,
 * if it was the tab you were on. So it should keep that completed icon until
 * you click a new tab"; 2026-10-23: "have it disappear once I click off the
 * tab"). It replaces the 2026-10-14 rule that focus coming back, or the
 * pointer moving over the window, took such a mark down.
 *
 * Pure bookkeeping, so the rule is tested without a browser: which ids are
 * held, whether a look may clear a mark, and which marks a change of the tab
 * in front releases. A mark raised while LOOKING (window focused, tab
 * in front) is never held: it never goes up at all.
 */
export interface Look {
  activeId: string | null
  focused: boolean
}

/** Looking at a tab is having it in front with the window focused. */
export const lookingAt = (id: string, look: Look): boolean => look.focused && look.activeId === id

export class HeldMarks {
  private readonly ids = new Set<string>()

  /** A Finished/Failed mark was raised on `id`: held when it is the tab in
   *  front and the window was away. */
  raised(id: string, look: Look): void {
    if (look.activeId === id && !look.focused) this.ids.add(id)
  }

  has(id: string): boolean {
    return this.ids.has(id)
  }

  /** May looking at `id` take its mark down? Not while it is held. */
  seen(id: string, look: Look): boolean {
    return lookingAt(id, look) && !this.ids.has(id)
  }

  /** The mark ended for another reason (work again, agent gone, tab closed). */
  drop(id: string): void {
    this.ids.delete(id)
  }

  /** The tab in front changed (by a click or a key): a held mark on a tab no
   *  longer in front is released. The same tab clicked again changes nothing. */
  moved(activeId: string | null): string[] {
    const out = [...this.ids].filter((id) => id !== activeId)
    for (const id of out) this.ids.delete(id)
    return out
  }
}
