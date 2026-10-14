# The phone browses like the Explorer (plan, 2026-10-14)

Spec: `docs/superpowers/specs/2026-10-14-phone-explorer-design.md`. One branch
(`feat/phone-explorer`), one PR, minor version bump. Tests first in each task.

1. **Wire contract.** `src/shared/phoneWire.ts`: drop `tabs`/`tab` routes and their types; add
   `places`, `PlacesAnswer`, `PhonePlace`, `PhoneDrive`; `Me = { name, here }`;
   `PairAnswer = { token, here }`. Update `phoneWire.test.ts`.
2. **Pairing store.** `src/main/phone/pairing.ts` + `store.ts`: `Phone.here`, code `start`,
   `issueCode(s, start | null, now)`, `parseStore` migrates `root` to `here`. Tests first.
3. **Phone access.** New `src/main/phone/phoneAccess.ts` (+ test): `listed(token, dir)`,
   `may(token, path)` (directly inside a listed folder), `localPath(p)` (absolute drive-letter
   path, never UNC or `\\?\` / `\\.\`), `release(token)`; all on `desktopAccess` with owner
   `phone:<token>` so `insideDesktop` (main's media wall) agrees.
4. **Server.** `src/main/phone/server.ts`: replace `inside()` and the media check with
   `may`; `/api/dir` lists any local folder, grants it, records `here` (saved throttled);
   `/api/places`; `/api/search?dir=`; `/api/me` answers `here`; `/pair` answers `here` and a
   re-scan moves `here`; HLS asks re-check `may`; `dropGrants` releases access. `PhoneDeps`
   loses `openRoots`/`rootOpen`/`isRoot`/`validRoot`, gains `places`, `search(dir, q)`.
   Delete `tabs.ts` (+ test). Rewrite the affected `server.test.ts` cases.
5. **Main wiring.** `src/main/phone/index.ts` and the deps built in `src/main/index.ts`:
   codes for any folder or none; `places()` from `browseLocations`, `driveUsage` and the pins;
   search through the Explorer's search (`browseSearch`) scoped to `dir`, granting hit
   folders; new `phone:pins` channel in `channels.ts`, preload, and a reporter beside
   `quickAccess.ts` in the renderer.
6. **PC dialog.** `src/renderer/src/components/PhoneDialog.tsx`: new switch line and the
   "every folder this Windows user can" line; a code from any tab (the Explorer passes its
   current folder; none passes null); the phones list shows `here`. `App.tsx` passes the
   folder. Update the dialog's tests.
7. **Phone page.** `PhoneApp.tsx` two states; `Browser.tsx` on `here`; `browse.ts` crumbs
   from This PC and `parentOf` to This PC; new `Places.tsx` (page and drawer, drive bars);
   `place.ts` URL without a root; `prismShim.ts`/`api.ts` follow the wire; delete
   `TabList.tsx` and `tabs.ts` (+ tests). The gone-folder screen offers Up and This PC.
8. **E2E.** Replace `phoneTabsScenario` with `phoneExplorerScenario` (as the spec's test list);
   adjust `pairPhone` to the new answer and to issue from the Explorer; keep `phone`,
   `phoneHls`, `phoneDocs` green.
9. **Docs.** `docs/features.md`: the new entry superseding "THE PHONE SEES THE OPEN TABS",
   and the "Prism on your phone" paragraph's root wording; `CLAUDE.md` scope line ("a LAN page
   that browses and plays what the PC has open" becomes "... browses the PC like the
   Explorer"); `docs/architecture.md` if it names the phone's root.
10. **Gates and ship.** typecheck, lint 0 errors, unit tests, phone scenarios, then the full
    e2e (coordinated with the PrismTerminal session), PR, merge, check ci and release, package
    with a real node_modules (count ~246 modules), install, and a check on a real phone is
    yours: pair, open the drawer, walk to a drive.
