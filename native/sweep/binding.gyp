{
  # SPIKE build (#338, task 1). Task 4 adds /W4 /WX and the dumpbin allow-list.
  # /MT: the static CRT, so the .node needs nothing from the VC++ redistributable.
  "targets": [
    {
      "target_name": "prism_sweep",
      "sources": ["sweep.cc"],
      "defines": ["UNICODE", "_UNICODE", "WIN32_LEAN_AND_MEAN", "NOMINMAX", "NAPI_VERSION=8"],
      "libraries": ["d3d11.lib", "dxgi.lib", "dcomp.lib", "user32.lib"],
      "msvs_settings": {
        "VCCLCompilerTool": {
          "RuntimeLibrary": 0,
          "Optimization": 2,
          "ExceptionHandling": 1
        }
      },
      "configurations": {
        "Release": {
          "msvs_settings": {
            "VCCLCompilerTool": { "RuntimeLibrary": 0 }
          }
        }
      }
    }
  ]
}
