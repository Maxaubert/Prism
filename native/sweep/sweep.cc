// The native sweep box's JS surface (#338). Every call is synchronous and only
// writes the thread's mutex-guarded queue (overlay.cc); nothing here keeps a
// reference to JS, and the thread never calls back. Main (src/main/
// sweepOverlay.ts) is the only caller, apart from the build's self-test and
// the dev measuring tools (tools/sweep-latency), which alone use configure().
#include <node_api.h>

#include <algorithm>
#include <cstdio>
#include <cstring>
#include <string>
#include <vector>

#include "box.h"
#include "overlay.h"

namespace prism_sweep {
namespace {

// Far beyond any window; keeps the box math well inside an int.
constexpr double kMaxCoord = 1e6;

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
  if (napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr) != napi_ok) return 0;
  return argc;
}
bool GetInt(napi_env env, napi_value o, const char* k, int* out) {
  napi_value v;
  double d;
  if (napi_get_named_property(env, o, k, &v) != napi_ok || napi_get_value_double(env, v, &d) != napi_ok) return false;
  if (!(d >= -kMaxCoord && d <= kMaxCoord)) return false;  // NaN fails too
  *out = static_cast<int>(d);
  return true;
}
bool GetBox(napi_env env, napi_value o, Box* b) {
  return GetInt(env, o, "ax", &b->ax) && GetInt(env, o, "ay", &b->ay) && GetInt(env, o, "left", &b->left) &&
         GetInt(env, o, "top", &b->top) && GetInt(env, o, "right", &b->right) &&
         GetInt(env, o, "bottom", &b->bottom);
}
bool GetRgba(napi_env env, napi_value arr, uint8_t out[4]) {
  for (uint32_t i = 0; i < 4; i++) {
    napi_value v;
    double d;
    if (napi_get_element(env, arr, i, &v) != napi_ok || napi_get_value_double(env, v, &d) != napi_ok) return false;
    if (!(d >= 0 && d <= 255)) return false;
    out[i] = static_cast<uint8_t>(d);
  }
  return true;
}
// A BrowserWindow's getNativeWindowHandle(): the HWND's bytes in a Buffer.
HWND GetHwnd(napi_env env, napi_value buf) {
  void* data = nullptr;
  size_t len = 0;
  if (napi_get_buffer_info(env, buf, &data, &len) != napi_ok || len < sizeof(HWND)) return nullptr;
  HWND h;
  std::memcpy(&h, data, sizeof h);
  return h;
}

// ---- the self-test: box.h's cases, run by the build in plain Node --------------
struct Case {
  const char* name;
  Box box;
  int cx, cy;
  Drawn want;
};

std::vector<std::string> SelfTest() {
  const Box clip{0, 0, 0, 0, 100, 100, 1};
  auto at = [&](int ax, int ay) {
    Box b = clip;
    b.ax = ax;
    b.ay = ay;
    return b;
  };
  const Case cases[] = {
      {"anchor left of and above the cursor", at(10, 10), 20, 30, {10, 10, 21, 31, kAllEdges}},
      {"anchor right of and below the cursor", at(50, 60), 20, 30, {20, 30, 51, 61, kAllEdges}},
      {"zero size is one pixel", at(10, 10), 10, 10, {10, 10, 11, 11, kAllEdges}},
      {"far corner clamped to the clip plus one, right", at(10, 10), 500, 50, {10, 10, 100, 51, kTop | kBottom | kLeft}},
      {"far corner clamped to the clip plus one, left", at(10, 10), -50, 50, {0, 10, 11, 51, kTop | kBottom | kRight}},
      {"far corner clamped to the clip plus one, down", at(10, 10), 30, 900, {10, 10, 31, 100, kTop | kLeft | kRight}},
      {"anchor above the clip is cut there", at(20, -30), 40, 50, {20, 0, 41, 51, kBottom | kLeft | kRight}},
      {"anchor below the clip is cut there", at(20, 300), 40, 50, {20, 50, 41, 100, kTop | kLeft | kRight}},
      {"empty when fully clipped", at(150, 150), 500, 500, {}},
      {"empty clip", Box{10, 10, 5, 5, 5, 5, 1}, 20, 20, {}},
      {"inside an offset clip", Box{60, 70, 50, 40, 300, 200, 1}, 55, 45, {55, 45, 61, 71, kAllEdges}},
  };
  std::vector<std::string> failures;
  for (const auto& c : cases) {
    const Drawn got = BoxAt(c.box, c.cx, c.cy);
    if (got != c.want) {
      char line[256];
      std::snprintf(line, sizeof line, "%s: got {%d,%d,%d,%d e%d}, want {%d,%d,%d,%d e%d}", c.name, got.l, got.t,
                    got.r, got.b, got.edges, c.want.l, c.want.t, c.want.r, c.want.b, c.want.edges);
      failures.emplace_back(line);
    }
  }
  return failures;
}

