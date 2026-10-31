import type { NativeDragRecord } from '@shared/dragOut'

/**
 * THE E2E NEVER STARTS AN OS DRAG (#103). `webContents.startDrag` is a modal
 * loop in main that only a real release ends; in the suite nothing would
 * release it and the run would hang (and on the owner's own desktop it would
 * take the pointer). Under `--e2e` main records each drag here instead
 * (`dragOut.ts`), and the e2e reads it with
 * `app.evaluate(() => globalThis.__e2eDragOut.calls)`.
 */
export interface FakeDragCall {
  paths: string[]
  file: string
  iconEmpty: boolean
  source: number
  cargo: NativeDragRecord['cargo']
}

const calls: FakeDragCall[] = []

export function recordFakeDrag(call: { record: NativeDragRecord; iconEmpty: boolean; file: string }): void {
  calls.push({
    paths: [...call.record.paths],
    file: call.file,
    iconEmpty: call.iconEmpty,
    source: call.record.source,
    cargo: call.record.cargo
  })
}

export function fakeDragCalls(): FakeDragCall[] {
  return calls
}

export function clearFakeDrags(): void {
  calls.length = 0
}
