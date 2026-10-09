// SPIKE (#338, task 1): the sweep box drawn by DirectComposition on Prism's own
// window, from the real cursor, every compositor frame. Spike quality: one
// window, begin/update/end, a per-frame log for the measuring tool. Task 4
// splits this into box.h / overlay.cc / sweep.cc at product quality.
//
// The rules the spike already keeps, because they are what it is testing:
// - every COM object is created, used and released on the native thread;
// - the thread never calls into JS (no thread-safe function): JS only writes the
//   mutex-guarded state and sets the wake event (PrismTerminal #127's abort);
// - the thread object is heap-allocated and never destroyed while joinable;
// - DCompositionWaitForCompositorClock is resolved with GetProcAddress, so the
//   module still loads on Windows 10;
// - SetWindowDisplayAffinity is never called (the box must stay capturable).
#include <windows.h>
#include <d3d11_1.h>
#include <dxgi.h>
#include <dcomp.h>
#include <node_api.h>

#include <algorithm>
#include <atomic>
#include <cstdint>
#include <cstring>
#include <deque>
#include <mutex>
#include <thread>
#include <vector>

namespace {

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

struct Box {
  int ax = 0, ay = 0, left = 0, top = 0, right = 0, bottom = 0, edge = 1;
};
struct Rect {
  int l = 0, t = 0, r = 0, b = 0;
  bool operator==(const Rect& o) const { return l == o.l && t == o.t && r == o.r && b == o.b; }
};

// Explorer's _SetVisualLoc in integer pixels: the far corner clamped to the clip
// plus one pixel, the box from anchor to cursor with +1 right and bottom, then
// intersected with the clip. Empty when fully clipped.
Rect BoxRect(const Box& k, int cx, int cy) {
  cx = std::clamp(cx, k.left - 1, k.right);
  cy = std::clamp(cy, k.top - 1, k.bottom);
  Rect r;
  r.l = std::max(std::min(k.ax, cx), k.left);
  r.r = std::min(std::max(k.ax, cx) + 1, k.right);
  r.t = std::max(std::min(k.ay, cy), k.top);
  r.b = std::min(std::max(k.ay, cy) + 1, k.bottom);
  if (r.r <= r.l || r.b <= r.t) return Rect{};
  return r;
}

enum Cause { kAuto = 0, kScroll = 1, kResize = 2 };
enum State { kNone = 0, kPending = 1, kReady = 2, kFailed = 3 };

struct PendingUpdate {
  Box box;
  int cause = 0;
  int64_t due = 0;  // compositor frame number it applies at
  bool queued = false;
};

constexpr int kLogCols = 12;
constexpr size_t kLogRows = 1 << 17;

using WaitClockFn = DWORD(WINAPI*)(UINT, const HANDLE*, DWORD);
using GetFrameIdFn = HRESULT(WINAPI*)(COMPOSITION_FRAME_ID_TYPE, COMPOSITION_FRAME_ID*);
using GetStatsFn = HRESULT(WINAPI*)(COMPOSITION_FRAME_ID, COMPOSITION_FRAME_STATS*, UINT, COMPOSITION_TARGET_ID*, UINT*);

WaitClockFn ResolveClock() {
  HMODULE m = GetModuleHandleW(L"dcomp.dll");
  if (!m) m = LoadLibraryExW(L"dcomp.dll", nullptr, LOAD_LIBRARY_SEARCH_SYSTEM32);
  return m ? reinterpret_cast<WaitClockFn>(GetProcAddress(m, "DCompositionWaitForCompositorClock")) : nullptr;
}

// ---- state shared between JS and the thread (all under g.m) ----------------
struct Shared {
  std::mutex m;
  HANDLE wake = nullptr;  // auto-reset
  HANDLE done = nullptr;  // manual-reset, set as the thread returns
  std::thread* thread = nullptr;
  bool running = false;
  bool stop = false;
  // commands
  HWND attachHwnd = nullptr;
  bool attachReq = false;
  bool detachReq = false;
  bool beginReq = false;
  Box beginBox;
  uint8_t fill[4] = {255, 0, 255, 40};
  uint8_t edgeColour[4] = {255, 0, 255, 255};
  bool endReq = false;
  std::vector<PendingUpdate> updates;
  // configuration
  int mode = 0;  // 0 at the tick, 1 late in the frame
  int leadUs = 2000;
  int k[3] = {0, 0, 0};
  bool ignoreButton = false;
  // status
  int state = kNone;
  HRESULT lastHr = S_OK;
  // stats
  int64_t frames = 0, commits = 0, failures = 0, wakes = 0, ticks = 0, timeouts = 0, occluded = 0,
          idleWakes = 0, maxWorkUs = 0, cpuUs = 0, upFrames = 0, workUs = 0, cycles = 0;
  int awareness = -2;  // DPI_AWARENESS of the native thread
  bool pmv2 = false;
  // log
  std::vector<double> log;
  size_t logRows = 0;
};
Shared g;

// ---- the native thread's own objects (touched only on the thread) ---------
struct Overlay {
  ID3D11Device* d3d = nullptr;
  ID3D11DeviceContext1* ctx = nullptr;
  IDXGIDevice* dxgi = nullptr;
  IDCompositionDesktopDevice* dcomp = nullptr;
  IDCompositionTarget* target = nullptr;
  IDCompositionVisual2* root = nullptr;
  IDCompositionVisual2* fillV = nullptr;
  IDCompositionVisual2* edgeV[4] = {};
  IDCompositionSurface* fillS = nullptr;
  IDCompositionSurface* edgeS = nullptr;
  HWND hwnd = nullptr;
  bool shown = false;
  Rect last;
  int lastEdge = -1;

