// The system's window order, for the tab tear-off's hit test (step 4, review
// 2026-10-30): main knows only which Prism window it focused last, never what
// is really in front, nor that another app's window covers a Prism strip.
// Also the only tab's window going clear (SetAlpha). Called on main's JS
// thread, synchronously, a few times per 8 ms tick while a tab is carried;
// nothing here touches the sweep's thread, COM or JS state.
#pragma once

#include <windows.h>

#include <vector>

namespace prism_sweep {

// `wins` front to back as the system stacks them, as indexes into `wins`. A
// window not on screen (hidden, minimized, cloaked: another virtual desktop)
// is left out.
std::vector<int> ZOrder(const std::vector<HWND>& wins);

// A window of ANOTHER process, drawn above `win`, takes the pointer at the
// physical screen point `p`. False when `win` is not found.
bool CoveredAt(POINT p, HWND win);

// The only tab's window going clear while its tab is in another window's
// strip (it holds the pointer's capture, so it is never hidden): `alpha` 0 or
// 255. Answers whether THIS call made the window layered; the caller takes the
// style off again with Unlayer once it is back, since a layered window loses
// its Mica or acrylic material (Electron's setOpacity never takes it off).
bool SetAlpha(HWND win, BYTE alpha);
void Unlayer(HWND win);

}  // namespace prism_sweep
