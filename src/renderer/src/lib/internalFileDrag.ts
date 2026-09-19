import { useEffect } from 'react'
import { DRAG_MIME, getDrag, setDrag } from './dragDrop'
import { QUICK_ACCESS_PIN_MIME } from './quickAccess'

/** Chromium's native drag loop swallows Ctrl+Tab. Keep Prism cargo in the
 * renderer, delivering the same drag events to its existing drop targets. */
export function useInternalFileDrag(stepTab: (delta: number) => void): void {
  useEffect(() => {
    let pressed = false
    let carry: {
      source: Element
      data: DataTransfer
      target: Element | null
      accepted: boolean
      x: number
      y: number
      ctrl: boolean
      shift: boolean
      badge: HTMLDivElement
      cursorStyle: HTMLStyleElement
      label: string
      pin: boolean
    } | null = null
    let frame = 0
    let suppressClick = false

    const send = (type: string, target: Element): boolean => {
      if (!carry) return false
      const event = new DragEvent(type, {
        bubbles: true,
        cancelable: true,
        dataTransfer: carry.data,
        clientX: carry.x,
        clientY: carry.y,
        ctrlKey: carry.ctrl,
        shiftKey: carry.shift,
        buttons: type === 'drop' || type === 'dragend' ? 0 : 1
      })
      if (type === 'dragend' && !target.isConnected) window.dispatchEvent(event)
      else target.dispatchEvent(event)
      return event.defaultPrevented
    }
    const targetAtPointer = (): Element | null => {
      if (!carry) return null
      const target = document.elementFromPoint(carry.x, carry.y)
      // Pins carry ordering intent only, never a filesystem operation or open.
      if (carry.pin && !target?.closest('.quick-access')) return null
      return target?.closest('[inert]') ? null : target
    }
    const hover = (): void => {
      if (!carry) return
      const target = targetAtPointer()
      if (target !== carry.target) {
        if (carry.target) send('dragleave', carry.target)
        carry.target = target
        if (target) send('dragenter', target)
      }
      carry.data.dropEffect = 'none'
      carry.accepted = target ? send('dragover', target) : false
      // The dispatched target sets the effect synchronously; TypeScript cannot
      // see that mutation and otherwise retains the preceding 'none' narrowing.
      const effect = carry.data.dropEffect as DataTransfer['dropEffect']
      const action = effect === 'move' ? 'Move' : effect === 'copy' ? 'Copy' : ''
      carry.badge.textContent = action ? `${action} ${carry.label}` : carry.label
      const { width, height } = carry.badge.getBoundingClientRect()
      // Hang the label below and left of the hand, keeping its drop target clear.
      carry.badge.style.left = `${Math.max(4, Math.min(carry.x - width - 4, window.innerWidth - width - 4))}px`
      carry.badge.style.top = `${Math.max(4, Math.min(carry.y + 12, window.innerHeight - height - 4))}px`
    }
    const tick = (): void => {
      if (!carry) return
      // Scroll the innermost list under the pointer, never a hidden source tab.
      for (let el = targetAtPointer(); el; el = el.parentElement) {
        if (!(el instanceof HTMLElement) || el.scrollHeight <= el.clientHeight) continue
        if (!/(auto|scroll)/.test(getComputedStyle(el).overflowY)) continue
        const box = el.getBoundingClientRect()
        const edge = Math.min(36, box.height / 4)
        const delta = carry.y < box.top + edge ? -8 : carry.y > box.bottom - edge ? 8 : 0
        if (delta) el.scrollTop += delta
        break
      }
      hover()
      frame = requestAnimationFrame(tick)
    }
    const end = (drop: boolean): void => {
      if (!carry) return
      if (drop) {
        hover()
        if (carry.accepted && carry.target) send('drop', carry.target)
      }
      if (carry.target) send('dragleave', carry.target)
      send('dragend', carry.source)
      carry.badge.remove()
      carry.cursorStyle.remove()
      carry = null
      pressed = false
      cancelAnimationFrame(frame)
      delete document.body.dataset.internalFileDrag
      setDrag(null)
      // A release over a file must not also select/open the drop destination.
      suppressClick = true
    }
    const down = (event: MouseEvent): void => {
      pressed = event.button === 0
      suppressClick = false
    }
    const start = (event: DragEvent): void => {
      if (
        !pressed ||
        !event.isTrusted ||
        event.defaultPrevented ||
        !event.dataTransfer
      )
        return
      const pin = event.dataTransfer.getData(QUICK_ACCESS_PIN_MIME)
      const payload = event.dataTransfer.types.includes(DRAG_MIME) ? getDrag() : null
      if ((!payload && !pin) || !(event.target instanceof Element)) return
      const data = new DataTransfer()
      for (const type of event.dataTransfer.types)
        data.setData(type, event.dataTransfer.getData(type))
      data.effectAllowed = event.dataTransfer.effectAllowed
      event.preventDefault()
      const badge = document.createElement('div')
      badge.dataset.fileDragBadge = ''
      const paths = pin ? [pin] : payload?.kind === 'files' ? payload.paths : payload!.entries
      const label =
        paths.length === 1 ? (paths[0].split(/[\\/]/).pop() ?? 'Item') : `${paths.length} items`
      badge.textContent = label
      const cursorStyle = document.createElement('style')
      cursorStyle.textContent =
        '[data-internal-file-drag], [data-internal-file-drag] * { cursor: grabbing !important; }'
      document.head.append(cursorStyle)
      Object.assign(badge.style, {
        position: 'fixed',
        pointerEvents: 'none',
        zIndex: '2147483647',
        padding: '8px 12px',
        borderRadius: '6px',
        background: 'var(--p-bg)',
        color: 'var(--p-text)',
        border: '1px solid var(--p-divider)',
        fontSize: '14px',
        maxWidth: 'min(320px, calc(100vw - 8px))',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        boxShadow: '0 4px 16px #0006'
      })
      document.body.append(badge)
      carry = {
        source: event.target,
        data,
        target: null,
        accepted: false,
        x: event.clientX,
        y: event.clientY,
        ctrl: event.ctrlKey,
        shift: event.shiftKey,
        badge,
        cursorStyle,
        label,
        pin: !!pin
      }
      document.body.dataset.internalFileDrag = 'true'
      hover()
      frame = requestAnimationFrame(tick)
    }
    const move = (event: MouseEvent): void => {
      if (!carry) return
      if (!(event.buttons & 1)) return end(false)
      carry.x = event.clientX
      carry.y = event.clientY
      carry.ctrl = event.ctrlKey
      carry.shift = event.shiftKey
      hover()
    }
    const up = (event: MouseEvent): void => {
      pressed = false
      if (!carry || event.button !== 0) return
      carry.x = event.clientX
      carry.y = event.clientY
      event.preventDefault()
      event.stopImmediatePropagation()
      end(true)
    }
    const key = (event: KeyboardEvent): void => {
      if (!carry) return
      event.preventDefault()
      event.stopImmediatePropagation()
      carry.ctrl = event.ctrlKey
      carry.shift = event.shiftKey
      if (event.type === 'keydown') {
        if (event.key === 'Escape') end(false)
        else if (event.key === 'Tab' && event.ctrlKey) stepTab(event.shiftKey ? -1 : 1)
      }
    }
    const click = (event: MouseEvent): void => {
      if (!suppressClick) return
      event.preventDefault()
      event.stopImmediatePropagation()
      suppressClick = false
    }
    const cancel = (): void => {
      pressed = false
      end(false)
    }
    window.addEventListener('mousedown', down, true)
    window.addEventListener('dragstart', start)
    window.addEventListener('mousemove', move, true)
    window.addEventListener('mouseup', up, true)
    window.addEventListener('keydown', key, true)
    window.addEventListener('keyup', key, true)
    window.addEventListener('click', click, true)
    window.addEventListener('blur', cancel)
    return () => {
      cancel()
      window.removeEventListener('mousedown', down, true)
      window.removeEventListener('dragstart', start)
      window.removeEventListener('mousemove', move, true)
      window.removeEventListener('mouseup', up, true)
      window.removeEventListener('keydown', key, true)
      window.removeEventListener('keyup', key, true)
      window.removeEventListener('click', click, true)
      window.removeEventListener('blur', cancel)
    }
  }, [stepTab])
}
