import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WindowPreferenceChange, WindowPreferencesSnapshot } from '@shared/windowPreferences'

let restorePrototype: (() => void) | undefined

/** Each test gets a disposable prototype because the production install marker is permanent. */
function harness(snapshot: WindowPreferencesSnapshot | null) {
  class TestStorage implements Storage {
    private values = new Map<string, string>()
    get length(): number {
      return this.values.size
    }
    clear(): void {
      this.values.clear()
    }
    getItem(key: string): string | null {
      return this.values.get(String(key)) ?? null
    }
    key(index: number): string | null {
      return [...this.values.keys()][index] ?? null
    }
    setItem(key: string, value: string): void {
      this.values.set(String(key), String(value))
    }
    removeItem(key: string): void {
      this.values.delete(String(key))
    }
  }
  const nativeSet = TestStorage.prototype.setItem
  const nativeRemove = TestStorage.prototype.removeItem
  restorePrototype = () => {
    TestStorage.prototype.setItem = nativeSet
    TestStorage.prototype.removeItem = nativeRemove
  }
  const local = new TestStorage()
  const session = new TestStorage()
  let change: ((snapshot: WindowPreferencesSnapshot) => void) | undefined
  const bridge = {
    windowPreferencesLoad: vi.fn(() => snapshot),
    windowPreferencesSeed: vi.fn<(values: Record<string, string>) => WindowPreferencesSnapshot | null>(() => snapshot),
    windowPreferencesSet: vi.fn<(change: WindowPreferenceChange) => boolean>(() => true),
    onWindowPreferencesChanged: vi.fn((listener: (snapshot: WindowPreferencesSnapshot) => void) => {
      change = listener
      return () => {
        change = undefined
      }
    })
  }
  class TestStorageEvent extends Event {
    readonly key: string | null
    readonly oldValue: string | null
    readonly newValue: string | null
    readonly storageArea: Storage | null
    constructor(type: string, init: StorageEventInit) {
      super(type)
      this.key = init.key ?? null
      this.oldValue = init.oldValue ?? null
      this.newValue = init.newValue ?? null
      this.storageArea = init.storageArea ?? null
    }
  }
  const target = Object.assign(new EventTarget(), {
    localStorage: local,
    sessionStorage: session,
    prism: bridge
  })
  vi.stubGlobal('Storage', TestStorage)
  vi.stubGlobal('StorageEvent', TestStorageEvent)
  vi.stubGlobal('window', target)
  return {
    local,
    session,
    bridge,
    target,
    notify: (snapshot: WindowPreferencesSnapshot) => change?.(snapshot),
    prototype: TestStorage.prototype,
    nativeSet,
    nativeRemove
  }
}

beforeEach(() => vi.resetModules())
afterEach(() => {
  restorePrototype?.()
  restorePrototype = undefined
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.resetModules()
})

