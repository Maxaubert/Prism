// Run the production fullscreen/shroud path without covering the user's display.
// Only placement and focus are changed. Frame flags, opacity and GPU composition
// remain native, which is essential for catching a process-wide GPU fallback.
import Module, { createRequire } from 'node:module'
import { resolve } from 'node:path'

const require = createRequire(import.meta.url)
const electron = require('electron')
const root = resolve(import.meta.dirname, '../..')
const parked = { x: -12000, y: -12000 }
electron.app.setAppPath(root)
const originalLoad = Module._load
function ParkedWindow(options) {
  const win = new electron.BrowserWindow({
    ...options, ...parked, focusable: false, skipTaskbar: true
  })
  const setBounds = win.setBounds.bind(win)
  win.setBounds = (bounds, ...rest) => setBounds({ ...bounds, ...parked }, ...rest)
  return win
}
Object.setPrototypeOf(ParkedWindow, electron.BrowserWindow)
ParkedWindow.prototype = electron.BrowserWindow.prototype
const screen = new Proxy(electron.screen, {
  get(target, key) {
    if (key === 'getDisplayMatching') return () => {
      const display = target.getPrimaryDisplay()
      return {
        ...display,
        bounds: { ...display.bounds, ...parked },
        workArea: { ...display.workArea, ...parked }
      }
    }
    const value = target[key]
    return typeof value === 'function' ? value.bind(target) : value
  }
})
const replacement = new Proxy(electron, {
  get(target, key) {
    if (key === 'BrowserWindow') return ParkedWindow
    if (key === 'screen') return screen
    return target[key]
  }
})
Module._load = function (request, ...args) {
  return request === 'electron' ? replacement : originalLoad.call(this, request, ...args)
}
require(process.env.PRISM_NATIVE_MAIN ?? resolve(root, 'out/main/index.js'))
