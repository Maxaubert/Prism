import type { JSX, ReactNode } from 'react'
import { followsHostStyle, hostOwnsWindowAcrylic } from '../host'
import {
  FONT_PCTS,
  TERM_FONTS,
  setAgentColor,
  setAgentDoneColor,
  setAgentQuestionColor,
  setTermAcrylic,
  setTermFontId,
  setTermFontPct,
  useAgentColorChoice,
  useAgentDoneColorChoice,
  useAgentQuestionColorChoice,
  useTermAcrylic,
  useTermFontId,
  useTermFontPct
} from '../lib/termLook'
import { useAgentColors } from '../lib/agentColors'
import { Pref, RESET_LINK, ROWS, SaveButton, Select, Switch, ThemeHead } from './fields'
import { ColourField } from './ColourPicker'
import { AgentIndicatorSetting, AttentionSettings } from './TerminalBehaviour'
import { ThemeWall } from './theme/ThemeWall'
import { useNoAcrylic, useTermSetup } from './theme/useTermSetup'
import { acrylicLabel, saveSetupTitle } from './sections/opts'

// THE TERMINAL'S LOOK, as one settings section for both hosts (#15): the theme
// wall and its editor, font, size, acrylic, and the two agent indicator
// colours. It WRITES STORES and nothing else; whoever hosts it listens to
// onTermLookChange and repaints what it owns. Each app composes its own page
// round this; the rows, their names, types and behaviour are the same code.
//
// LEGACY (2026-10-05): the grouped cards redesign draws the same rows from
// `sections/`. This layout is kept, unchanged, until Prism has moved off it
// (core README, "kept for the transition"); the wall, the dirty check and the
// save are the extracted pieces in `theme/`, shared by both.

/**
 * `afterFont`: an app's OWN rows, placed right under Font size (owner,
 * 2026-09-22: "move those settings, bg and accent, to the top of the list
 * right under font and font size"). The rows stay the app's - Prism passes
 * nothing, since its window colours belong to its app style - and the core
 * only lends them the place.
 */
