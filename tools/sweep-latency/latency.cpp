// sweep-latency: how far the sweep box trails the pointer, measured on the glass
// (#338, task 1 step 3). Dev-only, never shipped.
//
// Desktop Duplication of one monitor. Two streams, logged apart, because DDA
// reports them apart: every POINTER update (LastMouseUpdateTime, the hotspot)
// and every IMAGE frame (LastPresentTime non-zero). For each image frame a
// one-pixel column and a one-pixel row are copied out of the desktop image,
// through the middle of the box (between the press point and the pointer), so
// the analysis (analyze.mjs) can find the box's edges in them later, with the
// colours the run actually used. A third stream polls the cursor, the primary
// button and Escape at about 1 kHz (GetCursorPos / GetAsyncKeyState: reading,
// never sending), for the press point, the release and the Escape times.
//
// PASSIVE by default: it records while the owner moves the mouse. Nothing is
// drawn and no input is sent. --inject (SendInput) exists only for a run the
// owner has explicitly allowed, and refuses without --owner-allowed-inject.
//
//   sweep-latency.exe --out <dir> [--phases rest:3,slow:10,...] [--rect l,t,r,b]
//                     [--monitor-at x,y] [--no-beep]
//
// Output in <dir>: meta.json, frames.csv, mouse.csv, poll.csv, strips.bin.
#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#define _CRT_SECURE_NO_WARNINGS
#include <windows.h>
#include <d3d11.h>
#include <dxgi1_6.h>
#include <dwmapi.h>

#include <algorithm>
#include <atomic>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

#pragma comment(lib, "d3d11.lib")
#pragma comment(lib, "dxgi.lib")
#pragma comment(lib, "user32.lib")
#pragma comment(lib, "dwmapi.lib")

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

struct Phase {
  std::string name;
  double seconds;
};

struct Options {
  std::string out;
  std::vector<Phase> phases{{"rest", 3}, {"sweep", 30}};
  bool haveRect = false;
  RECT rect{};
  bool haveAt = false;
  POINT at{};
  bool beep = true;
  bool stripsAlways = false;  // dry runs: strips through the cursor, held or not
  bool inject = false;
  bool injectAllowed = false;
  std::vector<int> injectSpeeds{4, 12, 30};
  POINT injectFrom{};
  int injectSpan = 600;
};

std::vector<Phase> ParsePhases(const std::string& s) {
  std::vector<Phase> out;
  size_t i = 0;
  while (i < s.size()) {
    size_t j = s.find(',', i);
    if (j == std::string::npos) j = s.size();
    const std::string part = s.substr(i, j - i);
    const size_t c = part.find(':');
    if (c != std::string::npos) out.push_back({part.substr(0, c), atof(part.c_str() + c + 1)});
    i = j + 1;
  }
  return out;
}

bool ParseInts(const char* s, int* v, int n) {
  for (int i = 0; i < n; i++) {
    char* end = nullptr;
    v[i] = static_cast<int>(strtol(s, &end, 10));
    if (end == s) return false;
    s = end;
    if (i < n - 1) {
      if (*s != ',') return false;
      s++;
    }
  }
  return true;
}

// ---- the poll stream ----------------------------------------------------------
struct PollRow {
  LONGLONG qpc;
  int x, y;
  int primary, escape, phase;
};

std::mutex gPollM;
std::vector<PollRow> gPoll;
std::atomic<bool> gStop{false};
std::atomic<int> gPhase{0};
// What the capture loop needs from the poll, under gPollM.
struct Live {
  POINT cursor{};
  bool held = false;
  POINT anchor{};
  LONGLONG releasedAt = 0;
} gLive;

