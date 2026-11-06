import { clipboard } from 'electron'
import { createClipWriter } from './clipWriter'
import { copyWindowsFiles } from './fileClipboard'
import { createOwnClipboard } from './ownClipboard'

/**
 * The app's one record of Prism's newest copy and its one Windows clipboard
 * writer (#484). Electron's `clipboard` is read for "did it change outside
 * Prism?" (sync, no process; under --e2e it is the in-memory fake).
 */
export const ownClip = createOwnClipboard(() => clipboard)

export interface ClipRequest {
  paths: string[]
  cut: boolean
  text?: string
  token: string
}

export const clipWriter = createClipWriter<ClipRequest>(
  (r, signal) => copyWindowsFiles(r.paths, r.cut, r.text, r.token, signal),
  // A source that is gone will not be back for a second try.
  { retryable: (reason) => reason !== 'Source no longer exists' && reason !== 'No files to copy' }
)
