import { describe, expect, it } from 'vitest'
import { Grants } from './grants'

describe('Grants', () => {
  it('is per phone, case-insensitive, and prefix-aware for directories', () => {
    const g = new Grants()
    g.grant('a', 'C:\\Temp\\x.jpg')
    expect(g.has('a', 'c:\\temp\\X.JPG')).toBe(true)
    expect(g.has('b', 'C:\\Temp\\x.jpg')).toBe(false)
    g.grantDir('a', 'C:\\Users\\me\\AppData\\Roaming\\Prism\\comics\\abc')
    expect(g.has('a', 'C:\\Users\\me\\AppData\\Roaming\\Prism\\comics\\abc\\p1.jpg')).toBe(true)
    expect(g.has('a', 'C:\\Users\\me\\AppData\\Roaming\\Prism\\comics\\abc\\sub\\p2.jpg')).toBe(true)
    expect(g.has('a', 'C:\\Users\\me\\AppData\\Roaming\\Prism\\comics\\abcd\\p1.jpg')).toBe(false)
    expect(g.has('a', 'C:\\Users\\me\\AppData\\Roaming\\Prism\\comics\\abc\\..\\..\\x')).toBe(false)
    // The directory itself is not a file under it.
    expect(g.has('a', 'C:\\Users\\me\\AppData\\Roaming\\Prism\\comics\\abc')).toBe(false)
    // Another phone sees none of it.
    expect(g.has('b', 'C:\\Users\\me\\AppData\\Roaming\\Prism\\comics\\abc\\p1.jpg')).toBe(false)
    g.drop('a')
    expect(g.has('a', 'C:\\Temp\\x.jpg')).toBe(false)
    expect(g.has('a', 'C:\\Users\\me\\AppData\\Roaming\\Prism\\comics\\abc\\p1.jpg')).toBe(false)
  })

  it('resolves a climb before comparing, so a spelled-out grant still lands where it lands', () => {
    const g = new Grants()
    g.grant('a', 'C:\\docs\\..\\assets\\logo.png')
    expect(g.has('a', 'C:\\assets\\logo.png')).toBe(true)
    expect(g.has('a', 'C:\\docs\\logo.png')).toBe(false)
  })

  it('dropping one phone leaves the others alone', () => {
    const g = new Grants()
    g.grant('a', 'C:\\Temp\\x.jpg')
    g.grant('b', 'C:\\Temp\\x.jpg')
    g.drop('a')
    expect(g.has('a', 'C:\\Temp\\x.jpg')).toBe(false)
    expect(g.has('b', 'C:\\Temp\\x.jpg')).toBe(true)
  })
})
