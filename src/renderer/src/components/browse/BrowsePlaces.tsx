import type { JSX } from 'react'
import { FolderIcon } from '../TreeRows'
import { BrowseIcon } from './BrowseIcon'
import type { BrowsePlace } from './types'

export function BrowsePlaces({
  places,
  directory,
  onNavigate,
  onNewTerminal,
  onOpenProject
}: {
  places: BrowsePlace[]
  directory: string
  onNavigate: (path: string) => void
  onNewTerminal: (directory: string) => void
  onOpenProject?: () => void
}): JSX.Element {
  const groups: BrowsePlace['group'][] = ['Quick access', 'Projects', 'This PC']
  return (
    <aside className="browse-places" aria-label="Locations">
      <nav>
        {groups.map((group) => {
          const entries = places.filter((place) => place.group === group)
          return entries.length ? (
            <section key={group} aria-label={group}>
              <h2>{group}</h2>
              {entries.map((place) => {
                const current =
                  place.path.toLowerCase().replace(/[\\/]$/, '') ===
                  directory.toLowerCase().replace(/[\\/]$/, '')
                return (
                  <button
                    key={place.path}
                    className="browse-place"
                    aria-current={current ? 'location' : undefined}
                    onClick={() => onNavigate(place.path)}
                    title={place.path}
                  >
                    {group === 'This PC' ? (
                      <BrowseIcon name="drive" />
                    ) : place.label === 'Home' ? (
                      <BrowseIcon name="home" />
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
    </aside>
  )
}
