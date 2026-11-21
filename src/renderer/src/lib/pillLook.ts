/**
 * A pill centred with `left-1/2 -translate-x-1/2` (audit #81). An absolutely positioned box with only `left` set
 * gets its shrink-to-fit width from the room to the RIGHT of that edge, which is half the viewer, so a pill wider
 * than half the window wrapped or squashed its text. `w-max` takes the text's own width and the cap keeps it on the
 * screen (then it wraps, as a last resort, inside the window).
 */
export const CENTRED_PILL = 'w-max max-w-[calc(100%-16px)]'
/**
 * The line and column pill (bottom right) and the Save pill (bottom centre) of the code editor would overlap in a
 * narrow viewer (audit #82), so the caret pill rises above. Measured on the width of the viewer itself (a Tailwind
 * container), not the window's: the Explorer's preview pane is narrow in a wide window. The wider cut is for when
 * the Save pill carries a "Couldn't save" line.
 */
export const CARET_ABOVE = '@max-[480px]:bottom-14'
export const CARET_ABOVE_WIDE = '@max-[800px]:bottom-14'