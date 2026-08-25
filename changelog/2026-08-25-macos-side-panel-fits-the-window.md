# macOS: the side panel fits the window it is in

- `[macos]` Size the right-hand panel (Thread / Files / artifacts) from the space
  the split actually has, not from the stored preference alone. A hard-framed
  panel plus the chat column's ~410pt intrinsic minimum made the three columns
  need 1204pt while the window is allowed down to 900, and SwiftUI resolved the
  overflow by clipping — the workspace rail off the leading edge, the panel's own
  controls off the trailing one (#354).
- `[macos]` The preference is now a ceiling: the panel keeps it while there is
  room, gives up width before the chat column drops below 320pt, and squeezes to
  240pt before chat yields at all. Nothing is ever pushed past the window edge.
- `[macos]` Image and video attachment cards fit the transcript column instead
  of holding a fixed width and clipping out of it. Their size cap is unchanged
  (480/560pt); below that they now scale with the column, which is what a
  message beside an open panel needs.

## Feature

- **Opening a thread or the Files list no longer wrecks the Mac layout.** The
  panel fits the window at any size — the workspace rail and channel list stay
  put, and the panel narrows instead of running off the edge.
