// Optional, per-user Win+E interception. Windows Explorer registrations are never changed.
using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Win32;

internal static class Program
{
    internal const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
    internal const string ValueName = "PrismWinE";
    internal static readonly string Self = Path.GetFullPath(Process.GetCurrentProcess().MainModule.FileName);

    [STAThread]
    private static int Main(string[] args)
    {
        Owner owner = null;
        try
        {
            if (args.Length == 1 && args[0] == "--self-test") return SelfTests.Run();
            if (args.Length == 1 && args[0] == "--self-test-child")
            {
                Thread.Sleep(2000);
                return 0;
            }
            if (args.Length == 1 && args[0] == "--self-test-spawn-child")
            {
                StartHidden(Self, "--self-test-child");
                Console.WriteLine("child started");
                return 0;
            }
            if (args.Length == 1 && (args[0] == "--uninstall" || args[0] == "--stop-own"))
            {
                using (var gate = new ConfigurationLock())
                {
                    string[] command = SplitCommand(ReadValue(RunKey));
                    if (command.Length == 4 && SamePath(command[0], Self) && command[1] == "--watch")
                    {
                        owner = new Owner(command[2], command[3], RunKey);
                        if (args[0] == "--uninstall") owner.Disable();
                        else owner.Stop();
                    }
                }
                Print(owner, null);
                return 0;
            }
            if (args.Length == 4 && args[0] == "--folder") return FolderOpen.Run(args[1], args[2], args[3], FolderOpen.Explorer);
            if (args.Length > 0 && args[0].StartsWith("--folders-")) return Folders(args, FolderRegistration.Real());
            if (args.Length != 3) throw new ArgumentException("Expected --enable, --disable, --status or --watch followed by the Prism executable and profile paths.");
            owner = new Owner(args[1], args[2], RunKey);
            switch (args[0])
            {
                case "--watch": return Watcher.Run(owner);
                case "--status": break;
                case "--enable":
                    using (var gate = new ConfigurationLock()) owner.Enable();
                    break;
                case "--disable":
                    using (var gate = new ConfigurationLock()) owner.Disable();
                    break;
                default: throw new ArgumentException("Unknown shortcut command.");
            }
            Print(owner, null);
            return 0;
        }
        catch (Exception error)
        {
            Print(owner, error.Message);
            return 1;
        }
    }

    // `--folders-enable|--folders-status <exe> <profile>`, `--folders-disable`: one JSON line,
    // `on` (Prism is the folder handler) and `current` (pointing at this exe and profile).
    internal static int Folders(string[] args, FolderRegistration folders)
    {
        string error = null;
        bool known = args.Length == 3 && Path.IsPathRooted(args[1]) && Path.IsPathRooted(args[2]);
        try
        {
            if (args.Length == 1 && args[0] == "--folders-disable")
                using (var gate = new ConfigurationLock()) folders.Disable();
            else if (known && args[0] == "--folders-enable")
                using (var gate = new ConfigurationLock()) folders.Enable(args[1], args[2]);
            else if (!(known && args[0] == "--folders-status"))
                throw new ArgumentException("Expected --folders-enable, --folders-status or --folders-disable.");
        }
        catch (Exception failure) { error = failure.Message; }
        bool on = false, current = false;
        try
        {
            on = folders.IsOn;
            current = known && folders.IsCurrent(args[1], args[2]);
        }
        catch (Exception statusError) { if (error == null) error = statusError.Message; }
        Console.WriteLine(new JavaScriptSerializer().Serialize(new { on = on, current = current, error = error }));
        return error == null ? 0 : 1;
    }

    private static void Print(Owner owner, string error)
    {
        bool enabled = false, running = false, conflict = false;
        try
        {
            if (owner != null)
            {
                enabled = owner.IsOwned;
                running = owner.IsRunning;
                conflict = owner.HasConflict;
            }
        }
        catch (Exception statusError) { if (error == null) error = statusError.Message; }
        Console.WriteLine(new JavaScriptSerializer().Serialize(new { enabled = enabled, running = running, conflict = conflict, error = error }));
    }

    internal static bool SamePath(string first, string second)
    {
        return String.Equals(Path.GetFullPath(first), Path.GetFullPath(second), StringComparison.OrdinalIgnoreCase);
    }

    // Windows CommandLineToArgvW rules, including trailing backslashes in a profile path.
    internal static string Quote(string value)
    {
        var output = new StringBuilder("\"");
        int slashes = 0;
        foreach (char character in value)
        {
            if (character == '\\') { slashes++; continue; }
            output.Append('\\', character == '"' ? slashes * 2 + 1 : slashes);
            output.Append(character);
            slashes = 0;
        }
        return output.Append('\\', slashes * 2).Append('"').ToString();
    }

    internal static string[] SplitCommand(string value)
    {
        if (String.IsNullOrEmpty(value)) return new string[0];
        int count;
        IntPtr result = Native.CommandLineToArgvW(value, out count);
        if (result == IntPtr.Zero) return new string[0];
        try
        {
            var args = new string[count];
            for (int i = 0; i < count; i++) args[i] = Marshal.PtrToStringUni(Marshal.ReadIntPtr(result, i * IntPtr.Size));
            return args;
        }
        finally { Native.LocalFree(result); }
    }

    internal static string ReadValue(string key)
    {
        using (var registry = Registry.CurrentUser.OpenSubKey(key))
        {
            object value = registry == null ? null : registry.GetValue(ValueName, null, RegistryValueOptions.DoNotExpandEnvironmentNames);
            // A malformed/non-string value still belongs to somebody else.
            return value == null ? null : value as string ?? "<invalid Run value type>";
        }
    }

    internal static void StartHidden(string executable, string args)
    {
        // Framework Process.Start inherits inheritable stdout/stderr pipe handles even
        // without explicit redirection. A watcher would keep execFile(--enable) pending
        // for its entire lifetime. CreateProcess with inheritance disabled detaches it.
        Native.StartDetached(executable, args, false);
    }
}

internal sealed class ConfigurationLock : IDisposable
{
    private readonly Mutex mutex = new Mutex(false, @"Local\PrismWinE.Configuration");
    internal ConfigurationLock()
    {
        try { if (!mutex.WaitOne(5000)) throw new IOException("Another shortcut configuration operation is still running."); }
        catch (AbandonedMutexException) { }
    }
    public void Dispose() { mutex.ReleaseMutex(); mutex.Dispose(); }
}

