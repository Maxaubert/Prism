/**
 * Whether the Explorer writes down what is in the folders it opens (#271), so
 * the next launch, even after a reboot, shows them at once. On by default (the
 * owner's approved recommendation 1, 2026-10-04); 'off' stops it and deletes
 * what was kept. A window preference, so main reads the same key it watches.
 */
export const REMEMBER_FOLDERS_KEY = 'prism.explorer.rememberFolders'
