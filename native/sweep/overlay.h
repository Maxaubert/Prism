// The native sweep box's thread and its DirectComposition targets (#338). The
// N-API surface (sweep.cc) only calls these; everything here that touches COM
// runs on the one native thread, and that thread never calls into JS.
#pragma once

#include <windows.h>

#include <cstdint>

#include "box.h"

namespace prism_sweep {

enum TargetState { kStateNone = 0, kStatePending = 1, kStateReady = 2, kStateFailed = 3 };

// Who moved the list under the box; each is applied K[cause] frames late.
enum Cause { kCauseAuto = 0, kCauseScroll = 1, kCauseResize = 2 };

struct Stats {
  // Passes of the thread's loop: a heartbeat, moving at least once for every
  // command and every compositor frame while a box is up.
  int64_t frames = 0;
  int64_t ticks = 0;     // compositor clock ticks heard
  int64_t upFrames = 0;  // ticks with a box up
  int64_t commits = 0;
  int64_t failures = 0;
  int64_t maxWorkUs = 0;  // the longest wake-to-commit time, waits excluded
  int64_t idleWakes = 0;
  int64_t timeouts = 0;
  int64_t occluded = 0;
  int64_t cpuUs = 0;  // the thread's kernel + user time (15.6 ms steps)
  bool late = true;   // sampling late in the frame (false: at the tick)
  int leadUs = 0;     // the late sample's lead in force
  int64_t lateCommits = 0;
  int64_t widenings = 0;
  uint32_t lastHr = 0;
  int awareness = -2;  // DPI_AWARENESS of the thread
  bool pmv2 = false;
  bool running = false;
};

// Settings for the measuring tools only (tools/sweep-latency); main never
// calls Configure, and every field left at -1 is unchanged.
struct Config {
  int late = -1;     // 1 late in the frame (the default), 0 at the tick
  int leadUs = -1;   // the late sample's starting lead
  int adaptive = -1; // 1 widen on missed frames (the default)
  int ignoreButton = -1;  // 1 keep a box up with no button held (offscreen checks)
};

bool ClockAvailable();
bool Attach(HWND hwnd);
TargetState Status(HWND hwnd);
bool Begin(HWND hwnd, const Box& box, const uint8_t fill[4], const uint8_t edge[4]);
void Update(HWND hwnd, const Box& box, Cause cause);
void End(HWND hwnd);
void Detach(HWND hwnd);
bool Shutdown(DWORD timeoutMs);
Stats GetStats();
void Configure(const Config& c);

}  // namespace prism_sweep
