/**
 * PRISM'S CALLS THAT ARE SUPPOSED TO TAKE LONG (#322), for the diagnostics
 * log's IPC timing (`longWaitChannels`, added to the core's own `LONG_WAIT`).
 * A channel here is never `ipc-slow` and never in a `main-lag`'s `inflight`:
 * `npm run diag` reads both as stall suspects, and a folder picker left open
 * for a minute, or a 4 GB extraction, would sit at the top of every report and
 * push the real suspect out. It is still `ipc-error` when it fails, and `ipc`
 * in Detailed logging.
 *
 * The rule for a new entry: the call waits on the USER (a dialog), or it is a
 * long job BY DESIGN whose work runs off main's thread (a child process, a
 * walk the user can cancel) and has a window, a crumb or a progress of its
 * own. Work that runs IN main's thread stays timed however long it is
 * expected to take (`archive:delete`, `archive:add`, `archive:move-members`
 * and `archive:rename` rewrite a zip in process, `doc:html` converts in
 * process): there a slow answer IS the stall. `folder:sizes-cached` stays
 * timed too: its path guard is suspect 1 of the design.
 *
 * Phone: none. The phone's long polls are HTTP requests to the phone server
 * in main, not IPC, so the timing never sees them.
 *
 * A unit test holds every name to a registration in `index.ts`, so a renamed
 * channel cannot leave a stale entry behind.
 */
export const LONG_WAIT_CHANNELS: readonly string[] = [
  // Waits on the user: each opens a system dialog and answers when it closes.
  'dialog:pick-folder',
  'dialog:pick-files',
  'open:dialog',
  'subs:pick',
  'image:save-copy',
  // Searches: a recursive walk (or Everything's index) that answers when the
  // walk ends or the user cancels. Their `search-*` crumbs carry the time,
  // and `guard-slow` the path guard inside them.
  'browse:search',
  'browse:suggest',
  'search:files',
  // A folder's size: a full recursive scan, cancellable, answering at the end.
  // Its `folder-size` crumb carries the time.
  'folder:size',
  // Archive jobs with the extraction window (ExtractJobs): 7-Zip or the
  // extractor writing every member out, for as long as the archive is big.
  // Their `archive-job` crumbs carry start, end and time. Two of them open
  // the folder dialog first.
  'archive:extract-to',
  'archive:extract-members-picked',
  'archive:extract-all',
  'archive:extract-dir',
  'archive:member-out',
  // ffmpeg converting a whole video, with its own progress.
  'video:convert',
  // The update's download (and, for a preview, its three seconds of fake
  // progress).
  'update:install',
  // File copies with progress: a paste, and a move across drives, which is a
  // copy, last as long as the bytes do.
  'file:paste-into',
  'file:move',
  // ffmpeg or FluidSynth decoding a whole track in a child process: as long as
  // the file is.
  'media:peaks',
  'audio:synth'
]
