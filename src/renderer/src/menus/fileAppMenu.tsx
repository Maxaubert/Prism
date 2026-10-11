import type { OpenWithApp } from '@shared/types'
import type { JSX } from 'react'
import type { MenuItem } from '../components/ContextMenu'
import { FileMenuIcon } from '../components/FileMenuIcon'

const applicationIcon = (choose = false): JSX.Element => (
  <svg
    viewBox="0 0 24 24"
    width={13}
    height={13}
    fill="none"
    stroke="currentColor"
    strokeWidth="1.7"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="shrink-0 opacity-80"
    aria-hidden
  >
    <path d={choose ? 'M12 8v8M8 12h8M3.5 5h17v14h-17z' : 'M4 5h16v14H4zM4 9h16'} />
  </svg>
)

/** Both file surfaces offer the same Windows application choices. */
export function fileAppMenu(path: string, apps: OpenWithApp[] | null | undefined): MenuItem {
  return {
    label: 'Open in',
    icon: <FileMenuIcon name="open-with" />,
    children: [
      {
        label: 'Default app',
        icon: <FileMenuIcon name="default-app" />,
        onPick: () => window.prism.openInDefault(path)
      },
      ...(apps === null
        ? [{ label: 'Looking for apps…', disabled: true }]
        : (apps ?? []).map((app) => ({
            label: app.name,
            icon: app.icon ? (
              <img src={app.icon} width={14} height={14} alt="" className="shrink-0" />
            ) : (
              applicationIcon()
            ),
            onPick: () => void window.prism.openWith(path, app.id)
          }))),
      {
        label: 'Choose another app…',
        icon: applicationIcon(true),
        onPick: () => window.prism.openWithChooser(path)
      }
    ]
  }
}
