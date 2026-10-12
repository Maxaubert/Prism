import { describe, expect, it } from 'vitest'
import {
  createDriveModels,
  MODEL_COMMAND,
  MODEL_TTL,
  parseDriveModels,
  prettyModel
} from './driveModel'

describe('prettyModel', () => {
  it('reads underscores as spaces and trims', () => {
    expect(prettyModel('WD_BLACK SN850X 8000GB')).toBe('WD BLACK SN850X 8000GB')
    expect(prettyModel('  Storage Media   ')).toBe('Storage Media')
    expect(prettyModel('A__B')).toBe('A B')
  })
})

describe('parseDriveModels', () => {
  // The lines MEASURED on the owner's machine, 2026-10-12.
  const output =
    'D|Sony Storage Media|Storage Media   |USB|Unspecified|FAT32|ESD-USB\r\n' +
    'X|Kingston XS2000|XS2000|USB|Unspecified|NTFS|Local Disk\r\n' +
    'C|WD_BLACK SN850X 8000GB|WD_BLACK SN850X 8000GB|NVMe|SSD|NTFS|\r\n'

  it('reads each lettered volume', () => {
    const got = parseDriveModels(output)
    expect(got.get('C:\\')).toEqual({
      model: 'WD BLACK SN850X 8000GB',
      bus: 'NVMe',
      media: 'SSD',
      fs: 'NTFS'
    })
    expect(got.get('D:\\')).toEqual({
      model: 'Sony Storage Media',
      bus: 'USB',
      fs: 'FAT32',
      label: 'ESD-USB'
    })
    expect(got.get('X:\\')?.label).toBe('Local Disk')
    expect(got.size).toBe(3)
  })
  it('falls back to the model when there is no friendly name', () => {
    expect(parseDriveModels('E||Some_Disk|SATA|HDD|exFAT|').get('E:\\')).toEqual({
      model: 'Some Disk',
      bus: 'SATA',
      media: 'HDD',
      fs: 'exFAT'
    })
  })
  it('keeps a label with a bar in it whole, skips noise', () => {
    const got = parseDriveModels('F||||||a|b\nnoise\n\nGG|x|x|x|x|x|x')
    expect(got.get('F:\\')).toEqual({ label: 'a|b' })
    expect(got.size).toBe(1)
  })
  it('names a virtual disk plainly', () => {
    expect(
      parseDriveModels('V|Msft Virtual Disk||File Backed Virtual||NTFS|').get('V:\\')?.bus
    ).toBe('Virtual')
  })
  it('asks PowerShell for UTF-8 first', () => {
    expect(MODEL_COMMAND.startsWith('[Console]::OutputEncoding')).toBe(true)
  })
})

describe('createDriveModels', () => {
  it('reads once per MODEL_TTL', async () => {
    let now = 0
    let runs = 0
    const models = createDriveModels({
      run: async () => {
        runs++
        return 'C|Disk_A|x|NVMe|SSD|NTFS|'
      },
      now: () => now
    })
    expect(await models('c:\\')).toEqual({ model: 'Disk A', bus: 'NVMe', media: 'SSD', fs: 'NTFS' })
    await models('C:\\')
    expect(runs).toBe(1)
    now = MODEL_TTL + 1
    await models('C:\\')
    expect(runs).toBe(2)
  })
  it('answers nothing for a failed read and asks again next time', async () => {
    let runs = 0
    const models = createDriveModels({
      run: async () => (runs++ === 0 ? null : 'C|Disk|x|SATA|HDD|NTFS|'),
      now: () => 0
    })
    expect(await models('C:\\')).toEqual({})
    await Promise.resolve()
    expect((await models('C:\\')).model).toBe('Disk')
  })
})

describe.runIf(process.platform === 'win32')('driveModel', () => {
  it('reads the system drive through the worker', async () => {
    const system = `${(process.env.SystemDrive ?? 'C:').toUpperCase()}\\`
    const facts = await createDriveModels()(system)
    expect(facts.fs).toBe('NTFS')
  }, 30_000)
})
