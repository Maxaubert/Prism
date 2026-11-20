import { dirname, join } from 'path'

/**
 * The folders a bundled program can live in (audit #537 item 23: one walk
 * instead of four copies). Packaged: `resources/<packagedSub>`, put there by
 * electron-builder. Unpackaged (dev, the e2e's out/ build): `vendor/<vendor>`
 * at or above the app, walking up four parents, because appPath is wherever
 * the main script sits (the repo root under `npm run dev`, out/main for e2e).
 */
export function vendorDirs(
  vendor: string,
  packagedSub: string,
  packaged: boolean,
  resourcesPath: string,
  appPath: string
): string[] {
  const dirs: string[] = []
  if (packaged) dirs.push(join(resourcesPath, packagedSub))
  let up = appPath
  for (let i = 0; i < 4; i++) {
    dirs.push(join(up, 'vendor', vendor))
    const parent = dirname(up)
    if (parent === up) break
    up = parent
  }
  return dirs
}