internal sealed class Owner
{
    internal readonly string Exe, Profile, Key, Command, Identity;
    internal Owner(string executable, string profile, string key)
    {
        if (!Path.IsPathRooted(executable) || !Path.IsPathRooted(profile)) throw new ArgumentException("Shortcut paths must be absolute.");
        Exe = Path.GetFullPath(executable);
        Profile = Path.GetFullPath(profile);
        Key = key;
        Command = Program.Quote(Program.Self) + " --watch " + Program.Quote(Exe) + " " + Program.Quote(Profile);
        using (var sha = SHA256.Create())
            Identity = @"Local\PrismWinE." + BitConverter.ToString(sha.ComputeHash(Encoding.UTF8.GetBytes(Command.ToUpperInvariant()))).Replace("-", "").Substring(0, 32);
    }
    internal bool IsOwned { get { return String.Equals(Program.ReadValue(Key), Command, StringComparison.Ordinal); } }
    internal bool HasConflict { get { string value = Program.ReadValue(Key); return !String.IsNullOrEmpty(value) && value != Command; } }
    internal bool TargetExists
    {
        get
        {
            string resources = Path.Combine(Path.GetDirectoryName(Exe), "resources");
            return File.Exists(Exe) && (File.Exists(Path.Combine(resources, "app.asar")) || Directory.Exists(Path.Combine(resources, "app")));
        }
    }
    internal bool IsRunning
    {
        get
        {
            try { using (var ready = EventWaitHandle.OpenExisting(Identity + ".Ready")) return ready.WaitOne(0); }
            catch (WaitHandleCannotBeOpenedException) { return false; }
        }
    }
    internal void WriteOwned()
    {
        if (HasConflict) throw new IOException("Another Prism installation or profile owns Win+E. Disable it there first.");
        if (!TargetExists) throw new IOException("Prism or its application resources are missing.");
        using (var registry = Registry.CurrentUser.CreateSubKey(Key)) registry.SetValue(Program.ValueName, Command, RegistryValueKind.String);
    }
    internal void Enable()
    {
        WriteOwned();
        if (IsRunning) return;
        try
        {
            Program.StartHidden(Program.Self, "--watch " + Program.Quote(Exe) + " " + Program.Quote(Profile));
            var time = Stopwatch.StartNew();
            while (!IsRunning && time.ElapsedMilliseconds < 5000) Thread.Sleep(30);
            if (!IsRunning) throw new IOException("The shortcut helper did not become ready. Windows Explorer remains the default.");
        }
        catch { Disable(); throw; }
    }
    internal void Disable()
    {
        if (IsOwned)
        {
            using (var registry = Registry.CurrentUser.OpenSubKey(Key, true))
                if (registry != null && (string)registry.GetValue(Program.ValueName) == Command) registry.DeleteValue(Program.ValueName, false);
        }
        Stop();
    }
    internal void Stop()
    {
        try { using (var stop = EventWaitHandle.OpenExisting(Identity + ".Stop")) stop.Set(); }
        catch (WaitHandleCannotBeOpenedException) { }
        var time = Stopwatch.StartNew();
        while (IsRunning && time.ElapsedMilliseconds < 2500) Thread.Sleep(20);
        if (IsRunning) throw new IOException("The shortcut helper has not stopped yet. Please try again.");
        // Wait until the hook AND pending acknowledgement/fallback worker have exited,
        // so an installer can replace/delete this executable without a sharing violation.
        try
        {
            using (var watcher = Mutex.OpenExisting(Identity + ".Watcher"))
            {
                bool acquired = false;
                try { acquired = watcher.WaitOne(10000); }
                catch (AbandonedMutexException) { acquired = true; }
                if (!acquired) throw new IOException("The shortcut helper is still finishing a request. Please try again.");
                watcher.ReleaseMutex();
            }
        }
        catch (WaitHandleCannotBeOpenedException) { }
    }
    internal bool ShouldWatch()
    {
        if (!IsOwned) return false;
        if (TargetExists) return true;
        using (var registry = Registry.CurrentUser.OpenSubKey(Key, true))
            if (registry != null && (string)registry.GetValue(Program.ValueName) == Command) registry.DeleteValue(Program.ValueName, false);
        return false;
    }
}

