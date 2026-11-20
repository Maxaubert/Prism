import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'

// audit #21: the installer's own-folder test looked at the last five letters
// only, so D:\Tools\NotPrism passed as "Prism's folder" and Prism went into
// the user's folder, which the uninstaller then empties. NSIS cannot run in a
// unit test, so this reads the function and runs its rule the way NSIS does.
const nsh = readFileSync(join(__dirname, '../../build/installer/pages.nsh'), 'utf8')
const body = /Function prismOwnFolder([\s\S]*?)FunctionEnd/.exec(nsh)?.[1] ?? ''

/** What the function does to $INSTDIR, read from its own text. */
function ownFolder(instdir: string): string {
  const name = /StrLen \$0 "(.*)"/.exec(body)?.[1] ?? ''
  const compare = /\$1 != "(.*)"/.exec(body)?.[1] ?? ''
  const tail = instdir.slice(-name.replace('${APP_FILENAME}', 'Prism').length)
  return tail.toLowerCase() !== compare.replace('${APP_FILENAME}', 'Prism').toLowerCase()
    ? instdir + '\\Prism'
    : instdir
}

describe('prismOwnFolder', () => {
  it('adds a Prism subfolder to a folder that merely ends in the letters', () => {
    expect(ownFolder('D:\\Tools\\NotPrism')).toBe('D:\\Tools\\NotPrism\\Prism')
    expect(ownFolder('D:\\MyPrism')).toBe('D:\\MyPrism\\Prism')
  })
  it('keeps a folder that is itself named Prism', () => {
    expect(ownFolder('D:\\Apps\\Prism')).toBe('D:\\Apps\\Prism')
    expect(ownFolder('C:\\Users\\me\\AppData\\Local\\Programs\\Prism')).toBe(
      'C:\\Users\\me\\AppData\\Local\\Programs\\Prism'
    )
  })
  it('puts one in Documents', () => {
    expect(ownFolder('C:\\Users\\me\\Documents')).toBe('C:\\Users\\me\\Documents\\Prism')
  })
})