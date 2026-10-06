import { useState, type DragEvent, type JSX } from 'react'
import { fileKind } from '@shared/fileKind'
import { FolderIcon, KindIcon } from '../TreeRows'
import { ContextMenu } from '../ContextMenu'
import { FileMenuIcon } from '../FileMenuIcon'
import { fileVerbs } from '../../lib/fileVerbs'
import { setDrag } from '../../lib/dragDrop'
import {
  QUICK_ACCESS_PIN_MIME,
  sameQuickAccessPath,
  type QuickAccessPin
} from '../../lib/quickAccess'
import { useDriveStyle } from '../../lib/driveStylePrefs'
import { useDriveUsage } from '../../lib/useDriveUsage'
import { nearlyFull } from '../../lib/driveUsage'
import { DriveBody } from './DriveRow'
import { PlaceIcon } from './PlaceIcon'
import { PeekPinButton } from '../PanelToggle'
import type { BrowsePlace, FolderBrowserProps } from './types'
import './quick-access.css'
import './drive-rows.css'
import { useFolderDrop } from './useFolderDrop'
import { markedPlace, type PlaceRow } from '../../lib/placeMark'

type Props = Pick<
  FolderBrowserProps,
  | 'places'
  | 'directory'
  | 'onNavigate'
  | 'onNewTerminal'
  | 'quickAccess'
  | 'onQuickAccessFile'
  | 'onUnpinQuickAccess'
  | 'onMoveQuickAccess'
  | 'onPinQuickAccessPaths'
  | 'onDropInto'
  | 'onOpenProject'
  | 'onOpenNewTab'
  | 'readDrives'
>

type PlacesProps = Props & {
  /** Set only while the panel PEEKS (#250): the header's toggle pins it. */
  onPin?: () => void
  /** The place last clicked (FolderBrowser holds it, lib/placeMark.ts). */
  chosenPlace?: PlaceRow | null
  onChoosePlace?: (place: PlaceRow) => void
}

/** The two halves of the one pin list (#296): Windows' own folders, then
 *  what the user pinned. One store, one order; each half is shown apart. */
type PinSection = 'Quick access' | 'Pinned'

function isPinDrag(event: DragEvent): boolean {
  return event.dataTransfer.types.includes(QUICK_ACCESS_PIN_MIME)
}

const lastName = (path: string): string =>
  /[^\\/]*$/.exec(path.replace(/[\\/]+$/, ''))?.[0] || path

/**
 * THE PLACES PANEL (#296; owner, 2026-10-06, of the themes mockup: "i really
 * like the sidebar from here, so use that, with the icons and the disks with a
 * bar showing how much is in use"). Quick access is the pins that ARE a
 * Windows Known Folder, each with its own glyph; Pinned is every other pin;
 * then Projects; then This PC, each drive with its usage bar and free line.
 * The pin list is still ONE store in one order (`quickAccess.ts`): an unpinned
 * Desktop stays gone, a re-pinned one comes back under Quick access, and a pin
 * moves only among its own section's rows.
 */