internal static class Launcher
{
    // Server exists before starting Prism, including when Electron routes this invocation
    // to an existing process. No ack means Explorer opens, even if Prism stays alive.
    //
    // TWO STAGES (2026-09-22, owner: after a boot Win+E opened File Explorer until Prism had
    // been run once). A cold Electron start after boot can take longer than `timeout`, so
    // Prism writes "<token> started" the moment its main process has the request, keeps the
    // pipe open, and writes "<token>" once the folder browser is on screen. `timeout` bounds
    // the first line, so a Prism that is absent or never starts still falls back at once;
    // after it, `patience` does. A Prism that dies closes the pipe, which reads as 0 bytes
    // and falls back immediately rather than waiting the patience out.
    internal static bool LaunchAndWait(Action<string> launch, int timeout, int patience = 45000)
    {
        string reason;
        return LaunchAndWait(launch, timeout, patience, out reason);
    }
    // `reason` says how a request ended, for the helper's log (#350): "acknowledged",
    // "no-connection", "no-start", "closed", "wrong-reply", "not-ready" or "failed".
    internal static bool LaunchAndWait(Action<string> launch, int timeout, int patience, out string reason)
    {
        reason = "failed";
        bool started = false;
        string token = Guid.NewGuid().ToString("D");
        var clock = Stopwatch.StartNew();
        long deadline = timeout;
        try
        {
            using (var pipe = new NamedPipeServerStream("PrismWinE." + token, PipeDirection.In, 1, PipeTransmissionMode.Byte, PipeOptions.Asynchronous))
            {
                IAsyncResult connect = pipe.BeginWaitForConnection(null, null);
                launch(token);
                if (!connect.AsyncWaitHandle.WaitOne((int)Math.Max(0, deadline - clock.ElapsedMilliseconds)))
                {
                    reason = "no-connection";
                    return false;
                }
                pipe.EndWaitForConnection(connect);
                var bytes = new byte[256];
                int total = 0;
                while (total < bytes.Length)
                {
                    IAsyncResult read = pipe.BeginRead(bytes, total, bytes.Length - total, null, null);
                    if (!read.AsyncWaitHandle.WaitOne((int)Math.Max(0, deadline - clock.ElapsedMilliseconds)))
                    {
                        reason = started ? "not-ready" : "no-start";
                        return false;
                    }
                    int count = pipe.EndRead(read);
                    if (count == 0)
                    {
                        reason = started ? "closed after started" : "closed";
                        return false;
                    }
                    total += count;
                    string received = Encoding.UTF8.GetString(bytes, 0, total);
                    int newline;
                    while ((newline = received.IndexOf('\n')) >= 0)
                    {
                        string line = received.Substring(0, newline);
                        if (line == token)
                        {
                            reason = "acknowledged";
                            return true;
                        }
                        if (line != token + " started")
                        {
                            reason = "wrong-reply";
                            return false;
                        }
                        started = true;
                        deadline = clock.ElapsedMilliseconds + patience;
                        received = received.Substring(newline + 1);
                        byte[] rest = Encoding.UTF8.GetBytes(received);
                        Array.Copy(rest, bytes, rest.Length);
                        total = rest.Length;
                    }
                }
            }
        }
        catch (Exception) { return false; }
        return false;
    }
    internal static void Open(Owner owner)
    {
        bool acknowledged = false;
        string reason = "not-owned";
        var clock = Stopwatch.StartNew();
        try
        {
            acknowledged = owner.IsOwned && owner.TargetExists && LaunchAndWait(delegate(string token)
            {
                Native.StartDetached(owner.Exe, Program.Quote("--user-data-dir=" + owner.Profile) + " " + Program.Quote("--win-e=" + token), true);
            }, 8000, 45000, out reason);
        }
        catch (Exception) { reason = "failed"; }
        Log.Write("request " + (acknowledged ? "acknowledged" : "fell back to File Explorer (" + reason + ")")
            + " after " + clock.ElapsedMilliseconds + " ms");
        if (!acknowledged)
        {
            try { Native.StartDetached(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Windows), "explorer.exe"), "", true); }
            catch (Exception) { /* Windows shell launch itself can fail during shutdown. */ }
        }
    }
}

// OPEN FOLDERS IN PRISM (#393): Windows' default verb for Directory and Drive runs
// `--folder <Prism.exe> <profile> "%1"`. This copy lives OUTSIDE Prism's install folder, so a
// Prism deleted by hand, a crash or a hung start still opens the folder: anything short of
// Prism's acknowledgement opens it in File Explorer. `explorer.exe <path>` takes no shell
// verb (measured 2026-10-15), so the fallback never comes back here.
internal static class FolderOpen
{
    internal static void Explorer(string path)
    {
        Native.StartDetached(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Windows), "explorer.exe"), Program.Quote(path), true);
    }

    // A drive's %1 is `C:\`, and the quoted `"C:\"` reaches argv as `C:"`: CommandLineToArgvW
    // reads `\"` as a literal quote. A path never contains a quote, so a trailing one was
    // that backslash.
    internal static string Normalize(string path)
    {
        return path.EndsWith("\"") ? path.Substring(0, path.Length - 1) + "\\" : path;
    }

    internal static int Run(string executable, string profile, string raw, Action<string> fallback)
    {
        string path = Normalize(raw);
        bool acknowledged = false;
        string reason = "not-a-folder";
        var clock = Stopwatch.StartNew();
        try
        {
            if (Path.IsPathRooted(path) && Directory.Exists(path))
            {
                var owner = new Owner(executable, profile, Program.RunKey);
                Log.Start(owner.Profile);
                reason = "prism-missing";
                if (owner.TargetExists)
                    acknowledged = Launcher.LaunchAndWait(delegate(string token)
                    {
                        Native.StartDetached(owner.Exe, Program.Quote("--user-data-dir=" + owner.Profile) + " "
                            + Program.Quote("--win-e=" + token) + " " + Program.Quote("--browse=" + path), true);
                    }, 8000, 45000, out reason);
            }
        }
        catch (Exception) { reason = "failed"; }
        Log.Write("folder request " + (acknowledged ? "acknowledged" : "fell back to File Explorer (" + reason + ")")
            + " after " + clock.ElapsedMilliseconds + " ms");
        Log.Stop();
        if (!acknowledged)
        {
            try { fallback(path); }
            catch (Exception) { return 1; }
        }
        return 0;
    }
}