describe('window preference bootstrap', () => {
  it('seeds primary local preferences before applying canonical values, preserving unknown local keys', async () => {
    const originalStorage = globalThis.localStorage
    const h = harness({ shared: false, values: { 'prism.style': 'canonical' } })
    h.local.setItem('prism.style', 'stale-local')
    h.local.setItem('prism.quickAccess', '[{"path":"C:\\\\Photos"}]')
    h.local.setItem('prism.futurePreference', 'new-local-setting')
    h.local.setItem('prism.sidebar.width', '350')
    h.local.setItem('unrelated', 'leave-me')
    h.bridge.windowPreferencesSeed.mockImplementation((values) => {
      expect(h.bridge.windowPreferencesLoad).toHaveBeenCalledOnce()
      expect(h.local.getItem('prism.style')).toBe('stale-local')
      return { shared: false, values: { ...values, 'prism.style': 'canonical' } }
    })

    await import('./windowPreferences')

    expect(h.bridge.windowPreferencesSeed).toHaveBeenCalledExactlyOnceWith({
      'prism.style': 'stale-local',
      'prism.quickAccess': '[{"path":"C:\\\\Photos"}]',
      'prism.futurePreference': 'new-local-setting'
    })
    expect(h.local.getItem('prism.style')).toBe('canonical')
    expect(h.local.getItem('prism.futurePreference')).toBe('new-local-setting')
    expect(h.local.getItem('prism.sidebar.width')).toBe('350')
    expect(h.local.getItem('unrelated')).toBe('leave-me')
    expect(h.bridge.windowPreferencesSet).not.toHaveBeenCalled()
    expect(globalThis.localStorage).toBe(originalStorage)
  })

  it('loads child appearance and pins without seeding child values back into the primary', async () => {
    const h = harness({
      shared: true,
      values: {
        'prism.style': 'shared-style',
        'prism.onboarded': '1',
        'prism.quickAccess': '[]',
        'prism.sidebar.width': '999',
        'prism.phone.token': 'never-import',
        unrelated: 'never-import'
      }
    })
    h.local.setItem('prism.style', 'old-child-style')
    h.local.setItem('prism.sidebar.width', '240')

    await import('./windowPreferences')

    expect(h.bridge.windowPreferencesSeed).not.toHaveBeenCalled()
    expect(h.local.getItem('prism.style')).toBe('shared-style')
    expect(h.local.getItem('prism.onboarded')).toBe('1')
    expect(h.local.getItem('prism.quickAccess')).toBe('[]')
    expect(h.local.getItem('prism.sidebar.width')).toBe('240')
    expect(h.local.getItem('prism.phone.token')).toBeNull()
    expect(h.local.getItem('unrelated')).toBeNull()
    expect(h.bridge.windowPreferencesSet).not.toHaveBeenCalled()
  })

  it('applies explicit removal tombstones without deleting absent preferences or local state', async () => {
    const h = harness({
      shared: false,
      values: {},
      removed: ['prism.term.font', 'prism.sidebar.width', 'unrelated']
    })
    h.local.setItem('prism.term.font', 'removed-in-another-window')
    h.local.setItem('prism.futurePreference', 'still-local')
    h.local.setItem('prism.sidebar.width', '300')
    h.local.setItem('unrelated', 'still-local')

    await import('./windowPreferences')

    expect(h.bridge.windowPreferencesSeed).toHaveBeenCalledExactlyOnceWith({
      'prism.term.font': 'removed-in-another-window',
      'prism.futurePreference': 'still-local'
    })
    expect(h.local.getItem('prism.term.font')).toBeNull()
    expect(h.local.getItem('prism.futurePreference')).toBe('still-local')
    expect(h.local.getItem('prism.sidebar.width')).toBe('300')
    expect(h.local.getItem('unrelated')).toBe('still-local')
    expect(h.bridge.windowPreferencesSet).not.toHaveBeenCalled()
  })

  it('forwards shared localStorage mutations but leaves sessionStorage and local-only keys alone', async () => {
    const h = harness({ shared: true, values: {} })
    await import('./windowPreferences')
    h.local.setItem('prism.style', 'dark')
    h.local.removeItem('prism.term.font')
    for (const storage of [h.local, h.session]) {
      for (const key of [
        'unrelated',
        'prism.sidebar',
        'prism.sidebar.width',
        'prism.explorer.widths',
        'prism.explorer.places',
        'prism.settings.rail',
        'prism.term.h',
        'prism.term.w',
        'prism.phone.token',
        'prism.docpos.book',
        'prism.resume.movie'
      ]) {
        storage.setItem(key, 'local-value')
        expect(storage.getItem(key)).toBe('local-value')
        storage.removeItem(key)
        expect(storage.getItem(key)).toBeNull()
      }
    }
    h.session.setItem('prism.style', 'session-only')
    h.session.removeItem('prism.style')
    expect(h.bridge.windowPreferencesSet.mock.calls).toEqual([
      [{ key: 'prism.style', value: 'dark' }],
      [{ key: 'prism.term.font', value: null }]
    ])
    expect(h.local.getItem('prism.style')).toBe('dark')
  })

  it('does not double-patch Storage or reload preferences when the bootstrap module is evaluated twice', async () => {
    const h = harness({ shared: false, values: { 'prism.style': 'initial' } })
    await import('./windowPreferences')
    const patchedSet = h.prototype.setItem
    const patchedRemove = h.prototype.removeItem
    vi.resetModules()
    await import('./windowPreferences')
    expect(h.prototype.setItem).toBe(patchedSet)
    expect(h.prototype.removeItem).toBe(patchedRemove)
    expect(h.bridge.windowPreferencesLoad).toHaveBeenCalledOnce()
    expect(h.bridge.windowPreferencesSeed).toHaveBeenCalledOnce()
    expect(h.bridge.onWindowPreferencesChanged).toHaveBeenCalledOnce()
    h.local.setItem('prism.style', 'new')
    h.local.removeItem('prism.style')
    expect(h.bridge.windowPreferencesSet).toHaveBeenCalledTimes(2)
  })

  it('keeps local preferences usable if shared writes throw or the shared store is unavailable', async () => {
    const h = harness(null)
    await import('./windowPreferences')
    expect(h.prototype.setItem).toBe(h.nativeSet)
    expect(h.prototype.removeItem).toBe(h.nativeRemove)
    expect(h.bridge.windowPreferencesSeed).not.toHaveBeenCalled()
    h.bridge.windowPreferencesLoad.mockReturnValue({ shared: true, values: {} })
    h.bridge.windowPreferencesSet.mockImplementation(() => {
      throw new Error('Disk unavailable')
    })
    vi.resetModules()
    await import('./windowPreferences')
    expect(() => h.local.setItem('prism.style', 'local-fallback')).not.toThrow()
    expect(h.local.getItem('prism.style')).toBe('local-fallback')
    expect(() => h.local.removeItem('prism.style')).not.toThrow()
    expect(h.local.getItem('prism.style')).toBeNull()
    expect(h.bridge.windowPreferencesSet).toHaveBeenCalledTimes(2)
  })
})