export function TerminalAppearanceSettings({
  beforeTheme,
  afterTheme,
  withIndicator = false,
  onThemePicked
}: {
  /** The host's own rows that belong to no theme, drawn first (Prism
   *  Terminal: Tab width and Edges). */
  beforeTheme?: ReactNode
  /** The host's own rows that a theme sets, drawn right under the theme wall
   *  (Prism Terminal: Background colour and Accent colour). */
  afterTheme?: ReactNode
  /** Draw the Agent indicator row here, with the font above the theme wall
   *  (2026-09-28; its style belongs to no theme). Opt-in, so a host that
   *  still places the row itself never shows it twice. */
  withIndicator?: boolean
  /** A theme card was picked (Custom included), after the pick landed. For a
   *  host whose OWN rows follow the theme (owner, 2026-09-23: switching theme
   *  should change "the altered bg and accent colours" too): Prism Terminal
   *  forgets its picked background and accent here. Prism passes nothing. */
  onThemePicked?: () => void
} = {}): JSX.Element {
  const fontPct = useTermFontPct()
  const fontId = useTermFontId()
  const acrylicOn = useTermAcrylic()
  // The CHOICES ('' = follow the theme) are what is saved and compared; the
  // colours in force are what the swatches show.
  const agentCol = useAgentColorChoice()
  const doneCol = useAgentDoneColorChoice()
  const questionCol = useAgentQuestionColorChoice()
  const inForce = useAgentColors()
  const { dirty: termDirty, save: saveTermSetup } = useTermSetup()
  // The theme Background's alpha is the window's see-through here (#114).
  const windowAcrylic = hostOwnsWindowAcrylic()
  const noAcrylic = useNoAcrylic()
  // Where the terminal owns the window acrylic, the see-through window (#156);
  // in Prism the name this row always had.
  const acrylicName = windowAcrylic ? acrylicLabel() : 'Acrylic background'
  return (
    <div className={ROWS}>
      {/* WHAT NO THEME OWNS COMES FIRST (owner, 2026-09-28: font and font size
          "should transcend" the theme's save, "so changing a theme should not
          reset the font and font size or if you use a minimal or full agent
          indicator, or edges. those options should be above the themes in the
          list so the themes and save button appear under it"). The host's own
          such rows lead (Prism Terminal: Tab width, Edges), then the font, its
          size and the indicator's style; the theme wall and its Save follow,
          and under them only what a theme DOES set. */}
      {beforeTheme}
      <Pref id="term-font-family" label="Font" hint="The typeface used in the terminal.">
        <Select
          id="term-font-family"
          value={fontId}
          onChange={setTermFontId}
          options={TERM_FONTS.map((f) => ({ id: f.id, name: f.name, style: { fontFamily: f.stack } }))}
        />
      </Pref>
      <Pref
        id="term-font"
        label="Font size"
        hint="The text size for every terminal."
      >
        <Select
          id="term-font"
          value={String(fontPct)}
          onChange={(v) => setTermFontPct(Number(v))}
          options={FONT_PCTS.map((p) => ({ id: String(p), name: `${p}%` }))}
        />
      </Pref>
      {withIndicator && <AgentIndicatorSetting />}
      {withIndicator && <AttentionSettings />}
      <div data-pref="term-theme" className="border-b border-[color:var(--p-line)] py-2.5">
        <ThemeHead
          // Where the host has styles of its own the window wears THOSE; only a
          // host with none (Prism Terminal) dresses its window in the theme.
          sub={
            followsHostStyle()
              ? 'The colours of the terminal text and background.'
              : 'The colours of the terminal and the window around it.'
          }
          save={
            <SaveButton
              dirty={termDirty}
              onClick={saveTermSetup}
              title={saveSetupTitle()}
            />
          }
        />
        <ThemeWall onThemePicked={onThemePicked} className="mt-3" />
      </div>
      {afterTheme}
      {/* The material does not exist before Windows 11, so there the row says
          why instead of offering a switch that would do nothing. */}
      <Pref
        id="term-acrylic"
        label={acrylicName}
        off={noAcrylic}
        hint={
          noAcrylic
            ? 'Needs Windows 11.'
            : windowAcrylic
              ? 'Lets the desktop show through the window and terminal. The background colour sets how much.'
              : 'Gives the terminal the same see through surface as the app. When off, the terminal has a solid background.'
        }
      >
        <Switch
          on={acrylicOn && !noAcrylic}
          onChange={setTermAcrylic}
          label={acrylicName}
          disabled={noAcrylic}
        />
      </Pref>
      <Pref
        id="agent-color"
        label="Working colour"
        hint={
          agentCol
            ? 'The colour a tab shows while its agent is working. Uses your own colour.'
            : 'The colour a tab shows while its agent is working. Follows the theme accent.'
        }
      >
        <div className="flex items-center gap-2.5">
          {agentCol && (
            <button data-follow-theme="working" onClick={() => setAgentColor('')} className={RESET_LINK}>
              Reset
            </button>
          )}
          <ColourField label="Working colour" value={inForce.working} onChange={setAgentColor} onRevert={() => setAgentColor(agentCol)} />
        </div>
      </Pref>
      <Pref
        id="agent-done-color"
        label="Finished colour"
        hint={
          doneCol
            ? 'The colour a tab keeps after its agent finishes, until you open it. Uses your own colour.'
            : 'The colour a tab keeps after its agent finishes, until you open it. Follows the theme green.'
        }
      >
        <div className="flex items-center gap-2.5">
          {doneCol && (
            <button data-follow-theme="finished" onClick={() => setAgentDoneColor('')} className={RESET_LINK}>
              Reset
            </button>
          )}
          <ColourField label="Finished colour" value={inForce.finished} onChange={setAgentDoneColor} onRevert={() => setAgentDoneColor(doneCol)} />
        </div>
      </Pref>
      <Pref
        id="agent-question-color"
        label="Question colour"
        hint={
          questionCol
            ? 'The colour a tab shows while its agent waits for your answer, until you open it. Uses your own colour.'
            : 'The colour a tab shows while its agent waits for your answer, until you open it. Follows the theme.'
        }
      >
        <div className="flex items-center gap-2.5">
          {questionCol && (
            <button data-follow-theme="question" onClick={() => setAgentQuestionColor('')} className={RESET_LINK}>
              Reset
            </button>
          )}
          <ColourField label="Question colour" value={inForce.question} onChange={setAgentQuestionColor} onRevert={() => setAgentQuestionColor(questionCol)} />
        </div>
      </Pref>
    </div>
  )
}
