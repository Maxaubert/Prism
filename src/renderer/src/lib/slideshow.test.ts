import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_SECONDS, loadSlideSeconds, nextSlide, saveSlideSeconds, stopsSlideshow } from './slideshow'

beforeEach(() => localStorage.clear())

describe('where the next slide goes', () => {
  it('wraps at the end, which the arrow keys must not', () => {
    // A slideshow that stops after the last picture has ended rather than
    // looped; arrowing off the end should stop, because you are looking for
    // a file. Same folder, two different rules.
    expect(nextSlide(3, 2)).toBe(0)
  })

  it('steps forward otherwise', () => {
    expect(nextSlide(3, 0)).toBe(1)
    expect(nextSlide(3, 1)).toBe(2)
  })

  it('stays put in a folder of one', () => {
    expect(nextSlide(1, 0)).toBe(0)
  })

  it('has nowhere to go in an empty folder', () => {
    expect(nextSlide(0, 0)).toBe(-1)
  })
})

describe('what stops it', () => {
  it.each(['Escape', ' ', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'])(
    'stops on %s',
    (key) => {
      expect(stopsSlideshow(key)).toBe(true)
    }
  )

  it('is not stopped by a modifier or a letter on its own', () => {
    // Shift alone is a key event too, and stopping on it would end the show
    // whenever someone leaned on the keyboard.
    expect(stopsSlideshow('Shift')).toBe(false)
    expect(stopsSlideshow('r')).toBe(false)
  })
})

describe('the interval', () => {
  it('starts at the default', () => {
    expect(loadSlideSeconds()).toBe(DEFAULT_SECONDS)
  })

  it('remembers a choice', () => {
    saveSlideSeconds(10)
    expect(loadSlideSeconds()).toBe(10)
  })

  it('reads a value that is not one of the offered ones as the default', () => {
    localStorage.setItem('prism.slideshow.seconds', '999')
    expect(loadSlideSeconds()).toBe(DEFAULT_SECONDS)
  })
})
