# Spreadsheet previews in chat and the Files panel

- `[web]` xlsx, xlsm, xls, ods, csv and tsv attachments render as a small
  grid in the message (first sheet, top-left corner); click opens a full
  reader with sheet tabs, row numbers and column letters, capped at 500 rows
  × 50 columns per sheet with a note about what was left out. The Files
  panel preview uses the same view. Parsed in the browser with SheetJS CE
  0.20.3 (from its own CDN; the npm release lacks two parser security fixes),
  loaded lazily as its own chunk. Files over 10 MB keep the plain chip.
- `[macos]` `[ios]` Not on the native clients — Parity gap.

## Feature

- **Spreadsheets preview inline.** Drop an Excel, OpenDocument or CSV file
  into a message and see its first rows right in the chat. Click it to open
  the full reader, with a tab per sheet. The channel Files panel previews
  them the same way.
