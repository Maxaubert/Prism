import { useEffect } from 'react'
import { baseName } from '@shared/path'
import { dragBadgePlace } from './dragBadgePlace'
import { buildDragRow } from './dragRow'
import { DRAG_MIME, endNative, getDrag, setDrag, setNative } from './dragDrop'
import { isReady, noteReady, requestOf } from './dragOut'
import { pointerOut } from './edge'
import { QUICK_ACCESS_PIN_MIME } from '../quickAccess'

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
      effect: HTMLDivElement
      action: string
      effectH: number
      effectSide: '' | 'below' | 'above'
      size: { width: number; height: number }
      cursorStyle: HTMLStyleElement
      pin: boolean
    } | null = null
    let frame = 0
    let suppressClick = false
    /** A hand-off was asked for and the button has not come up since. */
    let handing = false

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
      // A carried PIN says nothing (#70 review, 2026-11-01): a reorder is not
      // a file operation, and its target's 'move' is only how it accepts.
      const action = carry.pin ? '' : effect === 'move' ? 'Move' : effect === 'copy' ? 'Copy' : ''
      // The row stays the row; what the drop would do is said by it. Written
      // only when it changes: this runs every frame and every mouse move.
      if (action !== carry.action) {
        carry.action = action
        carry.effect.textContent = action
        carry.effect.hidden = !action
        if (action && !carry.effectH) carry.effectH = carry.effect.getBoundingClientRect().height
      }
      // The line is outside the measured box (absolute), so the row's size is
      // measured once, at the start, and placement never jumps with it.
      const { width, height } = carry.size
      // Hang the carried row (#327) off the pointer's bottom right, attached (#310). It
      // used to sit its whole width LEFT of the pointer and 12 px below it.
      const place = dragBadgePlace(carry.x, carry.y, width, height, window.innerWidth, window.innerHeight)
      carry.badge.style.left = `${place.left}px`
      carry.badge.style.top = `${place.top}px`
      if (action) {
        // Under the row, or over it where the window's bottom leaves no room.
        const below = place.top + height + 4 + carry.effectH <= window.innerHeight
        const side = below ? 'below' : 'above'
        if (side !== carry.effectSide) {
          carry.effectSide = side
          carry.effect.style.top = below ? `${height + 4}px` : ''
          carry.effect.style.bottom = below ? '' : `${height + 4}px`
        }
      }
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
      // Parked on the edge (a maximized window) while main finished preparing.
      if (pointerOut(carry.x, carry.y, window.innerWidth, window.innerHeight) && handOff()) return
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
      delete document.documentElement.dataset.internalFileDrag
      setDrag(null)
      // A release over a file must not also select/open the drop destination.
      suppressClick = true
    }
    /**
     * THE HAND-OFF AT THE WINDOW'S EDGE (#103, D1; owner, 2026-10-31). Over
     * the window the carry stays exactly as it is (the carried row, the arrow,
     * Ctrl+Tab). When the pointer leaves with the button held, the carry ends
     * quietly, no drop, and main starts Windows' own drag with the same cargo:
     * Explorer, a browser, Discord, another Prism window, or back into this
     * one. ONLY A CARGO MAIN ALREADY SAID YES TO hands off (the press's
     * `drag:prepare`, `isReady`): with nothing that can leave (the archive
     * view's members, a member still extracting or over the budget, a path
     * main refused) the carry stays, so touching the edge, or the last 2 px of
     * a maximized window, never ends the drag for nothing. Pins never hand
     * off; they carry an order, not files. Answers whether it handed off.
     */
    const handOff = (): boolean => {
      if (!carry || carry.pin) return false
      const request = requestOf(getDrag())
      if (!request || !isReady(request)) return false
      end(false)
      handing = true
      void window.prism.dragOut(request).catch(() => {})
      return true
    }
    /** The button came up after the hand-off: if main has not started the
     *  OS drag yet, it must not (it would drop at once where the pointer is). */
    const released = (): void => {
      if (!handing) return
      handing = false
      window.prism.dragOutCancel()
    }
    const down = (event: MouseEvent): void => {
      pressed = event.button === 0
      suppressClick = false
      handing = false
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
      // Chromium drops a dropEffect set on a DataTransfer made outside a real
      // drag (`new DataTransfer()` is not in drag mode), so the target's
      // answer never reached the word under the row (found by #70's dragCopy
      // e2e). The carry keeps the effect itself.
      let dropEffect: DataTransfer['dropEffect'] = 'none'
      Object.defineProperty(data, 'dropEffect', {
        configurable: true,
        get: () => dropEffect,
        set: (v: DataTransfer['dropEffect']) => {
          if (v === 'none' || v === 'copy' || v === 'move' || v === 'link') dropEffect = v
        }
      })
      event.preventDefault()
      const paths = pin ? [pin] : payload?.kind === 'files' ? payload.paths : payload!.entries
      // THE ROW IS PICKED UP, NOT A LABEL (#327): the pressed row's icon and
      // name in the selected look, with the count of everything carried.
      const { root: badge, effect } = buildDragRow(
        event.target,
        (paths[0] && baseName(paths[0])) || 'Item',
        paths.length
      )
      // THE ARROW STAYS (#320; owner, 2026-10-07: "when you left click drag an
      // item dont switch the cursor to the hand, keep it the normal cursor").
      // It was `grabbing`. Pinned to the arrow for the whole drag, so nothing
      // under the pointer (a link, a text field, a splitter) changes it either.
      const cursorStyle = document.createElement('style')
      cursorStyle.textContent =
        'html[data-internal-file-drag], html[data-internal-file-drag] * { cursor: default !important; }'
      document.head.append(cursorStyle)
      document.body.append(badge)
      const { width, height } = badge.getBoundingClientRect()
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
        effect,
        action: '',
        effectH: 0,
        effectSide: '',
        size: { width, height },
        cursorStyle,
        pin: !!pin
      }
      document.body.dataset.internalFileDrag = 'true'
      document.documentElement.dataset.internalFileDrag = 'true'
      // The press of a file drag warms its icon in main, so a hand-off at the
      // edge starts at once (#103). Members prepare on their own press
      // (BrowseList), where the extraction has the most time.
      if (payload?.kind === 'files') {
        const req = { kind: 'files' as const, paths: payload.paths }
        void window.prism
          .dragPrepare(req)
          .then((r) => noteReady(req, r.ok))
          .catch(() => noteReady(req, false))
      }
      hover()
      frame = requestAnimationFrame(tick)
    }
    const move = (event: MouseEvent): void => {
      if (!carry) {
        if (!(event.buttons & 1)) released()
        return
      }
      if (!(event.buttons & 1)) return end(false)
      carry.x = event.clientX
      carry.y = event.clientY
      carry.ctrl = event.ctrlKey
      carry.shift = event.shiftKey
      if (pointerOut(carry.x, carry.y, window.innerWidth, window.innerHeight) && handOff()) return
      hover()
    }
    const up = (event: MouseEvent): void => {
      pressed = false
      if (event.button === 0) released()
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
    // The OS drag in flight (#103), for a drop back into any Prism window.
    const offStart = window.prism.onNativeDragStart((record) => setNative(record))
    const offEnd = window.prism.onNativeDragEnd(({ token }) => endNative(token))
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
      offStart()
      offEnd()
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
