import { useEffect, useImperativeHandle, useRef, type InputHTMLAttributes, type JSX, type Ref } from 'react'
import { DIALOG_INPUT } from 'prism-term-core/renderer/components/dialogLook'
import { selectStem } from '../lib/selectStem'
import { dialogInputKey } from './dialogInputKeys'

/**
 * THE TEXT FIELD OF EVERY DIALOG (#516): the password field's box and keys.
 * It focuses itself on mount (the Modal leaves a focused field alone) and
 * selects what `select` says. `onEnter` answers on Enter when `canEnter`.
 * `onKeyDown` is for keys of its own (a list's arrows), after the stop.
 */
export function DialogInput({
  select,
  stemOf,
  onEnter,
  canEnter = true,
  onKeyDown,
  className = '',
  ref,
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'onKeyDown'> & {
  /** What is selected on open: all of it, up to the extension of `stemOf`, or nothing. */
  select?: 'all' | 'stem'
  stemOf?: string
  onEnter?: () => void
  canEnter?: boolean
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void
  ref?: Ref<HTMLInputElement>
}): JSX.Element {
  const own = useRef<HTMLInputElement>(null)
  useImperativeHandle(ref, () => own.current as HTMLInputElement)
  useEffect(() => {
    const el = own.current
    if (!el) return
    el.focus()
    if (select === 'all') el.select()
    else if (select === 'stem') selectStem(el, stemOf ?? el.value)
    // Once, on open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return (
    <input
      {...rest}
      ref={own}
      onKeyDown={(e) => {
        if (!dialogInputKey(e, canEnter, onEnter)) onKeyDown?.(e)
      }}
      className={`${DIALOG_INPUT} ${className}`.trim()}
    />
  )
}