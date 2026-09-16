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
import { BrowseIcon } from './BrowseIcon'
import type { BrowsePlace, FolderBrowserProps } from './types'
import './quick-access.css'
import { useFolderDrop } from './useFolderDrop'

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
>

function isPinDrag(event: DragEvent): boolean {
  return event.dataTransfer.types.includes(QUICK_ACCESS_PIN_MIME)
}

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
  onDropInto
}: Props): JSX.Element {
  const folderDrop = useFolderDrop(onDropInto)
  const pins =
    quickAccess ??
    places
      .filter((place) => place.group === 'Quick access')
      .map((place) => ({ path: place.path, label: place.label, isFolder: true }))
  const [menu, setMenu] = useState<{
    pin: QuickAccessPin
    x: number
    y: number
    pinned: boolean
  } | null>(null)
  const [drop, setDrop] = useState<{ before?: string } | null>(null)
  const [dragging, setDragging] = useState<string | null>(null)
  const groups: BrowsePlace['group'][] = ['Projects', 'This PC']
  const over = (event: DragEvent, before?: string): void => {
    event.preventDefault()
    event.stopPropagation()
    if (!isPinDrag(event)) {
      event.dataTransfer.dropEffect = 'none'
      setDrop(null)
      return
    }
    event.dataTransfer.dropEffect = 'move'
    setDrop({ before })
  }
  const land = (event: DragEvent): void => {
    event.preventDefault()
    event.stopPropagation()
    setDrop(null)
    setDragging(null)
    if (!isPinDrag(event)) return
    // The release can arrive before React paints the final hover update.
    // Choose the insertion point from the actual drop position, not that state.
    const row = (event.target as Element).closest<HTMLElement>('[data-quick-access-path]')
    const at = row ? pins.findIndex((pin) => pin.path === row.dataset.quickAccessPath) : -1
    const box = row?.getBoundingClientRect()
    const before = box && at >= 0
      ? event.clientY < box.top + box.height / 2 ? pins[at].path : pins[at + 1]?.path
      : undefined
    const moving = event.dataTransfer.getData(QUICK_ACCESS_PIN_MIME)
    if (moving && pins.some((pin) => sameQuickAccessPath(pin.path, moving)))
      onMoveQuickAccess?.(moving, before)
  }
  const menuIndex = menu
    ? pins.findIndex((pin) => sameQuickAccessPath(pin.path, menu.pin.path))
    : -1
  return (
    <aside className="browse-places" aria-label="Locations">
      <nav>
        <section
          aria-label="Quick access"
          className="quick-access"
          data-drop-end={drop && !drop.before ? '' : undefined}
          onDragOver={(event) => over(event)}
          onDrop={land}
          onDragLeave={(event) => {
            if (
              !(event.relatedTarget instanceof Node) ||
              !event.currentTarget.contains(event.relatedTarget)
            )
              setDrop(null)
          }}
        >
          <h2>Quick access</h2>
          {!pins.length && (
            <p className="quick-access-empty">Right-click a file or folder to pin it here.</p>
          )}
          {pins.map((pin, index) => {
            const current = pin.isFolder && sameQuickAccessPath(pin.path, directory)
            const ext = /\.[^.\\/]+$/.exec(pin.path)?.[0].toLowerCase() ?? ''
            const destination = pin.isFolder ? folderDrop(pin.path) : undefined
            return (
              <button
                key={pin.path}
                className="browse-place quick-access-pin"
                {...destination}
                data-quick-access-path={pin.path}
                data-drop-before={drop?.before === pin.path ? '' : undefined}
                data-dragging={dragging === pin.path ? '' : undefined}
                draggable={!!onMoveQuickAccess}
                aria-current={current ? 'location' : undefined}
                onClick={() =>
                  pin.isFolder ? onNavigate(pin.path) : onQuickAccessFile?.(pin.path)
                }
                onContextMenu={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  setMenu({ pin, x: event.clientX, y: event.clientY, pinned: true })
                }}
                onKeyDown={(event) => {
                  if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10'))
                    return
                  event.preventDefault()
                  const box = event.currentTarget.getBoundingClientRect()
                  setMenu({ pin, x: box.left + 20, y: box.bottom, pinned: true })
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
                    else over(event)
                    return
                  }
                  const box = event.currentTarget.getBoundingClientRect()
                  over(
                    event,
                    event.clientY < box.top + box.height / 2 ? pin.path : pins[index + 1]?.path
                  )
                }}
                onDrop={(event) => {
                  if (!isPinDrag(event) && destination) destination.onDrop(event)
                  else land(event)
                }}
                title={pin.path}
              >
                {pin.isFolder ? (
                  pin.label === 'Home' ? (
                    <BrowseIcon name="home" />
                  ) : (
                    <FolderIcon color={current ? 'currentColor' : 'var(--p-tree-folder)'} />
                  )
                ) : (
                  <KindIcon
                    kind={fileKind(ext, pin.label)}
                    ext={ext}
                    name={pin.label}
                    size={18}
                    color="var(--p-text-soft)"
                  />
                )}
                <span>{pin.label}</span>
              </button>
            )
          })}
        </section>
        {groups.map((group) => {
          const entries = places.filter((place) => place.group === group)
          return entries.length ? (
            <section key={group} aria-label={group}>
              <h2>{group}</h2>
              {entries.map((place) => {
                const current = sameQuickAccessPath(place.path, directory)
                const showMenu = (x: number, y: number): void =>
                  setMenu({
                    pin: { path: place.path, label: place.label, isFolder: true },
                    x,
                    y,
                    pinned: pins.some((pin) => sameQuickAccessPath(pin.path, place.path))
                  })
                return (
                  <button
                    key={place.path}
                    className="browse-place"
                    {...folderDrop(place.path)}
                    aria-current={current ? 'location' : undefined}
                    onClick={() => onNavigate(place.path)}
                    title={place.path}
                    onContextMenu={(event) => {
                      event.preventDefault()
                      event.stopPropagation()
                      showMenu(event.clientX, event.clientY)
                    }}
                    onKeyDown={(event) => {
                      if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10'))
                        return
                      event.preventDefault()
                      const box = event.currentTarget.getBoundingClientRect()
                      showMenu(box.left + 20, box.bottom)
                    }}
                  >
                    {group === 'This PC' ? (
                      <BrowseIcon name="drive" />
                    ) : (
                      <FolderIcon color={current ? 'currentColor' : 'var(--p-tree-folder)'} />
                    )}
                    <span>{place.label}</span>
                  </button>
                )
              })}
            </section>
          ) : null
        })}
      </nav>
      <button
        className="browse-terminal"
        onClick={() =>
          onOpenProject
            ? onOpenProject({ path: directory, name: directory, isFolder: true })
            : onNewTerminal(directory)
        }
        title={
          onOpenProject ? `Open ${directory} as a project` : `New terminal tab in ${directory}`
        }
      >
        <BrowseIcon name={onOpenProject ? 'open' : 'terminal'} />
        <span>{onOpenProject ? 'Open as project here' : 'New terminal here'}</span>
      </button>
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            {
              label: 'Open',
              icon: <FileMenuIcon name="open" />,
              onPick: () => menu.pin.isFolder
                ? onNavigate(menu.pin.path)
                : onQuickAccessFile?.(menu.pin.path)
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
                    onPick: () => onMoveQuickAccess?.(menu.pin.path, pins[menuIndex - 1]?.path)
                  },
                  {
                    label: 'Move down',
                    icon: <FileMenuIcon name="down" />,
                    disabled: !onMoveQuickAccess || menuIndex < 0 || menuIndex >= pins.length - 1,
                    onPick: () => onMoveQuickAccess?.(menu.pin.path, pins[menuIndex + 2]?.path)
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
