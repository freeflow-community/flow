# Google sign-in always asks which account

- `[ios]` The in-app auth sheet no longer shares Safari's session, so Google
  asks which account to use instead of silently reusing the device's.
- `[web]` The `/?native=google` handoff page gained "Not you? Use a different
  account" on every phase after the sign-in screen — the auto-handoff for an
  existing web session now has a way out.

## Feature

- **Sign in as whoever you meant to.** Continuing with Google now lets you pick
  the account — on iPhone it asks every time, and the "send me back to the app"
  page has a "Not you?" escape if it signed you in as the wrong one.