// Prism as Windows' folder handler (#393): the default verb of Directory and Drive, per user.
// NEVER `Folder`: that class is Control Panel, This PC and every other shell namespace too.
// `ProgrammaticAccessOnly` keeps the verb out of the menu AND out of File Explorer's own
// double-click, which stays in File Explorer (owner, 2026-10-15); ShellExecute with no verb
// (Run, cmd, other apps) still reaches it (measured the same day).
//
// What was the default before is kept on the verb's key, so turning it off puts back exactly
// that, another file manager included. Nothing lives only in memory.
internal sealed class FolderRegistration
{
    internal const string Verb = "PrismBrowse";
    internal static readonly string[] Classes = { "Directory", "Drive" };
    private readonly string root, copyDir;
    internal FolderRegistration(string classesRoot, string copyDirectory) { root = classesRoot; copyDir = copyDirectory; }
    internal static FolderRegistration Real()
    {
        return new FolderRegistration(@"Software\Classes",
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "PrismFolders"));
    }
    internal string Launcher { get { return Path.Combine(copyDir, "PrismShortcut.exe"); } }
    internal string Command(string exe, string profile)
    {
        return Program.Quote(Launcher) + " --folder " + Program.Quote(Path.GetFullPath(exe)) + " "
            + Program.Quote(Path.GetFullPath(profile)) + " \"%1\"";
    }
    private string ShellKey(string cls) { return root + "\\" + cls + "\\shell"; }

    internal bool IsOn
    {
        get
        {
            foreach (string cls in Classes)
                using (var shell = Registry.CurrentUser.OpenSubKey(ShellKey(cls)))
                    if (shell == null || !(Verb.Equals(shell.GetValue(null) as string))) return false;
            return true;
        }
    }
    internal bool IsCurrent(string exe, string profile)
    {
        if (!IsOn || !File.Exists(Launcher) || new FileInfo(Launcher).Length != new FileInfo(Program.Self).Length) return false;
        foreach (string cls in Classes)
            using (var command = Registry.CurrentUser.OpenSubKey(ShellKey(cls) + "\\" + Verb + "\\command"))
                if (command == null || !(Command(exe, profile).Equals(command.GetValue(null) as string))) return false;
        return true;
    }

    internal void Enable(string exe, string profile)
    {
        if (!File.Exists(exe)) throw new IOException("Prism is missing.");
        CopySelf();
        foreach (string cls in Classes)
        {
            using (var shell = Registry.CurrentUser.CreateSubKey(ShellKey(cls)))
            using (var verb = shell.CreateSubKey(Verb))
            {
                object previous = shell.GetValue(null, null, RegistryValueOptions.DoNotExpandEnvironmentNames);
                // Re-enabling (an upgrade's repair) must not record ITSELF as what came before.
                if (!Verb.Equals(previous as string))
                {
                    if (previous is string) verb.SetValue("PreviousDefault", previous, RegistryValueKind.String);
                    else verb.DeleteValue("PreviousDefault", false);
                }
                verb.SetValue("ProgrammaticAccessOnly", "", RegistryValueKind.String);
                using (var command = verb.CreateSubKey("command"))
                    command.SetValue(null, Command(exe, profile), RegistryValueKind.String);
                // The default goes last: a half-written verb is never the one Windows runs.
                shell.SetValue(null, Verb, RegistryValueKind.String);
            }
        }
    }

    internal void Disable()
    {
        foreach (string cls in Classes)
        {
            using (var shell = Registry.CurrentUser.OpenSubKey(ShellKey(cls), true))
            {
                if (shell == null) continue;
                if (Verb.Equals(shell.GetValue(null) as string))
                {
                    string previous = null;
                    using (var verb = shell.OpenSubKey(Verb)) if (verb != null) previous = verb.GetValue("PreviousDefault") as string;
                    if (previous != null) shell.SetValue(null, previous, RegistryValueKind.String);
                    else shell.DeleteValue("", false);
                }
                // Another app's default is left alone; only Prism's own key goes.
                shell.DeleteSubKeyTree(Verb, false);
            }
        }
        // A request in flight may still be running the copy; it is removed next time.
        try { if (File.Exists(Launcher)) File.Delete(Launcher); } catch (Exception) { }
    }

    // The copy outside the install folder. A running copy cannot be overwritten but can be
    // renamed, so an old one steps aside first.
    private void CopySelf()
    {
        Directory.CreateDirectory(copyDir);
        foreach (string stale in Directory.GetFiles(copyDir, "PrismShortcut.exe.old-*"))
            try { File.Delete(stale); } catch (Exception) { /* still running: next time */ }
        if (File.Exists(Launcher) && Bytes.Same(File.ReadAllBytes(Launcher), File.ReadAllBytes(Program.Self))) return;
        if (File.Exists(Launcher)) File.Move(Launcher, Launcher + ".old-" + Guid.NewGuid().ToString("N"));
        File.Copy(Program.Self, Launcher);
    }
}

internal static class Bytes
{
    internal static bool Same(byte[] a, byte[] b)
    {
        if (a.Length != b.Length) return false;
        for (int i = 0; i < a.Length; i++) if (a[i] != b[i]) return false;
        return true;
    }
}

internal sealed class ShortcutPresses
{
    private bool captured;
    private int pending;
    internal bool ConsumeCaptured(int key, bool injected, bool up)
    {
        if (injected || key != 0x45 || !captured) return false;
        if (up) captured = false;
        return true;
    }
    internal void Accept()
    {
        captured = true;
        Interlocked.Increment(ref pending);
    }
    internal int TakePending() { return Interlocked.Exchange(ref pending, 0); }
}

internal sealed class Watcher : IDisposable
{
    private readonly Owner owner;
    private readonly Native.HookProc callback;
    private IntPtr hook;
    private volatile bool active;
    // Set by the checker thread, read by the hook thread's timer (#350).
    private volatile bool keep = true;
    private readonly ShortcutPresses presses = new ShortcutPresses();
    private readonly AutoResetEvent request = new AutoResetEvent(false);
    private Thread worker;
    private Watcher(Owner target) { owner = target; callback = HandleKey; }

    internal static int Run(Owner owner)
    {
        bool created;
        using (var singleton = new Mutex(true, owner.Identity + ".Watcher", out created))
        {
            if (!created) return 0;
            using (var stop = new EventWaitHandle(false, EventResetMode.ManualReset, owner.Identity + ".Stop"))
            using (var ready = new EventWaitHandle(false, EventResetMode.ManualReset, owner.Identity + ".Ready"))
            using (var watcher = new Watcher(owner))
            using (var timer = new System.Windows.Forms.Timer())
            {
                if (!owner.ShouldWatch()) return 0;
                stop.Reset();
                Log.Start(owner.Profile);
                watcher.hook = Native.SetWindowsHookEx(13, watcher.callback, Native.GetModuleHandle(null), 0);
                if (watcher.hook == IntPtr.Zero) throw new IOException("Windows refused the shortcut hook.");
                watcher.active = true;
                // Created before readiness, so the keyboard hook only signals a waiting worker.
                // Foreground lifetime allows an outstanding request to fall back after disable.
                watcher.worker = new Thread(watcher.Work);
                watcher.worker.Start();
                // THE LIFECYCLE CHECK IS OFF THE HOOK'S THREAD (#350). It reads the registry
                // and checks files every 500 ms; on this thread a slow read held the hook past
                // Windows' LowLevelHooksTimeout, so Win+E reached File Explorer, and enough of
                // those make Windows remove the hook without a word.
                var checker = new Thread(delegate()
                {
                    while (watcher.keep)
                    {
                        bool still = false;
                        try { still = !stop.WaitOne(500) && owner.ShouldWatch(); } catch (Exception) { }
                        if (!still) watcher.keep = false;
                    }
                });
                checker.IsBackground = true;
                checker.Start();
                int ticks = 0;
                timer.Interval = 500;
                timer.Tick += delegate
                {
                    if (!watcher.keep)
                    {
                        watcher.active = false;
                        ready.Reset();
                        Application.ExitThread();
                        return;
                    }
                    // RE-ARMED EVERY 15 SECONDS (#350): Windows removes a low-level hook that
                    // timed out without telling its owner, which left Win+E with File Explorer
                    // until the next sign-in. A fresh hook goes in before the old one comes out.
                    if (++ticks % 30 == 0) watcher.Rearm();
                };
                timer.Start();
                ready.Set();
                Log.Write("watching Win+E");
                try { Application.Run(); }
                finally
                {
                    ready.Reset();
                    watcher.active = false;
                    watcher.keep = false;
                    checker.Join(2000);
                    Log.Write("stopped watching Win+E");
                }
            }
            singleton.ReleaseMutex();
        }
        return 0;
    }

