import type { BinnedFrom } from '@shared/types'

/**
 * A FILE THAT IS NOT SIMPLY A FILE ON DISK IS READ-ONLY (Recycle Bin feature,
 * D12; spec section 4). A member of an archive (#300) is a copy in Prism's
 * temp folder; a binned file is an entry in the Recycle Bin that Windows owns.
 * Neither may be edited, saved, renamed, dragged out or handed to Windows.
 * Every site that used to ask `file.member` asks this, so the next kind of
 * file like these cannot be forgotten at one of them.
 */
export function readOnlyFile(file: { member?: true; binned?: BinnedFrom } | null | undefined): boolean {
  return !!file && (!!file.member || !!file.binned)
}
