/* eslint-disable react-hooks/preserve-manual-memoization -- reads the buffers ref at paste time; moved unchanged from App.tsx, which the compiler lint skipped. */
import { useCallback, type Dispatch, type RefObject, type SetStateAction } from 'react'
import type { Ask } from '../dialogs/asks'
import { rekeyPasted, useFilePaste, type PasteResult } from './useFilePaste'

/**
 * Pasting files into the Explorer (audit #8, 2026-11-21), moved out of
 * App.tsx unchanged: a paste that renamed files re-keys their unsaved text,
 * then the listing refreshes; a failed paste is asked about.
 */
export function useAppPaste(
  buffers: RefObject<Map<string, { path: string; text: string }>>,
  rekeyBuffer: (from: string, to: string) => void,
  setAsk: Dispatch<SetStateAction<Ask | null>>,
  setRefreshKey: Dispatch<SetStateAction<number>>
): ReturnType<typeof useFilePaste> {
  const reportPasteError = useCallback(
    (message: string) => setAsk({ kind: 'failed', message, op: 'paste' }),
    [setAsk]
  )
  const refreshFiles = useCallback(() => setRefreshKey((key) => key + 1), [setRefreshKey])
  const onPasted = useCallback(
    (result: PasteResult): void => {
      rekeyPasted(result, buffers.current.values(), rekeyBuffer)
      refreshFiles()
    },
    [buffers, rekeyBuffer, refreshFiles]
  )
  return useFilePaste(onPasted, reportPasteError)
}
