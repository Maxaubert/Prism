import { useEffect, useState, type JSX, type ReactNode } from 'react'
import type { ViewerFile } from '@shared/types'
import type { MemberAnswer } from '@shared/archivePlace'
import { formatBytes } from '../lib/format'
import { intendToPlay, wasPlaying } from '../lib/playState'
import { ROW_BUTTON } from 'prism-term-core/renderer/settings/fields'
import { askArchivePassword } from '../lib/archiveQuestion'

/**
 * THE MEMBER GATE (#300). A file inside a zip is a place in the Explorer now,
 * and every viewer Prism has is a viewer of a file on disk. So in front of each
 * of them, for a member, one gate: main unpacks just that member to the run's
 * temp folder (`archive:member`), and the SAME viewer is drawn with the temp
 * path. The member keeps its own name, so the viewer's kind and title read it.
 *
 * What the mockup drew while it works (04a): a 200 px bar and "Unpacking
 * caret.ts to show it", but only after 150 ms, so a small member never flashes
 * it. A member past the automatic-preview limit waits for an explicit Open; a
 * locked one asks for the password, and again when it was wrong. The question
 * is the window's (`askArchivePassword`): an extract of the same archive asking
 * at the same moment joins it, and the gate only says what is shut.
 */
export function MemberGate({
  file,
  render
}: {
  file: ViewerFile
  render: (real: ViewerFile) => ReactNode
}): JSX.Element {
  const [answer, setAnswer] = useState<{ key: string; got: MemberAnswer } | null>(null)
  const [slow, setSlow] = useState<string | null>(null)
  const [force, setForce] = useState<string | null>(null)
  const [password, setPassword] = useState<{ key: string; pw: string } | null>(null)
  // Counted so the same wrong password typed twice is still tried again.
  const [tries, setTries] = useState(0)
  const key = file.path
  const name = file.name
  const forced = force === key
  const pw = password?.key === key ? password.pw : undefined
  useEffect(() => {
    let live = true
    let withdraw = (): void => {}
    const began = performance.now()
    const timer = setTimeout(() => live && setSlow(key), 150)
    void window.prism
      .archiveMember(key, pw, forced)
      .then((got) => {
        if (!live) return
        if (got.ok) {
          // A pick that meant "play this" (#139) meant the member, whose
          // player is keyed by the temp copy's url.
          if (wasPlaying(window.prism.mediaUrl(key))) intendToPlay(window.prism.mediaUrl(got.path))
        } else if (got.reason === 'password') {
          const ask = askArchivePassword({
            archive: got.container ?? key,
            name,
            wrong: !!pw,
            tried: pw,
            began
          })
          withdraw = ask.withdraw
          void ask.answer.then((value) => {
            if (!live || value === null) return
            setAnswer(null)
            setPassword({ key, pw: value })
            setTries((n) => n + 1)
          })
        }
        setAnswer({ key, got })
      })
      .catch(() => live && setAnswer({ key, got: { ok: false, reason: 'failed' } }))
      .finally(() => clearTimeout(timer))
    return () => {
      live = false
      clearTimeout(timer)
      withdraw()
    }
  }, [key, name, pw, forced, tries])

  const got = answer?.key === key ? answer.got : null
  if (got?.ok) {
    return <>{render({ ...file, path: got.path, kind: got.kind === 'other' ? file.kind : got.kind, member: undefined, name })}</>
  }
  const center = 'grid h-full w-full place-items-center p-6 text-center text-[13px] text-[var(--p-dim)]'
  if (!got)
    return (
      <div className={center} data-member-gate="unpacking">
        {slow === key && (
          <div className="flex flex-col items-center gap-3">
            <div className="h-[3px] w-[200px] overflow-hidden rounded-full bg-[color:var(--p-divider)]">
              <div className="member-gate-bar h-full w-1/3 rounded-full bg-[var(--p-accent-solid)]" />
            </div>
            <span>Unpacking {file.name} to show it</span>
          </div>
        )}
      </div>
    )
  if (got.reason === 'too-big')
    return (
      <div className={center} data-member-gate="large">
        <div className="flex flex-col items-center gap-3">
          <div className="text-[var(--p-text)]">{file.name}</div>
          <div>
            {got.size ? `${formatBytes(got.size)}. ` : ''}Large file. Open it to unpack it.
          </div>
          <button className={ROW_BUTTON} onClick={() => setForce(key)}>
            Open
          </button>
        </div>
      </div>
    )
  if (got.reason === 'password')
    return (
      <div className={center} data-member-gate="locked">
        <span>{file.name} is password protected.</span>
      </div>
    )
  return (
    <div className={center} data-member-gate="failed" role="status">
      {got.reason === 'space'
        ? 'Not enough space to unpack this file.'
        : got.reason === 'deep'
          ? 'Archives nested this deep are not opened.'
          : got.reason === 'nest-big'
            ? 'This archive inside an archive is too large to open in place. Extract it first.'
          : `Couldn't unpack ${file.name}. The archive may be damaged.`}
    </div>
  )
}
