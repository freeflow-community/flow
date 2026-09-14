# Notice a dead socket instead of waiting for the OS to admit it

- `[macos]` `[ios]` `[web]` Every client now watches for inbound frames and
  reconnects after ~70s of silence (two missed server heartbeats). A socket
  that dies half-open — laptop asleep, Wi-Fi gone — reports nothing at all, so
  clients kept believing they were connected and never ran the reconnect
  backfill (#271).
- `[macos]` `[ios]` Waking from sleep (macOS) or returning to the foreground
  (iOS) rechecks the socket immediately, so catch-up starts at once rather
  than up to 70s later; the web client does the same on `visibilitychange`.
- `[qa]` `SocketWatchdogTests` drives the real `SocketClient` against a local
  WebSocket server that greets and then goes quiet — the failure, reproduced
  without a laptop.

## Feature

- **Open the lid and see what you missed.** Channels and messages that arrived
  while your machine was asleep now show up on their own, instead of the app
  quietly showing you a stale workspace until you clicked something.