void PollThread() {
  SetThreadPriority(GetCurrentThread(), THREAD_PRIORITY_HIGHEST);
  HANDLE timer = CreateWaitableTimerExW(nullptr, nullptr, CREATE_WAITABLE_TIMER_HIGH_RESOLUTION, TIMER_ALL_ACCESS);
  const int primaryVk = GetSystemMetrics(SM_SWAPBUTTON) ? VK_RBUTTON : VK_LBUTTON;
  bool wasHeld = false;
  while (!gStop.load()) {
    POINT p{};
    GetCursorPos(&p);
    const bool held = (GetAsyncKeyState(primaryVk) & 0x8000) != 0;
    const bool esc = (GetAsyncKeyState(VK_ESCAPE) & 0x8000) != 0;
    const LONGLONG t = Qpc();
    {
      std::lock_guard<std::mutex> lock(gPollM);
      gPoll.push_back({t, p.x, p.y, held ? 1 : 0, esc ? 1 : 0, gPhase.load()});
      gLive.cursor = p;
      if (held && !wasHeld) gLive.anchor = p;
      if (!held && wasHeld) gLive.releasedAt = t;
      gLive.held = held;
    }
    wasHeld = held;
    if (timer) {
      LARGE_INTEGER due;
      due.QuadPart = -5000;  // 0.5 ms
      SetWaitableTimer(timer, &due, 0, nullptr, nullptr, FALSE);
      WaitForSingleObject(timer, 5);
    } else {
      Sleep(1);
    }
  }
  if (timer) CloseHandle(timer);
}

void Beep2(DWORD f, DWORD ms) {
  std::thread([f, ms] { Beep(f, ms); }).detach();
}

// ---- injection (only with the owner's explicit yes for that run) --------------
void SendMouse(DWORD flags, LONG x = 0, LONG y = 0) {
  INPUT in{};
  in.type = INPUT_MOUSE;
  in.mi.dwFlags = flags;
  in.mi.dx = x;
  in.mi.dy = y;
  SendInput(1, &in, sizeof in);
}

void InjectThread(Options o) {
  using WaitClockFn = DWORD(WINAPI*)(UINT, const HANDLE*, DWORD);
  HMODULE dc = LoadLibraryExW(L"dcomp.dll", nullptr, LOAD_LIBRARY_SEARCH_SYSTEM32);
  auto waitClock = dc ? reinterpret_cast<WaitClockFn>(GetProcAddress(dc, "DCompositionWaitForCompositorClock")) : nullptr;
  auto frame = [&] {
    if (waitClock)
      waitClock(0, nullptr, 100);
    else
      DwmFlush();
  };
  Sleep(1500);
  for (int speed : o.injectSpeeds) {
    if (gStop.load()) break;
    SetCursorPos(o.injectFrom.x, o.injectFrom.y);
    Sleep(150);
    SendMouse(GetSystemMetrics(SM_SWAPBUTTON) ? MOUSEEVENTF_RIGHTDOWN : MOUSEEVENTF_LEFTDOWN);
    for (int moved = 0; moved < o.injectSpan && !gStop.load(); moved += speed) {
      frame();
      SendMouse(MOUSEEVENTF_MOVE, speed / 2, speed);
    }
    for (int moved = 0; moved < o.injectSpan && !gStop.load(); moved += speed) {
      frame();
      SendMouse(MOUSEEVENTF_MOVE, -speed / 2, -speed);
    }
    SendMouse(GetSystemMetrics(SM_SWAPBUTTON) ? MOUSEEVENTF_RIGHTUP : MOUSEEVENTF_LEFTUP);
    Sleep(700);
  }
}

// ---- duplication ------------------------------------------------------------------
struct Dup {
  ID3D11Device* dev = nullptr;
  ID3D11DeviceContext* ctx = nullptr;
  IDXGIOutput1* out1 = nullptr;
  IDXGIOutputDuplication* dup = nullptr;
  DXGI_OUTPUT_DESC desc{};
  DXGI_OUTDUPL_DESC ddesc{};
  ID3D11Texture2D* colTex = nullptr;
  ID3D11Texture2D* rowTex = nullptr;
  int colLen = 0, rowLen = 0;  // strip lengths in pixels
  DXGI_COLOR_SPACE_TYPE colorSpace = DXGI_COLOR_SPACE_RGB_FULL_G22_NONE_P709;
  UINT bitsPerColor = 8;
  DXGI_FORMAT frameFormat = DXGI_FORMAT_UNKNOWN;
};

