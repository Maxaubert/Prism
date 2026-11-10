import type { JSX } from 'react'
import { baseName } from '@shared/path'
import { ArchiveDeleteDialog } from './ArchiveDeleteDialog'
import { DeleteDialog } from './DeleteDialog'
import { DeleteManyDialog } from './DeleteManyDialog'
import { EmptyBinDialog } from './EmptyBinDialog'
import { PermanentDeleteDialog } from './PermanentDeleteDialog'
import { useArchiveSize, useBinUsage, useDeleteSize } from './useDeleteSize'

/**
 * The delete questions with their sizes (#503). Each is the pure dialog plus
 * the one hook that fills its line in: the dialogs themselves stay plain
 * functions a test can call, and the question always opens at once.
 */

const FIRST_NAMES = 2
const namesOf = (paths: readonly string[]): string[] => paths.slice(0, FIRST_NAMES).map(baseName)

interface Answers {
  onCancel: () => void
  onDelete: () => void
}

/** One file or folder to the bin. */
export function DeleteAsk({
  path,
  name,
  ...a
}: Answers & { path: string; name: string; onPermanent: () => void }): JSX.Element {
  return <DeleteDialog name={name} size={useDeleteSize([path])} {...a} />
}

/** Several marked rows to the bin. */
export function DeleteManyAsk({
  paths,
  ...a
}: Answers & { paths: readonly string[]; onPermanent: () => void }): JSX.Element {
  return (
    <DeleteManyDialog names={namesOf(paths)} count={paths.length} size={useDeleteSize(paths)} {...a} />
  )
}

/** The middle button's second question: delete these for good. */
export function PurgeAsk({ paths, ...a }: Answers & { paths: readonly string[] }): JSX.Element {
  return (
    <PermanentDeleteDialog
      names={namesOf(paths)}
      count={paths.length}
      size={useDeleteSize(paths)}
      {...a}
    />
  )
}

/** The bin's Delete permanently: the sizes are the list's own (`$I` records). */
export function BinDeleteAsk({
  names,
  bytes,
  ...a
}: Answers & { names: readonly string[]; bytes?: number }): JSX.Element {
  return (
    <PermanentDeleteDialog
      names={names}
      size={bytes === undefined ? { state: 'none' } : { state: 'known', bytes }}
      {...a}
    />
  )
}

/** Empty Recycle Bin: the count, the size and a bar per drive, from main. */
export function BinEmptyAsk({
  onCancel,
  onEmpty
}: {
  onCancel: () => void
  onEmpty: () => void
}): JSX.Element {
  return <EmptyBinDialog usage={useBinUsage()} onCancel={onCancel} onEmpty={onEmpty} />
}

/** Members out of a zip. */
export function ArchiveDeleteAsk({
  container,
  inners,
  names,
  ...a
}: Answers & {
  container: string
  inners: readonly string[]
  names: readonly string[]
}): JSX.Element {
  return <ArchiveDeleteDialog names={names} size={useArchiveSize(container, inners)} {...a} />
}
