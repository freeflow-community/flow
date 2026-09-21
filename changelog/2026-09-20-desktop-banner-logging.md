# Desktop: log banner failures, and attempts under FLOW_DESKTOP_DEBUG

- `[desktop]` A banner macOS refuses (an unsigned dev binary, `UNErrorDomain
  error 1`) is logged instead of failing silently; `FLOW_DESKTOP_DEBUG=1` also
  logs each banner the renderer asks for and each one shown.
