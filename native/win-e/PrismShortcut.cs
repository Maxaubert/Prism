// Optional, per-user Win+E interception. Windows Explorer registrations are never changed.
using System;
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
    internal static bool LaunchAndWait(Action<string> launch, int timeout)
    {
        string token = Guid.NewGuid().ToString("D");
        var clock = Stopwatch.StartNew();
        try
        {
            using (var pipe = new NamedPipeServerStream("PrismWinE." + token, PipeDirection.In, 1, PipeTransmissionMode.Byte, PipeOptions.Asynchronous))
            {
                IAsyncResult connect = pipe.BeginWaitForConnection(null, null);
                launch(token);
                if (!connect.AsyncWaitHandle.WaitOne(Math.Max(0, timeout - (int)clock.ElapsedMilliseconds))) return false;
                pipe.EndWaitForConnection(connect);
                var bytes = new byte[64];
                int total = 0;
                while (total < bytes.Length)
                {
                    IAsyncResult read = pipe.BeginRead(bytes, total, bytes.Length - total, null, null);
                    if (!read.AsyncWaitHandle.WaitOne(Math.Max(0, timeout - (int)clock.ElapsedMilliseconds))) return false;
                    int count = pipe.EndRead(read);
                    if (count == 0) return false;
                    total += count;
                    string received = Encoding.UTF8.GetString(bytes, 0, total);
                    if (received.IndexOf('\n') >= 0) return received == token + "\n";
                }
            }
        }
        catch (Exception) { return false; }
        return false;
    }
    internal static void Open(Owner owner)
    {
        bool acknowledged = false;
        try
        {
            acknowledged = owner.IsOwned && owner.TargetExists && LaunchAndWait(delegate(string token)
            {
                Native.StartDetached(owner.Exe, Program.Quote("--user-data-dir=" + owner.Profile) + " " + Program.Quote("--win-e=" + token), true);
            }, 8000);
        }
        catch (Exception) { }
        if (!acknowledged)
        {
            try { Native.StartDetached(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Windows), "explorer.exe"), "", true); }
            catch (Exception) { /* Windows shell launch itself can fail during shutdown. */ }
        }
    }
}

internal sealed class Watcher : IDisposable
{
    private readonly Owner owner;
    private readonly Native.HookProc callback;
    private IntPtr hook;
    private volatile bool active;
    private bool capturedE;
    private int pending;
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
                watcher.hook = Native.SetWindowsHookEx(13, watcher.callback, Native.GetModuleHandle(null), 0);
                if (watcher.hook == IntPtr.Zero) throw new IOException("Windows refused the shortcut hook.");
                watcher.active = true;
                // Created before readiness, so the keyboard hook only signals a waiting worker.
                // Foreground lifetime allows an outstanding request to fall back after disable.
                watcher.worker = new Thread(watcher.Work);
                watcher.worker.Start();
                timer.Interval = 500;
                timer.Tick += delegate
                {
                    bool keep = false;
                    try { keep = !stop.WaitOne(0) && owner.ShouldWatch(); } catch (Exception) { }
                    if (!keep)
                    {
                        watcher.active = false;
                        ready.Reset();
                        Application.ExitThread();
                    }
                };
                timer.Start();
                ready.Set();
                try { Application.Run(); }
                finally { ready.Reset(); watcher.active = false; }
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
            if ((key.flags & 0x10) == 0 && key.vkCode == 0x45 && capturedE)
            {
                if (up) capturedE = false;
                return new IntPtr(1);
            }
            if (active && Matches((int)key.vkCode, down, (key.flags & 0x10) != 0,
                Held(0x5B) || Held(0x5C), Held(0x11), Held(0x12), Held(0x10)))
            {
                // Mark the Windows chord as used so its release does not open Start.
                // Only these injected modifier events are synthesized, never user input.
                if (!Native.MaskWindowsRelease()) return Native.CallNextHookEx(hook, code, message, data);
                capturedE = true;
                if (Interlocked.CompareExchange(ref pending, 1, 0) == 0)
                {
                    request.Set();
                }
                return new IntPtr(1);
            }
        }
        return Native.CallNextHookEx(hook, code, message, data);
    }
    private static bool Held(int key) { return (Native.GetAsyncKeyState(key) & 0x8000) != 0; }
    private void Work()
    {
        try
        {
            while (true)
            {
                request.WaitOne();
                if (Interlocked.CompareExchange(ref pending, 0, 0) == 1)
                {
                    try { Launcher.Open(owner); }
                    finally { Interlocked.Exchange(ref pending, 0); }
                }
                if (!active) return;
            }
        }
        finally { request.Dispose(); }
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

internal static class Native
{
    internal delegate IntPtr HookProc(int code, IntPtr message, IntPtr data);
    [StructLayout(LayoutKind.Sequential)] internal struct Keyboard { internal uint vkCode, scanCode, flags, time; internal UIntPtr extra; }
    [StructLayout(LayoutKind.Sequential)] private struct KeyInput { internal ushort vk, scan; internal uint flags, time; internal UIntPtr extra; }
    [StructLayout(LayoutKind.Explicit, Size = 32)] private struct InputUnion { [FieldOffset(0)] internal KeyInput keyboard; }
    [StructLayout(LayoutKind.Sequential)] private struct Input { internal uint type; internal InputUnion data; }
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
    internal static bool MaskWindowsRelease()
    {
        var events = new Input[2];
        events[0].type = events[1].type = 1;
        events[0].data.keyboard.vk = events[1].data.keyboard.vk = 0x11;
        events[1].data.keyboard.flags = 2;
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
            Check(Watcher.Matches(0x45, true, false, true, false, false, false), "plain Win+E matches");
            Check(!Watcher.Matches(0x45, true, false, true, true, false, false), "Ctrl+Win+E passes through");
            Check(!Watcher.Matches(0x45, true, false, true, false, true, false), "Alt+Win+E passes through");
            Check(!Watcher.Matches(0x45, true, false, true, false, false, true), "Shift+Win+E passes through");
            Check(!Watcher.Matches(0x45, false, false, true, false, false, false), "uncaptured key release passes through");
            Check(!Watcher.Matches(0x45, true, true, true, false, false, false), "injected keys pass through");
            Check(!Watcher.Matches(0x41, true, false, true, false, false, false), "other Windows shortcuts pass through");
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
            Console.WriteLine(assertions + " native assertions passed. No real keyboard hook or Explorer launch was performed.");
            return 0;
        }
        finally
        {
            Registry.CurrentUser.DeleteSubKeyTree(key, false);
            if (Directory.Exists(directory)) Directory.Delete(directory, true);
        }
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
