import { DIAGNOSTICS_OPTIONS } from '../diagnosticsOptions'

// The core's settings rows, by id, for the sections that draw them: a row's
// label, icon and resting subtext are read from its list entry, so the page
// and Find a setting can never word a row two ways. (The terminal's and
// dictation's lists went with them, 2026-10-26: Diagnostics is what is left.)

const byId = new Map(DIAGNOSTICS_OPTIONS.map((o) => [o.id, o]))

/** A core option by id. Throws on a typo, which the unit suite then finds. */
export function opt(id: string): (typeof DIAGNOSTICS_OPTIONS)[number] {
  const o = byId.get(id)
  if (!o) throw new Error(`no settings option ${id}`)
  return o
}