// ---- the JS surface ----------------------------------------------------------------
napi_value JsProbe(napi_env env, napi_callback_info) {
  napi_value o;
  napi_create_object(env, &o);
  OSVERSIONINFOEXW v{};
  v.dwOSVersionInfoSize = sizeof v;
  using RtlGetVersionFn = LONG(WINAPI*)(OSVERSIONINFOEXW*);
  const HMODULE ntdll = GetModuleHandleW(L"ntdll.dll");
  const auto rtl = ntdll ? reinterpret_cast<RtlGetVersionFn>(reinterpret_cast<void*>(GetProcAddress(ntdll, "RtlGetVersion")))
                         : nullptr;
  if (rtl) rtl(&v);
  Set(env, o, "build", Num(env, v.dwBuildNumber));
  Set(env, o, "clock", Bool(env, ClockAvailable()));
  Set(env, o, "remote", Bool(env, GetSystemMetrics(SM_REMOTESESSION) != 0));
  return o;
}

napi_value JsAttach(napi_env env, napi_callback_info info) {
  napi_value argv[1];
  if (Args(env, info, argv, 1) < 1) return Undefined(env);
  const HWND h = GetHwnd(env, argv[0]);
  if (h) Attach(h);
  return Undefined(env);
}

napi_value JsStatus(napi_env env, napi_callback_info info) {
  static const char* const names[] = {"none", "pending", "ready", "failed"};
  napi_value argv[1];
  if (Args(env, info, argv, 1) < 1) return Str(env, "none");
  const HWND h = GetHwnd(env, argv[0]);
  return Str(env, h ? names[Status(h)] : "none");
}

// begin(hwnd, box, fill, edge) -> false when that window's target is not ready.
napi_value JsBegin(napi_env env, napi_callback_info info) {
  napi_value argv[4];
  if (Args(env, info, argv, 4) < 4) return Bool(env, false);
  const HWND h = GetHwnd(env, argv[0]);
  Box b;
  uint8_t fill[4], edge[4];
  if (!h || !GetBox(env, argv[1], &b) || !GetRgba(env, argv[2], fill) || !GetRgba(env, argv[3], edge))
    return Bool(env, false);
  if (!GetInt(env, argv[1], "edge", &b.edge)) b.edge = 1;
  b.edge = std::clamp(b.edge, 1, 16);
  return Bool(env, Begin(h, b, fill, edge));
}

// update(hwnd, box): the anchor and the clip, applied K[box.cause] frames later.
napi_value JsUpdate(napi_env env, napi_callback_info info) {
  napi_value argv[2];
  if (Args(env, info, argv, 2) < 2) return Undefined(env);
  const HWND h = GetHwnd(env, argv[0]);
  Box b;
  if (!h || !GetBox(env, argv[1], &b)) return Undefined(env);
  Cause cause = kCauseAuto;
  napi_value v;
  char s[16] = {};
  size_t n = 0;
  if (napi_get_named_property(env, argv[1], "cause", &v) == napi_ok &&
      napi_get_value_string_utf8(env, v, s, sizeof s, &n) == napi_ok)
    cause = std::strcmp(s, "scroll") == 0 ? kCauseScroll : std::strcmp(s, "resize") == 0 ? kCauseResize : kCauseAuto;
  Update(h, b, cause);
  return Undefined(env);
}

napi_value JsEnd(napi_env env, napi_callback_info info) {
  napi_value argv[1];
  if (Args(env, info, argv, 1) < 1) return Undefined(env);
  const HWND h = GetHwnd(env, argv[0]);
  if (h) End(h);
  return Undefined(env);
}

napi_value JsDetach(napi_env env, napi_callback_info info) {
  napi_value argv[1];
  if (Args(env, info, argv, 1) < 1) return Undefined(env);
  const HWND h = GetHwnd(env, argv[0]);
  if (h) Detach(h);
  return Undefined(env);
}

napi_value JsShutdown(napi_env env, napi_callback_info info) {
  napi_value argv[1];
  double ms = 250;
  if (Args(env, info, argv, 1) >= 1) napi_get_value_double(env, argv[0], &ms);
  if (!(ms >= 0)) ms = 250;
  return Bool(env, Shutdown(static_cast<DWORD>(std::min(ms, 10000.0))));
}

