/**
 * PRISM'S IPC CHANNEL NAMES, ONCE (structure cleanup, 2026-10-12). The preload
 * and main both read this table, so a channel cannot be renamed on one side of
 * the bridge and not the other: a typo is a type error, not a call that never
 * answers. The diagnostics log's channels are the core's
 * (`prism-term-core/shared/channels`) and are not repeated here.
 *
 * The VALUES are the wire: `npm run diag` reports and the e2e read some of
 * them (`e2e:slow-ipc`), so a value changes only on purpose.
 */

/** Main to the page: `webContents.send` in main, `ipcRenderer.on` in the preload. */
export const PUSH = {
  browseDetails: 'browse:details',
  browseSearchProgress: 'browse:search-progress',
  phoneChanged: 'phone:changed',
  pasteProgress: 'paste:progress',
  fileHashProgress: 'file:hash-progress',
  fileAppended: 'file:appended',
  folderSizeProgress: 'folder:size-progress',
  videoProgress: 'video:progress',
  windowState: 'window:state',
  windowFullscreen: 'window:fullscreen',
  openFile: 'open:file',
  openRestored: 'open:restored',
  dirChanged: 'dir:changed',
  extractEvent: 'extract:event',
  appAskClose: 'app:ask-close',
  updateAvailable: 'update:available',
  updateProgress: 'update:progress',
  windowPreferencesChanged: 'window-preferences:changed',
  winEOpen: 'win-e:open',
  /** The native sweep box's answer (#338): is the box drawn natively. */
  sweepOverlayState: 'sweep-overlay:state'
} as const

/** The page to main: `invoke`, `send` and `sendSync` in the preload, `handle`
 *  or `on` in main. Grouped by the channel's prefix. */
export const CALL = {
  browseDirectory: 'browse:directory',
  browseCached: 'browse:cached',
  browsePrefetch: 'browse:prefetch',
  browseSearch: 'browse:search',
  browseSearchCancel: 'browse:search-cancel',
  browseSuggest: 'browse:suggest',
  browseSuggestCancel: 'browse:suggest-cancel',
  browseWatch: 'browse:watch',
  browseLocations: 'browse:locations',
  browseDrives: 'browse:drives',
  browseRelease: 'browse:release',

  systemWeekStart: 'system:week-start',

  listingCacheClear: 'listing-cache:clear',

  openDialog: 'open:dialog',
  openWithin: 'open:within',
  openListen: 'open:listen',

  dialogPickFolder: 'dialog:pick-folder',
  dialogPickFiles: 'dialog:pick-files',

  tabsChanged: 'tabs:changed',

  rootsDrop: 'roots:drop',

  posGet: 'pos:get',
  posSet: 'pos:set',

  phoneGet: 'phone:get',
  phoneSetOn: 'phone:set-on',
  phoneCode: 'phone:code',
  phoneCodeDrop: 'phone:code-drop',
  phoneForget: 'phone:forget',
  phonePins: 'phone:pins',

  dirList: 'dir:list',

  searchFiles: 'search:files',

  fileRename: 'file:rename',
  fileTrash: 'file:trash',
  fileText: 'file:text',
  fileTailBytes: 'file:tailBytes',
  fileWrite: 'file:write',
  filePasteInto: 'file:paste-into',
  fileStat: 'file:stat',
  fileHash: 'file:hash',
  fileHashCancel: 'file:hash-cancel',
  fileShowInExplorer: 'file:show-in-explorer',
  fileOpenDefault: 'file:open-default',
  fileOpenChooser: 'file:open-chooser',
  fileOpenWith: 'file:open-with',
  fileCopyClip: 'file:copy-clip',
  fileCopyAddress: 'file:copy-address',
  fileDuplicate: 'file:duplicate',
  fileNewFolder: 'file:newFolder',
  fileBinIfEmpty: 'file:binIfEmpty',
  fileRestore: 'file:restore',
  fileMove: 'file:move',

  tailStart: 'tail:start',
  tailStop: 'tail:stop',

  imagePhotoInfo: 'image:photo-info',
  imageSaveCopy: 'image:save-copy',

  clipboardHasFiles: 'clipboard:has-files',

  propsMedia: 'props:media',
  propsPicture: 'props:picture',
  propsText: 'props:text',

  driveDetails: 'drive:details',
  driveCleanup: 'drive:cleanup',

  folderSize: 'folder:size',
  folderSizesCached: 'folder:sizes-cached',
  folderSizesRefresh: 'folder:sizes-refresh',
  folderSizeCancel: 'folder:size-cancel',

  subsFor: 'subs:for',
  subsPick: 'subs:pick',
  subsRead: 'subs:read',

  mediaPeaks: 'media:peaks',
  mediaPeaksCancel: 'media:peaks-cancel',
  mediaProbe: 'media:probe',

  shellVerbStatus: 'shell:verb-status',
  shellVerbSet: 'shell:verb-set',

  audioSynth: 'audio:synth',
  audioBlind: 'audio:blind',

  docHtml: 'doc:html',

  videoConvert: 'video:convert',
  videoCancel: 'video:cancel',

  appsFor: 'apps:for',

  archiveAdd: 'archive:add',
  archiveMoveMembers: 'archive:move-members',
  archiveExtractTo: 'archive:extract-to',
  archiveExtractMembersPicked: 'archive:extract-members-picked',
  archiveStat: 'archive:stat',
  archiveList: 'archive:list',
  archiveExtractAll: 'archive:extract-all',
  archiveExtractDir: 'archive:extract-dir',
  archiveExtract: 'archive:extract',
  archiveRename: 'archive:rename',
  archiveMember: 'archive:member',
  archiveSummary: 'archive:summary',
  archiveMemberOut: 'archive:member-out',
  archiveRememberPassword: 'archive:remember-password',
  archiveDelete: 'archive:delete',

  iconForExt: 'icon:for-ext',

  extractCancel: 'extract:cancel',

  comicOpen: 'comic:open',

  openExternal: 'link:open-external',

  windowMinimize: 'window:minimize',
  windowToggleMaximize: 'window:toggle-maximize',
  windowClose: 'window:close',
  windowSetFullscreen: 'window:set-fullscreen',
  windowMaterial: 'window:material',
  windowFsTransition: 'window:fs-transition',
  windowFsShroud: 'window:fs-shroud',

  editorDirty: 'editor:dirty',

  powerAwake: 'power:awake',

  updateAnnounce: 'update:announce',
  updateInstall: 'update:install',
  updateCancel: 'update:cancel',

  appVersion: 'app:version',
  appDefaultApps: 'app:default-apps',

  e2eSlowIpc: 'e2e:slow-ipc',
  e2eClipboard: 'e2e:clipboard',

  windowPreferencesLoad: 'window-preferences:load',
  windowPreferencesSeed: 'window-preferences:seed',
  windowPreferencesSet: 'window-preferences:set',

  winEStatus: 'win-e:status',
  winESet: 'win-e:set',
  winEListen: 'win-e:listen',
  foldersStatus: 'folders:status',
  foldersSet: 'folders:set',
  winEReady: 'win-e:ready',

  sweepOverlayBegin: 'sweep-overlay:begin',
  sweepOverlayUpdate: 'sweep-overlay:update',
  sweepOverlayEnd: 'sweep-overlay:end'
} as const

/** The native sweep box's four (#338), by message kind: main's handler and
 *  its test index them by `begin`, `update` and `end`. */
export const SWEEP_CHANNELS = {
  begin: CALL.sweepOverlayBegin,
  update: CALL.sweepOverlayUpdate,
  end: CALL.sweepOverlayEnd,
  state: PUSH.sweepOverlayState
} as const
