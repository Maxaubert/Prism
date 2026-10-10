// The native sweep box (#338): one thread, one D3D11 + DirectComposition
// device, one TOPMOST DComp target per window. While a box is up the thread
// waits on the compositor clock, reads the real cursor late in the frame and
// commits the box only when it moved. README.md beside this file has the rules
// and the measurements; the ones this file keeps:
// - every COM object is created, used and released on the thread;
// - the thread never calls into JS (no thread-safe function): JS writes the
//   mutex-guarded command queue and sets the wake event, nothing else
//   (PrismTerminal #127's 0xc0000409 at quit);
// - the std::thread is heap-allocated and never destroyed while joinable;
// - DCompositionWaitForCompositorClock is resolved with GetProcAddress, so the
//   module still loads on Windows 10 (main then keeps the DOM box);
// - SetWindowDisplayAffinity is never called: the box stays capturable, so
//   Wind's render engine and screenshots see it.
#include "overlay.h"

#include <d3d11_1.h>
#include <dcomp.h>
#include <dxgi.h>

#include <algorithm>
#include <cstring>
#include <deque>
#include <mutex>
#include <thread>
#include <vector>

namespace prism_sweep {
namespace {

// ---- when the cursor is sampled ---------------------------------------------
// LATE IN THE FRAME, kLeadUsDefault before the next compositor tick. MEASURED
// 2026-10-09 at 1x with injected sweeps (research prism/2026-10-09-native-sweep-
// spike.md): sampling AT the tick puts the box 1.15 frames behind the pointer,
// no better than the DOM box (1.06); DWM latches a DComp commit shortly before
// its tick, so a sample taken just after a tick always waits a whole frame.
// Sampling late: lead 1200 us 0.29 frames, 0 of about 3500 frames missed; 900 us
// 0.25 frames, 0.3 % missed; 600 us 6.6 % missed. File Explorer is 0.65 to
// 0.86. The owner, zoomed in under Wind, judged 1500 us "not quite there" and
// 1000 us "seems like it works", so 1000 us is the default. At 1000 us the box
// measured 0.26 to 0.31 frames behind at every speed (2026-10-10).
constexpr int kLeadUsDefault = 1000;
// A machine whose timer wakes later than this one's can miss DWM's latch at
// 1000 us. The thread then WIDENS the lead (never narrows it below the
// default) in kLeadUsStep steps up to kLeadUsMax, and past that it falls back
// to sampling at the tick, which never misses (a frame late by design).
constexpr int kLeadUsStep = 250;
constexpr int kLeadUsMax = 2000;
// A commit that lands closer than this to the predicted tick counts as a miss.
// MEASURED 2026-10-10, lead 1000 us, three runs against Desktop Duplication:
// the commits land a median 655 us before the tick (the timer wakes about
// 345 us late); frames shown a frame late 17, 8 and 5 of about 3600, commits
// under 100 us before the tick 16, 12 and 4. Under 300 us flagged 66 to 76,
// several times the real misses, and widened the lead for nothing.
constexpr int kLatchUs = 100;
// Misses are counted over windows of up-frames (ten seconds of sweeping at 144
// Hz, across sweeps); more than kMissLimit in one window (over 1 %) widens the
// lead. MEASURED: a one-second window (144 frames, 2 misses) widened twice in
// one minute of injected sweeps while the PC was busy, 1000 to 1500 us, and
// the widening is never undone, so it must take a sustained rate, not a burst.
constexpr int kMissWindow = 1440;
constexpr int kMissLimit = 14;

// ---- the anchor waits for its rows --------------------------------------------
// An update is applied K[cause] compositor frames after it arrives, so the
// anchored edge stays on its row. MEASURED 2026-10-10 (both runs, the native
// edge over the DOM box's): auto-scroll (our own scrollTop write; Chromium
// shows the rows frames later) 2 and 3 frames, pooled 2 (3.2 px mean error
// against 4.2 at 3); the wheel (Chromium scrolls on its compositor thread, the
// page hears it after) 0 in all three runs. Resize is not measured; it is laid
// out a few frames late like auto-scroll, so 2 until it is.
constexpr int kDelayFrames[3] = {2, 0, 2};

// The clock's own timeout: bounded, so the stop flag is always seen.
constexpr DWORD kClockTimeoutMs = 100;
// After an occluded or failed clock wait (it returns at once while the display
// is off): a plain wait, so a box over a sleeping display never spins a core.
constexpr DWORD kOccludedWaitMs = 16;

template <class T>
void SafeRelease(T*& p) {
  if (p) {
    p->Release();
    p = nullptr;
  }
}

LONGLONG Qpc() {
  LARGE_INTEGER v;
  QueryPerformanceCounter(&v);
  return v.QuadPart;
}
LONGLONG QpcFreq() {
  LARGE_INTEGER v;
  QueryPerformanceFrequency(&v);
  return v.QuadPart;
}

using WaitClockFn = DWORD(WINAPI*)(UINT, const HANDLE*, DWORD);
using GetFrameIdFn = HRESULT(WINAPI*)(COMPOSITION_FRAME_ID_TYPE, COMPOSITION_FRAME_ID*);
using GetStatsFn = HRESULT(WINAPI*)(COMPOSITION_FRAME_ID, COMPOSITION_FRAME_STATS*, UINT, COMPOSITION_TARGET_ID*,
                                    UINT*);

HMODULE Dcomp() {
  HMODULE m = GetModuleHandleW(L"dcomp.dll");
  return m ? m : LoadLibraryExW(L"dcomp.dll", nullptr, LOAD_LIBRARY_SEARCH_SYSTEM32);
}
template <class F>
F Resolve(const char* name) {
  HMODULE m = Dcomp();
  return m ? reinterpret_cast<F>(reinterpret_cast<void*>(GetProcAddress(m, name))) : nullptr;
}

// ---- what JS and the thread share (all under g.m) -----------------------------
struct Cmd {
  enum Kind { kAttach, kDetach, kBegin, kUpdate, kEnd } kind = kEnd;
  HWND hwnd = nullptr;
  Box box;
  uint8_t fill[4] = {};
  uint8_t edge[4] = {};
  Cause cause = kCauseAuto;
};

struct TargetStatus {
  HWND hwnd;
  TargetState state;
};

struct Shared {
  std::mutex m;
  HANDLE wake = nullptr;  // auto-reset: commands and stop
  HANDLE done = nullptr;  // manual-reset: set as the thread returns
  std::thread* thread = nullptr;
  bool running = false;
  bool stop = false;
  std::vector<Cmd> cmds;
  std::vector<TargetStatus> states;
  Config config;  // -1 fields: the defaults
  int configGen = 0;
  Stats stats;
};
Shared g;

void SetState(HWND hwnd, TargetState s) {  // g.m held
  for (auto& t : g.states)
    if (t.hwnd == hwnd) {
      t.state = s;
      return;
    }
  g.states.push_back({hwnd, s});
}
void DropState(HWND hwnd) {  // g.m held
  g.states.erase(std::remove_if(g.states.begin(), g.states.end(), [&](const TargetStatus& t) { return t.hwnd == hwnd; }),
                 g.states.end());
}
TargetState StateOf(HWND hwnd) {  // g.m held
  for (const auto& t : g.states)
    if (t.hwnd == hwnd) return t.state;
  return kStateNone;
}

// ---- the thread's own objects (touched only on the thread) --------------------
struct Device {
  ID3D11Device* d3d = nullptr;
  ID3D11DeviceContext1* ctx = nullptr;
  IDXGIDevice* dxgi = nullptr;
  IDCompositionDesktopDevice* dcomp = nullptr;