bool FindOutput(const POINT& at, IDXGIAdapter1** adapterOut, IDXGIOutput** outputOut) {
  IDXGIFactory1* f = nullptr;
  if (FAILED(CreateDXGIFactory1(__uuidof(IDXGIFactory1), reinterpret_cast<void**>(&f)))) return false;
  // The output holding the point; failing that (a parked window), the primary.
  POINT primary{0, 0};
  for (int pass = 0; pass < 2; pass++) {
    const POINT p = pass == 0 ? at : primary;
    IDXGIAdapter1* a = nullptr;
    for (UINT i = 0; f->EnumAdapters1(i, &a) != DXGI_ERROR_NOT_FOUND; i++) {
      IDXGIOutput* o = nullptr;
      for (UINT j = 0; a->EnumOutputs(j, &o) != DXGI_ERROR_NOT_FOUND; j++) {
        DXGI_OUTPUT_DESC d;
        o->GetDesc(&d);
        if (d.AttachedToDesktop && PtInRect(&d.DesktopCoordinates, p)) {
          *adapterOut = a;
          *outputOut = o;
          f->Release();
          return true;
        }
        o->Release();
      }
      a->Release();
    }
  }
  f->Release();
  return false;
}

HRESULT OpenDup(Dup& d, const POINT& at, const RECT& want, bool haveRect, RECT* stripRect) {
  IDXGIAdapter1* adapter = nullptr;
  IDXGIOutput* output = nullptr;
  if (!FindOutput(at, &adapter, &output)) return E_FAIL;
  HRESULT hr = D3D11CreateDevice(adapter, D3D_DRIVER_TYPE_UNKNOWN, nullptr, 0, nullptr, 0, D3D11_SDK_VERSION, &d.dev,
                                 nullptr, &d.ctx);
  adapter->Release();
  if (FAILED(hr)) {
    output->Release();
    return hr;
  }
  output->GetDesc(&d.desc);
  IDXGIOutput6* o6 = nullptr;
  if (SUCCEEDED(output->QueryInterface(__uuidof(IDXGIOutput6), reinterpret_cast<void**>(&o6)))) {
    DXGI_OUTPUT_DESC1 d1;
    if (SUCCEEDED(o6->GetDesc1(&d1))) {
      d.colorSpace = d1.ColorSpace;
      d.bitsPerColor = d1.BitsPerColor;
    }
    o6->Release();
  }
  hr = output->QueryInterface(__uuidof(IDXGIOutput1), reinterpret_cast<void**>(&d.out1));
  output->Release();
  if (FAILED(hr)) return hr;
  // An HDR desktop is FP16 (scRGB). DuplicateOutput1 asked for 8-bit BGRA has
  // Windows convert it to SDR, so the box's colours come back as the page's
  // sRGB bytes (within a tolerance) and the strips are 4 bytes a pixel.
  IDXGIOutput5* out5 = nullptr;
  hr = E_NOINTERFACE;
  if (SUCCEEDED(d.out1->QueryInterface(__uuidof(IDXGIOutput5), reinterpret_cast<void**>(&out5)))) {
    const DXGI_FORMAT formats[] = {DXGI_FORMAT_B8G8R8A8_UNORM};
    hr = out5->DuplicateOutput1(d.dev, 0, 1, formats, &d.dup);
    out5->Release();
  }
  if (FAILED(hr)) hr = d.out1->DuplicateOutput(d.dev, &d.dup);
  if (FAILED(hr)) return hr;
  d.dup->GetDesc(&d.ddesc);
  const RECT& dc = d.desc.DesktopCoordinates;
  RECT r = dc;
  if (haveRect && !IntersectRect(&r, &dc, &want)) r = dc;  // off this monitor: the whole of it
  *stripRect = r;
  d.colLen = r.bottom - r.top;
  d.rowLen = r.right - r.left;
  return S_OK;
}

