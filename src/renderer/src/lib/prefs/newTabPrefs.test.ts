import { beforeEach, describe, expect, it } from 'vitest'
import { newTabFolder, newTabMode, setNewTabMode } from './newTabPrefs'

beforeEach(() => localStorage.clear())

describe('new-tab prefs', () => {
  it('defaults to browsing the home folder', () => {
    expect(newTabMode()).toBe('home')
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
  it('garbage in the mode falls back to home', () => {
    localStorage.setItem('prism.newtab.mode', 'soup')
    expect(newTabMode()).toBe('home')
  })
})