it('applies shared updates with storage events, shares custom styles and ignores unchanged echoes', async () => {
  const h = harness({ shared: true, values: { 'prism.style.draft': '{"accent":"blue"}' } })
  const events: Array<{ key: string | null; oldValue: string | null; newValue: string | null }> = []
  h.target.addEventListener('storage', (event) => {
    const changed = event as StorageEvent
    expect(changed.storageArea).toBe(h.local)
    expect(h.local.getItem(changed.key!)).toBe(changed.newValue)
    events.push({ key: changed.key, oldValue: changed.oldValue, newValue: changed.newValue })
  })
  await import('./windowPreferences')
  expect(h.local.getItem('prism.style.draft')).toBe('{"accent":"blue"}')
  expect(events).toEqual([])
  h.notify({
    shared: true,
    values: { 'prism.quickAccess': '["Pictures"]', 'prism.style.draft': '{"accent":"red"}' }
  })
  h.notify({
    shared: true,
    values: { 'prism.quickAccess': '["Pictures"]', 'prism.style.draft': '{"accent":"red"}' }
  })
  h.notify({ shared: true, values: {}, removed: ['prism.quickAccess'] })
  expect(events).toEqual([
    { key: 'prism.quickAccess', oldValue: null, newValue: '["Pictures"]' },
    { key: 'prism.style.draft', oldValue: '{"accent":"blue"}', newValue: '{"accent":"red"}' },
    { key: 'prism.quickAccess', oldValue: '["Pictures"]', newValue: null }
  ])
  expect(h.bridge.windowPreferencesSet).not.toHaveBeenCalled()
  h.local.setItem('prism.style.draft', '{"accent":"green"}')
  h.notify({ shared: true, values: { 'prism.style.draft': '{"accent":"green"}' } })
  expect(events).toHaveLength(3)
  expect(h.bridge.windowPreferencesSet).toHaveBeenCalledExactlyOnceWith({
    key: 'prism.style.draft',
    value: '{"accent":"green"}'
  })
})

it('refreshes canonical preferences synchronously on focus before the next user edit', async () => {
  const h = harness({
    shared: true,
    values: { 'prism.quickAccess': '["Home"]', 'prism.term.font': 'old-font' }
  })
  await import('./windowPreferences')
  const changes: string[] = []
  h.target.addEventListener('storage', (event) => changes.push((event as StorageEvent).key!))
  h.bridge.windowPreferencesLoad.mockReturnValue({
    shared: true,
    values: { 'prism.quickAccess': '["Home","Photos"]', 'prism.sidebar.width': '999' },
    removed: ['prism.term.font']
  })
  h.target.dispatchEvent(new Event('focus'))
  expect(h.local.getItem('prism.quickAccess')).toBe('["Home","Photos"]')
  expect(h.local.getItem('prism.term.font')).toBeNull()
  expect(h.local.getItem('prism.sidebar.width')).toBeNull()
  expect(changes).toEqual(['prism.quickAccess', 'prism.term.font'])
  expect(h.bridge.windowPreferencesSeed).not.toHaveBeenCalled()
  expect(h.bridge.windowPreferencesSet).not.toHaveBeenCalled()
  h.target.dispatchEvent(new Event('focus'))
  expect(changes).toHaveLength(2)
  const pins = JSON.parse(h.local.getItem('prism.quickAccess')!) as string[]
  h.local.setItem('prism.quickAccess', JSON.stringify([...pins, 'Documents']))
  expect(h.bridge.windowPreferencesSet).toHaveBeenCalledExactlyOnceWith({
    key: 'prism.quickAccess',
    value: '["Home","Photos","Documents"]'
  })
})
