# Reads what a screen magnifier reads from the text box named $Name in the window
# $Hwnd, both ways a magnifier asks: UI Automation (the box's rectangle and the
# TextPattern selection, text and rectangles) and the older MSAA caret object
# plus the system caret (GetGUIThreadInfo). Run on the desktop the app is on (the
# e2e's hidden one). Prints one JSON line. Rectangles are x, y, width, height.
param([Int64]$Hwnd, [string]$Name)
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class CaretProbe {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [StructLayout(LayoutKind.Sequential)] public struct GUITHREADINFO {
    public int cbSize, flags; public IntPtr hwndActive, hwndFocus, hwndCapture, hwndMenuOwner, hwndMoveSize, hwndCaret; public RECT rcCaret;
  }
  delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr p, EnumProc cb, IntPtr l);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern bool GetGUIThreadInfo(uint tid, ref GUITHREADINFO g);
  [DllImport("user32.dll")] static extern bool ClientToScreen(IntPtr h, ref POINT p);
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
  [DllImport("oleacc.dll")] static extern int AccessibleObjectFromWindow(IntPtr h, uint id, ref Guid iid, [MarshalAs(UnmanagedType.Interface)] out object acc);
  public static IntPtr RenderWidget(IntPtr top) {
    IntPtr found = IntPtr.Zero;
    EnumChildWindows(top, (h, l) => {
      var sb = new StringBuilder(256); GetClassName(h, sb, 256);
      if (sb.ToString() == "Chrome_RenderWidgetHostHWND") { found = h; return false; }
      return true;
    }, IntPtr.Zero);
    return found;
  }
  public static object MsaaCaret(IntPtr h) {
    Guid iid = new Guid("618736E0-3C3D-11CF-810C-00AA00389B71");
    object acc; int hr = AccessibleObjectFromWindow(h, 0xFFFFFFF8u, ref iid, out acc);
    return hr == 0 ? acc : null;
  }
  public static int[] SystemCaret(IntPtr top) {
    uint pid; uint tid = GetWindowThreadProcessId(top, out pid);
    var g = new GUITHREADINFO(); g.cbSize = Marshal.SizeOf(typeof(GUITHREADINFO));
    if (!GetGUIThreadInfo(tid, ref g)) return null;
    var p = new POINT { X = g.rcCaret.L, Y = g.rcCaret.T };
    if (g.hwndCaret != IntPtr.Zero) ClientToScreen(g.hwndCaret, ref p);
    return new int[] { p.X, p.Y, g.rcCaret.R - g.rcCaret.L, g.rcCaret.B - g.rcCaret.T, g.hwndCaret == IntPtr.Zero ? 0 : 1 };
  }
}
"@
$A = [System.Windows.Automation.AutomationElement]
$top = [IntPtr]$Hwnd
$root = $A::FromHandle($top)
$cond = New-Object System.Windows.Automation.PropertyCondition($A::NameProperty, $Name)
$el = $null
foreach ($c in $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $cond)) {
  # The label of a field can share its name; the field is an Edit or a ComboBox.
  $type = $c.Current.ControlType.ProgrammaticName
  if (($type -eq 'ControlType.Edit' -or $type -eq 'ControlType.ComboBox') -and $c.GetCurrentPropertyValue($A::IsTextPatternAvailableProperty)) { $el = $c; break }
}
if (-not $el) { '{"found":false}'; exit 0 }
$r = $el.Current.BoundingRectangle
$out = @{ found = $true; box = @($r.X, $r.Y, $r.Width, $r.Height); focused = $el.Current.HasKeyboardFocus; selection = @(); msaa = $null; system = $null }
try {
  $tp = $el.GetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern)
  foreach ($s in $tp.GetSelection()) {
    $rects = @()
    foreach ($b in $s.GetBoundingRectangles()) { $rects += ,@($b.X, $b.Y, $b.Width, $b.Height) }
    $out.selection += ,@{ text = $s.GetText(-1); rects = $rects }
  }
} catch { $out.error = "$_" }
try {
  $rw = [CaretProbe]::RenderWidget($top)
  if ($rw -ne [IntPtr]::Zero) {
    $acc = [CaretProbe]::MsaaCaret($rw)
    if ($acc) {
      $l = 0; $t = 0; $w = 0; $h = 0
      $acc.accLocation([ref]$l, [ref]$t, [ref]$w, [ref]$h, 0)
      $out.msaa = @($l, $t, $w, $h)
    }
  }
  $out.system = [CaretProbe]::SystemCaret($top)
} catch { $out.msaaError = "$_" }
$out | ConvertTo-Json -Compress -Depth 6
