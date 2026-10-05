import type { JSX } from 'react'
import { Glyph } from 'prism-term-core/renderer/settings/layout/Glyph'
import { deletePreset, setStyle, useMode, useSelectedId, useStyle, useStyles } from '../../lib/theme'
import { StyleMini } from '../StyleMini'
import { CARD_GRID, Tile, TileFooter } from './cards'

/**
 * THE STYLE WALL: the styles of the current mode, then the saved presets.
 * Once a colour is changed nothing here is selected but the card being
 * edited: what is on screen is no longer any of these, and clicking one is
 * how you go back to it.
 */
export function StyleWall(): JSX.Element {
  const style = useStyle()
  const mode = useMode()
  const selected = useSelectedId()
  const list = useStyles(mode)
  return (
    <div className={CARD_GRID}>
      {list.map((st) => {
        // The CURRENT style's card is live: it renders the edited style, so
        // turning Void white turns its card white with it. It also stays
        // selected through an edit - the user reads it as "my theme", and a
        // wall with nothing selected read as a bug. Clicking it while edited
        // does nothing (setStyle would silently revert the edits); every
        // other card still shows its saved self and gives what it shows.
        const live = st.id === style.id
        const on = st.id === (selected ?? style.id)
        return (
          <Tile
            key={st.id}
            on={on}
            onClick={() => {
              if (live && selected === null) return
              setStyle(st.id)
            }}
          >
            <StyleMini st={live ? style : st} />
            <div className="flex items-center justify-between gap-2">
              <TileFooter name={st.name} on={on} />
              {st.custom && (
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    deletePreset(st.id)
                  }}
                  aria-label={`Delete ${st.name}`}
                  title="Delete preset"
                  className="grid h-5 w-5 shrink-0 place-items-center rounded-[var(--p-radius-sm)] text-[var(--p-dim2)] opacity-0 transition hover:bg-[var(--p-hover)] hover:text-[var(--p-text)] focus-visible:opacity-100 group-hover:opacity-100"
                >
                  <Glyph name="x" size={13} stroke={2} />
                </button>
              )}
            </div>
          </Tile>
        )
      })}
    </div>
  )
}
