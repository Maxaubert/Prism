# THE RESIDENT PARAKEET HOST (owner, 2026-10-17: "It needs to be ready at all
# times"; the startup is "the important bit"). parakeet-cli loads the model for
# every pass: MEASURED on the owner's RTX 5090, 0.72 to 0.86 s a pass whatever
# the clip's length, nearly all of it start-up. This keeps ONE model loaded in
# a long-lived Windows PowerShell (the app's helper pattern, no new binary) and
# calls the engine's own parakeet.dll for each pass: 24 ms (1 s clip) to 170 ms
# (60 s clip) on the GPU, the text identical to parakeet-cli's, MEASURED.
# Report: research/prism-terminal/2026-10-17-dictation-performance.md.
#
# args:   <engine folder> <model> <gpu 1|0> <threads> [<cache folder>]
# stdin:  "pass <n>" + LF, then n bytes of a 16 kHz mono PCM16 WAV; "quit" ends it.
# stdout: "ready" once the model is loaded; per pass "ok <base64 of the UTF-8
#         text>" or "err <why>". Nothing else is ever written there.
#
# The C# is compiled ONCE into <cache folder> (keyed by its own hash) and
# loaded from there afterwards, so a start pays no compiler.
param([string]$dir, [string]$model, [int]$gpu = 1, [int]$threads = 4, [string]$cache = '')
$ErrorActionPreference = 'Stop'
$src = @'
using System;
using System.IO;
using System.Text;
using System.Runtime.InteropServices;
public static class PTParakeetHost {
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern IntPtr LoadLibraryW(string path);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool SetDllDirectoryW(string path);
  [DllImport("ggml.dll", CallingConvention = CallingConvention.Cdecl)] static extern void ggml_backend_load_all();
  [StructLayout(LayoutKind.Sequential)] public struct CtxParams { [MarshalAs(UnmanagedType.I1)] public bool use_gpu; public int gpu_device; }
  // parakeet.h's parakeet_full_params, field for field (passed BY VALUE).
  [StructLayout(LayoutKind.Sequential)] public struct FullParams {
    public int strategy; public int n_threads; public int offset_ms; public int duration_ms;
    [MarshalAs(UnmanagedType.I1)] public bool no_context; public int audio_ctx;
    public IntPtr seg_cb, seg_ud, tok_cb, tok_ud, prog_cb, prog_ud, enc_cb, enc_ud, abort_cb, abort_ud;
  }
  [DllImport("parakeet.dll", CallingConvention = CallingConvention.Cdecl)] static extern IntPtr parakeet_init_from_file_with_params([MarshalAs(UnmanagedType.LPStr)] string path, CtxParams p);
  [DllImport("parakeet.dll", CallingConvention = CallingConvention.Cdecl)] static extern IntPtr parakeet_full_default_params_by_ref(int strategy);
  [DllImport("parakeet.dll", CallingConvention = CallingConvention.Cdecl)] static extern void parakeet_free_params(IntPtr p);
  [DllImport("parakeet.dll", CallingConvention = CallingConvention.Cdecl)] static extern int parakeet_full(IntPtr ctx, FullParams p, float[] samples, int n);
  [DllImport("parakeet.dll", CallingConvention = CallingConvention.Cdecl)] static extern int parakeet_full_n_segments(IntPtr ctx);
  [DllImport("parakeet.dll", CallingConvention = CallingConvention.Cdecl)] static extern IntPtr parakeet_full_get_segment_text(IntPtr ctx, int i);
  [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate void LogCb(int level, IntPtr text, IntPtr ud);
  [DllImport("parakeet.dll", CallingConvention = CallingConvention.Cdecl)] static extern void parakeet_log_set(LogCb cb, IntPtr ud);
  static readonly LogCb quiet = (l, t, u) => { };

  static string Utf8(IntPtr p) {
    if (p == IntPtr.Zero) return "";
    int n = 0; while (Marshal.ReadByte(p, n) != 0) n++;
    var b = new byte[n]; Marshal.Copy(p, b, 0, n); return Encoding.UTF8.GetString(b);
  }
  // The app's own WAV (16-bit mono, 16 kHz): the samples of its "data" chunk.
  static float[] Pcm(byte[] wav) {
    int i = 12;
    while (i + 8 <= wav.Length) {
      int len = BitConverter.ToInt32(wav, i + 4);
      if (len < 0) break;
      if (wav[i] == 'd' && wav[i + 1] == 'a' && wav[i + 2] == 't' && wav[i + 3] == 'a') {
        int n = Math.Min(len, wav.Length - i - 8) / 2;
        var f = new float[n];
        for (int k = 0; k < n; k++) f[k] = BitConverter.ToInt16(wav, i + 8 + k * 2) / 32768f;
        return f;
      }
      i += 8 + len + (len & 1);
    }
    return new float[0];
  }
  static string ReadLine(Stream s) {
    var b = new StringBuilder();
    while (true) {
      int c = s.ReadByte();
      if (c < 0) return null;
      if (c == '\n') return b.ToString().TrimEnd('\r');
      if (b.Length > 64) return "";
      b.Append((char)c);
    }
  }
  public static void Run(string dir, string model, bool gpu, int threads) {
    var output = Console.Out;
    SetDllDirectoryW(dir);
    LoadLibraryW(Path.Combine(dir, "ggml.dll"));
    LoadLibraryW(Path.Combine(dir, "parakeet.dll"));
    parakeet_log_set(quiet, IntPtr.Zero);
    ggml_backend_load_all();
    IntPtr ctx = parakeet_init_from_file_with_params(model, new CtxParams { use_gpu = gpu, gpu_device = 0 });
    if (ctx == IntPtr.Zero) { output.WriteLine("err the model did not load"); output.Flush(); return; }
    IntPtr dp = parakeet_full_default_params_by_ref(0);
    var fp = (FullParams)Marshal.PtrToStructure(dp, typeof(FullParams));
    parakeet_free_params(dp);
    fp.n_threads = threads;
    output.WriteLine("ready"); output.Flush();
    var input = Console.OpenStandardInput();
    while (true) {
      string head = ReadLine(input);
      if (head == null || head == "quit") return;
      int n;
      if (!head.StartsWith("pass ") || !int.TryParse(head.Substring(5), out n) || n < 0 || n > 64 * 1024 * 1024) { output.WriteLine("err a bad request"); output.Flush(); return; }
      var wav = new byte[n]; int got = 0;
      while (got < n) { int r = input.Read(wav, got, n - got); if (r <= 0) return; got += r; }
      var pcm = Pcm(wav);
      if (pcm.Length == 0) { output.WriteLine("ok "); output.Flush(); continue; }
      int rc = parakeet_full(ctx, fp, pcm, pcm.Length);
      if (rc != 0) { output.WriteLine("err the pass failed (" + rc + ")"); output.Flush(); continue; }
      var sb = new StringBuilder();
      int segs = parakeet_full_n_segments(ctx);
      for (int s = 0; s < segs; s++) sb.Append(Utf8(parakeet_full_get_segment_text(ctx, s)));
      output.WriteLine("ok " + Convert.ToBase64String(Encoding.UTF8.GetBytes(sb.ToString().Trim())));
      output.Flush();
    }
  }
}
'@
$loaded = $false
if ($cache) {
  try {
    $sha = [Security.Cryptography.SHA256]::Create()
    $hash = ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($src))) -replace '-', '').Substring(0, 16)
    $dll = Join-Path $cache "pt-parakeet-host-$hash.dll"
    if (-not (Test-Path -LiteralPath $dll)) {
      New-Item -ItemType Directory -Force -Path $cache | Out-Null
      $tmp = Join-Path $cache "pt-parakeet-host-$hash-$PID.dll"
      Add-Type -TypeDefinition $src -OutputAssembly $tmp -OutputType Library
      Move-Item -LiteralPath $tmp -Destination $dll -Force -ErrorAction SilentlyContinue
      if (Test-Path -LiteralPath $tmp) { Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue }
    }
    Add-Type -LiteralPath $dll
    $loaded = $true
  } catch { $loaded = $false }
}
if (-not $loaded) { Add-Type -TypeDefinition $src }
[PTParakeetHost]::Run($dir, $model, $gpu -eq 1, $threads)
