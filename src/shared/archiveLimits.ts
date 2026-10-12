/** adm-zip's write cap: past it, listing still works, but main refuses every
 *  member operation and every write to a zip (main's archive.ts). The
 *  renderer reads it too, so a zip over it is never offered Add files. */
export const ZIP_WRITE_MAX = 600 * 1024 * 1024
