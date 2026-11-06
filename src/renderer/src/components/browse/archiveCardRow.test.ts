import { describe, expect, it } from 'vitest'
import { cardRowTarget } from './archiveCardRow'

const zip = 'C:\\Users\\me\\Downloads\\W-13.zip'

describe('cardRowTarget (#483)', () => {
  it('goes into a folder under the one top folder', () => {
    expect(cardRowTarget(zip, 'web-application-project', { name: 'app', dir: true })).toEqual({
      go: 'folder',
      path: `${zip}\\web-application-project\\app`
    })
  })
  it('opens a file under the one top folder', () => {
    expect(cardRowTarget(zip, 'web-application-project', { name: 'README.md', dir: false })).toEqual({
      go: 'file',
      path: `${zip}\\web-application-project\\README.md`
    })
  })
  it('without a top folder, the row sits at the zip root', () => {
    expect(cardRowTarget(zip, null, { name: 'docs', dir: true }).path).toBe(`${zip}\\docs`)
    expect(cardRowTarget(zip, null, { name: '.gitignore', dir: false })).toEqual({
      go: 'file',
      path: `${zip}\\.gitignore`
    })
  })
  it('a zip inside the zip is gone into, as the Explorer does', () => {
    expect(cardRowTarget(zip, null, { name: 'nested.zip', dir: false }).go).toBe('folder')
  })
})
