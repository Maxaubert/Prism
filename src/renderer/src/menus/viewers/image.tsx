/**
 * The picture's menu: what you get right-clicking an image in the viewer
 * (ImageView's stage, also a picture inside an archive).
 */
import type { Dispatch, SetStateAction } from 'react'
import type { MenuItem } from '../../components/ContextMenu'
import { FileMenuIcon } from '../../components/icons/FileMenuIcon'
import { fileVerbs } from '../fileVerbs'
import { tickIf } from '../../components/icons/menuGlyphs'
import { saveSlideSeconds, SLIDE_SECONDS, type SlideSeconds } from '../../lib/slideshow'

export interface ImageMenuContext {
  /** The file on disk; absent for a picture with no path of its own. */
  path?: string
  /** Whether the picture has loaded: Copy image and Save a copy grey out until it has. */
  hasImage: boolean
  /** Whether the folder can be stepped (the viewer was given onStep and canStep). */
  canSlideshow: boolean
  slideshow: boolean
  slideSecs: SlideSeconds
  rotate: () => void
  copyImage: () => Promise<void>
  saveCopy: (format: 'png' | 'jpeg') => Promise<void>
  setSlideshow: Dispatch<SetStateAction<boolean>>
  setSlideSecs: (n: SlideSeconds) => void
}

/**
 * The picture's own menu (2026-08-30, cut back 2026-08-31).
 *
 * It started as everything the picture could do and read like a toolbar:
 * next, previous, zoom in, zoom out, fit, actual size, rotate, fullscreen,
 * copy, and a shortcut against nearly every row. All of that was already
 * one press or one button away - the arrows page the folder, the zoom
 * cluster sits in the corner, F is fullscreen - so the menu was teaching
 * keys nobody needed taught and burying the two verbs that are only here.
 *
 * What is left is what you cannot do another way with a pointer: turn the
 * picture, take the PIXELS (which for a HEIC or a RAW is the one thing
 * Windows itself cannot do), and get to the file. Shared action icons keep
 * the menu consistent with the Explorer and project menus.
 */
export function imageMenu(ctx: ImageMenuContext): MenuItem[] {
  const { path, hasImage: img, slideshow, slideSecs, setSlideshow, setSlideSecs } = ctx
  const verbs = path ? fileVerbs(path, { icons: true }) : []
  // Copy image and Copy path side by side (owner, 2026-10-12: the clipboard
  // rows in one place); Show in File Explorer last.
  const copyPath = verbs.filter((item) => item.label === 'Copy path')
  return [
    { label: 'Rotate', icon: <FileMenuIcon name="rotate" />, onPick: () => ctx.rotate() },
    // The pixels go to the OS clipboard and the copy through main's save
    // dialog: neither exists on the phone (#106), so the rows are left out
    // rather than offered and refused.
    ...(window.prism.capabilities.clipboard
      ? [
          {
            label: 'Copy image',
            icon: <FileMenuIcon name="copy" />,
            disabled: !img,
            onPick: () => void ctx.copyImage()
          }
        ]
      : []),
    ...copyPath,
    ...(window.prism.capabilities.write
      ? [
          {
            label: 'Save a copy',
            icon: <FileMenuIcon name="save" />,
            disabled: !img,
            children: [
              {
                label: 'PNG',
                icon: <FileMenuIcon name="image" />,
                onPick: () => void ctx.saveCopy('png')
              },
              {
                label: 'JPEG',
                icon: <FileMenuIcon name="image" />,
                onPick: () => void ctx.saveCopy('jpeg')
              }
            ]
          }
        ]
      : []),
    ...(ctx.canSlideshow
      ? [
          {
            label: slideshow ? 'Stop slideshow' : 'Slideshow',
            icon: <FileMenuIcon name={slideshow ? 'stop' : 'slideshow'} />,
            // The interval hangs off the same row, so starting one and saying
            // how fast it goes are one gesture rather than two.
            onPick: () => setSlideshow((on) => !on),
            children: SLIDE_SECONDS.map((n) => ({
              label: `${n} seconds`,
              icon: tickIf(n === slideSecs),
              onPick: () => {
                setSlideSecs(n)
                saveSlideSeconds(n)
                setSlideshow(true)
              }
            }))
          } as MenuItem
        ]
      : []),
    ...verbs.filter((item) => !copyPath.includes(item))
  ]
}
