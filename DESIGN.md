---
name: Prism
description: Quiet Windows file browsing, viewing and terminal chrome.
colors:
  canvas: "var(--p-bg)"
  text: "var(--p-text)"
  text-soft: "var(--p-text-soft)"
  dim: "var(--p-dim)"
  selection: "var(--p-sel-bg)"
  on-selection: "var(--p-on-accent)"
  hover: "var(--p-hover)"
  divider: "var(--p-divider)"
  focus: "var(--p-accent-hi)"
typography:
  body:
    fontFamily: "Segoe UI, sans-serif"
    fontSize: "15px"
  label:
    fontFamily: "Segoe UI, sans-serif"
    fontSize: "13px"
  status:
    fontFamily: "Segoe UI, sans-serif"
    fontSize: "12px"
rounded:
  control: "3px"
  place: "4px"
components:
  folder-row:
    height: "40px"
    textColor: "{colors.text}"
  navigation-button:
    height: "36px"
    width: "36px"
    rounded: "{rounded.control}"
---

# Design System: Prism

## Overview

Prism uses a continuous dark workspace with restrained controls and familiar Windows file navigation.
The accepted September 14 folder mockup extends the existing viewer chrome: compact title bar,
content-sized top-level tabs, a roomy details list and an optional right preview.
Terminal, folder and media views share that same tab strip.

Explorer tabs use folder icons and one pinned first tab labeled Explorer. Project tabs retain the
working folder name. The panel toggle controls places in Explorer and the tree in project tabs.
Recursive search results add a readable containing-folder line and a visible scope/progress row.
Open as project is available in the Explorer action row and folder/file context menu.
The path bar highlights as one continuous control and remains above a full-file viewer, with
clickable ancestor folders and a current-file label. Quick access uses persistent, reorderable
file and folder pins, with context-menu actions for unpinning and keyboard-accessible reordering.

This document records the implemented folder surface. Existing viewer and terminal styles remain
authoritative for their own controls; see `PRODUCT.md` for product constraints.

## Colors

The frontmatter references live CSS variables, not a second fixed palette. `lib/theme.ts` applies
the selected Prism style; `index.css` contains fallbacks. New folder controls use the same variables.
Selection uses the existing selection fill and its contrasting foreground. Hover and context-menu
targets remain quieter. Dividers separate regions without enclosing every control in a card.

## Typography

Use Segoe UI for the browser. File names use the body role; column headings, location group labels
and supporting terminal actions use the label role. The status row is 12px. The current breadcrumb
uses semibold text. Truncate long names visually while retaining full labels in titles or accessible
names. Do not make the main listing smaller to fit extra columns.

## Layout

The folder surface fills the available workspace below the existing tab strip. Its rows are a 48px
path/history/search toolbar, a 44px action bar, flexible content and a 26px status bar.
Quick access, open projects and drives occupy a 210px left rail. The rail becomes 160px below 760px.
The file list gets the remaining width. Its optional preview uses `clamp(260px, 32%, 440px)` on
desktop and 44% at the narrow workspace breakpoint.

The list scrolls within the window and renders a bounded set of visible rows. Metadata columns
disappear as the list container narrows: modified date below 720px, type below 510px, size below
300px. The name remains. Breadcrumbs scroll horizontally and reveal the current location.
Check actual high-zoom layouts after changing toolbar width, row height or preview geometry.

## Elevation & Depth

The folder surface is flat. Background continuity, subtle dividers, hover fill and selection establish
its regions. Reuse the existing application menus and dialogs for transient actions.

## Shapes

Details rows run edge to edge. Small control corners and slightly rounded location buttons follow
the frontmatter sizes. Keep the existing simple line icons and file-kind icons. Avoid decorative
tiles, oversized pills and a second navigation strip.

## Components

- **Tabs:** retain the existing shallow, content-sized strip, close buttons, plus button and truthful
  minimal/full agent activity treatments. A folder or expanded viewer must not displace the strip.
- **Navigation:** Back, Forward, Up and Refresh precede ancestor breadcrumbs. Editing the path
  replaces the breadcrumbs with a text field. Search sits at the other end of the same row.
- **Details list:** Name, Type, Size and Date modified align under sortable headers. Rows have
  selection, hover and keyboard-focus states; single-click selects and activation opens.
- **Preview:** reuse the live viewer in a bounded right pane with an explicit open action.
- **Terminal actions:** label return, terminal-folder reveal and deliberate cwd change plainly;
  show disabled eligibility states for cwd changes rather than silently acting on a busy shell.
- **Focus:** folder buttons and inputs use a visible 2px accent outline. Disabled controls reduce
  opacity and retain their spatial position. Preserve keyboard access when layout becomes narrow.

## Do's and Don'ts

- **Do** keep text readable, targets usable and selection distinct from hover.
- **Do** use existing style variables, viewers, icons and tab components.
- **Do** keep loading, empty, unreadable and failed-navigation states distinguishable.
- **Don't** add dashboard cards, fake file content, simulated terminal activity or decorative chrome.
- **Don't** introduce another Files/Viewer/Terminal tab strip or a new theme system.

Implementation references: `src/renderer/src/components/browse/browse.css`, `workspace.css`,
`BrowseToolbar.tsx`, `BrowseList.tsx` and `src/renderer/src/App.tsx`.
