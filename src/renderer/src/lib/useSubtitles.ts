import { useCallback, useEffect, useRef, useState } from 'react'
import { setPlayerPref, usePlayerPrefs } from './playerPrefs'

// Sidecar subtitles for the video player. Main finds the tracks (same name
// beside the file, or in Subs/); this hook remembers whether subtitles are
// wanted at all (persisted, so a season marathon turns them on once), picks
// the first track of a new file automatically when they are, and turns the
// active track's text into a blob URL a <track> element can carry.

export interface SubTrackInfo {
  path: string
  label: string
}

export interface Subtitles {
  tracks: SubTrackInfo[]
  active: string | null
  /** Object URL of the active track's WebVTT, for <track src>. */
  vttUrl: string | null
  pick: (path: string | null) => void
  /** Point at a subtitle file by hand: added to this file's tracks and turned
   *  on. For the ones name-matching cannot find. */
  add: () => void
}

export function useSubtitles(videoPath: string): Subtitles {
  const { subs } = usePlayerPrefs()
  // Everything here is keyed by path: the player is NOT remounted between
  // videos (the viewer is keyed by kind), so un-keyed state would carry one
  // file's subtitles onto the next while the lookup is still in flight.
  const [found, setFound] = useState<{ path: string; tracks: SubTrackInfo[] } | null>(null)
  const [chosen, setChosen] = useState<{ path: string; track: string | null } | null>(null)
  const [vtt, setVtt] = useState<{ track: string; url: string } | null>(null)
  const urlRef = useRef<string | null>(null)

  const tracks = found?.path === videoPath ? found.tracks : []
  const active = chosen?.path === videoPath ? chosen.track : null

  useEffect(() => {
    let alive = true
    void window.prism.subsFor(videoPath).then((t) => {
      if (!alive) return
      setFound({ path: videoPath, tracks: t })
      // Subtitles are wanted: the new file starts with its first track on.
      setChosen({ path: videoPath, track: subs && t.length ? t[0].path : null })
    })
    return () => {
      alive = false
    }
    // `subs` is deliberately not a dependency: it decides what a NEW file opens
    // with; flipping it mid-file is the pick() below, not a refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoPath])

  // `vtt` is keyed by track, and vttUrl below only hands it out while it still
  // matches `active`, so turning subtitles off needs no reset here.
  useEffect(() => {
    if (!active) return
    let alive = true
    void window.prism.readSubs(active).then((text) => {
      if (!alive || text === null) return
      const url = URL.createObjectURL(new Blob([text], { type: 'text/vtt' }))
      setVtt({ track: active, url })
    })
    return () => {
      alive = false
    }
  }, [active])

  // One live object URL at a time; the previous one is released when replaced,
  // and the last on unmount.
  useEffect(() => {
    const prev = urlRef.current
    urlRef.current = vtt?.url ?? null
    if (prev && prev !== vtt?.url) URL.revokeObjectURL(prev)
  }, [vtt])
  useEffect(
    () => () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current)
    },
    []
  )

  const pick = useCallback(
    (path: string | null) => {
      setChosen({ path: videoPath, track: path })
      setPlayerPref('subs', path !== null) // remembered for the next file
    },
    [videoPath]
  )

  /** The manual route: main's dialog picks the file (that IS the consent for
   *  reading it), and it joins this file's tracks, already chosen. */
  const add = useCallback(() => {
    void window.prism.pickSubtitle(videoPath).then((track) => {
      if (!track) return
      setFound((f) => {
        const list = f?.path === videoPath ? f.tracks : []
        // Picking the same file twice adds one row, not two.
        const merged = list.some((t) => t.path === track.path) ? list : [...list, track]
        return { path: videoPath, tracks: merged }
      })
      setChosen({ path: videoPath, track: track.path })
      setPlayerPref('subs', true)
    })
  }, [videoPath])

  return { tracks, active, vttUrl: vtt?.track === active ? vtt.url : null, pick, add }
}
