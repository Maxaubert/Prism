import { isResumable, type DetectedAgent } from '../../shared/types'

// What AgentIcon draws, pure (the component is components/AgentIcon.tsx).

export type IconKind = DetectedAgent | 'shell' | 'settings'

/** Which mark a tab wears: the agent in its shell, else the shell's own. */
export function iconKind(agent: DetectedAgent | null | undefined, settings = false): IconKind {
  if (settings) return 'settings'
  return isResumable(agent) ? agent : 'shell'
}

/** Clawd's colour, as Claude Code draws it in the terminal. */
export const CLAWD_ORANGE = '#d77757'

/**
 * CLAWD, from Claude Code's start screen, which draws it in block characters:
 *
 *      ▐▛███▜▌
 *     ▝▜█████▛▘
 *       ▘▘ ▝▝
 *
 * One quadrant of a character cell is one pixel here, [x, y] on an 18 x 6
 * grid. A terminal cell is twice as tall as it is wide, so each pixel is
 * drawn twice as tall too, or Clawd comes out squat.
 */
export const CLAWD_PIXELS: ReadonlyArray<readonly [number, number]> = (() => {
  const px: Array<[number, number]> = [
    // ▐ and ▛ (its missing quarter is the left eye), ▜ (the right eye) and ▌
    [3, 0], [3, 1], [4, 0], [5, 0], [4, 1], [12, 0], [13, 0], [13, 1], [14, 0], [14, 1],
    // ▝▜ and ▛▘: the arms
    [1, 2], [2, 2], [3, 2], [3, 3], [14, 2], [15, 2], [14, 3], [16, 2],
    // ▘▘ ▝▝: the legs
    [4, 4], [6, 4], [11, 4], [13, 4]
  ]
  for (let x = 6; x <= 11; x++) px.push([x, 0], [x, 1])
  for (let x = 4; x <= 13; x++) px.push([x, 2], [x, 3])
  return px
})()

/** The OpenAI mark (Simple Icons 15, CC0 path data; the mark is OpenAI's). */
export const OPENAI_PATH =
  'M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z'

/** The cog that means Settings: the title bar's button, the start screen's
 *  row and the Settings tab draw this one path with an r=3 circle, so they
 *  never part (owner, 2026-10-13, picking the tab's icon: "the title bar
 *  cog"). Here, in core, so the tab's AgentIcon can draw it. */
export const COG_PATH =
  'M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.01a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.01a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z'
