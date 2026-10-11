import { useEffect, useRef, useState } from 'react'

/**
 * One answer from main for the Properties window, read once per `key` (the
 * file's path). Undefined while it is on its way; an answer for an older key
 * is never shown under a newer one, and a failure answers `fallback`.
 */
export function useLoaded<T>(key: string, load: () => Promise<T>, fallback: T): T | undefined {
  const [got, setGot] = useState<{ key: string; value: T } | null>(null)
  const latest = useRef({ load, fallback })
  useEffect(() => {
    latest.current = { load, fallback }
  })
  useEffect(() => {
    let alive = true
    const { load: read, fallback: none } = latest.current
    read().then(
      (value) => alive && setGot({ key, value }),
      () => alive && setGot({ key, value: none })
    )
    return () => {
      alive = false
    }
  }, [key])
  return got?.key === key ? got.value : undefined
}