// The staging strips take the format of the frames themselves (made at the
// first frame): a copy between textures of different formats does nothing.
HRESULT EnsureStaging(Dup& d, ID3D11Texture2D* desk) {
  D3D11_TEXTURE2D_DESC dd;
  desk->GetDesc(&dd);
  if (d.colTex && dd.Format == d.frameFormat) return S_OK;
  SafeRelease(d.colTex);
  SafeRelease(d.rowTex);
  d.frameFormat = dd.Format;
  D3D11_TEXTURE2D_DESC td{};
  td.MipLevels = 1;
  td.ArraySize = 1;
  td.Format = dd.Format;
  td.SampleDesc.Count = 1;
  td.Usage = D3D11_USAGE_STAGING;
  td.CPUAccessFlags = D3D11_CPU_ACCESS_READ;
  td.Width = 1;
  td.Height = d.colLen;
  HRESULT hr = d.dev->CreateTexture2D(&td, nullptr, &d.colTex);
  if (FAILED(hr)) return hr;
  td.Width = d.rowLen;
  td.Height = 1;
  return d.dev->CreateTexture2D(&td, nullptr, &d.rowTex);
}

void CloseDup(Dup& d) {
  SafeRelease(d.colTex);
  SafeRelease(d.rowTex);
  SafeRelease(d.dup);
  SafeRelease(d.out1);
  SafeRelease(d.ctx);
  SafeRelease(d.dev);
}

bool ReadStrip(Dup& d, ID3D11Texture2D* tex, int len, bool column, std::vector<uint8_t>& out) {
  D3D11_MAPPED_SUBRESOURCE m{};
  if (FAILED(d.ctx->Map(tex, 0, D3D11_MAP_READ, 0, &m))) return false;
  const uint8_t* p = static_cast<const uint8_t*>(m.pData);
  for (int i = 0; i < len; i++) {
    const uint8_t* px = column ? p + static_cast<size_t>(i) * m.RowPitch : p + static_cast<size_t>(i) * 4;
    out.insert(out.end(), px, px + 4);
  }
  d.ctx->Unmap(tex, 0);
  return true;
}

std::string Esc(const std::string& s) {
  std::string o;
  for (char c : s) {
    if (c == '\\' || c == '"') o += '\\';
    o += c;
  }
  return o;
}

}  // namespace

