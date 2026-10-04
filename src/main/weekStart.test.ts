import { describe, expect, it } from 'vitest'
import { parseFirstDayOfWeek } from './weekStart'

const out = (value: string): string =>
  `\r\nHKEY_CURRENT_USER\\Control Panel\\International\r\n    iFirstDayOfWeek    REG_SZ    ${value}\r\n\r\n`

describe('parseFirstDayOfWeek', () => {
  it("turns Windows' day (0 Monday) into JavaScript's (1 Monday)", () => {
    expect(parseFirstDayOfWeek(out('0'))).toBe(1)
    expect(parseFirstDayOfWeek(out('5'))).toBe(6)
    expect(parseFirstDayOfWeek(out('6'))).toBe(0)
  })
  it('answers null for anything else', () => {
    expect(parseFirstDayOfWeek(out('7'))).toBeNull()
    expect(parseFirstDayOfWeek(out(''))).toBeNull()
    expect(parseFirstDayOfWeek('ERROR: The system was unable to find the specified registry key or value.')).toBeNull()
  })
})