  HRESULT Create() {
    if (dcomp) return S_OK;
    const UINT flags = D3D11_CREATE_DEVICE_BGRA_SUPPORT;
    ID3D11DeviceContext* ctx0 = nullptr;
    HRESULT hr = D3D11CreateDevice(nullptr, D3D_DRIVER_TYPE_HARDWARE, nullptr, flags, nullptr, 0, D3D11_SDK_VERSION,
                                   &d3d, nullptr, &ctx0);
    if (FAILED(hr))
      hr = D3D11CreateDevice(nullptr, D3D_DRIVER_TYPE_WARP, nullptr, flags, nullptr, 0, D3D11_SDK_VERSION, &d3d,
                             nullptr, &ctx0);
    if (SUCCEEDED(hr)) hr = ctx0->QueryInterface(__uuidof(ID3D11DeviceContext1), reinterpret_cast<void**>(&ctx));
    SafeRelease(ctx0);
    if (SUCCEEDED(hr)) hr = d3d->QueryInterface(__uuidof(IDXGIDevice), reinterpret_cast<void**>(&dxgi));
    if (SUCCEEDED(hr))
      hr = DCompositionCreateDevice2(dxgi, __uuidof(IDCompositionDesktopDevice), reinterpret_cast<void**>(&dcomp));
    if (FAILED(hr)) Release();
    return hr;
  }
  bool Lost() const { return d3d && FAILED(d3d->GetDeviceRemovedReason()); }
  void Release() {
    SafeRelease(dcomp);
    SafeRelease(dxgi);
    SafeRelease(ctx);
    SafeRelease(d3d);
  }
};

struct Target {
  HWND hwnd = nullptr;
  IDCompositionTarget* target = nullptr;
  IDCompositionVisual2* root = nullptr;
  IDCompositionVisual2* fillV = nullptr;
  IDCompositionVisual2* edgeV[4] = {};
  IDCompositionSurface* fillS = nullptr;
  IDCompositionSurface* edgeS = nullptr;
  uint8_t fillC[4] = {};
  uint8_t edgeC[4] = {};
  bool coloured = false;
  bool shown = false;
  Drawn last;
  int lastEdge = -1;

