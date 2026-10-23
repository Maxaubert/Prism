// The update offer, as both apps carry it from main to the title bar (#28).
//
// It lives in the core because the chip and the window that opens from it are
// the core's (owner, 2026-09-19: "yes keep the core"), and a component cannot
// name a type that belongs to one host. Each app still FINDS its own update
// (its own repo, its own installer name); what is shared is the shape of the
// answer and everything the user sees of it.

/** A newer release than the one running. */
export interface UpdateInfo {
  /** The release's version, without the tag's leading v. */
  version: string
  /** The installer's download url. Empty for a preview, which installs nothing. */
  url: string
  /**
   * The release's body, RAW, exactly as GitHub served it. It is text off the
   * network, so nothing renders it: `parseReleaseNotes` turns it into plain
   * entries and the dialog prints those as text nodes.
   */
  notes: string
  /** A preview (`--preview-update`, or an unpackaged build): a fake offer, shown
   *  so the chip and its window can be looked at. Install is a fake too. */
  mock?: boolean
}

/** Where an install has got to. The chip draws all three in ONE shape. */
export type UpdatePhase = 'idle' | 'downloading' | 'installing'
