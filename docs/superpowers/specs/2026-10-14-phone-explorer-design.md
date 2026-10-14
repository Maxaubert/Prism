# The phone browses like the Explorer (design, 2026-10-14)

Owner, 2026-10-14: "i wanna change up how remote works so its basically just on the explorer,
meaning youre not tied down to a specific project". Answers the same day:

| Question | Owner's answer |
|---|---|
| How much of the PC can a paired phone reach? | **The whole PC, like the Explorer tab**: This PC, every drive, Quick access, any folder below. |
| What does the drawer (hamburger) show? | **The Explorer's places**: Quick access (Known Folders and the user's pins) and This PC's drives. Open tabs leave the phone. |
| Where does the phone land? | **Where it left off.** First time: the folder the PC is showing when the code is made. After that the last folder the phone was in, whatever the PC does. |

## What changes for the person holding the phone

- The phone is no longer "on a tab". It is in a FOLDER, anywhere on the PC.
- The crumb row starts at **This PC**: `This PC › C: › Users › Max › Videos`. Tapping This PC
  shows the places page (below); Up from a drive's top goes there too.
- The hamburger opens a drawer titled **Places**: Quick access (Home, Desktop, Downloads,
  Documents, Pictures, Music, Videos, then the user's own Quick access pins, in the PC's
  order), then **This PC** with each drive (letter, label, used of total, the same bar as the
  Explorer's drive rows). A tap goes there and closes the drawer.
- Search searches the folder the phone is in and everything below it, the way the
  Explorer's search box does.
- A folder that is gone (deleted, a drive pulled) says so and offers **Up** and **This PC**,
  never a dead end. The old "that tab closed" screen and the open-tabs list are removed.
- Reopening the page, or the phone coming back days later, lands in the last folder it was in.
  The PC moving between tabs never moves the phone.
- Viewing is unchanged: every viewer, HLS, subtitles, documents, comics, archives, positions.
  The phone stays READ-ONLY: no rename, delete, move or save route exists or is added.

## What changes on the PC

- The phone dialog's switch line: "Serve this PC's open folders to phones on this network"
  becomes "Let paired phones browse this PC on this network". Above the switch, before it is
  turned on, one plain line says that a paired phone can see every folder this Windows user
  can (beside the existing firewall line).
- A code can be made from ANY tab, the Explorer included (today only a folder tab can show
  one). It carries the folder that tab is showing as the phone's first stop; with nothing to
  carry (Settings in front), the phone starts at This PC.
- The paired-phones list shows each phone's current folder instead of its tab.
- An already-paired phone keeps its token and starts in the folder it was on.

## THE WALL (a security decision, written down because it widens)

Today a paired phone reaches only folders open as tabs (the 2026-09-08 widening from one
tab to every open tab). This WIDENS IT to **every folder this Windows user can read**, which
is exactly what the desktop Explorer already reaches. What does NOT change:

1. **Pairing is the gate.** Every route but the page and `/pair` still needs a paired token;
   codes stay six characters, single-use, two minutes, five tries a minute per address.
2. **Your network only.** Plain HTTP on the LAN as today, loopback-only under `--e2e`.
3. **Read-only.** The phone writes exactly one thing, a film's position, into main's store.
4. **The same per-folder grant model as the desktop Explorer** (`desktopAccess.ts`). Each
   phone gets its own access owner, `phone:<token>`:
   - Listing a folder by its absolute path is allowed (any local folder, like the Explorer's
     `browse:directory`) and GRANTS that folder to that phone.
   - A file route (`/m/`, play, thumb, text, doc, comic, archive, subs, stat, pos) is
     allowed only for a path DIRECTLY inside a folder this phone has listed, or a file one of
     its own answers granted it (a markdown's pictures, a comic's pages, an extracted member),
     exactly as today's `grants`.
   - Search grants the folders of the hits it returns, as the Explorer's search does.
   - Because the owner is the same `desktopAccess` map, main's own media wall
     (`insideDesktop` in `pathWall.ts`) passes the bytes with no new hole in `serveMedia`.
   - Forgetting a phone, or the server switching off, releases its access owner and stops its
     HLS jobs. Grants are in memory and rebuilt by browsing; the remembered folder is listed
     again on return, which re-grants it.
5. **Paths are local absolute paths.** UNC paths (`\\server\share`) and device paths
   (`\\?\`, `\\.\`) are refused for the phone, even where the desktop allows them. A drive
   letter that is a mapped network drive is allowed, as in the Explorer.
6. **Every ask, not just the first** still holds: an HLS job's file is re-checked against
   the phone's access on every playlist and segment ask.

`docs/features.md` gets this as a new entry that supersedes "THE PHONE SEES THE OPEN TABS"
(2026-09-08), saying the widening plainly.

## Wire changes (`src/shared/phoneWire.ts`)

- Removed: `ROUTE.tabs`, `ROUTE.tab`, `TabsAnswer`, `TabMoved`, `PhoneTab`.
- Added `ROUTE.places` → `PlacesAnswer { quick: PhonePlace[]; drives: PhoneDrive[] }`, where a
  place is `{ name, path, known? }` and a drive is `{ name, path, label, total, free }`
  (what `browseLocations` and `driveUsage` already answer the Explorer).
- `Me` becomes `{ name: string; here: string | null }` (`here` null means This PC).
- `PairAnswer` becomes `{ token, here }`.
- `ROUTE.dir` lists any local absolute folder and records it as the phone's `here`.
- `ROUTE.search` takes `dir` (the folder searched) instead of using a root.

## Main side

- `pairing.ts`: `Phone.root` becomes `Phone.here: string | null`; a code's `root` becomes
  `start: string | null`. `parseStore` reads an old store's `root` as `here`.
- `server.ts`: the `inside()` closure and the media check become one `may(phone, path)`
  backed by `phoneAccess.ts` (new, thin: wraps `grantDesktopDirectory`,
  `ownsDesktopDirectory` and `validDesktopRoot` with the `phone:<token>` owner, plus the
  UNC refusal). `move()` stays as the one path a re-scan takes (drops grants and the job).
  `here` is saved at most once every few seconds (the store write is already async).
- `PhoneDeps`: `openRoots`, `rootOpen`, `isRoot`, `validRoot` go; `places()` (locations, the
  user's pins and drive usage), `phoneAccess` and an Explorer-style `search(dir, q)` come in.
- `index.ts`: codes are issued for any folder or none; `rootIsOpen` no longer gates a code.
- Pins: the renderer already keeps Quick access pins in `prism.quickAccess`. It reports them
  to main on change over one new fire-and-forget channel (`phone:pins`), which main keeps in
  memory for `/api/places`. Main never reads renderer storage.

## Phone side (`src/renderer/src/phone/`)

- `PhoneApp.tsx`: three states become two: pair, or browse. The "tab closed" state goes.
- `Browser.tsx`: works on `here` with no root. `crumbs` and `parentOf` (`browse.ts`) take a
  path and return This PC as the first crumb. A `Places` page (new `Places.tsx`) shows when
  `here` is null; the drawer reuses it. `TabList.tsx` and `tabs.ts` are deleted.
- `place.ts`: the URL carries `dir` and `file` without a root, so a reload lands in place.
- Search sends the current folder.

## Tests

- Unit: `pairing.test.ts` (store migration `root` to `here`, `start` codes),
  `phoneAccess.test.ts` (new: list grants, file needs a listed parent, UNC refused, release),
  `server.test.ts` (routes: `/api/places`, `/api/dir` anywhere, file outside a listed folder
  is 403, `/api/tab(s)` gone, forget releases), `browse.test.ts` (crumbs from This PC),
  `place.test.ts`.
- E2E (`tools/e2e/run.mjs`): `phoneTabs` is replaced by `phoneExplorer`: pair from the
  Explorer tab, land in its folder, open the drawer and see Quick access and the drives, tap
  a drive and walk into a second fixture folder that is NOT open in any tab, play a file
  there, reload and land in the same folder, a file in a never-listed folder is 403, a
  forgotten phone gets 401. `phone`, `phoneHls` and `phoneDocs` keep passing with the new
  pairing answer.

## Out of scope

Writing from the phone, network shares browsed by UNC, a phone-side settings page, and
anything on the PC's own Explorer.
