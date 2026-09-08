/**
 * What a tap on the picture means (owner, 2026-09-08, after an iPad).
 *
 * A MOUSE has a pointer on screen: you can see the transport is gone, you
 * click to pause, and that is what the desktop has done since the beginning.
 * A FINGER has none. The chrome hides on a clock while a film plays, so on a
 * phone the first tap after two and a half seconds was always a pause nobody
 * asked for - the tap that every phone player on earth spends on bringing the
 * controls back.
 *
 * So the first tap REVEALS and the next one plays, and the rule is the pointer
 * type rather than the page: a touchscreen laptop gets the phone's behaviour
 * with its finger and the desktop's with its mouse, which is what each of them
 * means. Pen counts as a finger, the same reading the comic's page turn makes.
 *
 * An UNKNOWN pointer reads as a mouse deliberately. A click can arrive with no
 * pointer behind it at all (Enter on a focused element, a synthetic click),
 * and the safe answer there is the behaviour that was already shipped.
 *
 * The chrome's state is asked for as an ARGUMENT, and the caller reads it at
 * POINTERDOWN rather than at click: what the user was reacting to is what the
 * screen showed when the finger landed, and anything that wakes the chrome in
 * between (the window's own listeners hear a tap too) would otherwise turn the
 * reveal into a pause a millisecond after deciding it was not one.
 */
export type TapVerb = 'reveal' | 'toggle'

export function tapVerb(pointerType: string | undefined, chromeShown: boolean): TapVerb {
  const finger = pointerType === 'touch' || pointerType === 'pen'
  return finger && !chromeShown ? 'reveal' : 'toggle'
}