    internal static bool Matches(int key, bool down, bool injected, bool windows, bool control, bool alt, bool shift)
    {
        return key == 0x45 && down && !injected && windows && !control && !alt && !shift;
    }
    private IntPtr HandleKey(int code, IntPtr message, IntPtr data)
    {
        if (code >= 0)
        {
            var key = (Native.Keyboard)Marshal.PtrToStructure(data, typeof(Native.Keyboard));
            bool down = message.ToInt32() == 0x100 || message.ToInt32() == 0x104;
            bool up = message.ToInt32() == 0x101 || message.ToInt32() == 0x105;
            if (presses.ConsumeCaptured((int)key.vkCode, (key.flags & 0x10) != 0, up))
            {
                return new IntPtr(1);
            }
            if (active && Matches((int)key.vkCode, down, (key.flags & 0x10) != 0,
                Held(0x5B) || Held(0x5C), Held(0x11), Held(0x12), Held(0x10)))
            {
                // A press that reached the hook late may already have gone on to File
                // Explorer: Windows does not wait past LowLevelHooksTimeout (#350).
                int late = unchecked(Environment.TickCount - (int)key.time);
                if (late > 200) Log.Write("Win+E reached the hook " + late + " ms late");
                // Mark the Windows chord as used so its release does not open Start.
                // Use an unassigned non-modifier key, never Ctrl/Alt/Shift: modifier
                // masking can activate another app's Win+Ctrl dictation shortcut.
                if (!Native.MaskWindowsRelease()) return Native.CallNextHookEx(hook, code, message, data);
                presses.Accept();
                request.Set();
                return new IntPtr(1);
            }
        }
        return Native.CallNextHookEx(hook, code, message, data);
    }
    private void Rearm()
    {
        IntPtr fresh = Native.SetWindowsHookEx(13, callback, Native.GetModuleHandle(null), 0);
        if (fresh == IntPtr.Zero)
        {
            Log.Write("Windows refused to re-arm the hook");
            return;
        }
        IntPtr old = hook;
        hook = fresh;
        Native.UnhookWindowsHookEx(old);
    }
    private static bool Held(int key) { return (Native.GetAsyncKeyState(key) & 0x8000) != 0; }
    private void Work()
    {
        var launches = new List<Thread>();
        try
        {
            while (true)
            {
                request.WaitOne();
                launches.RemoveAll(delegate(Thread launch) { return !launch.IsAlive; });
                Dispatch(presses.TakePending(), delegate { Launcher.Open(owner); }, launches);
                if (!active) return;
            }
        }
        finally
        {
            // Accepted presses each finish their own ACK/fallback, including on disable.
            foreach (Thread launch in launches) launch.Join();
            request.Dispose();
        }
    }
    internal static void Dispatch(int count, Action launch, List<Thread> launches)
    {
        for (int index = 0; index < count; index++)
        {
            // Only the dispatcher creates threads. Slow ACKs never drop another press.
            var thread = new Thread(delegate() { launch(); });
            thread.Start();
            launches.Add(thread);
        }
    }
    public void Dispose()
    {
        active = false;
        if (hook != IntPtr.Zero) { Native.UnhookWindowsHookEx(hook); hook = IntPtr.Zero; }
        if (worker != null)
        {
            try { request.Set(); }
            catch (ObjectDisposedException) { /* The pending worker already completed shutdown. */ }
            worker.Join();
        }
        else request.Dispose();
        GC.KeepAlive(callback);
    }
}

