import { useState, type DragEvent, type JSX } from 'react'
import { fileKind } from '@shared/fileKind'
import { FolderIcon, KindIcon } from '../TreeRows'
import { ContextMenu } from '../ContextMenu'
import { dragPayload, droppedPaths } from '../../lib/dragDrop'
import {
  QUICK_ACCESS_PATHS_MIME,
  QUICK_ACCESS_PIN_MIME,
  sameQuickAccessPath,
  type QuickAccessPin
} from '../../lib/quickAccess'
import { BrowseIcon } from './BrowseIcon'
import type { BrowsePlace, FolderBrowserProps } from './types'
import './quick-access.css'

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
> & { onOpenProject?: () => void }

function acceptsDrop(event: DragEvent): boolean {
  const types = event.dataTransfer.types
  return (
    types.includes(QUICK_ACCESS_PIN_MIME) ||
    types.includes(QUICK_ACCESS_PATHS_MIME) ||
    types.includes('Files') ||
    dragPayload(event.dataTransfer)?.kind === 'files'
  )
}

export function BrowsePlaces({
  places,
  directory,
  onNavigate,
  onNewTerminal,
  onOpenProject,
  quickAccess,
  onQuickAccessFile,
  onUnpinQuickAccess,
  onMoveQuickAccess,
  onPinQuickAccessPaths
}: Props): JSX.Element {
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
    if (!acceptsDrop(event)) return
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = event.dataTransfer.types.includes(QUICK_ACCESS_PIN_MIME)
      ? 'move'
      : 'copy'
    setDrop({ before })
  }
  const land = (event: DragEvent): void => {
    if (!acceptsDrop(event)) return
    event.preventDefault()
    event.stopPropagation()
    const before = drop?.before
    setDrop(null)
    setDragging(null)
    const moving = event.dataTransfer.getData(QUICK_ACCESS_PIN_MIME)
    if (moving) {
      if (pins.some((pin) => sameQuickAccessPath(pin.path, moving)))
        onMoveQuickAccess?.(moving, before)
      return
    }
    const supplied = event.dataTransfer.getData(QUICK_ACCESS_PATHS_MIME)
    if (supplied) {
      try {
        const paths: unknown = JSON.parse(supplied)
        if (Array.isArray(paths))
          onPinQuickAccessPaths?.(
            paths.filter((path): path is string => typeof path === 'string'),
            before
          )
      } catch {
        /* A malformed drag payload is not a path. */
      }
      return
    }
    const inside = dragPayload(event.dataTransfer)
    onPinQuickAccessPaths?.(
      inside?.kind === 'files' ? inside.paths : droppedPaths(event.dataTransfer),
      before
    )
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
            <p className="quick-access-empty">Drag files or folders here to pin them.</p>
          )}
          {pins.map((pin, index) => {
            const current = pin.isFolder && sameQuickAccessPath(pin.path, directory)
            const ext = /\.[^.\\/]+$/.exec(pin.path)?.[0].toLowerCase() ?? ''
            return (
              <button
                key={pin.path}
                className="browse-place quick-access-pin"
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
                  event.dataTransfer.setData(QUICK_ACCESS_PIN_MIME, pin.path)
                  event.dataTransfer.effectAllowed = 'move'
                  setDragging(pin.path)
                }}
                onDragEnd={() => {
                  setDrop(null)
                  setDragging(null)
                }}
                onDragOver={(event) => {
                  const box = event.currentTarget.getBoundingClientRect()
                  over(
                    event,
                    event.clientY < box.top + box.height / 2 ? pin.path : pins[index + 1]?.path
                  )
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
        onClick={() => (onOpenProject ? onOpenProject() : onNewTerminal(directory))}
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
          items={
            menu.pinned
              ? [
                  {
                    label: 'Unpin from Quick access',
                    disabled: !onUnpinQuickAccess,
                    onPick: () => onUnpinQuickAccess?.(menu.pin.path)
                  },
                  {
                    label: 'Move up',
                    disabled: !onMoveQuickAccess || menuIndex <= 0,
                    onPick: () => onMoveQuickAccess?.(menu.pin.path, pins[menuIndex - 1]?.path)
                  },
                  {
                    label: 'Move down',
                    disabled: !onMoveQuickAccess || menuIndex < 0 || menuIndex >= pins.length - 1,
                    onPick: () => onMoveQuickAccess?.(menu.pin.path, pins[menuIndex + 2]?.path)
                  }
                ]
              : [
                  {
                    label: 'Pin to Quick access',
                    disabled: !onPinQuickAccessPaths,
                    onPick: () => onPinQuickAccessPaths?.([menu.pin.path])
                  }
                ]
          }
        />
      )}
    </aside>
  )
}
