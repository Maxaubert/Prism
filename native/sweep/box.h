// The sweep box's integer geometry (#338). Pure: no Windows, no COM, so the
// build's self-test runs every case in plain Node (selfTest() in sweep.cc).
#pragma once

#include <algorithm>

namespace prism_sweep {

// What main hands over, in the window's physical client pixels: the anchor
// (the press point, moved as the list scrolls) and the clip (the list's
// visible rect; right and bottom exclusive).
struct Box {
  int ax = 0, ay = 0, left = 0, top = 0, right = 0, bottom = 0, edge = 1;
};

enum EdgeBit { kTop = 1, kBottom = 2, kLeft = 4, kRight = 8, kAllEdges = 15 };

// The drawn rect (right and bottom exclusive) and which of its edges are the
// box's own. An edge the clip cut off is not drawn: the DOM band's edge goes
// out of view under the scroller's overflow there, and Explorer's does too.
struct Drawn {
  int l = 0, t = 0, r = 0, b = 0;
  int edges = 0;
  bool empty() const { return r <= l || b <= t; }
  bool operator==(const Drawn& o) const {
    return l == o.l && t == o.t && r == o.r && b == o.b && edges == o.edges;
  }
  bool operator!=(const Drawn& o) const { return !(*this == o); }
};

// Explorer's _SetVisualLoc in integer pixels: the cursor (cx, cy) is first
// clamped to the clip plus one pixel (Explorer's OnMouseMoved clamp), the box
// runs from the anchor to it with +1 on the right and bottom, so a box with no
// size is one pixel, and is then cut by the clip. Empty when nothing is left.
inline Drawn BoxAt(const Box& k, int cx, int cy) {
  if (k.right <= k.left || k.bottom <= k.top) return Drawn{};
  cx = std::clamp(cx, k.left - 1, k.right);
  cy = std::clamp(cy, k.top - 1, k.bottom);
  const int ul = std::min(k.ax, cx), ur = std::max(k.ax, cx) + 1;
  const int ut = std::min(k.ay, cy), ub = std::max(k.ay, cy) + 1;
  Drawn d;
  d.l = std::max(ul, k.left);
  d.r = std::min(ur, k.right);
  d.t = std::max(ut, k.top);
  d.b = std::min(ub, k.bottom);
  if (d.empty()) return Drawn{};
  d.edges = (ut >= k.top ? kTop : 0) | (ub <= k.bottom ? kBottom : 0) | (ul >= k.left ? kLeft : 0) |
            (ur <= k.right ? kRight : 0);
  return d;
}

}  // namespace prism_sweep