// THE HELPER'S OWN LOG (#350): <profile>\logs\win-e.log, what the watcher did and how each
// request ended, never which keys were typed. Written on a thread of its own, so the hook's
// thread never waits on the disk. 256 KB, then one .old.
internal static class Log
{
    private const long Cap = 256 * 1024;
    private static BlockingCollection<string> lines;
    private static Thread writer;
    internal static void Start(string profile)
    {
        if (lines != null) return;
        string file = Path.Combine(profile, "logs", "win-e.log");
        lines = new BlockingCollection<string>(256);
        writer = new Thread(delegate()
        {
            foreach (string line in lines.GetConsumingEnumerable())
            {
                try
                {
                    Directory.CreateDirectory(Path.GetDirectoryName(file));
                    var info = new FileInfo(file);
                    if (info.Exists && info.Length > Cap)
                    {
                        string old = file + ".old";
                        if (File.Exists(old)) File.Delete(old);
                        File.Move(file, old);
                    }
                    File.AppendAllText(file, line + Environment.NewLine);
                }
                catch (Exception) { /* A log that cannot be written is not worth the shortcut. */ }
            }
        });
        writer.IsBackground = true;
        writer.Start();
    }
    /** A one-shot process (`--folder`) exits right after its request: let the lines land. */
    internal static void Stop()
    {
        if (lines == null) return;
        lines.CompleteAdding();
        writer.Join(1000);
    }
    internal static void Write(string message)
    {
        var queue = lines;
        if (queue != null && !queue.IsAddingCompleted)
            queue.TryAdd(DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss.fff") + " pid " + Process.GetCurrentProcess().Id + " " + message);
    }
}

internal static class Native
{
    internal delegate IntPtr HookProc(int code, IntPtr message, IntPtr data);
    [StructLayout(LayoutKind.Sequential)] internal struct Keyboard { internal uint vkCode, scanCode, flags, time; internal UIntPtr extra; }
    [StructLayout(LayoutKind.Sequential)] internal struct KeyInput { internal ushort vk, scan; internal uint flags, time; internal UIntPtr extra; }
    [StructLayout(LayoutKind.Explicit, Size = 32)] internal struct InputUnion { [FieldOffset(0)] internal KeyInput keyboard; }
    [StructLayout(LayoutKind.Sequential)] internal struct Input { internal uint type; internal InputUnion data; }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] private struct StartupInfo
    {
        internal uint size;
        internal string reserved, desktop, title;
        internal uint x, y, xSize, ySize, xChars, yChars, fill, flags;
        internal ushort show, reservedSize;
        internal IntPtr reservedPointer, stdin, stdout, stderr;
    }
    [StructLayout(LayoutKind.Sequential)] private struct ProcessInfo
    {
        internal IntPtr process, thread;
        internal uint processId, threadId;
    }
    internal static void StartDetached(string executable, string args, bool visible)
    {
        var startup = new StartupInfo { size = (uint)Marshal.SizeOf(typeof(StartupInfo)), flags = 1, show = (ushort)(visible ? 1 : 0) };
        ProcessInfo process;
        if (!CreateProcess(executable, new StringBuilder(Program.Quote(executable) + " " + args), IntPtr.Zero, IntPtr.Zero,
            false, 0x08000000, IntPtr.Zero, Path.GetDirectoryName(executable), ref startup, out process))
            throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
        CloseHandle(process.thread);
        CloseHandle(process.process);
    }
    internal static Input[] MenuMaskInputs()
    {
        var events = new Input[2];
        events[0].type = events[1].type = 1;
        // Microsoft's virtual-key table lists 0xE8 as unassigned. It marks the
        // Windows chord as used without synthesizing another application's modifiers.
        events[0].data.keyboard.vk = events[1].data.keyboard.vk = 0xE8;
        events[1].data.keyboard.flags = 2;
        return events;
    }
    internal static bool MaskWindowsRelease()
    {
        var events = MenuMaskInputs();
        uint sent = SendInput(2, events, Marshal.SizeOf(typeof(Input)));
        if (sent == 1) SendInput(1, new Input[] { events[1] }, Marshal.SizeOf(typeof(Input)));
        return sent == 2;
    }
    [DllImport("user32.dll", SetLastError = true)] internal static extern IntPtr SetWindowsHookEx(int id, HookProc callback, IntPtr module, uint thread);
    [DllImport("user32.dll")] internal static extern bool UnhookWindowsHookEx(IntPtr hook);
    [DllImport("user32.dll")] internal static extern IntPtr CallNextHookEx(IntPtr hook, int code, IntPtr message, IntPtr data);
    [DllImport("user32.dll")] internal static extern short GetAsyncKeyState(int key);
    [DllImport("user32.dll", SetLastError = true)] private static extern uint SendInput(uint count, Input[] inputs, int size);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] internal static extern IntPtr GetModuleHandle(string name);
    [DllImport("shell32.dll", CharSet = CharSet.Unicode, SetLastError = true)] internal static extern IntPtr CommandLineToArgvW(string command, out int count);
    [DllImport("kernel32.dll")] internal static extern IntPtr LocalFree(IntPtr pointer);
    [DllImport("kernel32.dll", EntryPoint = "CreateProcessW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CreateProcess(string application, StringBuilder command, IntPtr processAttributes,
        IntPtr threadAttributes, bool inheritHandles, uint flags, IntPtr environment, string directory,
        ref StartupInfo startup, out ProcessInfo process);
    [DllImport("kernel32.dll")] private static extern bool CloseHandle(IntPtr handle);
}

