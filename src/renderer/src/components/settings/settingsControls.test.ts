import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// SETTINGS CONTROLS ARE NEUTRAL AND ONLY SAVE WEARS THE ACCENT (owner,
// 2026-09-23, #202). Since the grouped cards redesign (2026-10-05, #292) the
// controls are prism-term-core's (`renderer/settings/fields.tsx`, held there by
// its own `neutralControls.test.ts`), so this holds Prism's pages to USING
// them: no local copy of a control, and the accent only on what is a mark,
// not a button. Read as source.
const files = readdirSync(__dirname)
  .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f))
  .map((f) => ({ f, src: readFileSync(join(__dirname, f), 'utf8').replace(/\r\n/g, '\n') }))
const ACCENT = /--p-(accent|accent-hi|accent-solid|on-accent|sel-bg|sel-tint|sel-line)\b/

describe('settings controls', () => {
  it("are the core's: no page keeps a copy of its own", () => {
    const local = files.flatMap(({ f, src }) =>
      [...src.matchAll(/\bfunction (Switch|Segmented|Select|SaveButton|Pref|Section|ThemeHead)\b|\bconst (ROW_BUTTON|SEGMENT_ON|SWITCH_ON|SWITCH_KNOB_ON|ROWS)\b/g)].map(
        (m) => `${f}: ${m[0]}`
      )
    )
    expect(local).toEqual([])
    expect(files.some(({ src }) => /from 'prism-term-core\/renderer\/settings\/fields'/.test(src))).toBe(true)
  })

  // Still accented, since they are not buttons: the chosen card's ring, the
  // chosen swatch's ring, the band slider's thumb and the progress bars drawn
  // inside a style's preview card. The Win+E switch was an exception until
  // #318; it is the core's switch now, like every other.
  it('the accent is only on marks, never on a button', () => {
    const allowed = ['cards.tsx', 'ColourSchemes.tsx', 'MediaPage.tsx', 'TransportMini.tsx']
    const worn = files.filter(({ src }) => ACCENT.test(src)).map(({ f }) => f)
    expect(worn.filter((f) => !allowed.includes(f))).toEqual([])
  })

  // EVERY SWITCH IS THE CORE'S (#318; owner, 2026-10-07: "toggles differ in
  // look"). The Win+E row and the phone server each drew their own, the accent
  // with a white knob, beside the core's. No file in the renderer may draw a
  // switch of its own: one look, and the core decides it.
  it("every switch in the app is the core's", () => {
    const root = join(__dirname, '..', '..')
    const own = (readdirSync(root, { recursive: true }) as string[])
      .filter((f) => /\.tsx$/.test(f) && !/\.test\.tsx$/.test(f))
      .filter((f) => /role="switch"/.test(readFileSync(join(root, f), 'utf8')))
    expect(own).toEqual([])
  })

  it('Default apps and Clear are row buttons', () => {
    const explorer = files.find(({ f }) => f === 'ExplorerPage.tsx')!.src
    expect(explorer).toMatch(/id="default-apps"[\s\S]{0,120}className=\{ROW_BUTTON\}/)
    expect(explorer).toMatch(/id="remember-folders-clear"\s+className=\{ROW_BUTTON\}/)
  })
})
