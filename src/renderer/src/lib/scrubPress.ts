/** Only the main button seeks (audit #19): a right press fires pointerdown
 *  (button 2) before contextmenu, and the player menu would open on a jump. */
export const seeksOnPress = (button: number): boolean => button === 0