  void Release(Device& d) {
    if (target) target->SetRoot(nullptr);
    if (d.dcomp && target) d.dcomp->Commit();
    for (auto& v : edgeV) SafeRelease(v);
    SafeRelease(fillV);
    SafeRelease(root);
    SafeRelease(fillS);
    SafeRelease(edgeS);
    SafeRelease(target);
    shown = false;
    coloured = false;
  }
};

HRESULT FillSurface(Device& d, IDCompositionSurface* s, const uint8_t c[4]) {
  ID3D11Texture2D* tex = nullptr;
  POINT off{};
  HRESULT hr = s->BeginDraw(nullptr, __uuidof(ID3D11Texture2D), reinterpret_cast<void**>(&tex), &off);
  if (FAILED(hr)) return hr;
  D3D11_RENDER_TARGET_VIEW_DESC desc{};
  desc.Format = DXGI_FORMAT_B8G8R8A8_UNORM;
  desc.ViewDimension = D3D11_RTV_DIMENSION_TEXTURE2D;
  ID3D11RenderTargetView* rtv = nullptr;
  hr = d.d3d->CreateRenderTargetView(tex, &desc, &rtv);
  if (SUCCEEDED(hr)) {
    // Premultiplied: the CSS bytes are straight alpha. The texture may be an
    // ATLAS shared with other surfaces (documented), so only our 1x1 rect at
    // the returned offset is cleared, never the whole view.
    const float a = c[3] / 255.0f;
    const float colour[4] = {c[0] / 255.0f * a, c[1] / 255.0f * a, c[2] / 255.0f * a, a};
    const D3D11_RECT rect{off.x, off.y, off.x + 1, off.y + 1};
    d.ctx->ClearView(rtv, colour, &rect, 1);
    rtv->Release();
  }
  tex->Release();
  const HRESULT end = s->EndDraw();
  return FAILED(hr) ? hr : end;
}

HRESULT Build(Device& d, Target& t, HWND hwnd) {
  t.hwnd = hwnd;
  HRESULT hr = d.Create();
  // TOPMOST: drawn above the window's children, Chromium's GPU child included.
  if (SUCCEEDED(hr)) hr = d.dcomp->CreateTargetForHwnd(hwnd, TRUE, &t.target);
  if (SUCCEEDED(hr)) hr = d.dcomp->CreateVisual(&t.root);
  if (SUCCEEDED(hr))
    hr = d.dcomp->CreateSurface(1, 1, DXGI_FORMAT_B8G8R8A8_UNORM, DXGI_ALPHA_MODE_PREMULTIPLIED, &t.fillS);
  if (SUCCEEDED(hr))
    hr = d.dcomp->CreateSurface(1, 1, DXGI_FORMAT_B8G8R8A8_UNORM, DXGI_ALPHA_MODE_PREMULTIPLIED, &t.edgeS);
  IDCompositionVisual2** all[5] = {&t.fillV, &t.edgeV[0], &t.edgeV[1], &t.edgeV[2], &t.edgeV[3]};
  for (int i = 0; i < 5 && SUCCEEDED(hr); i++) {
    hr = d.dcomp->CreateVisual(all[i]);
    IDCompositionVisual2* v = *all[i];
    // Whole pixels, hard edges: a 1x1 surface scaled up must not blur.
    if (SUCCEEDED(hr)) hr = v->SetBitmapInterpolationMode(DCOMPOSITION_BITMAP_INTERPOLATION_MODE_NEAREST_NEIGHBOR);
    if (SUCCEEDED(hr)) hr = v->SetBorderMode(DCOMPOSITION_BORDER_MODE_HARD);
    if (SUCCEEDED(hr)) hr = v->SetContent(i == 0 ? t.fillS : t.edgeS);
    // Each added above the last: the fill first, the edges over it.
    if (SUCCEEDED(hr)) hr = t.root->AddVisual(v, TRUE, nullptr);
  }
  if (SUCCEEDED(hr)) hr = d.dcomp->Commit();
  return hr;
}

void Place(IDCompositionVisual2* v, int x, int y, int w, int h) {
  if (w <= 0 || h <= 0) w = h = 0;
  D2D_MATRIX_3X2_F m{};
  m._11 = static_cast<float>(w);
  m._22 = static_cast<float>(h);
  m._31 = static_cast<float>(x);
  m._32 = static_cast<float>(y);
  v->SetTransform(m);
}

// S_FALSE when nothing changed (no commit, no GPU work).
HRESULT Draw(Device& d, Target& t, const Drawn& r, int e, bool show) {
  const bool visible = show && !r.empty();
  if (visible == t.shown && (!visible || (r == t.last && e == t.lastEdge))) return S_FALSE;
  HRESULT hr = S_OK;
  if (visible) {
    const int w = r.r - r.l, h = r.b - r.t;
    const int ew = std::min(e, w), eh = std::min(e, h);
    const int topH = (r.edges & kTop) ? eh : 0;
    const int botH = (r.edges & kBottom) ? std::min(eh, h - topH) : 0;
    const int leftW = (r.edges & kLeft) ? ew : 0;
    const int rightW = (r.edges & kRight) ? std::min(ew, w - leftW) : 0;
    const int midH = h - topH - botH;
    Place(t.fillV, r.l, r.t, w, h);
    Place(t.edgeV[0], r.l, r.t, w, topH);
    Place(t.edgeV[1], r.l, r.b - botH, w, botH);
    Place(t.edgeV[2], r.l, r.t + topH, leftW, midH);
    Place(t.edgeV[3], r.r - rightW, r.t + topH, rightW, midH);
    if (!t.shown) hr = t.target->SetRoot(t.root);
  } else {
    hr = t.target->SetRoot(nullptr);
  }
  if (SUCCEEDED(hr)) hr = d.dcomp->Commit();
  if (FAILED(hr)) return hr;
  t.shown = visible;
  t.last = visible ? r : Drawn{};
  t.lastEdge = e;
  return S_OK;
}

// GetAsyncKeyState reads PHYSICAL buttons (documented), so the primary one is
// the right button when the user swapped them.
int PrimaryVk() { return GetSystemMetrics(SM_SWAPBUTTON) ? VK_RBUTTON : VK_LBUTTON; }

struct PendingUpdate {
  Box box;
  int64_t due = 0;  // the loop's frame number it applies at
};

void ThreadMain() {
  Device dev;
  std::vector<Target> targets;
  const WaitClockFn waitClock = Resolve<WaitClockFn>("DCompositionWaitForCompositorClock");
  const GetFrameIdFn getFrameId = Resolve<GetFrameIdFn>("DCompositionGetFrameId");
  const GetStatsFn getStats = Resolve<GetStatsFn>("DCompositionGetStatistics");
  HANDLE timer = CreateWaitableTimerExW(nullptr, nullptr, CREATE_WAITABLE_TIMER_HIGH_RESOLUTION, TIMER_ALL_ACCESS);
  const LONGLONG freq = QpcFreq();
  const LONGLONG us = freq / 1000000 > 0 ? freq / 1000000 : 1;
  {
    std::lock_guard<std::mutex> lock(g.m);
    const DPI_AWARENESS_CONTEXT ctx = GetThreadDpiAwarenessContext();
    g.stats.awareness = static_cast<int>(GetAwarenessFromDpiAwarenessContext(ctx));
    g.stats.pmv2 = AreDpiAwarenessContextsEqual(ctx, DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2) != FALSE;
  }
  auto find = [&](HWND h) -> Target* {
    for (auto& t : targets)
      if (t.hwnd == h) return &t;
    return nullptr;
  };

  bool up = false;          // a box is being drawn
  HWND active = nullptr;    // the window it is drawn on
  Box box;
  int64_t frameNo = 0;
  std::deque<PendingUpdate> due;
  LONGLONG lastTick = 0, period = freq / 144;
  int seenGen = -1, lead = kLeadUsDefault, startLead = kLeadUsDefault;
  bool lateMode = true, adaptive = true, ignoreButton = false, fellBack = false;
  int windowFrames = 0, windowMisses = 0;

  // A failed HRESULT: that target is failed for the session (main turns the
  // native box off and the page shows the DOM box). A lost device takes every
  // target with it.
  auto fail = [&](Target* t, HRESULT hr) {
    const bool lost = dev.Lost();
    std::lock_guard<std::mutex> lock(g.m);
    g.stats.failures++;
    g.stats.lastHr = static_cast<uint32_t>(hr);
    for (auto& x : targets)
      if (lost || &x == t) {
        x.Release(dev);
        SetState(x.hwnd, kStateFailed);
        if (x.hwnd == active) up = false;
      }
    targets.erase(std::remove_if(targets.begin(), targets.end(), [](const Target& x) { return !x.target; }),
                  targets.end());
    if (lost) dev.Release();
  };

  for (;;) {
    // ---- wait ------------------------------------------------------------------
    bool tick = false;
    if (!up) {
      WaitForSingleObject(g.wake, INFINITE);
      std::lock_guard<std::mutex> lock(g.m);
      g.stats.idleWakes++;
    } else if (waitClock) {
      const DWORD r = waitClock(1, &g.wake, kClockTimeoutMs);
      bool occluded = false;
      {
        std::lock_guard<std::mutex> lock(g.m);
        if (r == WAIT_OBJECT_0 + 1) {
          tick = true;
          g.stats.ticks++;
        } else if (r == WAIT_TIMEOUT) {
          g.stats.timeouts++;
        } else if (r != WAIT_OBJECT_0) {
          g.stats.occluded++;
          occluded = true;
        }
      }
      if (occluded) WaitForSingleObject(g.wake, kOccludedWaitMs);
    } else {
      // No compositor clock (Windows 10): main never begins a box there; this
      // only keeps the loop paced if one is begun anyway.
      tick = WaitForSingleObject(g.wake, 16) == WAIT_TIMEOUT;
    }
    const LONGLONG woke = Qpc();
    if (tick) {
      if (lastTick && woke - lastTick < freq / 20) period = (period * 7 + (woke - lastTick)) / 8;
      lastTick = woke;
      frameNo++;
    }

    // ---- commands ----------------------------------------------------------------
    std::vector<Cmd> cmds;
    bool stop = false;
    {
      std::lock_guard<std::mutex> lock(g.m);
      stop = g.stop;
      cmds.swap(g.cmds);
      if (g.configGen != seenGen) {
        // A new configuration (the measuring tools only) starts the
        // adaptation over from its lead.
        seenGen = g.configGen;
        lateMode = g.config.late != 0;
        startLead = g.config.leadUs >= 0 ? g.config.leadUs : kLeadUsDefault;
        adaptive = g.config.adaptive != 0;
        ignoreButton = g.config.ignoreButton == 1;
        lead = startLead;
        fellBack = false;
        windowFrames = windowMisses = 0;
      }
    }
    if (stop) break;
    for (auto& c : cmds) {
      Target* t = find(c.hwnd);
      switch (c.kind) {
        case Cmd::kAttach: {
          if (t) break;  // already made
          targets.emplace_back();
          Target& n = targets.back();
          const HRESULT hr = Build(dev, n, c.hwnd);
          std::lock_guard<std::mutex> lock(g.m);
          g.stats.lastHr = static_cast<uint32_t>(hr);
          if (SUCCEEDED(hr)) {
            SetState(c.hwnd, kStateReady);
          } else {
            g.stats.failures++;
            n.Release(dev);
            targets.pop_back();
            SetState(c.hwnd, kStateFailed);
          }
          break;
        }
        case Cmd::kDetach: {
          // The state was dropped by Detach() itself, so an Attach queued
          // after this (a new window given the same handle) is not lost.
          if (t) {
            t->Release(dev);
            targets.erase(targets.begin() + (t - targets.data()));
          }
          if (c.hwnd == active) {
            up = false;
            active = nullptr;
          }
          break;
        }
        case Cmd::kBegin: {
          if (!t) break;
          // Another window's box goes the moment this one begins.
          if (active && active != c.hwnd) {
            Target* old = find(active);
            if (old) {
              const HRESULT hr = Draw(dev, *old, Drawn{}, 0, false);
              if (FAILED(hr)) fail(old, hr);
            }
          }
          t = find(c.hwnd);
          if (!t) break;
          // A device lost since the last sweep (a GPU reset): the surfaces
          // are filled only when a colour changes and the per-frame path only
          // moves visuals, so nothing else would notice, and every later sweep
          // would draw nothing while the page hides its own box.
          if (dev.Lost()) {
            fail(t, DXGI_ERROR_DEVICE_REMOVED);
            break;
          }
          HRESULT hr = S_OK;
          if (!t->coloured || std::memcmp(t->fillC, c.fill, 4) != 0)
            hr = FillSurface(dev, t->fillS, c.fill);
          if (SUCCEEDED(hr) && (!t->coloured || std::memcmp(t->edgeC, c.edge, 4) != 0))
            hr = FillSurface(dev, t->edgeS, c.edge);
          if (FAILED(hr)) {
            fail(t, hr);
            break;
          }
          std::memcpy(t->fillC, c.fill, 4);
          std::memcpy(t->edgeC, c.edge, 4);
          t->coloured = true;
          active = c.hwnd;
          box = c.box;
          due.clear();
          up = true;
          break;
        }
        case Cmd::kUpdate:
          if (up && c.hwnd == active) due.push_back({c.box, frameNo + kDelayFrames[c.cause]});
          break;
        case Cmd::kEnd:
          if (c.hwnd == active) up = false;
          break;
      }
    }
    while (!due.empty() && due.front().due <= frameNo) {
      // The anchor and the clip only; the edge width comes with a begin.
      const int e = box.edge;
      box = due.front().box;
      box.edge = e;
      due.pop_front();
    }
    Target* t = active ? find(active) : nullptr;
    if (!t) {
      up = false;
      active = nullptr;
    }
    const bool late = lateMode && !fellBack;

    // ---- late in the frame (the default) -------------------------------------------
    LONGLONG waited = 0;    // asleep below: not work, so not in maxWorkUs
    LONGLONG nextTick = 0;  // the tick the late sample aims for
    if (up && tick && late && timer) {
      COMPOSITION_FRAME_STATS st{};
      COMPOSITION_FRAME_ID id = 0;
      const bool sane = getFrameId && getStats && SUCCEEDED(getFrameId(COMPOSITION_FRAME_ID_CREATED, &id)) &&
                        SUCCEEDED(getStats(id, &st, 0, nullptr, nullptr)) && st.framePeriod > 0 &&
                        st.framePeriod < static_cast<UINT64>(freq / 20) &&
                        static_cast<LONGLONG>(st.startTime) > woke - freq &&
                        static_cast<LONGLONG>(st.startTime) < woke + freq;
      const LONGLONG step = sane ? static_cast<LONGLONG>(st.framePeriod) : period;
      LONGLONG target = (sane ? static_cast<LONGLONG>(st.startTime) + step : woke + period) - lead * us;
      // MEASURED 2026-10-09: the CREATED frame's startTime is a period behind
      // the tick, so the target above can already be past; roll it forward to
      // the first one still ahead of this tick.
      while (target <= woke) target += step;
      nextTick = target + lead * us;
      const LONGLONG wait = target - Qpc();
      if (wait > 0) {
        LARGE_INTEGER due100ns;
        due100ns.QuadPart = -(wait * 10000000 / freq);
        if (SetWaitableTimer(timer, &due100ns, 0, nullptr, nullptr, FALSE)) {
          HANDLE hs[2] = {timer, g.wake};
          const LONGLONG slept = Qpc();
          // A command that lands during this wait consumed the auto-reset wake
          // event; set it again, so the next pass sees it at once instead of
          // at the next tick (an end would lose a frame).
          if (WaitForMultipleObjects(2, hs, FALSE, 50) == WAIT_OBJECT_0 + 1) SetEvent(g.wake);
          waited = Qpc() - slept;
        }
      }
    }

    // ---- sample and draw -------------------------------------------------------------
    HRESULT hr = S_FALSE;
    LONGLONG committed = Qpc();
    if (t) {
      if (up && !ignoreButton && !(GetAsyncKeyState(PrimaryVk()) & 0x8000)) up = false;
      Drawn r;
      if (up) {
        POINT p{};
        GetCursorPos(&p);
        ScreenToClient(t->hwnd, &p);
        r = BoxAt(box, p.x, p.y);
      }
      // Lost mid-sweep: the commit may still succeed and show nothing, so it
      // is asked (GetDeviceRemovedReason, a few hundred ns) only while up.
      hr = up && dev.Lost() ? DXGI_ERROR_DEVICE_REMOVED : Draw(dev, *t, r, box.edge, up);
      committed = Qpc();
      if (FAILED(hr)) {
        fail(t, hr);
        up = false;
        active = nullptr;
      }
    }

    std::lock_guard<std::mutex> lock(g.m);
    g.stats.frames++;
    if (up && tick) g.stats.upFrames++;
    if (hr == S_OK) g.stats.commits++;
    if (nextTick && SUCCEEDED(hr)) {
      // Did the commit make this frame? Too close to the tick and DWM may
      // already have latched, so the box shows a frame late.
      windowFrames++;
      if (hr == S_OK && nextTick - committed < kLatchUs * us) {
        windowMisses++;
        g.stats.lateCommits++;
      }
      if (windowFrames >= kMissWindow) {
        if (adaptive && windowMisses > kMissLimit) {
          g.stats.widenings++;
          if (lead + kLeadUsStep <= std::max(kLeadUsMax, startLead))
            lead = std::max(lead, kLeadUsDefault) + kLeadUsStep;
          else
            fellBack = true;  // at the tick from now on: never a miss, a frame behind
        }
        windowFrames = windowMisses = 0;
      }
    }
    g.stats.late = lateMode && !fellBack;
    g.stats.leadUs = lead;
    const int64_t workUs = (committed - woke - waited) / us;
    if (tick && workUs > g.stats.maxWorkUs) g.stats.maxWorkUs = workUs;
    FILETIME c0, e0, k0, u0;
    if (GetThreadTimes(GetCurrentThread(), &c0, &e0, &k0, &u0)) {
      const ULONGLONG kt = (static_cast<ULONGLONG>(k0.dwHighDateTime) << 32) | k0.dwLowDateTime;
      const ULONGLONG ut = (static_cast<ULONGLONG>(u0.dwHighDateTime) << 32) | u0.dwLowDateTime;
      g.stats.cpuUs = static_cast<int64_t>((kt + ut) / 10);
    }
  }
  for (auto& x : targets) x.Release(dev);
  targets.clear();
  dev.Release();
  if (timer) CloseHandle(timer);
}

bool StartThread() {  // g.m held
  if (g.running) return true;
  if (!g.wake) g.wake = CreateEventW(nullptr, FALSE, FALSE, nullptr);
  if (!g.done) g.done = CreateEventW(nullptr, TRUE, FALSE, nullptr);
  if (!g.wake || !g.done) return false;
  g.stop = false;
  g.cmds.clear();
  ResetEvent(g.done);
  try {
    g.thread = new std::thread([] {
      ThreadMain();
      SetEvent(g.done);
    });
  } catch (...) {
    g.thread = nullptr;
    return false;
  }
  g.running = true;
  return true;
}

void Push(const Cmd& c) {
  {
    std::lock_guard<std::mutex> lock(g.m);
    if (!g.running) return;
    g.cmds.push_back(c);
  }
  SetEvent(g.wake);
}

}  // namespace

bool ClockAvailable() { return Resolve<WaitClockFn>("DCompositionWaitForCompositorClock") != nullptr; }

bool Attach(HWND hwnd) {
  {
    std::lock_guard<std::mutex> lock(g.m);
    if (!StartThread()) return false;
    const TargetState s = StateOf(hwnd);
    if (s == kStateReady || s == kStatePending) return true;
    SetState(hwnd, kStatePending);
    Cmd c;
    c.kind = Cmd::kAttach;
    c.hwnd = hwnd;
    g.cmds.push_back(c);
  }
  SetEvent(g.wake);
  return true;
}

TargetState Status(HWND hwnd) {
  std::lock_guard<std::mutex> lock(g.m);
  return StateOf(hwnd);
}

bool Begin(HWND hwnd, const Box& box, const uint8_t fill[4], const uint8_t edge[4]) {
  {
    std::lock_guard<std::mutex> lock(g.m);
    if (!g.running || StateOf(hwnd) != kStateReady) return false;
    Cmd c;
    c.kind = Cmd::kBegin;
    c.hwnd = hwnd;
    c.box = box;
    std::memcpy(c.fill, fill, 4);
    std::memcpy(c.edge, edge, 4);
    g.cmds.push_back(c);
  }
  SetEvent(g.wake);
  return true;
}

void Update(HWND hwnd, const Box& box, Cause cause) {
  Cmd c;
  c.kind = Cmd::kUpdate;
  c.hwnd = hwnd;
  c.box = box;
  c.cause = cause;
  Push(c);
}

void End(HWND hwnd) {
  Cmd c;
  c.kind = Cmd::kEnd;
  c.hwnd = hwnd;
  Push(c);
}

void Detach(HWND hwnd) {
  {
    std::lock_guard<std::mutex> lock(g.m);
    if (!g.running) return;
    // Dropped here, not on the thread: Windows reuses a closed window's handle,
    // and an Attach for the new window that ran before the thread's detach
    // would have found the old window's "ready" and queued nothing.
    DropState(hwnd);
    Cmd c;
    c.kind = Cmd::kDetach;
    c.hwnd = hwnd;
    g.cmds.push_back(c);
  }
  SetEvent(g.wake);
}

// Idempotent. False when the join timed out: the thread is then LEAKED, never
// destroyed while joinable (a joinable std::thread at CRT teardown calls
// std::terminate, the 0xc0000409 abort of #127), and ExitProcess ends it.
bool Shutdown(DWORD timeoutMs) {
  std::thread* t = nullptr;
  {
    std::lock_guard<std::mutex> lock(g.m);
    if (!g.running) return true;
    g.stop = true;
    t = g.thread;
  }
  SetEvent(g.wake);
  if (WaitForSingleObject(g.done, timeoutMs) != WAIT_OBJECT_0) return false;
  t->join();
  delete t;
  std::lock_guard<std::mutex> lock(g.m);
  g.thread = nullptr;
  g.running = false;
  g.states.clear();
  return true;
}

Stats GetStats() {
  std::lock_guard<std::mutex> lock(g.m);
  Stats s = g.stats;
  s.running = g.running;
  if (!g.running && s.leadUs == 0) s.leadUs = kLeadUsDefault;
  return s;
}

void Configure(const Config& c) {
  std::lock_guard<std::mutex> lock(g.m);
  if (c.late >= 0) g.config.late = c.late;
  if (c.leadUs >= 0) g.config.leadUs = std::clamp(c.leadUs, 0, 20000);
  if (c.adaptive >= 0) g.config.adaptive = c.adaptive;
  if (c.ignoreButton >= 0) g.config.ignoreButton = c.ignoreButton;
  g.configGen++;
}

}  // namespace prism_sweep
