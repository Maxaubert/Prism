import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { missingFromAsar, packageName, requiredPackages } from './packedDeps.mjs'

let root
const pkg = (dir, body) => {
  mkdirSync(join(root, dir), { recursive: true })
  writeFileSync(join(root, dir, 'package.json'), JSON.stringify(body))
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'prism-packed-'))
  pkg('.', { dependencies: { qrcode: '1', react: '19' }, devDependencies: { vite: '7' } })
  pkg('node_modules/qrcode', { dependencies: { dijkstrajs: '1', pngjs: '5' } })
  pkg('node_modules/dijkstrajs', {})
  pkg('node_modules/pngjs', {})
  // A nested copy: qrcode's own yargs wins over the top one.
  pkg('node_modules/react', { dependencies: { scheduler: '1' }, optionalDependencies: { fsevents: '2' } })
  pkg('node_modules/react/node_modules/scheduler', {})
  pkg('node_modules/scheduler', {})
  pkg('node_modules/vite', {})
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('what the packed app needs (2026-10-14)', () => {
  it('walks dependencies the way Node resolves them, nested first, devDependencies never', () => {
    const { packages, missing } = requiredPackages(root)
    expect(packages).toEqual([
      'node_modules/dijkstrajs',
      'node_modules/pngjs',
      'node_modules/qrcode',
      'node_modules/react',
      'node_modules/react/node_modules/scheduler'
    ])
    // fsevents is optional and not installed: skipped, not missing.
    expect(missing).toEqual([])
  })

  it('reports a required package that is not installed at all', () => {
    rmSync(join(root, 'node_modules/dijkstrajs'), { recursive: true })
    expect(requiredPackages(root).missing).toEqual(['dijkstrajs (needed by node_modules/qrcode)'])
  })

  it('finds what a junctioned pack left out: the transitive ones', () => {
    const { packages } = requiredPackages(root)
    // What 0.106.8 shipped: the direct dependencies only.
    const asar = ['\\node_modules\\qrcode\\package.json', '\\node_modules\\react\\package.json']
    expect(missingFromAsar(packages, asar)).toEqual([
      'node_modules/dijkstrajs',
      'node_modules/pngjs',
      'node_modules/react/node_modules/scheduler'
    ])
  })

  it('finds a nested copy the packer flattened to the top', () => {
    const { packages } = requiredPackages(root)
    // electron-builder puts react's own scheduler at node_modules/scheduler.
    const asar = packagesAsAsar(['qrcode', 'react', 'scheduler', 'pngjs', 'dijkstrajs'])
    expect(missingFromAsar(packages, asar)).toEqual([])
  })

  it('names a package by its last node_modules segment, scope included', () => {
    expect(packageName('node_modules/react/node_modules/scheduler')).toBe('scheduler')
    expect(packageName('node_modules/@codemirror/view')).toBe('@codemirror/view')
    expect(packageName('/node_modules/a/node_modules/@x/y/package')).toBe('@x/y')
  })

  it('counts an unpacked package as packed', () => {
    const asar = packagesAsAsar(['qrcode', 'react', 'react/node_modules/scheduler', 'pngjs'])
    const { packages } = requiredPackages(root)
    expect(missingFromAsar(packages, asar, (dir) => dir === 'node_modules/dijkstrajs')).toEqual([])
  })
})

function packagesAsAsar(names) {
  return names.map((n) => `\\node_modules\\${n.replace(/\//g, '\\')}\\package.json`)
}
