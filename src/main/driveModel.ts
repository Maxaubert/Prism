import { powershellInWorker } from './driveUsage'

/**
 * WHAT A DRIVE IS, for the Properties window's drive header and facts (owner,
 * 2026-10-12: the drive's own model with underscores read as spaces, its
 * connection and its file system; spec
 * `docs/superpowers/specs/2026-10-12-properties-window-design.md`).
 *
 * No Node call names the disk behind a letter, so one PowerShell command
 * reads every lettered volume at once (Get-Volume, Get-Partition, Get-Disk,
 * Get-PhysicalDisk), spawned from a worker thread like the Explorer's labels
 * (#351), and the answer is kept MODEL_TTL: a disk does not change model
 * while the window is open, and the query takes about two seconds.
 */

export const MODEL_TTL = 10 * 60_000

export interface DriveModel {
  model?: string
  bus?: string
  media?: string
  fs?: string
  label?: string
}

/** UTF-8 first, as `LABEL_COMMAND` (a label like "Søren" broke without it).
 *  One line per lettered volume: `C|FriendlyName|Model|BusType|MediaType|FileSystem|Label`.
 *  The label is last, so a bar inside it stays whole. MEASURED 2026-10-12:
 *  `C|WD_BLACK SN850X 8000GB|WD_BLACK SN850X 8000GB|NVMe|SSD|NTFS|`. */
export const MODEL_COMMAND =
  '[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); ' +
  "$ErrorActionPreference = 'SilentlyContinue'; " +
  '$pd = @{}; Get-PhysicalDisk | ForEach-Object { $pd[[string]$_.DeviceId] = [string]$_.MediaType }; ' +
  '$dk = @{}; Get-Disk | ForEach-Object { $dk[[string]$_.Number] = $_ }; ' +
  "$pt = @{}; Get-Partition | Where-Object { [string]$_.DriveLetter -match '^[A-Za-z]$' } | " +
  'ForEach-Object { $pt[[string]$_.DriveLetter] = [string]$_.DiskNumber }; ' +
  "Get-Volume | Where-Object { [string]$_.DriveLetter -match '^[A-Za-z]$' } | ForEach-Object { " +
  "$l = [string]$_.DriveLetter; $n = $pt[$l]; $d = $null; $m = ''; " +
  'if ($n) { $d = $dk[$n]; $m = $pd[$n] }; ' +
  "('{0}|{1}|{2}|{3}|{4}|{5}|{6}' -f $l, $d.FriendlyName, $d.Model, $d.BusType, $m, $_.FileSystem, $_.FileSystemLabel) " +
  "-replace '[\\r\\n]', ' ' }"

/** "WD_BLACK SN850X 8000GB" reads as "WD BLACK SN850X 8000GB" (owner, 2026-10-12). */
export function prettyModel(raw: string): string {
  return raw.replace(/_/g, ' ').replace(/\s+/g, ' ').trim()
}

/** Windows' bus names, kept as Windows says them except the one nobody reads. */
function prettyBus(raw: string): string | undefined {
  const bus = raw.trim()
  if (!bus || bus === 'Unknown') return undefined
  if (bus === 'File Backed Virtual') return 'Virtual'
  return bus
}

/** Only SSD and HDD are answers; "Unspecified" (every USB stick) is none. */
function prettyMedia(raw: string): string | undefined {
  const media = raw.trim().toUpperCase()
  return media === 'SSD' || media === 'HDD' ? media : undefined
}

/** `MODEL_COMMAND`'s lines into a map keyed `C:\`. An empty field is left out. */
export function parseDriveModels(output: string): Map<string, DriveModel> {
  const found = new Map<string, DriveModel>()
  for (const line of output.split(/\r?\n/)) {
    const parts = line.trim().split('|')
    if (parts.length < 7 || !/^[A-Z]$/i.test(parts[0])) continue
    const [letter, friendly, model, bus, media, fs] = parts
    const label = parts.slice(6).join('|').trim()
    const name = prettyModel(friendly) || prettyModel(model)
    const facts: DriveModel = {}
    if (name) facts.model = name
    const b = prettyBus(bus)
    if (b) facts.bus = b
    const m = prettyMedia(media)
    if (m) facts.media = m
    if (fs.trim()) facts.fs = fs.trim()
    if (label) facts.label = label
    found.set(`${letter.toUpperCase()}:\\`, facts)
  }
  return found
}

export interface DriveModelDeps {
  run: () => Promise<string | null>
  now: () => number
}

const defaults: DriveModelDeps = {
  run: () =>
    process.platform === 'win32' ? powershellInWorker(MODEL_COMMAND) : Promise.resolve(null),
  now: Date.now
}

/** The model facts of one drive root (`C:\`), from a read at most MODEL_TTL
 *  old. A failed read is not kept, so the next window asks again. */
export function createDriveModels(deps: DriveModelDeps = defaults) {
  let read: { at: number; models: Promise<Map<string, DriveModel>> } | null = null
  return async function driveModel(root: string): Promise<DriveModel> {
    if (!read || deps.now() - read.at > MODEL_TTL) {
      const models = deps.run().then(
        (out) => (out === null ? null : parseDriveModels(out)),
        () => null
      )
      const entry = {
        at: deps.now(),
        models: models.then((m) => m ?? new Map<string, DriveModel>())
      }
      read = entry
      void models.then((m) => {
        if (m === null && read === entry) read = null
      })
    }
    return (await read.models).get(root.toUpperCase()) ?? {}
  }
}

export const driveModel = createDriveModels()
