# Navigation scope — implementation plan

Spec: [`2026-07-31-navigation-scope-design.md`](../specs/2026-07-31-navigation-scope-design.md)
Issue: [#1](https://github.com/Maxaubert/Prism/issues/1) · Branch: `feat/navigation-scope`

## Task 1 — test harness

`vitest.config.ts`: `test.include` on `src/**/*.test.ts`, `environment: 'node'`,
aliases `@shared` → `src/shared` and `@renderer` → `src/renderer/src`.

Verify: `npm test` runs (still passes with no tests).

## Task 2 — `src/renderer/src/lib/navScope.ts`

Written test-first against `navScope.test.ts`.

1. `export type NavScope = 'all' | 'group' | 'type'`.
2. `NAV_SCOPES: Array<{ id: NavScope; name: string; desc: string }>`.
3. `GROUP: Record<FileKind, string>` — image/video/audio → `media`,
   pdf/text → `docs`, other → `other`.
4. `scopeFiles(files: ViewerFile[], index: number, scope: NavScope): { files: ViewerFile[]; index: number }`
   - `all`, empty list, or an out-of-range index → return the input unchanged
     (index clamped).
   - Otherwise anchor on `files[index]`, keep any file matching the anchor by
     group (`group`) or kind (`type`), always keep the anchor itself, and return
     the anchor's new position.
5. Persisted store: `loadNavScope()`, `setNavScope(s)`, `useNavScope()` —
   `useSyncExternalStore` over a module-level value, key `prism.nav.scope`,
   unknown/absent stored value falls back to `'group'`.

Verify: `npm test` green.

## Task 3 — wire `App.tsx`

- Rename the payload state to `raw`; add `rawIndex`.
- `const scope = useNavScope()`; derive `view` via `useMemo(scopeFiles(...))`.
- `file = view?.files[view.index] ?? null`.
- `go(delta)` clamps within `view.files`, resolves the target file, sets
  `rawIndex` to its index in `raw.files`.
- Point `pos`, `many`, the arrows, and the preload effect at `view`.

Verify: `npm run typecheck` and `npm run lint` clean.

## Task 4 — Settings tab

- `TabId` gains `'general'`; a General entry leads the `TABS` array with its own
  icon.
- `GeneralTab`: one `Section` ("Folder navigation"), a tile per `NAV_SCOPES` entry with a
  small schematic (a row of kind chips showing what the list holds) and the
  description, reusing `Tile` / `TileFooter`.

Verify: `npm run typecheck`, `npm run lint`, then `npm run dev` — open an image
in a mixed folder, confirm the count changes across the three modes and the
viewer keeps its file.

## Task 5 — ship

`npm test && npm run typecheck && npm run lint && npm run build`, commit, push,
PR referencing #1.