internal static class SelfTests
{
    private static int assertions;
    private static void Check(bool condition, string description)
    {
        if (!condition) throw new Exception("Self-test failed: " + description);
        assertions++;
        Console.WriteLine("PASS " + description);
    }
    internal static int Run()
    {
        string key = @"Software\Prism\ShortcutTests\" + Guid.NewGuid().ToString("N");
        string directory = Path.Combine(Path.GetTempPath(), "prism-shortcut-test-" + Guid.NewGuid().ToString("N"));
        string priorRun = Program.ReadValue(Program.RunKey);
        try
        {
            Directory.CreateDirectory(Path.Combine(directory, "resources"));
            string executable = Path.Combine(directory, "Prism.exe");
            File.WriteAllText(executable, "fixture");
            File.WriteAllText(Path.Combine(directory, "resources", "app.asar"), "fixture");
            var owner = new Owner(executable, Path.Combine(directory, "profile with spaces"), key);
            Check(!owner.IsOwned && !owner.HasConflict, "default disabled");
            owner.WriteOwned();
            Check(owner.IsOwned && !owner.IsRunning, "isolated registration ownership");
            string[] parsed = Program.SplitCommand(owner.Command);
            Check(parsed.Length == 4 && parsed[2] == executable && parsed[3] == owner.Profile, "literal command path roundtrip");
            string weird = "C:\\folder with spaces\\";
            Check(Program.SplitCommand("helper.exe " + Program.Quote(weird))[1] == weird, "trailing backslash quoted safely");
            var other = new Owner(executable, Path.Combine(directory, "other profile"), key);
            bool refused = false;
            try { other.WriteOwned(); } catch (IOException) { refused = true; }
            Check(refused && other.HasConflict && owner.IsOwned, "different owner cannot replace registration");
            other.Disable();
            Check(owner.IsOwned, "different owner cannot remove registration");
            using (var stop = new EventWaitHandle(false, EventResetMode.ManualReset, owner.Identity + ".Stop"))
            {
                owner.Disable();
                Check(!owner.IsOwned && stop.WaitOne(0), "disable removes owned entry and signals watcher");
            }
            using (var registry = Registry.CurrentUser.OpenSubKey(key, true)) registry.SetValue(Program.ValueName, 1, RegistryValueKind.DWord);
            refused = false;
            try { owner.WriteOwned(); } catch (IOException) { refused = true; }
            Check(refused && owner.HasConflict, "malformed foreign registration is never overwritten");
            using (var registry = Registry.CurrentUser.OpenSubKey(key, true)) registry.DeleteValue(Program.ValueName);
            owner.WriteOwned();
            using (var stop = new EventWaitHandle(false, EventResetMode.ManualReset, owner.Identity + ".Stop"))
            {
                owner.Stop();
                Check(owner.IsOwned && stop.WaitOne(0), "upgrade pause signals watcher while preserving opt-in");
            }
            File.Delete(Path.Combine(directory, "resources", "app.asar"));
            Check(!owner.ShouldWatch() && !owner.IsOwned, "missing resources revoke hook permission and remove stale entry");
            File.WriteAllText(Path.Combine(directory, "resources", "app.asar"), "fixture");
            owner.WriteOwned();
            File.Delete(executable);
            Check(!owner.ShouldWatch() && !owner.IsOwned, "deleted executable restores native shortcut ownership");
            Check(!Launcher.LaunchAndWait(delegate { throw new IOException("launch fixture failure"); }, 100), "failed launch requests Explorer fallback");
            Check(!Launcher.LaunchAndWait(delegate { }, 100), "missing acknowledgement requests Explorer fallback");
            Check(PipeResponse(true), "renderer acknowledgement accepted over real named pipe");
            Check(!PipeResponse(false), "wrong acknowledgement requests Explorer fallback");
            Check(PipeScript(new[] { " started", "" }, 300, 5000, 600),
                "a started Prism is waited for past the first timeout");
            Check(!PipeScript(new[] { " started" }, 300, 5000, 0),
                "a started Prism whose pipe closes falls back at once");
            Check(!PipeScript(new[] { " started", "" }, 300, 400, 900),
                "a started Prism that never gets ready falls back after the patience");
            string why;
            Check(!Launcher.LaunchAndWait(delegate { }, 100, 1000, out why) && why == "no-connection",
                "the log names a Prism that never connected (" + why + ")");
            Check(PipeReason(new[] { " started" }, out why) == false && why == "closed after started",
                "the log names a pipe closed after started, the #350 case (" + why + ")");
            Check(PipeReason(new[] { " started", "" }, out why) && why == "acknowledged",
                "the log names an acknowledged request (" + why + ")");
            Check(Watcher.Matches(0x45, true, false, true, false, false, false), "plain Win+E matches");
            Check(!Watcher.Matches(0x45, true, false, true, true, false, false), "Ctrl+Win+E passes through");
            Check(!Watcher.Matches(0x45, true, false, true, false, true, false), "Alt+Win+E passes through");
            Check(!Watcher.Matches(0x45, true, false, true, false, false, true), "Shift+Win+E passes through");
            Check(!Watcher.Matches(0x45, false, false, true, false, false, false), "uncaptured key release passes through");
            Check(!Watcher.Matches(0x45, true, true, true, false, false, false), "injected keys pass through");
            Check(!Watcher.Matches(0x41, true, false, true, false, false, false), "other Windows shortcuts pass through");
            var mask = Native.MenuMaskInputs();
            Check(mask.Length == 2 && mask[0].type == 1 && mask[1].type == 1 &&
                mask[0].data.keyboard.vk == 0xE8 && mask[1].data.keyboard.vk == 0xE8 &&
                mask[0].data.keyboard.flags == 0 && mask[1].data.keyboard.flags == 2,
                "Start-menu mask is one unassigned key down/up pair");
            bool modifiers = false;
            foreach (var input in mask)
            {
                ushort vk = input.data.keyboard.vk;
                modifiers |= (vk >= 0x10 && vk <= 0x12) || (vk >= 0xA0 && vk <= 0xA5);
            }
            Check(!modifiers, "Start-menu mask never injects Ctrl, Alt or Shift");
            var presses = new ShortcutPresses();
            presses.Accept();
            Check(presses.ConsumeCaptured(0x45, false, false) && presses.ConsumeCaptured(0x45, false, false)
                && presses.TakePending() == 1, "holding E queues one launch despite auto-repeat");
            Check(!presses.ConsumeCaptured(0x45, true, true) && presses.ConsumeCaptured(0x45, false, false),
                "injected key-up does not release the physical-key latch");
            Check(presses.ConsumeCaptured(0x45, false, true) && !presses.ConsumeCaptured(0x45, false, false),
                "physical E release allows a new Win+E press");
            presses.Accept();
            presses.ConsumeCaptured(0x45, false, true);
            presses.Accept();
            Check(presses.TakePending() == 2, "distinct presses are retained while earlier ACKs are pending");
            var dispatches = new List<Thread>();
            using (var started = new CountdownEvent(2))
            using (var release = new ManualResetEvent(false))
            {
                bool concurrent;
                try
                {
                    Watcher.Dispatch(2, delegate { started.Signal(); release.WaitOne(); }, dispatches);
                    concurrent = started.Wait(2000);
                }
                finally
                {
                    release.Set();
                    foreach (Thread dispatch in dispatches) dispatch.Join();
                }
                Check(concurrent, "separate presses launch concurrently without waiting for another ACK");
            }
            Check(Program.ReadValue(Program.RunKey) == priorRun, "real Windows Run entry remains unchanged");
            var childClock = Stopwatch.StartNew();
            using (var child = Process.Start(new ProcessStartInfo(Program.Self, "--self-test-spawn-child")
            {
                UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true
            }))
            {
                string stdout = child.StandardOutput.ReadToEnd();
                child.WaitForExit();
                Check(child.ExitCode == 0 && stdout.Contains("child started") && childClock.ElapsedMilliseconds < 1500,
                    "detached watcher does not keep CLI stdout pipes open (" + childClock.ElapsedMilliseconds + " ms)");
            }
            Check(FolderOpen.Normalize("C:\"") == "C:\\" && FolderOpen.Normalize("C:\\x y") == "C:\\x y",
                "a drive root's swallowed backslash is put back");
            Check(Program.SplitCommand("h.exe " + Program.Quote("--browse=C:\\"))[1] == "--browse=C:\\",
                "a drive root survives the handoff to Prism");
            var opened = new List<string>();
            string missingPrism = Path.Combine(directory, "gone", "Prism.exe");
            Check(FolderOpen.Run(missingPrism, Path.Combine(directory, "profile"), directory + "\"", opened.Add) == 0
                && opened.Count == 1 && opened[0] == directory + "\\",
                "a missing Prism opens the folder in File Explorer");
            opened.Clear();
            string nowhere = Path.Combine(directory, "no such folder");
            FolderOpen.Run(executable, Path.Combine(directory, "profile"), nowhere, opened.Add);
            Check(opened.Count == 1 && opened[0] == nowhere, "a path that is not a folder goes to File Explorer untouched");
            File.WriteAllText(executable, "fixture");
            FolderSelfTests(key + @"\Classes", Path.Combine(directory, "copy"), executable, Path.Combine(directory, "profile"));
            Console.WriteLine(assertions + " native assertions passed. No real keyboard hook or Explorer launch was performed.");
            return 0;
        }
        finally
        {
            Registry.CurrentUser.DeleteSubKeyTree(key, false);
            if (Directory.Exists(directory)) Directory.Delete(directory, true);
        }
    }
    private static string Default(string root, string cls)
    {
        using (var shell = Registry.CurrentUser.OpenSubKey(root + "\\" + cls + "\\shell"))
            return shell == null ? null : shell.GetValue(null) as string;
    }