export function BrowsePlaces({
  places,
  directory,
  onNavigate,
  onNewTerminal,
  onOpenProject,
  onOpenNewTab,
  quickAccess,
  onQuickAccessFile,
  onUnpinQuickAccess,
  onMoveQuickAccess,
  onPinQuickAccessPaths,
  onDropInto,
  readDrives,
  onPin,
  chosenPlace = null,
  onChoosePlace
}: PlacesProps): JSX.Element {
  const folderDrop = useFolderDrop(onDropInto)
  const pins =
    quickAccess ??
    places
      .filter((place) => place.group === 'Quick access')
      .map((place) => ({ path: place.path, label: place.label, isFolder: true }))
  const knownOf = (pin: QuickAccessPin): BrowsePlace['known'] =>
    pin.isFolder
      ? places.find(
          (place) =>
            place.group === 'Quick access' && place.known && sameQuickAccessPath(place.path, pin.path)
        )?.known
      : undefined
  const sections: Record<PinSection, QuickAccessPin[]> = {
    'Quick access': pins.filter((pin) => knownOf(pin)),
    Pinned: pins.filter((pin) => !knownOf(pin))
  }
  const sectionOf = (path: string): PinSection =>
    sections['Quick access'].some((pin) => sameQuickAccessPath(pin.path, path))
      ? 'Quick access'
      : 'Pinned'
  const drives = places.filter((place) => place.group === 'This PC')
  const usage = useDriveUsage(
    drives.map((drive) => drive.path),
    readDrives
  )
  const driveLook = useDriveStyle()
  const [menu, setMenu] = useState<{
    pin: QuickAccessPin
    x: number
    y: number
    pinned: boolean
    /** Which row opened it, so that row alone wears the menu's tint: a
     *  pinned project is a pin AND a Projects row, one path in two places. */
    row: string
  } | null>(null)
  const [drop, setDrop] = useState<{ section: PinSection; before?: string } | null>(null)
  const [dragging, setDragging] = useState<string | null>(null)
  const over = (event: DragEvent, section: PinSection, before?: string): void => {
    event.preventDefault()
    event.stopPropagation()
    // A pin moves among its own section's rows: a Pinned folder dropped in
    // Quick access would land back under Pinned anyway.
    if (!isPinDrag(event) || !dragging || sectionOf(dragging) !== section) {
      event.dataTransfer.dropEffect = 'none'
      setDrop(null)
      return
    }
    event.dataTransfer.dropEffect = 'move'
    setDrop({ section, before })
  }
  const land = (event: DragEvent, section: PinSection): void => {
    event.preventDefault()
    event.stopPropagation()
    setDrop(null)
    setDragging(null)
    if (!isPinDrag(event)) return
    const list = sections[section]
    // The release can arrive before React paints the final hover update.
    // Choose the insertion point from the actual drop position, not that state.
    const row = (event.target as Element).closest<HTMLElement>('[data-quick-access-path]')
    const at = row ? list.findIndex((pin) => pin.path === row.dataset.quickAccessPath) : -1
    const box = row?.getBoundingClientRect()
    const before = box && at >= 0
      ? event.clientY < box.top + box.height / 2 ? list[at].path : list[at + 1]?.path
      : undefined
    const moving = event.dataTransfer.getData(QUICK_ACCESS_PIN_MIME)
    if (moving && list.some((pin) => sameQuickAccessPath(pin.path, moving)))
      onMoveQuickAccess?.(moving, before)
  }
  const projects = places.filter((place) => place.group === 'Projects')
  // ONE PLACE IS MARKED (#296; owner, 2026-10-06), File Explorer's rule
  // (lib/placeMark.ts): the one clicked while the folder is inside it, else
  // the first whose path IS the folder. aria-current is on that row alone.
  const placeRows: PlaceRow[] = [
    ...[...sections['Quick access'], ...sections.Pinned]
      .filter((pin) => pin.isFolder)
      .map((pin) => ({ row: `pin:${pin.path}`, path: pin.path })),
    ...[...projects, ...drives].map((place) => ({ row: `place:${place.path}`, path: place.path }))
  ]
  const marked = markedPlace(placeRows, directory, chosenPlace)
  // While a menu is open on ANOTHER row, the mark is not drawn (owner, same
  // day: "both are equally highlighted which makes it seem like the right
  // click action is targeting both"); it comes back when the menu shuts.
  const markOf = (row: string): Record<string, string | undefined> =>
    row === marked
      ? {
          'aria-current': 'location',
          'data-mark-hidden': menu && menu.row !== row ? '' : undefined
        }
      : {}
  const choose = (row: string, path: string): void => onChoosePlace?.({ row, path })
  const menuList = menu ? sections[sectionOf(menu.pin.path)] : []
  const menuIndex = menu
    ? menuList.findIndex((pin) => sameQuickAccessPath(pin.path, menu.pin.path))
    : -1
  const pinSection = (section: PinSection): JSX.Element | null => {
    const list = sections[section]
    // An empty section is not drawn at all (owner, 2026-10-06, of the empty
    // Pinned and its "Right-click a file or folder to pin it here." hint:
    // "hide this section when nothing's pinned"). Pinning is on the menus.
    if (!list.length) return null
    return (
      <section
        aria-label={section}
        className="quick-access"
        data-pin-section={section}
        data-drop-end={drop?.section === section && !drop.before ? '' : undefined}
        onDragOver={(event) => over(event, section)}
        onDrop={(event) => land(event, section)}
        onDragLeave={(event) => {
          if (
            !(event.relatedTarget instanceof Node) ||
            !event.currentTarget.contains(event.relatedTarget)
          )
            setDrop(null)
        }}
      >
        <h2>{section}</h2>
        {list.map((pin, index) => {
          const ext = /\.[^.\\/]+$/.exec(pin.path)?.[0].toLowerCase() ?? ''
          const destination = pin.isFolder ? folderDrop(pin.path) : undefined
          const known = knownOf(pin)
          // Home reads as the user's own folder, as the mockup has it.
          const label = known === 'home' ? lastName(pin.path) : pin.label
          return (
            <button
              key={pin.path}
              className="browse-place quick-access-pin"
              {...destination}
              data-quick-access-path={pin.path}
              data-known={known}
              data-drop-before={
                drop?.section === section && drop.before === pin.path ? '' : undefined
              }
              data-dragging={dragging === pin.path ? '' : undefined}
              // The right-clicked place wears the selection tint while its
              // menu is open (#296; owner, 2026-10-06), File Explorer's look.
              data-menu={menu?.row === `pin:${pin.path}` ? '' : undefined}
              draggable={!!onMoveQuickAccess}
              {...markOf(`pin:${pin.path}`)}
              onClick={() => {
                if (!pin.isFolder) {
                  onQuickAccessFile?.(pin.path)
                  return
                }
                choose(`pin:${pin.path}`, pin.path)
                onNavigate(pin.path)
              }}
              onDoubleClick={() => {
                if (!pin.isFolder) onQuickAccessFile?.(pin.path, true)
              }}
              onContextMenu={(event) => {
                event.preventDefault()
                event.stopPropagation()
                setMenu({ pin, x: event.clientX, y: event.clientY, pinned: true, row: `pin:${pin.path}` })
              }}
              onKeyDown={(event) => {
                if (!pin.isFolder && event.key === 'Enter') {
                  event.preventDefault()
                  event.stopPropagation()
                  onQuickAccessFile?.(pin.path, true)
                  return
                }
                if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10'))
                  return
                event.preventDefault()
                const box = event.currentTarget.getBoundingClientRect()
                setMenu({ pin, x: box.left + 20, y: box.bottom, pinned: true, row: `pin:${pin.path}` })
              }}
              onDragStart={(event) => {
                setDrag(null)
                event.dataTransfer.setData(QUICK_ACCESS_PIN_MIME, pin.path)
                event.dataTransfer.effectAllowed = 'move'
                setDragging(pin.path)
              }}
              onDragEnd={() => {
                setDrag(null)
                setDrop(null)
                setDragging(null)
              }}
              onDragOver={(event) => {
                if (!isPinDrag(event)) {
                  if (destination) destination.onDragOver(event)
                  else over(event, section)
                  return
                }
                const box = event.currentTarget.getBoundingClientRect()
                over(
                  event,
                  section,
                  event.clientY < box.top + box.height / 2 ? pin.path : list[index + 1]?.path
                )
              }}
              onDrop={(event) => {
                if (!isPinDrag(event) && destination) destination.onDrop(event)
                else land(event, section)
              }}
              title={pin.path}
            >
              {known ? (
                <PlaceIcon name={known} />
              ) : pin.isFolder ? (
                <FolderIcon color="var(--p-tree-folder)" />
              ) : (
                <KindIcon
                  kind={fileKind(ext, pin.label)}
                  ext={ext}
                  name={pin.label}
                  size={18}
                  color="var(--p-text-soft)"
                />
              )}
              <span>{label}</span>
            </button>
          )
        })}
      </section>
    )
  }
  const placeMenu = (place: BrowsePlace, x: number, y: number): void =>
    setMenu({
      pin: { path: place.path, label: place.label, isFolder: true },
      x,
      y,
      pinned: pins.some((pin) => sameQuickAccessPath(pin.path, place.path)),
      row: `place:${place.path}`
    })
  const placeButton = (
    place: BrowsePlace,
    body: JSX.Element,
    { className = '', ...attrs }: { className?: string; 'data-warn'?: string } = {}
  ): JSX.Element => (
    <button
      key={place.path}
      className={`browse-place${className}`}
      {...attrs}
      {...folderDrop(place.path)}
      {...markOf(`place:${place.path}`)}
      data-menu={menu?.row === `place:${place.path}` ? '' : undefined}
      onClick={() => {
        choose(`place:${place.path}`, place.path)
        onNavigate(place.path)
      }}
      title={place.path}
      onContextMenu={(event) => {
        event.preventDefault()
        event.stopPropagation()
        placeMenu(place, event.clientX, event.clientY)
      }}
      onKeyDown={(event) => {
        if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return
        event.preventDefault()
        const box = event.currentTarget.getBoundingClientRect()
        placeMenu(place, box.left + 20, box.bottom)
      }}
    >
      {body}
    </button>
  )
  return (
    <aside className="browse-places" aria-label="Locations">
      {onPin && (
        <div className="browse-places-peekhead">
          <PeekPinButton onPin={onPin} />
        </div>
      )}
      <nav>
        {pinSection('Quick access')}
        {pinSection('Pinned')}
        {projects.length > 0 && (
          <section aria-label="Projects">
            <h2>Projects</h2>
            {projects.map((place) =>
              placeButton(
                place,
                <>
                  <FolderIcon color="var(--p-tree-folder)" />
                  <span>{place.label}</span>
                </>
              )
            )}
          </section>
        )}
        {drives.length > 0 && (
          <section aria-label="This PC" data-drive-style={driveLook}>
            <h2>This PC</h2>
            {drives.map((place) => {
              const info = usage.get(place.path.toUpperCase())
              return placeButton(
                place,
                <DriveBody path={place.path} info={info} look={driveLook} />,
                {
                  className: ` browse-drive browse-drive-${driveLook}`,
                  // From 90% used the drive wears the warning colour.
                  ...(nearlyFull(info?.total, info?.free) ? { 'data-warn': '' } : {})
                }
              )
            })}
          </section>
        )}
      </nav>
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            {
              label: 'Open',
              icon: <FileMenuIcon name="open" />,
              onPick: () => {
                if (!menu.pin.isFolder) {
                  onQuickAccessFile?.(menu.pin.path, true)
                  return
                }
                // Open from a place's menu is a pick of that place.
                choose(menu.row, menu.pin.path)
                onNavigate(menu.pin.path)
              }
            },
            {
              label: 'Open in new tab',
              icon: <FileMenuIcon name="new-tab" />,
              disabled: !onOpenNewTab,
              onPick: () => onOpenNewTab?.(menu.pin.path, menu.pin.isFolder)
            },
            {
              label: 'Open as project',
              icon: <FileMenuIcon name="project" />,
              disabled: !onOpenProject,
              onPick: () => onOpenProject?.({
                path: menu.pin.path, name: menu.pin.label, isFolder: menu.pin.isFolder
              })
            },
            ...(menu.pin.isFolder ? [{
              label: 'New terminal here',
              icon: <FileMenuIcon name="terminal" />,
              onPick: () => onNewTerminal(menu.pin.path)
            }] : []),
            ...fileVerbs(menu.pin.path).map((item) => ({
              ...item,
              icon: <FileMenuIcon name={item.label === 'Copy path' ? 'path' : 'folder'} />
            })),
            ...(menu.pinned
              ? [
                  {
                    label: 'Unpin from Quick access',
                    icon: <FileMenuIcon name="unpin" />,
                    disabled: !onUnpinQuickAccess,
                    onPick: () => onUnpinQuickAccess?.(menu.pin.path)
                  },
                  {
                    label: 'Move up',
                    icon: <FileMenuIcon name="up" />,
                    disabled: !onMoveQuickAccess || menuIndex <= 0,
                    onPick: () =>
                      onMoveQuickAccess?.(menu.pin.path, menuList[menuIndex - 1]?.path)
                  },
                  {
                    label: 'Move down',
                    icon: <FileMenuIcon name="down" />,
                    disabled:
                      !onMoveQuickAccess || menuIndex < 0 || menuIndex >= menuList.length - 1,
                    // Before the row after next; the last row moves to the
                    // end, which is the end of its section too.
                    onPick: () =>
                      onMoveQuickAccess?.(menu.pin.path, menuList[menuIndex + 2]?.path)
                  }
                ]
              : [
                  {
                    label: 'Pin to Quick access',
                    icon: <FileMenuIcon name="pin" />,
                    disabled: !onPinQuickAccessPaths,
                    onPick: () => onPinQuickAccessPaths?.([menu.pin.path])
                  }
                ])
          ]}
        />
      )}
    </aside>
  )
}
