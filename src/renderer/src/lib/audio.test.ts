import { describe, expect, it } from 'vitest'
import { boostFactor, elementVolume } from './audio'

describe('volume past 100%', () => {
  it('leaves everything to the element up to 100%', () => {
    expect(elementVolume(0.8)).toBe(0.8)
    expect(boostFactor(0.8)).toBe(1)
  })

  it('holds the element at its ceiling and boosts above it', () => {
    // The spec caps HTMLMediaElement.volume at 1, so 150% has to be a gain.
    expect(elementVolume(1.5)).toBe(1)
    expect(boostFactor(1.5)).toBe(1.5)
  })

  it('treats exactly 100% as the plain path, with no gain at all', () => {
    expect(elementVolume(1)).toBe(1)
    expect(boostFactor(1)).toBe(1)
  })

  it('never asks for a negative volume or a negative gain', () => {
    expect(elementVolume(-0.5)).toBe(0)
    expect(boostFactor(-0.5)).toBe(1)
  })

  it('silences by element volume as well as gain, so mute is mute', () => {
    expect(elementVolume(0)).toBe(0)
  })
})
