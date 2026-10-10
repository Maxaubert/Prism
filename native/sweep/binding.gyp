{
  # The native sweep box (#338), built by tools/build-sweep.mjs.
  # /MT: the static CRT, so the .node needs nothing from the VC++ redistributable
  # on a fresh Windows (the build checks dumpbin /dependents against an
  # allow-list). /W4 /WX: a warning fails the build. node-gyp's own common.gypi
  # sets the language standard its Node headers need (C++20).
  "targets": [
    {
      "target_name": "prism_sweep",
      "sources": ["sweep.cc", "overlay.cc"],
      "defines": ["UNICODE", "_UNICODE", "WIN32_LEAN_AND_MEAN", "NOMINMAX", "NAPI_VERSION=8"],
      "libraries": ["d3d11.lib", "dxgi.lib", "dcomp.lib", "user32.lib"],
      "win_delay_load_hook": "true",
      "msvs_settings": {
        "VCCLCompilerTool": {
          "RuntimeLibrary": 0,
          "Optimization": 2,
          "ExceptionHandling": 1,
          "WarningLevel": 4,
          "WarnAsError": "true"
        }
      },
      "configurations": {
        "Release": {
          "msvs_settings": {
            "VCCLCompilerTool": { "RuntimeLibrary": 0, "WarningLevel": 4, "WarnAsError": "true" }
          }
        }
      }
    }
  ]
}
