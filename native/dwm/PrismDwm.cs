// Sets DWM window attributes and exits (#189). Replaces a resident PowerShell.
//
// Usage: PrismDwm.exe <hwnd> <attribute> <value> [<hwnd> <attribute> <value> ...]
//   33 DWMWA_WINDOW_CORNER_PREFERENCE (0 default, 1 do not round)
//   34 DWMWA_BORDER_COLOR (a COLORREF 0x00BBGGRR, -1 default, -2 none)
//
// WHY A PROGRAM AND NOT THE POWERSHELL IT REPLACES. The PowerShell helper was
// kept running so the C# it compiled with Add-Type (about two seconds) was paid
// once; to talk to it, Prism held a pipe open to its stdin. Starting a process
// with a held-open stdin pipe from Electron's MAIN process blocks the UI thread
// for about 900 ms the first time (measured, #189), and Prism did that while
// showing its window, so the first frame waited for it: 1.2 s to a visible
// window instead of 0.36 s. This is compiled once at BUILD time, so there is
// nothing to keep warm: it is started per change with no pipes at all, which
// costs Electron single milliseconds, and it exits when it is done.
//
// Every attribute here is cosmetic, so it never fails loudly: a bad argument or
// a window that has gone is skipped, and the exit code is always 0.
using System;
using System.Runtime.InteropServices;

internal static class Program
{
    [DllImport("dwmapi.dll")]
    private static extern int DwmSetWindowAttribute(IntPtr hwnd, int attribute, ref int value, int size);

    private static int Main(string[] args)
    {
        if (args.Length == 1 && args[0] == "--self-test") return SelfTest();
        for (int i = 0; i + 2 < args.Length; i += 3)
        {
            long hwnd;
            int attribute;
            int value;
            if (!long.TryParse(args[i], out hwnd) || !int.TryParse(args[i + 1], out attribute) || !int.TryParse(args[i + 2], out value))
                continue;
            // Only the two attributes Prism sets: this program must not become a
            // general way to poke any window attribute on the machine.
            if (attribute != 33 && attribute != 34) continue;
            try
            {
                DwmSetWindowAttribute(new IntPtr(hwnd), attribute, ref value, 4);
            }
            catch
            {
                // dwmapi missing or the window gone: cosmetic, so nothing to report.
            }
        }
        return 0;
    }

    // The build runs this, so a helper that cannot even parse its arguments is
    // caught in CI rather than on somebody's machine.
    private static int SelfTest()
    {
        // A handle that is no window: the call must be survived, not thrown.
        int value = -2;
        try { DwmSetWindowAttribute(IntPtr.Zero, 34, ref value, 4); } catch { return 1; }
        return 0;
    }
}
