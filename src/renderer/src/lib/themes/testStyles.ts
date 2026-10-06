import { STYLES, type Style } from '../theme'
import { RETIRED_STYLES } from './retired'

/**
 * TEST FIXTURES, imported by tests only. The DERIVED rules (the marked-file
 * tint, the accent's fill and ink, the dims) must hold for every style that
 * has no theme table: the ten retired styles, which is what an own copy
 * saved before #298 is, and the 18 themes with their design taken off,
 * which is where an edit of a theme's ground, text or accent ends up. The
 * 18 as designed are held by `contrast.test.ts` on what Prism paints.
 */
const designless = (s: Style): Style => {
  const out: Style = { ...s, id: `${s.id}-derived` }
  delete out.table
  delete out.selection
  delete out.hc
  return out
}

export const DERIVED_STYLES: Style[] = [...RETIRED_STYLES, ...STYLES.map(designless)]
