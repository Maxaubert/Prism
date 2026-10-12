import { join } from 'node:path'
import { compileCs } from './lib/csc.mjs'
import { ROOT, windowsOnly } from './lib/repo.mjs'

windowsOnly('Win+E helper: Windows-only build skipped')
process.exit(
  compileCs({
    src: join(ROOT, 'native', 'win-e', 'PrismShortcut.cs'),
    out: join(ROOT, 'vendor', 'win-e', 'PrismShortcut.exe'),
    references: ['System.Windows.Forms.dll', 'System.Web.Extensions.dll']
  })
)
