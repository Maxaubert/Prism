import { describe, expect, it } from 'vitest'
import { powershellInWorker } from './driveUsage'
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
  // The worker, a real PowerShell and the parser, end to end, with a command
  // that answers at once. The Storage cmdlets themselves are the MACHINE's:
  // on a cold GitHub runner Get-PhysicalDisk alone passed the 10 s the app
  // allows (2026-10-14, ci of #382), which is the app's timeout doing its
  // job, not a fault in this code. So the live read below runs here only.
  it('runs its command in the worker and parses the answer', async () => {
    const answer = "'C|Disk|Model|NVMe|SSD|NTFS|Windows'"
    // The app kills the query at 10 s, and PowerShell on a starved machine
    // took that long to echo this one line (2026-11-01, 1 run in 20 under
    // load): what is under test is the worker and the parser, not the
    // machine's speed, so this one waits up to 25 s.
    const run = (): Promise<string | null> => powershellInWorker(answer, 25_000)
    const facts = await createDriveModels({ run, now: Date.now })('C:\\')
    expect(facts).toEqual({ model: 'Disk', bus: 'NVMe', media: 'SSD', fs: 'NTFS', label: 'Windows' })
  }, 30_000)

  it.skipIf(!!process.env.CI)('reads the system drive through the worker (this machine)', async () => {
    const system = `${(process.env.SystemDrive ?? 'C:').toUpperCase()}\\`
    const facts = await createDriveModels()(system)
    expect(facts.fs).toBe('NTFS')
  }, 30_000)
})
