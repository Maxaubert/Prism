#include "zorder.h"

namespace prism_sweep {
namespace {

// DwmGetWindowAttribute, resolved at run time like the compositor clock: the
// build's import allow-list has no dwmapi.dll.
using DwmGetFn = HRESULT(WINAPI*)(HWND, DWORD, PVOID, DWORD);
constexpr DWORD kExtendedFrameBounds = 9;  // DWMWA_EXTENDED_FRAME_BOUNDS
constexpr DWORD kCloaked = 14;             // DWMWA_CLOAKED

DwmGetFn Dwm() {
  static const DwmGetFn fn = [] {
    const HMODULE m = LoadLibraryExW(L"dwmapi.dll", nullptr, LOAD_LIBRARY_SEARCH_SYSTEM32);
    return m ? reinterpret_cast<DwmGetFn>(reinterpret_cast<void*>(GetProcAddress(m, "DwmGetWindowAttribute")))
             : nullptr;
  }();
  return fn;
}

// Far more windows than any desktop holds: a z-order changing under the walk
// can never make it endless.
constexpr int kMaxWalk = 20000;

bool OnScreen(HWND h) {
  if (!IsWindowVisible(h) || IsIconic(h)) return false;
  const DwmGetFn dwm = Dwm();
  DWORD cloaked = 0;
  if (dwm && SUCCEEDED(dwm(h, kCloaked, &cloaked, sizeof cloaked)) && cloaked) return false;
  return true;
}

// Drawn where it is and taking the pointer there: not click-through, not a
// fully clear layered window (an overlay).
bool TakesPointer(HWND h) {
  const LONG_PTR ex = GetWindowLongPtrW(h, GWL_EXSTYLE);
  if (ex & WS_EX_TRANSPARENT) return false;
  if (ex & WS_EX_LAYERED) {
    BYTE alpha = 255;
    DWORD flags = 0;
    if (GetLayeredWindowAttributes(h, nullptr, &alpha, &flags) && (flags & LWA_ALPHA) && alpha == 0) return false;
  }
  return true;
}

// The window as drawn: without the invisible resize borders Windows 10 and 11
// put around a framed window.
bool DrawnRect(HWND h, RECT* r) {
  const DwmGetFn dwm = Dwm();
  if (dwm && SUCCEEDED(dwm(h, kExtendedFrameBounds, r, sizeof *r))) return true;
  return GetWindowRect(h, r) != 0;
}

}  // namespace

std::vector<int> ZOrder(const std::vector<HWND>& wins) {
  std::vector<int> out;
  if (wins.empty()) return out;
  int n = 0;
  for (HWND h = GetTopWindow(nullptr); h && out.size() < wins.size() && n < kMaxWalk;
       h = GetWindow(h, GW_HWNDNEXT), n++) {
    for (size_t i = 0; i < wins.size(); i++) {
      if (wins[i] != h) continue;
      if (OnScreen(h)) out.push_back(static_cast<int>(i));
      break;
    }
  }
  return out;
}

bool CoveredAt(POINT p, HWND win) {
  if (!win) return false;
  const DWORD self = GetCurrentProcessId();
  bool covered = false;
  int n = 0;
  for (HWND h = GetTopWindow(nullptr); h && n < kMaxWalk; h = GetWindow(h, GW_HWNDNEXT), n++) {
    if (h == win) return covered;
    if (covered) continue;  // only whether `win` is below it is left to find
    RECT r;
    // The outer rect first (cheap, and holds the drawn one), then the rest.
    if (!GetWindowRect(h, &r) || !PtInRect(&r, p)) continue;
    DWORD pid = 0;
    GetWindowThreadProcessId(h, &pid);
    // Prism's own windows are the caller's to order; the one moving with the
    // cursor is one of them.
    if (pid == self) continue;
    if (!OnScreen(h) || !TakesPointer(h) || !DrawnRect(h, &r) || !PtInRect(&r, p)) continue;
    covered = true;
  }
  return false;
}

bool SetAlpha(HWND win, BYTE alpha) {
  if (!win || !IsWindow(win)) return false;
  const LONG_PTR ex = GetWindowLongPtrW(win, GWL_EXSTYLE);
  const bool added = !(ex & WS_EX_LAYERED);
  if (added) SetWindowLongPtrW(win, GWL_EXSTYLE, ex | WS_EX_LAYERED);
  SetLayeredWindowAttributes(win, 0, alpha, LWA_ALPHA);
  return added;
}

void Unlayer(HWND win) {
  if (!win || !IsWindow(win)) return;
  const LONG_PTR ex = GetWindowLongPtrW(win, GWL_EXSTYLE);
  if (!(ex & WS_EX_LAYERED)) return;
  SetWindowLongPtrW(win, GWL_EXSTYLE, ex & ~static_cast<LONG_PTR>(WS_EX_LAYERED));
  // The style change is applied, and the window drawn again, without moving,
  // sizing, reordering or activating it.
  SetWindowPos(win, nullptr, 0, 0, 0, 0,
               SWP_FRAMECHANGED | SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_NOOWNERZORDER);
  RedrawWindow(win, nullptr, nullptr, RDW_ERASE | RDW_INVALIDATE | RDW_FRAME | RDW_ALLCHILDREN);
}

}  // namespace prism_sweep