    private static bool HasVerb(string root, string cls)
    {
        using (var verb = Registry.CurrentUser.OpenSubKey(root + "\\" + cls + "\\shell\\" + FolderRegistration.Verb)) return verb != null;
    }

    private static void FolderSelfTests(string root, string copy, string executable, string profile)
    {
        string realDirectory = Default(@"Software\Classes", "Directory"), realDrive = Default(@"Software\Classes", "Drive");
        var folders = new FolderRegistration(root, copy);
        Check(!folders.IsOn && !folders.IsCurrent(executable, profile), "folders start off");
        folders.Enable(executable, profile);
        Check(folders.IsOn && folders.IsCurrent(executable, profile) && File.Exists(folders.Launcher),
            "on: Directory and Drive default to Prism, the launcher is copied out");
        using (var verb = Registry.CurrentUser.OpenSubKey(root + @"\Directory\shell\" + FolderRegistration.Verb))
            Check(verb.GetValue("ProgrammaticAccessOnly") is string && verb.GetValue("PreviousDefault") == null,
                "the verb stays out of the menu and remembers there was no default");
        string[] command = Program.SplitCommand(folders.Command(executable, profile).Replace("%1", "C:\\x"));
        Check(command.Length == 5 && command[1] == "--folder" && command[2] == executable && command[4] == "C:\\x",
            "the command hands the launcher Prism, the profile and the folder");
        Check(!folders.IsCurrent(Path.Combine(Path.GetDirectoryName(executable), "Other.exe"), profile),
            "another Prism is not current");
        folders.Disable();
        Check(!folders.IsOn && Default(root, "Directory") == null && Default(root, "Drive") == null
            && !HasVerb(root, "Directory") && !File.Exists(folders.Launcher),
            "off removes the default, the verb and the launcher");
        using (var shell = Registry.CurrentUser.CreateSubKey(root + @"\Directory\shell")) shell.SetValue(null, "OpusVerb");
        folders.Enable(executable, profile);
        folders.Enable(executable, profile);
        folders.Disable();
        Check(Default(root, "Directory") == "OpusVerb" && Default(root, "Drive") == null,
            "off puts back another file manager's default, even after a repeated on");
        folders.Enable(executable, profile);
        using (var shell = Registry.CurrentUser.CreateSubKey(root + @"\Drive\shell")) shell.SetValue(null, "LaterApp");
        folders.Disable();
        Check(Default(root, "Drive") == "LaterApp" && !HasVerb(root, "Drive") && Default(root, "Directory") == "OpusVerb",
            "a default another app took since is never touched");
        bool refused = false;
        try { folders.Enable(Path.Combine(copy, "missing", "Prism.exe"), profile); } catch (IOException) { refused = true; }
        Check(refused && !folders.IsOn, "a missing Prism is never registered");
        Check(Default(@"Software\Classes", "Directory") == realDirectory && Default(@"Software\Classes", "Drive") == realDrive,
            "the real folder handler remains unchanged");
    }

    /** Lines suffixed to the token ("" is the ready line), `pause` ms before the last. */
    private static bool PipeScript(string[] lines, int timeout, int patience, int pause)
    {
        Thread client = null;
        var clock = Stopwatch.StartNew();
        bool result = Launcher.LaunchAndWait(delegate(string token)
        {
            client = new Thread(delegate()
            {
                try
                {
                    using (var pipe = new NamedPipeClientStream(".", "PrismWinE." + token, PipeDirection.Out))
                    {
                        pipe.Connect(1000);
                        for (int i = 0; i < lines.Length; i++)
                        {
                            if (i == lines.Length - 1 && i > 0) Thread.Sleep(pause);
                            byte[] bytes = Encoding.UTF8.GetBytes(token + lines[i] + "\n");
                            pipe.Write(bytes, 0, bytes.Length);
                            pipe.Flush();
                        }
                        if (lines.Length == 1) Thread.Sleep(50);
                    }
                }
                catch (Exception) { /* the server gave up first */ }
            });
            client.Start();
        }, timeout, patience);
        if (client != null) client.Join(patience + pause + 1000);
        return result && clock.ElapsedMilliseconds < patience + pause + 1000;
    }

    /** The reason LaunchAndWait gives for a client writing `lines`, then closing. */
    private static bool PipeReason(string[] lines, out string reason)
    {
        Thread client = null;
        bool result = Launcher.LaunchAndWait(delegate(string token)
        {
            client = new Thread(delegate()
            {
                try
                {
                    using (var pipe = new NamedPipeClientStream(".", "PrismWinE." + token, PipeDirection.Out))
                    {
                        pipe.Connect(1000);
                        foreach (string line in lines)
                        {
                            byte[] bytes = Encoding.UTF8.GetBytes(token + line + "\n");
                            pipe.Write(bytes, 0, bytes.Length);
                            pipe.Flush();
                        }
                        Thread.Sleep(50);
                    }
                }
                catch (Exception) { /* the server gave up first */ }
            });
            client.Start();
        }, 2000, 2000, out reason);
        if (client != null) client.Join(3000);
        return result;
    }

    private static bool PipeResponse(bool valid)
    {
        Thread client = null;
        bool result = Launcher.LaunchAndWait(delegate(string token)
        {
            client = new Thread(delegate()
            {
                using (var pipe = new NamedPipeClientStream(".", "PrismWinE." + token, PipeDirection.Out))
                {
                    pipe.Connect(1000);
                    byte[] bytes = Encoding.UTF8.GetBytes((valid ? token : "wrong-token") + "\n");
                    pipe.Write(bytes, 0, bytes.Length);
                }
            });
            client.Start();
        }, 2000);
        if (client != null) client.Join(2500);
        return result;
    }
}