  void Release() {
    if (target) target->SetRoot(nullptr);
    if (dcomp) dcomp->Commit();
    for (auto& v : edgeV) SafeRelease(v);
    SafeRelease(fillV);
    SafeRelease(root);
    SafeRelease(fillS);
    SafeRelease(edgeS);
    SafeRelease(target);
    SafeRelease(dcomp);
    SafeRelease(dxgi);
    SafeRelease(ctx);
    SafeRelease(d3d);
    hwnd = nullptr;
    shown = false;
    last = Rect{};
    lastEdge = -1;
  }
};

HRESULT FillSurface(Overlay& o, IDCompositionSurface* s, const uint8_t c[4]) {
  ID3D11Texture2D* tex = nullptr;
  POINT off{};
  HRESULT hr = s->BeginDraw(nullptr, __uuidof(ID3D11Texture2D), reinterpret_cast<void**>(&tex), &off);
  if (FAILED(hr)) return hr;
  D3D11_RENDER_TARGET_VIEW_DESC desc{};
  desc.Format = DXGI_FORMAT_B8G8R8A8_UNORM;
  desc.ViewDimension = D3D11_RTV_DIMENSION_TEXTURE2D;
  ID3D11RenderTargetView* rtv = nullptr;
  hr = o.d3d->CreateRenderTargetView(tex, &desc, &rtv);
  if (SUCCEEDED(hr)) {
    // Premultiplied: the CSS bytes are straight alpha. The texture may be an
    // ATLAS shared with other surfaces (documented), so only our 1x1 rect at
    // the returned offset is cleared, never the whole view.
    const float a = c[3] / 255.0f;
    const float colour[4] = {c[0] / 255.0f * a, c[1] / 255.0f * a, c[2] / 255.0f * a, a};
    const D3D11_RECT rect{off.x, off.y, off.x + 1, off.y + 1};
    o.ctx->ClearView(rtv, colour, &rect, 1);
    rtv->Release();
  }
  tex->Release();
  const HRESULT end = s->EndDraw();
  return FAILED(hr) ? hr : end;
}

HRESULT Attach(Overlay& o, HWND hwnd) {
  o.Release();
  const UINT flags = D3D11_CREATE_DEVICE_BGRA_SUPPORT;
  ID3D11DeviceContext* ctx0 = nullptr;
  HRESULT hr = D3D11CreateDevice(nullptr, D3D_DRIVER_TYPE_HARDWARE, nullptr, flags, nullptr, 0, D3D11_SDK_VERSION,
                                 &o.d3d, nullptr, &ctx0);
  if (FAILED(hr))
    hr = D3D11CreateDevice(nullptr, D3D_DRIVER_TYPE_WARP, nullptr, flags, nullptr, 0, D3D11_SDK_VERSION, &o.d3d,
                           nullptr, &ctx0);
  if (FAILED(hr)) return hr;
  hr = ctx0->QueryInterface(__uuidof(ID3D11DeviceContext1), reinterpret_cast<void**>(&o.ctx));
  ctx0->Release();
  if (FAILED(hr)) return hr;
  if (FAILED(hr = o.d3d->QueryInterface(__uuidof(IDXGIDevice), reinterpret_cast<void**>(&o.dxgi)))) return hr;
  if (FAILED(hr = DCompositionCreateDevice2(o.dxgi, __uuidof(IDCompositionDesktopDevice),
                                            reinterpret_cast<void**>(&o.dcomp))))
    return hr;
  if (FAILED(hr = o.dcomp->CreateTargetForHwnd(hwnd, TRUE, &o.target))) return hr;
  if (FAILED(hr = o.dcomp->CreateVisual(&o.root))) return hr;
  if (FAILED(hr = o.dcomp->CreateSurface(1, 1, DXGI_FORMAT_B8G8R8A8_UNORM, DXGI_ALPHA_MODE_PREMULTIPLIED, &o.fillS)))
    return hr;
  if (FAILED(hr = o.dcomp->CreateSurface(1, 1, DXGI_FORMAT_B8G8R8A8_UNORM, DXGI_ALPHA_MODE_PREMULTIPLIED, &o.edgeS)))
    return hr;
  IDCompositionVisual2** all[5] = {&o.fillV, &o.edgeV[0], &o.edgeV[1], &o.edgeV[2], &o.edgeV[3]};
  for (int i = 0; i < 5; i++) {
    if (FAILED(hr = o.dcomp->CreateVisual(all[i]))) return hr;
    IDCompositionVisual2* v = *all[i];
    v->SetBitmapInterpolationMode(DCOMPOSITION_BITMAP_INTERPOLATION_MODE_NEAREST_NEIGHBOR);
    v->SetBorderMode(DCOMPOSITION_BORDER_MODE_HARD);
    if (FAILED(hr = v->SetContent(i == 0 ? o.fillS : o.edgeS))) return hr;
    // Each added above the last: the fill first, the edges over it.
    if (FAILED(hr = o.root->AddVisual(v, TRUE, nullptr))) return hr;
  }
  o.hwnd = hwnd;
  return o.dcomp->Commit();
}

void Place(IDCompositionVisual2* v, int x, int y, int w, int h) {
  if (w <= 0 || h <= 0) {
    w = 0;
    h = 0;
  }
  D2D_MATRIX_3X2_F m{};
  m._11 = static_cast<float>(w);
  m._22 = static_cast<float>(h);
  m._31 = static_cast<float>(x);
  m._32 = static_cast<float>(y);
  v->SetTransform(m);
}

// Returns S_FALSE when nothing changed (no commit).
HRESULT Draw(Overlay& o, const Rect& r, int e, bool show) {
  const bool visible = show && r.r > r.l && r.b > r.t;
  if (visible == o.shown && (!visible || (r == o.last && e == o.lastEdge))) return S_FALSE;
  HRESULT hr = S_OK;
  if (visible) {
    const int w = r.r - r.l, h = r.b - r.t;
    const int ew = std::min(e, w), eh = std::min(e, h);
    Place(o.fillV, r.l, r.t, w, h);
    Place(o.edgeV[0], r.l, r.t, w, eh);                     // top
    Place(o.edgeV[1], r.l, r.b - eh, w, h > eh ? eh : 0);   // bottom
    Place(o.edgeV[2], r.l, r.t + eh, ew, h - 2 * eh);       // left
    Place(o.edgeV[3], r.r - ew, r.t + eh, w > ew ? ew : 0, h - 2 * eh);  // right
    if (!o.shown) hr = o.target->SetRoot(o.root);
  } else {
    hr = o.target->SetRoot(nullptr);
  }
  if (FAILED(hr)) return hr;
  hr = o.dcomp->Commit();
  if (FAILED(hr)) return hr;
  o.shown = visible;
  o.last = visible ? r : Rect{};
  o.lastEdge = e;
  return S_OK;
}

void Log(const double row[kLogCols]) {
  // g.m held by the caller.
  if (g.log.empty()) g.log.resize(kLogRows * kLogCols);
  const size_t at = (g.logRows % kLogRows) * kLogCols;
  std::memcpy(&g.log[at], row, sizeof(double) * kLogCols);
  g.logRows++;
}

int PrimaryVk() { return GetSystemMetrics(SM_SWAPBUTTON) ? VK_RBUTTON : VK_LBUTTON; }

void ThreadMain() {
  Overlay o;
  WaitClockFn waitClock = ResolveClock();
  HMODULE dc = GetModuleHandleW(L"dcomp.dll");
  auto getFrameId = dc ? reinterpret_cast<GetFrameIdFn>(GetProcAddress(dc, "DCompositionGetFrameId")) : nullptr;
  auto getStats = dc ? reinterpret_cast<GetStatsFn>(GetProcAddress(dc, "DCompositionGetStatistics")) : nullptr;
  HANDLE timer = CreateWaitableTimerExW(nullptr, nullptr, CREATE_WAITABLE_TIMER_HIGH_RESOLUTION, TIMER_ALL_ACCESS);
  const LONGLONG freq = QpcFreq();
  {
    std::lock_guard<std::mutex> lock(g.m);
    DPI_AWARENESS_CONTEXT ctx = GetThreadDpiAwarenessContext();
    g.awareness = static_cast<int>(GetAwarenessFromDpiAwarenessContext(ctx));
    g.pmv2 = AreDpiAwarenessContextsEqual(ctx, DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2) != FALSE;
  }
  bool up = false;  // a box is being drawn
  Box box;
  int64_t frameNo = 0;
  std::deque<PendingUpdate> due;
  LONGLONG lastTick = 0, period = freq / 144;

  for (;;) {
    // ---- wait --------------------------------------------------------------
    bool tick = false;
    if (!up) {
      WaitForSingleObject(g.wake, INFINITE);
      std::lock_guard<std::mutex> lock(g.m);
      g.idleWakes++;
    } else if (waitClock) {
      const DWORD r = waitClock(1, &g.wake, 100);
      bool occluded = false;
      {
        std::lock_guard<std::mutex> lock(g.m);
        if (r == WAIT_OBJECT_0 + 1) {
          tick = true;
          g.ticks++;
        } else if (r == WAIT_OBJECT_0) {
          g.wakes++;
        } else if (r == WAIT_TIMEOUT) {
          g.timeouts++;
        } else {
          g.occluded++;
          occluded = true;
        }
      }
      // Occluded (display off) or failed: the call returns at once, so a
      // plain 16 ms wait follows and a box over a sleeping display never spins.
      if (occluded) WaitForSingleObject(g.wake, 16);
    } else {
      // No compositor clock (Windows 10): the spike just paces at 16 ms.
      tick = WaitForSingleObject(g.wake, 16) == WAIT_TIMEOUT;
    }
    const LONGLONG woke = Qpc();
    if (tick) {
      if (lastTick && woke - lastTick < freq / 20) period = (period * 7 + (woke - lastTick)) / 8;
      lastTick = woke;
      frameNo++;
    }

    // ---- commands ------------------------------------------------------------
    HWND attachHwnd = nullptr;
    bool attachReq = false, detachReq = false, beginReq = false, endReq = false, stop = false, ignoreButton = false;
    Box beginBox;
    uint8_t fill[4], edgeColour[4];
    int mode, leadUs, k[3];
    std::vector<PendingUpdate> updates;
    {
      std::lock_guard<std::mutex> lock(g.m);
      stop = g.stop;
      attachReq = g.attachReq;
      attachHwnd = g.attachHwnd;
      g.attachReq = false;
      detachReq = g.detachReq;
      g.detachReq = false;
      beginReq = g.beginReq;
      beginBox = g.beginBox;
      g.beginReq = false;
      endReq = g.endReq;
      g.endReq = false;
      std::memcpy(fill, g.fill, 4);
      std::memcpy(edgeColour, g.edgeColour, 4);
      updates.swap(g.updates);
      mode = g.mode;
      leadUs = g.leadUs;
      std::memcpy(k, g.k, sizeof k);
      ignoreButton = g.ignoreButton;
    }
    if (stop) break;
    auto fail = [&](HRESULT hr) {
      std::lock_guard<std::mutex> lock(g.m);
      g.failures++;
      g.lastHr = hr;
      g.state = kFailed;
    };
    if (detachReq) {
      o.Release();
      up = false;
      std::lock_guard<std::mutex> lock(g.m);
      g.state = kNone;
    }
    if (attachReq) {
      const HRESULT hr = Attach(o, attachHwnd);
      std::lock_guard<std::mutex> lock(g.m);
      g.lastHr = hr;
      g.state = SUCCEEDED(hr) ? kReady : kFailed;
      if (FAILED(hr)) {
        g.failures++;
        o.Release();
      }
    }
    if (beginReq && o.target) {
      HRESULT hr = FillSurface(o, o.fillS, fill);
      if (SUCCEEDED(hr)) hr = FillSurface(o, o.edgeS, edgeColour);
      if (FAILED(hr)) {
        fail(hr);
        o.Release();
      } else {
        box = beginBox;
        due.clear();
        up = true;
      }
    }
    for (auto& u : updates) {
      u.due = frameNo + k[std::clamp(u.cause, 0, 2)];
      due.push_back(u);
    }
    while (!due.empty() && due.front().due <= frameNo) {
      // The anchor and the clip only; the edge width comes with a begin.
      const int e = box.edge;
      box = due.front().box;
      box.edge = e;
      due.pop_front();
    }
    if (endReq) up = false;
    if (!o.target) up = false;

    // ---- late in the frame (spike variant) -------------------------------------
    LONGLONG waited = 0;  // time asleep below: not work, so not in workUs
    if (up && tick && mode == 1 && timer) {
      LONGLONG target = 0;
      COMPOSITION_FRAME_ID id = 0;
      COMPOSITION_FRAME_STATS st{};
      if (getFrameId && getStats && SUCCEEDED(getFrameId(COMPOSITION_FRAME_ID_CREATED, &id)) &&
          SUCCEEDED(getStats(id, &st, 0, nullptr, nullptr)) && st.framePeriod > 0 &&
          st.framePeriod < static_cast<UINT64>(freq / 20) &&
          static_cast<LONGLONG>(st.startTime) > woke - freq && static_cast<LONGLONG>(st.startTime) < woke + freq)
        target = static_cast<LONGLONG>(st.startTime + st.framePeriod);
      else
        target = woke + period;
      target -= static_cast<LONGLONG>(leadUs) * freq / 1000000;
      const LONGLONG wait = target - Qpc();
      if (wait > 0) {
        LARGE_INTEGER due100ns;
        due100ns.QuadPart = -(wait * 10000000 / freq);
        if (SetWaitableTimer(timer, &due100ns, 0, nullptr, nullptr, FALSE)) {
          HANDLE hs[2] = {timer, g.wake};
          // A command that lands during this wait consumed the auto-reset wake
          // event; set it again, so the next loop sees it at once instead of
          // at the next tick (an end or an Escape would lose a frame).
          const LONGLONG slept = Qpc();
          if (WaitForMultipleObjects(2, hs, FALSE, 50) == WAIT_OBJECT_0 + 1) SetEvent(g.wake);
          waited = Qpc() - slept;
        }
      }
    }

    // ---- sample and draw -----------------------------------------------------
    if (!o.target) continue;
    if (up && !ignoreButton && !(GetAsyncKeyState(PrimaryVk()) & 0x8000)) up = false;
    POINT p{};
    const LONGLONG sampled = Qpc();
    GetCursorPos(&p);
    ScreenToClient(o.hwnd, &p);
    const Rect r = up ? BoxRect(box, p.x, p.y) : Rect{};
    const HRESULT hr = Draw(o, r, box.edge, up);
    const LONGLONG committed = Qpc();
    if (FAILED(hr)) {
      fail(hr);
      o.Release();
      up = false;
      continue;
    }
    std::lock_guard<std::mutex> lock(g.m);
    if (tick) g.frames++;
    if (up && tick) g.upFrames++;
    if (hr == S_OK) g.commits++;
    const int64_t workUs = (committed - woke - waited) * 1000000 / freq;
    if (tick && workUs > g.maxWorkUs) g.maxWorkUs = workUs;
    g.workUs += workUs;
    ULONG64 cyc = 0;
    if (QueryThreadCycleTime(GetCurrentThread(), &cyc)) g.cycles = static_cast<int64_t>(cyc);
    FILETIME c0, e0, k0, u0;
    if (GetThreadTimes(GetCurrentThread(), &c0, &e0, &k0, &u0)) {
      const ULONGLONG kt = (static_cast<ULONGLONG>(k0.dwHighDateTime) << 32) | k0.dwLowDateTime;
      const ULONGLONG ut = (static_cast<ULONGLONG>(u0.dwHighDateTime) << 32) | u0.dwLowDateTime;
      g.cpuUs = static_cast<int64_t>((kt + ut) / 10);
    }
    if (up || hr == S_OK) {
      const double row[kLogCols] = {static_cast<double>(woke),
                                    static_cast<double>(sampled),
                                    static_cast<double>(p.x),
                                    static_cast<double>(p.y),
                                    static_cast<double>(r.l),
                                    static_cast<double>(r.t),
                                    static_cast<double>(r.r),
                                    static_cast<double>(r.b),
                                    o.shown ? 1.0 : 0.0,
                                    hr == S_OK ? 1.0 : 0.0,
                                    static_cast<double>(committed),
                                    tick ? static_cast<double>(frameNo) : -1.0};
      Log(row);
    }
  }
  o.Release();
  if (timer) CloseHandle(timer);
}

// ---- lifetime ----------------------------------------------------------------
void EnsureEvents() {
  if (!g.wake) g.wake = CreateEventW(nullptr, FALSE, FALSE, nullptr);
  if (!g.done) g.done = CreateEventW(nullptr, TRUE, FALSE, nullptr);
}

bool StartThread() {
  std::lock_guard<std::mutex> lock(g.m);
  if (g.running) return true;
  EnsureEvents();
  if (!g.wake || !g.done) return false;
  g.stop = false;
  ResetEvent(g.done);
  g.thread = new std::thread([] {
    ThreadMain();
    SetEvent(g.done);
  });
  g.running = true;
  return true;
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
  g.state = kNone;
  return true;
}

void Wake() { SetEvent(g.wake); }

// ---- N-API helpers -------------------------------------------------------------
napi_value Undefined(napi_env env) {
  napi_value v;
  napi_get_undefined(env, &v);
  return v;
}
napi_value Num(napi_env env, double d) {
  napi_value v;
  napi_create_double(env, d, &v);
  return v;
}
napi_value Bool(napi_env env, bool b) {
  napi_value v;
  napi_get_boolean(env, b, &v);
  return v;
}
napi_value Str(napi_env env, const char* s) {
  napi_value v;
  napi_create_string_utf8(env, s, NAPI_AUTO_LENGTH, &v);
  return v;
}
void Set(napi_env env, napi_value o, const char* k, napi_value v) { napi_set_named_property(env, o, k, v); }

size_t Args(napi_env env, napi_callback_info info, napi_value* argv, size_t n) {
  size_t argc = n;
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  return argc;
}
bool GetInt(napi_env env, napi_value o, const char* k, int* out) {
  napi_value v;
  if (napi_get_named_property(env, o, k, &v) != napi_ok) return false;
  double d;
  if (napi_get_value_double(env, v, &d) != napi_ok || !(d == d)) return false;
  *out = static_cast<int>(d);
  return true;
}
bool GetBox(napi_env env, napi_value o, Box* b) {
  return GetInt(env, o, "ax", &b->ax) && GetInt(env, o, "ay", &b->ay) && GetInt(env, o, "left", &b->left) &&
         GetInt(env, o, "top", &b->top) && GetInt(env, o, "right", &b->right) && GetInt(env, o, "bottom", &b->bottom);
}
bool GetRgba(napi_env env, napi_value arr, uint8_t out[4]) {
  for (uint32_t i = 0; i < 4; i++) {
    napi_value v;
    if (napi_get_element(env, arr, i, &v) != napi_ok) return false;
    double d;
    if (napi_get_value_double(env, v, &d) != napi_ok) return false;
    out[i] = static_cast<uint8_t>(std::clamp(d, 0.0, 255.0));
  }
  return true;
}
HWND GetHwnd(napi_env env, napi_value buf) {
  void* data = nullptr;
  size_t len = 0;
  if (napi_get_buffer_info(env, buf, &data, &len) != napi_ok || len < sizeof(HWND)) return nullptr;
  HWND h;
  std::memcpy(&h, data, sizeof h);
  return h;
}

// ---- the JS surface -----------------------------------------------------------
napi_value JsProbe(napi_env env, napi_callback_info) {
  napi_value o;
  napi_create_object(env, &o);
  OSVERSIONINFOEXW v{sizeof v};
  using RtlGetVersionFn = LONG(WINAPI*)(OSVERSIONINFOEXW*);
  auto rtl = reinterpret_cast<RtlGetVersionFn>(GetProcAddress(GetModuleHandleW(L"ntdll.dll"), "RtlGetVersion"));
  if (rtl) rtl(&v);
  Set(env, o, "build", Num(env, v.dwBuildNumber));
  Set(env, o, "clock", Bool(env, ResolveClock() != nullptr));
  Set(env, o, "remote", Bool(env, GetSystemMetrics(SM_REMOTESESSION) != 0));
  return o;
}

napi_value JsStart(napi_env env, napi_callback_info) { return Bool(env, StartThread()); }

napi_value JsShutdown(napi_env env, napi_callback_info info) {
  napi_value argv[1];
  double ms = 250;
  if (Args(env, info, argv, 1) >= 1) napi_get_value_double(env, argv[0], &ms);
  return Bool(env, Shutdown(static_cast<DWORD>(std::clamp(ms, 0.0, 10000.0))));
}

napi_value JsAttach(napi_env env, napi_callback_info info) {
  napi_value argv[1];
  if (Args(env, info, argv, 1) < 1) return Bool(env, false);
  HWND h = GetHwnd(env, argv[0]);
  if (!h || !StartThread()) return Bool(env, false);
  {
    std::lock_guard<std::mutex> lock(g.m);
    g.attachHwnd = h;
    g.attachReq = true;
    g.state = kPending;
  }
  Wake();
  return Bool(env, true);
}

napi_value JsDetach(napi_env env, napi_callback_info) {
  {
    std::lock_guard<std::mutex> lock(g.m);
    if (!g.running) return Undefined(env);
    g.detachReq = true;
  }
  Wake();
  return Undefined(env);
}

napi_value JsStatus(napi_env env, napi_callback_info) {
  static const char* names[] = {"none", "pending", "ready", "failed"};
  napi_value o;
  napi_create_object(env, &o);
  std::lock_guard<std::mutex> lock(g.m);
  Set(env, o, "state", Str(env, names[g.state]));
  Set(env, o, "hr", Num(env, static_cast<double>(static_cast<uint32_t>(g.lastHr))));
  return o;
}

// begin(box, fill, edge) -> false when no target is ready.
napi_value JsBegin(napi_env env, napi_callback_info info) {
  napi_value argv[3];
  const size_t argc = Args(env, info, argv, 3);
  Box b;
  if (argc < 1 || !GetBox(env, argv[0], &b)) return Bool(env, false);
  GetInt(env, argv[0], "edge", &b.edge);
  b.edge = std::clamp(b.edge, 1, 16);
  {
    std::lock_guard<std::mutex> lock(g.m);
    if (g.state != kReady) return Bool(env, false);
    if (argc >= 2) GetRgba(env, argv[1], g.fill);
    if (argc >= 3) GetRgba(env, argv[2], g.edgeColour);
    g.beginBox = b;
    g.beginReq = true;
    g.endReq = false;
    g.updates.clear();
  }
  Wake();
  return Bool(env, true);
}

napi_value JsUpdate(napi_env env, napi_callback_info info) {
  napi_value argv[2];
  const size_t argc = Args(env, info, argv, 2);
  PendingUpdate u;
  if (argc < 1 || !GetBox(env, argv[0], &u.box)) return Undefined(env);
  if (argc >= 2) {
    char s[16] = {};
    size_t n = 0;
    napi_get_value_string_utf8(env, argv[1], s, sizeof s, &n);
    u.cause = strcmp(s, "scroll") == 0 ? kScroll : strcmp(s, "resize") == 0 ? kResize : kAuto;
  }
  {
    std::lock_guard<std::mutex> lock(g.m);
    g.updates.push_back(u);
  }
  Wake();
  return Undefined(env);
}

napi_value JsEnd(napi_env env, napi_callback_info) {
  {
    std::lock_guard<std::mutex> lock(g.m);
    g.endReq = true;
    g.beginReq = false;
  }
  Wake();
  return Undefined(env);
}

// configure({ mode: 'tick' | 'late', leadUs, kAuto, kScroll, kResize, ignoreButton })
napi_value JsConfigure(napi_env env, napi_callback_info info) {
  napi_value argv[1];
  if (Args(env, info, argv, 1) < 1) return Undefined(env);
  std::lock_guard<std::mutex> lock(g.m);
  napi_value v;
  if (napi_get_named_property(env, argv[0], "mode", &v) == napi_ok) {
    char s[8] = {};
    size_t n = 0;
    if (napi_get_value_string_utf8(env, v, s, sizeof s, &n) == napi_ok) g.mode = strcmp(s, "late") == 0 ? 1 : 0;
  }
  int i;
  if (GetInt(env, argv[0], "leadUs", &i)) g.leadUs = std::clamp(i, 0, 20000);
  if (GetInt(env, argv[0], "kAuto", &i)) g.k[kAuto] = std::clamp(i, 0, 8);
  if (GetInt(env, argv[0], "kScroll", &i)) g.k[kScroll] = std::clamp(i, 0, 8);
  if (GetInt(env, argv[0], "kResize", &i)) g.k[kResize] = std::clamp(i, 0, 8);
  if (napi_get_named_property(env, argv[0], "ignoreButton", &v) == napi_ok) {
    bool b = false;
    if (napi_get_value_bool(env, v, &b) == napi_ok) g.ignoreButton = b;
  }
  return Undefined(env);
}

napi_value JsStats(napi_env env, napi_callback_info) {
  napi_value o;
  napi_create_object(env, &o);
  std::lock_guard<std::mutex> lock(g.m);
  Set(env, o, "running", Bool(env, g.running));
  Set(env, o, "frames", Num(env, static_cast<double>(g.frames)));
  Set(env, o, "upFrames", Num(env, static_cast<double>(g.upFrames)));
  Set(env, o, "commits", Num(env, static_cast<double>(g.commits)));
  Set(env, o, "failures", Num(env, static_cast<double>(g.failures)));
  Set(env, o, "ticks", Num(env, static_cast<double>(g.ticks)));
  Set(env, o, "wakes", Num(env, static_cast<double>(g.wakes)));
  Set(env, o, "timeouts", Num(env, static_cast<double>(g.timeouts)));
  Set(env, o, "occluded", Num(env, static_cast<double>(g.occluded)));
  Set(env, o, "idleWakes", Num(env, static_cast<double>(g.idleWakes)));
  Set(env, o, "maxWorkUs", Num(env, static_cast<double>(g.maxWorkUs)));
  Set(env, o, "cpuUs", Num(env, static_cast<double>(g.cpuUs)));
  Set(env, o, "workUs", Num(env, static_cast<double>(g.workUs)));
  Set(env, o, "cycles", Num(env, static_cast<double>(g.cycles)));
  Set(env, o, "awareness", Num(env, g.awareness));
  Set(env, o, "pmv2", Bool(env, g.pmv2));
  Set(env, o, "lastHr", Num(env, static_cast<double>(static_cast<uint32_t>(g.lastHr))));
  return o;
}

// The per-frame log since the last call, kLogCols doubles per row:
// tickQpc, sampleQpc, cursorX, cursorY, left, top, right, bottom, shown,
// committed, commitDoneQpc, frameNo (-1 when not a tick).
napi_value JsTakeLog(napi_env env, napi_callback_info) {
  std::vector<double> copy;
  {
    std::lock_guard<std::mutex> lock(g.m);
    const size_t rows = std::min(g.logRows, kLogRows);
    copy.resize(rows * kLogCols);
    const size_t first = g.logRows - rows;
    for (size_t i = 0; i < rows; i++)
      std::memcpy(&copy[i * kLogCols], &g.log[((first + i) % kLogRows) * kLogCols], sizeof(double) * kLogCols);
    g.logRows = 0;
  }
  napi_value ab, arr;
  void* data = nullptr;
  napi_create_arraybuffer(env, copy.size() * sizeof(double), &data, &ab);
  if (!copy.empty()) std::memcpy(data, copy.data(), copy.size() * sizeof(double));
  napi_create_typedarray(env, napi_float64_array, copy.size(), ab, 0, &arr);
  return arr;
}

napi_value JsQpc(napi_env env, napi_callback_info) { return Num(env, static_cast<double>(Qpc())); }
napi_value JsQpcFreq(napi_env env, napi_callback_info) { return Num(env, static_cast<double>(QpcFreq())); }

void Cleanup(void*) { Shutdown(250); }

napi_value Init(napi_env env, napi_value exports) {
  struct Fn {
    const char* name;
    napi_callback cb;
  } fns[] = {{"probe", JsProbe},       {"start", JsStart},   {"shutdown", JsShutdown}, {"attach", JsAttach},
             {"detach", JsDetach},     {"status", JsStatus}, {"begin", JsBegin},       {"update", JsUpdate},
             {"end", JsEnd},           {"configure", JsConfigure}, {"stats", JsStats}, {"takeLog", JsTakeLog},
             {"qpc", JsQpc},           {"qpcFreq", JsQpcFreq}};
  for (const auto& f : fns) {
    napi_value fn;
    napi_create_function(env, f.name, NAPI_AUTO_LENGTH, f.cb, nullptr, &fn);
    Set(env, exports, f.name, fn);
  }
  napi_add_env_cleanup_hook(env, Cleanup, nullptr);
  return exports;
}

}  // namespace

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
