/**
 * THE ONE EXTRACTION CHANNEL (2026-09-19, #166).
 *
 * Owner: "When you extract something, the progress bar works differently
 * based on how you extracted ... I would like it to just be one kind of view
 * that appears, and I want it to be a pop-up window that you can't close,
 * kind of like it is with WinRAR." There were five routes (Extract here,
 * Extract to..., a folder row's Extract folder here, a member row's pair, and
 * members dragged onto a sidebar folder) and three looks between them: a chip
 * with a percentage, a chip with none, and nothing at all for the drag.
 *
 * So MAIN tells the story, not each caller: every route that writes extracted
 * files to a folder the user can see opens a job, and the job speaks on ONE
 * channel (`extract:event`) in three kinds of message. The renderer has one
 * listener, one reducer and one window for all of them. Main starts the job
 * AFTER its own folder dialog has been answered, which is why the start has
 * to come from main: the renderer cannot know when "Extract to..." stopped
 * being a question and became work.
 */

/** Why an extraction did not happen. `busy` never reaches the window: it is
 *  main refusing a second job while one is up, which the modal makes
 *  unreachable from the UI. */
export type ExtractFail = 'password' | 'aes' | 'failed'

export type ExtractEvent =
  | {
      type: 'start'
      id: string
      /** The archive's file name, for the title. */
      archive: string
      /** The folder the files are going to, as a full path. */
      dest: string
      /** The caller asks for a password and tries again when one is needed,
       *  so a `password` ending closes the window instead of becoming the
       *  error: two dialogs for one wrong answer would be the old problem
       *  in a new place. */
      asksPassword?: boolean
    }
  | {
      type: 'progress'
      id: string
      /** 0-100, or null while the engine has not said. */
      pct: number | null
      /** The member being written, as the container names it. */
      file: string
    }
  | {
      type: 'end'
      id: string
      result: 'done' | 'cancelled' | 'failed'
      reason?: ExtractFail
      /** 7-Zip's own line, when it printed one worth reading. */
      message?: string
    }