int wmain(int argc, wchar_t** wargv) {
  SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
  Options o;
  std::vector<std::string> args;
  for (int i = 1; i < argc; i++) {
    char buf[2048];
    WideCharToMultiByte(CP_UTF8, 0, wargv[i], -1, buf, sizeof buf, nullptr, nullptr);
    args.emplace_back(buf);
  }
  for (size_t i = 0; i < args.size(); i++) {
    const std::string& a = args[i];
    auto next = [&]() -> const char* { return i + 1 < args.size() ? args[++i].c_str() : ""; };
    int v[4];
    if (a == "--out") o.out = next();
    else if (a == "--phases") o.phases = ParsePhases(next());
    else if (a == "--seconds") o.phases = {{"rest", 3}, {"sweep", atof(next())}};
    else if (a == "--rect" && ParseInts(next(), v, 4)) {
      o.haveRect = true;
      o.rect = {v[0], v[1], v[2], v[3]};
    } else if (a == "--monitor-at" && ParseInts(next(), v, 2)) {
      o.haveAt = true;
      o.at = {v[0], v[1]};
    } else if (a == "--no-beep") o.beep = false;
    else if (a == "--strips-always") o.stripsAlways = true;
    else if (a == "--inject") o.inject = true;
    else if (a == "--owner-allowed-inject") o.injectAllowed = true;
    else if (a == "--inject-from" && ParseInts(next(), v, 2)) o.injectFrom = {v[0], v[1]};
    else if (a == "--inject-span") o.injectSpan = atoi(next());
    else {
      fprintf(stderr, "unknown or malformed argument: %s\n", a.c_str());
      return 2;
    }
  }
  if (o.out.empty() || o.phases.empty()) {
    fprintf(stderr, "usage: sweep-latency --out <dir> [--phases name:s,...] [--rect l,t,r,b] [--monitor-at x,y]\n");
    return 2;
  }
  if (o.inject && !o.injectAllowed) {
    fprintf(stderr, "--inject sends input to the screen: it needs --owner-allowed-inject, given only on the owner's yes\n");
    return 2;
  }
  CreateDirectoryA(o.out.c_str(), nullptr);
  if (!o.haveAt) {
    if (o.haveRect)
      o.at = {(o.rect.left + o.rect.right) / 2, (o.rect.top + o.rect.bottom) / 2};
    else
      GetCursorPos(&o.at);
  }

  Dup d;
  RECT strip{};
  HRESULT hr = OpenDup(d, o.at, o.rect, o.haveRect, &strip);
  if (FAILED(hr)) {
    fprintf(stderr, "duplication failed: 0x%08lx\n", static_cast<unsigned long>(hr));
    return 1;
  }
  const RECT dc = d.desc.DesktopCoordinates;
  LARGE_INTEGER freq;
  QueryPerformanceFrequency(&freq);
  DWM_TIMING_INFO ti{sizeof ti};
  double refresh = 0;
  if (SUCCEEDED(DwmGetCompositionTimingInfo(nullptr, &ti)) && ti.rateRefresh.uiDenominator)
    refresh = static_cast<double>(ti.rateRefresh.uiNumerator) / ti.rateRefresh.uiDenominator;

  const std::string dir = o.out + "\\";
  FILE* frames = fopen((dir + "frames.csv").c_str(), "wb");
  FILE* mouse = fopen((dir + "mouse.csv").c_str(), "wb");
  FILE* strips = fopen((dir + "strips.bin").c_str(), "wb");
  if (!frames || !mouse || !strips) {
    fprintf(stderr, "cannot write to %s\n", o.out.c_str());
    return 1;
  }
  fprintf(frames,
          "present_qpc,acquire_qpc,accumulated,phase,held,anchor_x,anchor_y,cursor_x,cursor_y,scan_x,scan_y,"
          "strip\n");
  fprintf(mouse, "mouse_qpc,pos_x,pos_y,hot_x,hot_y,visible,phase\n");

  gPoll.reserve(1 << 20);
  std::thread poll(PollThread);
  std::thread inject;
  if (o.inject) inject = std::thread(InjectThread, o);

  std::vector<LONGLONG> phaseStart;
  double total = 0;
  for (auto& p : o.phases) total += p.seconds;
  const LONGLONG t0 = Qpc();
  size_t phase = 0;
  phaseStart.push_back(t0);
  printf("[%s] %.0f s\n", o.phases[0].name.c_str(), o.phases[0].seconds);
  fflush(stdout);
  if (o.beep) Beep2(660, 150);
  double phaseEnd = o.phases[0].seconds;

  POINT hot{0, 0};
  std::vector<uint8_t> shapeBuf;
  std::vector<uint8_t> pixels;
  long long nFrames = 0, nMouse = 0, nStrips = 0, nAccumulatedOver1 = 0, nLost = 0;
  int scanX = -1, scanY = -1;
  for (;;) {
    const double elapsed = static_cast<double>(Qpc() - t0) / freq.QuadPart;
    if (elapsed >= total) break;
    if (elapsed >= phaseEnd && phase + 1 < o.phases.size()) {
      phase++;
      gPhase.store(static_cast<int>(phase));
      phaseStart.push_back(Qpc());
      phaseEnd += o.phases[phase].seconds;
      printf("[%s] %.0f s\n", o.phases[phase].name.c_str(), o.phases[phase].seconds);
      fflush(stdout);
      if (o.beep) Beep2(phase + 1 == o.phases.size() ? 990 : 880, 150);
    }
    DXGI_OUTDUPL_FRAME_INFO fi{};
    IDXGIResource* res = nullptr;
    hr = d.dup->AcquireNextFrame(20, &fi, &res);
    if (hr == DXGI_ERROR_WAIT_TIMEOUT) continue;
    if (hr == DXGI_ERROR_ACCESS_LOST || FAILED(hr)) {
      nLost++;
      CloseDup(d);
      Sleep(50);
      if (FAILED(OpenDup(d, o.at, o.rect, o.haveRect, &strip))) Sleep(200);
      continue;
    }
    const LONGLONG acquired = Qpc();
    if (fi.LastMouseUpdateTime.QuadPart != 0) {
      if (fi.PointerShapeBufferSize > 0) {
        shapeBuf.resize(fi.PointerShapeBufferSize);
        UINT need = 0;
        DXGI_OUTDUPL_POINTER_SHAPE_INFO si{};
        if (SUCCEEDED(d.dup->GetFramePointerShape(static_cast<UINT>(shapeBuf.size()), shapeBuf.data(), &need, &si)))
          hot = si.HotSpot;
      }
      // Position is the shape's top-left in the output's image; the hotspot is
      // what GetCursorPos and the page call the pointer. Screen coordinates.
      fprintf(mouse, "%lld,%ld,%ld,%ld,%ld,%d,%zu\n", fi.LastMouseUpdateTime.QuadPart,
              fi.PointerPosition.Position.x + dc.left, fi.PointerPosition.Position.y + dc.top,
              fi.PointerPosition.Position.x + dc.left + hot.x, fi.PointerPosition.Position.y + dc.top + hot.y,
              fi.PointerPosition.Visible ? 1 : 0, phase);
      nMouse++;
    }
    if (fi.LastPresentTime.QuadPart != 0) {
      Live live;
      {
        std::lock_guard<std::mutex> lock(gPollM);
        live = gLive;
      }
      // While held, and for 600 ms after the release (so the frames that show
      // the box going are cut too), the strips run through the box's middle.
      // After the release they stay where they were.
      const bool recent = live.releasedAt && (acquired - live.releasedAt) < freq.QuadPart * 6 / 10;
      if (o.stripsAlways && !live.held) {
        scanX = live.cursor.x;
        scanY = live.cursor.y;
      }
      if (live.held) {
        scanX = (live.anchor.x + live.cursor.x) / 2;
        scanY = (live.anchor.y + live.cursor.y) / 2;
      }
      long long stripIndex = -1;
      if ((live.held || recent || o.stripsAlways) && scanX >= strip.left && scanX < strip.right && scanY >= strip.top &&
          scanY < strip.bottom) {
        ID3D11Texture2D* desk = nullptr;
        if (SUCCEEDED(res->QueryInterface(__uuidof(ID3D11Texture2D), reinterpret_cast<void**>(&desk))) &&
            SUCCEEDED(EnsureStaging(d, desk)) && (d.frameFormat == DXGI_FORMAT_B8G8R8A8_UNORM || d.frameFormat == DXGI_FORMAT_B8G8R8A8_UNORM_SRGB)) {
          const int lx = scanX - dc.left, ly = scanY - dc.top;
          const D3D11_BOX col{static_cast<UINT>(lx), static_cast<UINT>(strip.top - dc.top), 0,
                              static_cast<UINT>(lx + 1), static_cast<UINT>(strip.bottom - dc.top), 1};
          const D3D11_BOX row{static_cast<UINT>(strip.left - dc.left), static_cast<UINT>(ly), 0,
                              static_cast<UINT>(strip.right - dc.left), static_cast<UINT>(ly + 1), 1};
          d.ctx->CopySubresourceRegion(d.colTex, 0, 0, 0, 0, desk, 0, &col);
          d.ctx->CopySubresourceRegion(d.rowTex, 0, 0, 0, 0, desk, 0, &row);
          pixels.clear();
          if (ReadStrip(d, d.colTex, d.colLen, true, pixels) && ReadStrip(d, d.rowTex, d.rowLen, false, pixels)) {
            fwrite(pixels.data(), 1, pixels.size(), strips);
            stripIndex = nStrips++;
          }
        }
        if (desk) desk->Release();
      }
      if (fi.AccumulatedFrames > 1) nAccumulatedOver1++;
      fprintf(frames, "%lld,%lld,%u,%zu,%d,%ld,%ld,%ld,%ld,%d,%d,%lld\n", fi.LastPresentTime.QuadPart, acquired,
              fi.AccumulatedFrames, phase, live.held ? 1 : 0, live.anchor.x, live.anchor.y, live.cursor.x,
              live.cursor.y, scanX, scanY, stripIndex);
      nFrames++;
    }
    res->Release();
    d.dup->ReleaseFrame();
  }
  gStop.store(true);
  poll.join();
  if (inject.joinable()) inject.join();
  if (o.beep) Beep(990, 300);

  FILE* pf = fopen((dir + "poll.csv").c_str(), "wb");
  if (pf) {
    fprintf(pf, "qpc,x,y,primary,escape,phase\n");
    for (const auto& r : gPoll) fprintf(pf, "%lld,%d,%d,%d,%d,%d\n", r.qpc, r.x, r.y, r.primary, r.escape, r.phase);
    fclose(pf);
  }
  fclose(frames);
  fclose(mouse);
  fclose(strips);

  FILE* mf = fopen((dir + "meta.json").c_str(), "wb");
  if (mf) {
    fprintf(mf, "{\n  \"qpcFreq\": %lld,\n  \"refreshHz\": %.4f,\n", freq.QuadPart, refresh);
    fprintf(mf, "  \"output\": [%ld, %ld, %ld, %ld],\n", dc.left, dc.top, dc.right, dc.bottom);
    fprintf(mf, "  \"stripRect\": [%ld, %ld, %ld, %ld],\n", strip.left, strip.top, strip.right, strip.bottom);
    fprintf(mf, "  \"colLen\": %d,\n  \"rowLen\": %d,\n  \"bytesPerPixel\": 4,\n  \"pixelOrder\": \"BGRA\",\n",
            d.colLen, d.rowLen);
    fprintf(mf, "  \"frameFormat\": %d,\n", static_cast<int>(d.frameFormat));
    fprintf(mf, "  \"format\": %d,\n  \"colorSpace\": %d,\n  \"bitsPerColor\": %u,\n  \"rotation\": %d,\n",
            static_cast<int>(d.ddesc.ModeDesc.Format), static_cast<int>(d.colorSpace), d.bitsPerColor,
            static_cast<int>(d.ddesc.Rotation));
    fprintf(mf, "  \"phases\": [");
    for (size_t i = 0; i < o.phases.size(); i++)
      fprintf(mf, "%s{\"name\": \"%s\", \"seconds\": %.3f, \"startQpc\": %lld}", i ? ", " : "",
              Esc(o.phases[i].name).c_str(), o.phases[i].seconds, i < phaseStart.size() ? phaseStart[i] : 0LL);
    fprintf(mf, "],\n  \"endQpc\": %lld,\n", Qpc());
    fprintf(mf,
            "  \"counts\": {\"frames\": %lld, \"mouseUpdates\": %lld, \"polls\": %zu, \"strips\": %lld, "
            "\"accumulatedOver1\": %lld, \"accessLost\": %lld},\n",
            nFrames, nMouse, gPoll.size(), nStrips, nAccumulatedOver1, nLost);
    fprintf(mf, "  \"injected\": %s\n}\n", o.inject ? "true" : "false");
    fclose(mf);
  }
  printf("done: %lld image frames, %lld pointer updates, %zu polls, %lld strips\n", nFrames, nMouse, gPoll.size(),
         nStrips);
  CloseDup(d);
  return 0;
}
