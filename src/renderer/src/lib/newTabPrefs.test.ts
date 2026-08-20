import { beforeEach, describe, expect, it } from 'vitest'
import { newTabFolder, newTabMode, newTabShow, setNewTabMode, setNewTabShow } from './newTabPrefs'

beforeEach(() => localStorage.clear())

describe('new-tab prefs', () => {
  it('defaults: home folder, first file, exactly today', () => {
    expect(newTabMode()).toBe('home')
    expect(newTabShow()).toBe('file')
  })
  it('round-trips a chosen folder with its mode', () => {
    setNewTabMode('folder', 'D:\\downloads')
    expect(newTabMode()).toBe('folder')
    expect(newTabFolder()).toBe('D:\\downloads')
  })
  it('ask is a mode of its own; the folder is untouched by it', () => {
    setNewTabMode('folder', 'D:\\x')
    setNewTabMode('ask')
    expect(newTabMode()).toBe('ask')
    expect(newTabFolder()).toBe('D:\\x')
  })
  it('show round-trips and garbage falls back', () => {
    setNewTabShow('terminal')
    expect(newTabShow()).toBe('terminal')
    localStorage.setItem('prism.newtab.show', 'soup')
    expect(newTabShow()).toBe('file')
    localStorage.setItem('prism.newtab.mode', 'soup')
    expect(newTabMode()).toBe('home')
  })
})
