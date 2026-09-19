# Prism implementation checks

Read CLAUDE.md for the existing behavior and safety boundaries. Current explicit task instructions supersede historical product constraints there.

- All changes use an issue, feature branch and PR. Never merge without approval for that PR.
- Run `npm ci`, `npm test`, `npm run typecheck`, `npm run lint` and `npm run build`.
- UI, renderer or window behavior changes require local Playwright E2E. `npm run e2e -- <scenario>` is the inner loop; run the full suite before pushing.
- Fullscreen/window-compositor changes also require `npx playwright test -c tools/e2e/fullscreen.config.ts`. It exercises the real native transition cover offscreen; the regular E2E path bypasses that cover.
- Tests use isolated profiles and offscreen windows. Never close or replace the user's installed Prism or active terminals to test a branch.
- `npm run package` builds the unsigned per-user NSIS installer. Version lives in package.json; a feature increments the minor version.
- Stage a runnable branch build with its own user-data profile before recommending merge. Report its exact path and verification limits.
- CI checks typecheck, lint and units. Releases run after an approved merge, never manually from a feature branch.
- Browsing grants are desktop-only. Phone roots must remain unchanged when the desktop visits an ancestor or another drive.