napi_value JsStats(napi_env env, napi_callback_info) {
  const Stats s = GetStats();
  napi_value o;
  napi_create_object(env, &o);
  Set(env, o, "running", Bool(env, s.running));
  Set(env, o, "frames", Num(env, static_cast<double>(s.frames)));
  Set(env, o, "ticks", Num(env, static_cast<double>(s.ticks)));
  Set(env, o, "upFrames", Num(env, static_cast<double>(s.upFrames)));
  Set(env, o, "commits", Num(env, static_cast<double>(s.commits)));
  Set(env, o, "failures", Num(env, static_cast<double>(s.failures)));
  Set(env, o, "maxWorkUs", Num(env, static_cast<double>(s.maxWorkUs)));
  Set(env, o, "idleWakes", Num(env, static_cast<double>(s.idleWakes)));
  Set(env, o, "timeouts", Num(env, static_cast<double>(s.timeouts)));
  Set(env, o, "occluded", Num(env, static_cast<double>(s.occluded)));
  Set(env, o, "cpuUs", Num(env, static_cast<double>(s.cpuUs)));
  Set(env, o, "sampling", Str(env, s.late ? "late" : "tick"));
  Set(env, o, "leadUs", Num(env, s.leadUs));
  Set(env, o, "lateCommits", Num(env, static_cast<double>(s.lateCommits)));
  Set(env, o, "widenings", Num(env, static_cast<double>(s.widenings)));
  Set(env, o, "lastHr", Num(env, s.lastHr));
  Set(env, o, "awareness", Num(env, s.awareness));
  Set(env, o, "pmv2", Bool(env, s.pmv2));
  return o;
}

napi_value JsSelfTest(napi_env env, napi_callback_info) {
  const std::vector<std::string> failures = SelfTest();
  napi_value arr;
  napi_create_array_with_length(env, failures.size(), &arr);
  for (uint32_t i = 0; i < failures.size(); i++) napi_set_element(env, arr, i, Str(env, failures[i].c_str()));
  return arr;
}

// configure({ sampling: 'tick' | 'late', leadUs, adaptive, ignoreButton }): the
// dev measuring tools only. Main never calls it.
napi_value JsConfigure(napi_env env, napi_callback_info info) {
  napi_value argv[1];
  if (Args(env, info, argv, 1) < 1) return Undefined(env);
  Config c;
  napi_value v;
  char s[8] = {};
  size_t n = 0;
  if (napi_get_named_property(env, argv[0], "sampling", &v) == napi_ok &&
      napi_get_value_string_utf8(env, v, s, sizeof s, &n) == napi_ok)
    c.late = std::strcmp(s, "tick") == 0 ? 0 : 1;
  int i;
  if (GetInt(env, argv[0], "leadUs", &i)) c.leadUs = i;
  bool b;
  if (napi_get_named_property(env, argv[0], "adaptive", &v) == napi_ok && napi_get_value_bool(env, v, &b) == napi_ok)
    c.adaptive = b ? 1 : 0;
  if (napi_get_named_property(env, argv[0], "ignoreButton", &v) == napi_ok &&
      napi_get_value_bool(env, v, &b) == napi_ok)
    c.ignoreButton = b ? 1 : 0;
  Configure(c);
  return Undefined(env);
}

void Cleanup(void*) { Shutdown(250); }

napi_value Init(napi_env env, napi_value exports) {
  struct Fn {
    const char* name;
    napi_callback cb;
  };
  const Fn fns[] = {{"probe", JsProbe},   {"attach", JsAttach},     {"status", JsStatus},
                    {"begin", JsBegin},   {"update", JsUpdate},     {"end", JsEnd},
                    {"detach", JsDetach}, {"shutdown", JsShutdown}, {"stats", JsStats},
                    {"selfTest", JsSelfTest}, {"configure", JsConfigure}};
  for (const auto& f : fns) {
    napi_value fn;
    napi_create_function(env, f.name, NAPI_AUTO_LENGTH, f.cb, nullptr, &fn);
    Set(env, exports, f.name, fn);
  }
  // The env's teardown (a worker, or a process that skips will-quit) joins the
  // thread too; Shutdown is idempotent.
  napi_add_env_cleanup_hook(env, Cleanup, nullptr);
  return exports;
}

}  // namespace
}  // namespace prism_sweep

NAPI_MODULE(NODE_GYP_MODULE_NAME, prism_sweep::Init)
